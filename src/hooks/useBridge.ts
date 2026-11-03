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
  const isRafRef = useRef<boolean>(false);
  const lastFlushTsRef = useRef<number>(0);

  const cancelPendingTimer = () => {
    if (timerRef.current !== null) {
      if (isRafRef.current && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(timerRef.current);
      } else if (typeof clearTimeout !== 'undefined') {
        clearTimeout(timerRef.current);
      }
      timerRef.current = null;
    }
  };

  // Coalesce high-frequency incoming frames into adaptive rAF / throttled batches
  // Reduces GC pressure and Zustand dispatch frequency on large 100k~1M buffers
  const enqueueFrames = (frames: any[]) => {
    queueRef.current.push(...frames);
    if (timerRef.current === null) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - lastFlushTsRef.current;
      // Minimum throttle interval during burst: 40ms (~25Hz) to prevent GC churn on huge buffers
      const delay = elapsed < 40 ? 40 - elapsed : 0;

      const flush = () => {
        timerRef.current = null;
        isRafRef.current = false;
        lastFlushTsRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (queueRef.current.length > 0) {
          const batch = queueRef.current;
          queueRef.current = [];
          addFramesBatch(batch);
        }
      };

      if (delay > 0 && typeof window !== 'undefined' && window.setTimeout) {
        isRafRef.current = false;
        timerRef.current = window.setTimeout(flush, delay) as unknown as number;
      } else if (typeof requestAnimationFrame !== 'undefined') {
        isRafRef.current = true;
        timerRef.current = requestAnimationFrame(flush);
      } else {
        flush();
      }
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

    // Connect to background service worker
    const port = chrome.runtime.connect({ name: 'ws-analyzer-bridge' });
    globalDevToolsPort = port;

    port.postMessage({
      type: 'ATTACH',
      tabId: chrome.devtools.inspectedWindow.tabId,
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'FRAMES_BATCH' && Array.isArray(msg.frames)) {
        enqueueFrames(msg.frames);
      }
    });

    return () => {
      try {
        port.postMessage({ type: 'DETACH' });
        port.disconnect();
      } catch {
        // Ignore disconnect error
      }
      globalDevToolsPort = null;
      cancelPendingTimer();
    };
  }, [addFramesBatch, setMockActive]);
}
