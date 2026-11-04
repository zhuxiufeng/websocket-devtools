import { useEffect, useRef } from 'react';
import { useWSStore } from '../store/ws-store';
import { MockStreamGenerator } from '../core/mock-stream';

let globalDevToolsPort: chrome.runtime.Port | null = null;

export function sendBridgeMessage(connectionId: string, payload: string): void {
  if (globalDevToolsPort) {
    try {
      globalDevToolsPort.postMessage({
        type: 'SEND_FRAME',
        connectionId,
        payload,
      });
      return;
    } catch {
      globalDevToolsPort = null;
    }
  }

  // Fallback for standalone mock preview
  const addFramesBatch = useWSStore.getState().addFramesBatch;
  addFramesBatch([
    {
      connectionId: connectionId || 'ws://127.0.0.1:7125/websocket',
      direction: 'out',
      timestamp: Date.now(),
      length: payload.length,
      payload,
    },
  ]);
}

export function useBridge() {
  const addFramesBatch = useWSStore((s) => s.addFramesBatch);
  const isMockActive = useWSStore((s) => s.isMockActive);
  const mockSpeed = useWSStore((s) => s.mockSpeed);
  const setMockActive = useWSStore((s) => s.setMockActive);

  const mockRef = useRef<MockStreamGenerator | null>(null);
  const queueRef = useRef<any[]>([]);
  const timerRef = useRef<number | null>(null);
  const lastFlushTsRef = useRef<number>(0);

  const cancelPendingTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Coalesce high-frequency incoming frames into smooth throttled batches
  // Always uses setTimeout instead of requestAnimationFrame so that background/unfocused
  // DevTools panel continues smooth stream ingestion without freezing until mouse interaction!
  const enqueueFrames = (frames: any[]) => {
    queueRef.current.push(...frames);
    if (timerRef.current === null) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - lastFlushTsRef.current;
      // 30ms (~33Hz) target throttle interval provides silky continuous updates without GC jitter
      const delay = Math.max(0, 30 - elapsed);

      const flush = () => {
        timerRef.current = null;
        lastFlushTsRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (queueRef.current.length > 0) {
          const batch = queueRef.current;
          queueRef.current = [];
          addFramesBatch(batch);
        }
      };

      timerRef.current = window.setTimeout(flush, delay) as unknown as number;
    }
  };

  // Initialize mock generator
  useEffect(() => {
    mockRef.current = new MockStreamGenerator((frames) => {
      enqueueFrames(frames);
    });

    return () => {
      mockRef.current?.stop();
      cancelPendingTimer();
    };
  }, [addFramesBatch]);

  // Sync mock generator active & speed
  useEffect(() => {
    if (!mockRef.current) return;
    mockRef.current.setSpeed(mockSpeed);

    if (isMockActive) {
      mockRef.current.start();
    } else {
      mockRef.current.stop();
    }
  }, [isMockActive, mockSpeed]);

  // Handle Chrome DevTools Port bridge if running as extension
  useEffect(() => {
    const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.connect;
    const isDevTools = isExtension && !!chrome.devtools?.inspectedWindow;

    if (!isDevTools) {
      // In standalone browser tab preview, auto-activate mock stream
      setMockActive(true);
      return;
    }

    let isMounted = true;
    let activePort: chrome.runtime.Port | null = null;
    let reconnectTimer: any = null;
    let syncFallbackTimer: any = null;

    const requestPageSync = () => {
      if (typeof chrome === 'undefined' || !chrome.devtools?.inspectedWindow) return;
      try {
        chrome.devtools.inspectedWindow.eval<boolean>(
          `
          (function() {
            if (typeof window !== 'undefined') {
              window.postMessage({ __ws_telemetry__: true, type: 'QUERY_ACTIVE_STATE' }, '*');
              return Boolean(window.WebSocket && (window.WebSocket as any).__ws_telemetry_hooked__);
            }
            return false;
          })()
        `,
          (isHooked: any, exceptionInfo: any) => {
            if (!isHooked && !exceptionInfo) {
              // Page was loaded before extension was loaded/enabled.
              // Dynamically inject the runtime hook now so any new/reconnecting WebSockets are intercepted!
              chrome.devtools.inspectedWindow.eval(`
                (function() {
                  if (typeof window === 'undefined' || !window.WebSocket || window.WebSocket.__ws_telemetry_hooked__) return;
                  const NativeWebSocket = window.WebSocket;
                  const WrappedWebSocket = function(url, protocols) {
                    const ws = protocols !== undefined ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
                    const resolvedUrl = typeof url === 'string' ? url : url.toString();
                    const startTime = Date.now();
                    window.postMessage({
                      __ws_telemetry__: true,
                      type: 'SOCKET_CREATED',
                      connection: { id: resolvedUrl, url: resolvedUrl, status: 'open', frameCount: 0, inCount: 0, outCount: 0, startTime }
                    }, '*');
                    const origSend = ws.send;
                    ws.send = function(data) {
                      try {
                        const payload = typeof data === 'string' ? data : String(data);
                        const isJson = payload.charCodeAt(0) === 123 || payload.charCodeAt(0) === 91;
                        window.postMessage({
                          __ws_telemetry__: true,
                          type: 'FRAME',
                          frame: { connectionId: resolvedUrl, direction: 'out', timestamp: Date.now(), length: payload.length, payload, isJson, isBinary: false }
                        }, '*');
                      } catch (e) {}
                      return origSend.apply(this, arguments);
                    };
                    ws.addEventListener('message', function(ev) {
                      try {
                        const payload = typeof ev.data === 'string' ? ev.data : String(ev.data);
                        const isJson = payload.charCodeAt(0) === 123 || payload.charCodeAt(0) === 91;
                        window.postMessage({
                          __ws_telemetry__: true,
                          type: 'FRAME',
                          frame: { connectionId: resolvedUrl, direction: 'in', timestamp: Date.now(), length: payload.length, payload, isJson, isBinary: false }
                        }, '*');
                      } catch (e) {}
                    });
                    return ws;
                  };
                  WrappedWebSocket.prototype = NativeWebSocket.prototype;
                  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
                  WrappedWebSocket.__ws_telemetry_hooked__ = true;
                  window.WebSocket = WrappedWebSocket;
                })()
              `);
            }
          }
        );
      } catch {}
    };

    const connectBridge = () => {
      if (!isMounted) return;
      try {
        const port = chrome.runtime.connect({ name: 'ws-analyzer-bridge' });
        activePort = port;
        globalDevToolsPort = port;

        port.postMessage({
          type: 'ATTACH',
          tabId: chrome.devtools.inspectedWindow.tabId,
        });

        // Proactively ask inspected page for active sockets and buffered frames
        requestPageSync();
        syncFallbackTimer = setTimeout(requestPageSync, 600);

        port.onMessage.addListener((msg) => {
          if (msg.type === 'PING') return;
          if (msg.type === 'CONNECTIONS_SYNC' && Array.isArray(msg.connections)) {
            useWSStore.getState().syncConnections(msg.connections);
          }
          if (msg.type === 'FRAMES_BATCH' && Array.isArray(msg.frames)) {
            enqueueFrames(msg.frames);
          }
        });

        port.onDisconnect.addListener(() => {
          activePort = null;
          globalDevToolsPort = null;
          if (isMounted) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectBridge, 500);
          }
        });
      } catch {
        if (isMounted) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectBridge, 1000);
        }
      }
    };

    connectBridge();

    // Re-query active state when inspected page navigates or refreshes
    const onNavigatedHandler = () => {
      setTimeout(requestPageSync, 300);
    };
    chrome.devtools?.network?.onNavigated?.addListener(onNavigatedHandler);

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
      clearTimeout(syncFallbackTimer);
      if (chrome.devtools?.network?.onNavigated) {
        chrome.devtools.network.onNavigated.removeListener(onNavigatedHandler);
      }
      if (activePort) {
        try {
          activePort.postMessage({ type: 'DETACH' });
          activePort.disconnect();
        } catch {}
      }
      globalDevToolsPort = null;
      cancelPendingTimer();
    };
  }, [addFramesBatch, setMockActive]);
}
