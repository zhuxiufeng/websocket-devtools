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
  const rafRef = useRef<number | null>(null);

  // Coalesce high-frequency incoming frames into 60fps rAF batches
  const enqueueFrames = (frames: any[]) => {
    queueRef.current.push(...frames);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (queueRef.current.length > 0) {
          const batch = queueRef.current;
          queueRef.current = [];
          addFramesBatch(batch);
        }
      });
    }
  };

  // Initialize mock generator
  useEffect(() => {
    mockRef.current = new MockStreamGenerator((frames) => {
      enqueueFrames(frames);
    });

    return () => {
      mockRef.current?.stop();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [addFramesBatch, setMockActive]);
}
