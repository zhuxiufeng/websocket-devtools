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

        port.onMessage.addListener((msg) => {
          if (msg.type === 'PING') return;
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

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
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
