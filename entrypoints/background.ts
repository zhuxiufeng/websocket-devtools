import { defineBackground } from 'wxt/utils/define-background';
import type { WSFrame, WSConnection } from '../src/types/websocket';

export default defineBackground(() => {
  // Panel ports mapped by inspected tabId
  const panelPortsByTab = new Map<number, Set<chrome.runtime.Port>>();

  // Active content script relay ports per tab
  const contentPortsByTab = new Map<number, Set<chrome.runtime.Port>>();

  // Ring buffer of recent frames per tab (retained for late DevTools opening)
  const tabFrameBuffers = new Map<number, Partial<WSFrame>[]>();
  const tabConnections = new Map<number, Map<string, WSConnection>>();

  const MAX_TAB_BUFFER = 2000;

  // Persist recent tab state to chrome.storage.session so Service Worker termination won't lose buffer
  const saveTimers = new Map<number, any>();
  const debouncedPersistTabSession = (tabId: number) => {
    if (!chrome.storage?.session) return;
    const existingTimer = saveTimers.get(tabId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      saveTimers.delete(tabId);
      try {
        const rawFrames = (tabFrameBuffers.get(tabId) || []).slice(-300);
        // Quota safeguard: bound total payload size under 3MB to avoid exceeding QUOTA_BYTES
        let totalBytes = 0;
        const safeFrames: Partial<WSFrame>[] = [];
        for (let i = rawFrames.length - 1; i >= 0; i--) {
          const f = rawFrames[i];
          const payloadLen = f.payload ? f.payload.length : 0;
          if (totalBytes + payloadLen > 3 * 1024 * 1024) break;
          totalBytes += payloadLen;
          safeFrames.unshift(f);
        }

        const conns = Array.from(tabConnections.get(tabId)?.values() || []);
        chrome.storage.session.set({
          [`tab_${tabId}`]: { frames: safeFrames, conns, ts: Date.now() },
        }).catch(() => {});
      } catch {}
    }, 200);

    saveTimers.set(tabId, timer);
  };

  const restoreTabSession = async (tabId: number) => {
    if (!chrome.storage?.session) return;
    try {
      const data = await chrome.storage.session.get(`tab_${tabId}`);
      const entry = data?.[`tab_${tabId}`] as { frames?: Partial<WSFrame>[]; conns?: WSConnection[] } | undefined;
      if (entry && Array.isArray(entry.frames)) {
        if (!tabFrameBuffers.has(tabId) || tabFrameBuffers.get(tabId)!.length === 0) {
          tabFrameBuffers.set(tabId, entry.frames);
        }
        if (!tabConnections.has(tabId) || tabConnections.get(tabId)!.size === 0) {
          const map = new Map<string, WSConnection>();
          for (const c of entry.conns || []) {
            map.set(c.id, c);
          }
          tabConnections.set(tabId, map);
        }
      }
    } catch {}
  };

  // Handle incoming connections
  chrome.runtime.onConnect?.addListener((port) => {
    // 1. Connection from ISOLATED content script (relay from webpage)
    if (port.name === 'ws-telemetry-relay') {
      const tabId = port.sender?.tab?.id;
      if (tabId === undefined) return;

      let ports = contentPortsByTab.get(tabId);
      if (!ports) {
        ports = new Set();
        contentPortsByTab.set(tabId, ports);
      }
      ports.add(port);

      // Proactively query active state from newly connected content script if DevTools panel is already watching
      if (panelPortsByTab.get(tabId)?.size) {
        try {
          port.postMessage({ type: 'QUERY_ACTIVE_STATE' });
        } catch {}
      }

      let buffer = tabFrameBuffers.get(tabId);
      if (!buffer) {
        buffer = [];
        tabFrameBuffers.set(tabId, buffer);
      }

      let connMap = tabConnections.get(tabId);
      if (!connMap) {
        connMap = new Map();
        tabConnections.set(tabId, connMap);
      }

      port.onMessage.addListener((msg) => {
        if (msg.type === 'EVENTS_BATCH' && Array.isArray(msg.events)) {
          const newFrames: Partial<WSFrame>[] = [];
          const updatedConns: WSConnection[] = [];

          for (const ev of msg.events) {
            if (ev.type === 'SOCKET_CREATED' && ev.connection) {
              connMap!.set(ev.connection.id, ev.connection);
              updatedConns.push(ev.connection);
            } else if (ev.type === 'SOCKET_CLOSED') {
              const existing = connMap!.get(ev.connectionId);
              if (existing) {
                existing.status = 'closed';
                existing.closedAt = ev.closedAt || Date.now();
                updatedConns.push({ ...existing });
              }
            } else if (ev.type === 'FRAME' && ev.frame) {
              buffer!.push(ev.frame);
              newFrames.push(ev.frame);
            }
          }

          // Trim ring buffer
          if (buffer!.length > MAX_TAB_BUFFER) {
            buffer!.splice(0, buffer!.length - MAX_TAB_BUFFER);
          }

          debouncedPersistTabSession(tabId);

          // Forward to DevTools panels watching this tabId
          const watchingPanels = panelPortsByTab.get(tabId);
          if (watchingPanels && watchingPanels.size > 0) {
            if (updatedConns.length > 0) {
              for (const panelPort of watchingPanels) {
                try {
                  panelPort.postMessage({ type: 'CONNECTIONS_SYNC', connections: updatedConns });
                } catch {
                  watchingPanels.delete(panelPort);
                }
              }
            }
            if (newFrames.length > 0) {
              for (const panelPort of watchingPanels) {
                try {
                  panelPort.postMessage({ type: 'FRAMES_BATCH', frames: newFrames });
                } catch {
                  watchingPanels.delete(panelPort);
                }
              }
            }
          }
        }
      });

      port.onDisconnect.addListener(() => {
        const ports = contentPortsByTab.get(tabId);
        if (ports) {
          ports.delete(port);
          if (ports.size === 0) {
            contentPortsByTab.delete(tabId);
          }
        }
      });

      return;
    }

    // 2. Connection from DevTools Panel
    if (port.name === 'ws-analyzer-bridge') {
      let registeredTabId: number | null = null;

      // Keepalive ping prevents Service Worker from sleeping while DevTools panel is open
      const keepAliveTimer = setInterval(() => {
        try {
          port.postMessage({ type: 'PING' });
        } catch {
          clearInterval(keepAliveTimer);
        }
      }, 25000);

      port.onMessage.addListener((msg) => {
        if (msg.type === 'PONG') {
          return;
        }

        if (msg.type === 'CLEAR_BUFFER' && registeredTabId !== null) {
          tabFrameBuffers.delete(registeredTabId);
          chrome.storage?.session?.remove?.(`tab_${registeredTabId}`).catch?.(() => {});
          const conns = tabConnections.get(registeredTabId);
          if (conns) {
            for (const [id, c] of Array.from(conns.entries())) {
              if (c.status === 'closed') {
                conns.delete(id);
              } else {
                c.frameCount = 0;
                c.inCount = 0;
                c.outCount = 0;
              }
            }
          }
          debouncedPersistTabSession(registeredTabId);
          return;
        }

        if (msg.type === 'PURGE_CONNECTIONS' && registeredTabId !== null) {
          const conns = tabConnections.get(registeredTabId);
          if (conns) {
            for (const [id, c] of Array.from(conns.entries())) {
              if (c.status === 'closed') {
                conns.delete(id);
              }
            }
            debouncedPersistTabSession(registeredTabId);
          }
          return;
        }

        if (msg.type === 'REMOVE_CONNECTION' && registeredTabId !== null && msg.connectionId) {
          const conns = tabConnections.get(registeredTabId);
          if (conns) {
            conns.delete(msg.connectionId);
            debouncedPersistTabSession(registeredTabId);
          }
          return;
        }

        if (msg.type === 'ATTACH' && typeof msg.tabId === 'number') {
          const tabId = msg.tabId;
          registeredTabId = tabId;

          let panels = panelPortsByTab.get(tabId);
          if (!panels) {
            panels = new Set();
            panelPortsByTab.set(tabId, panels);
          }
          const alreadyAttached = panels.has(port);
          panels.add(port);

          port.postMessage({ type: 'ATTACHED', tabId });

          const sendCurrentState = () => {
            const connMap = tabConnections.get(tabId);
            if (connMap && connMap.size > 0) {
              port.postMessage({
                type: 'CONNECTIONS_SYNC',
                connections: Array.from(connMap.values()),
              });
            }

            const buffer = tabFrameBuffers.get(tabId);
            if (buffer && buffer.length > 0) {
              port.postMessage({ type: 'FRAMES_BATCH', frames: [...buffer] });
            }
          };

          // On first attach, restore session if needed and send current state
          if (!alreadyAttached) {
            if (!tabFrameBuffers.has(tabId) || tabFrameBuffers.get(tabId)!.length === 0) {
              restoreTabSession(tabId).then(() => {
                sendCurrentState();
              });
            } else {
              sendCurrentState();
            }
          }

          // Request active state query to inspected tab content script(s)
          chrome.tabs?.sendMessage?.(tabId, { type: 'QUERY_ACTIVE_STATE' }).catch?.(() => {});
          const contentPorts = contentPortsByTab.get(tabId);
          if (contentPorts) {
            for (const cp of contentPorts) {
              try {
                cp.postMessage({ type: 'QUERY_ACTIVE_STATE' });
              } catch {
                contentPorts.delete(cp);
              }
            }
          }
        } else if (msg.type === 'SEND_FRAME' && registeredTabId !== null) {
          // Forward message injection request to content script(s) of the inspected tab
          const contentPorts = contentPortsByTab.get(registeredTabId);
          if (contentPorts && contentPorts.size > 0) {
            for (const contentPort of contentPorts) {
              try {
                contentPort.postMessage({
                  type: 'SEND_DATA',
                  connectionId: msg.connectionId,
                  payload: msg.payload,
                });
              } catch {
                contentPorts.delete(contentPort);
              }
            }
          }
        } else if (msg.type === 'DETACH') {
          if (registeredTabId !== null) {
            const panels = panelPortsByTab.get(registeredTabId);
            if (panels) {
              panels.delete(port);
            }
          }
        }
      });

      port.onDisconnect.addListener(() => {
        clearInterval(keepAliveTimer);
        if (registeredTabId !== null) {
          const panels = panelPortsByTab.get(registeredTabId);
          if (panels) {
            panels.delete(port);
            if (panels.size === 0) {
              panelPortsByTab.delete(registeredTabId);
            }
          }
        }
      });
    }
  });

  // Handle inspected page reload/navigation: close open connections on navigating tab
  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      const connMap = tabConnections.get(tabId);
      if (connMap) {
        let changed = false;
        for (const conn of connMap.values()) {
          if (conn.status === 'open') {
            conn.status = 'closed';
            conn.closedAt = Date.now();
            changed = true;
          }
        }
        if (changed) {
          const watchingPanels = panelPortsByTab.get(tabId);
          if (watchingPanels && watchingPanels.size > 0) {
            const conns = Array.from(connMap.values());
            for (const panelPort of watchingPanels) {
              try {
                panelPort.postMessage({ type: 'CONNECTIONS_SYNC', connections: conns });
              } catch {
                watchingPanels.delete(panelPort);
              }
            }
          }
        }
      }
    }
  });

  // Clean up tab memory on tab close
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    const timer = saveTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(tabId);
    }
    tabFrameBuffers.delete(tabId);
    tabConnections.delete(tabId);
    panelPortsByTab.delete(tabId);
    contentPortsByTab.delete(tabId);
    chrome.storage?.session?.remove?.(`tab_${tabId}`).catch?.(() => {});
  });
});
