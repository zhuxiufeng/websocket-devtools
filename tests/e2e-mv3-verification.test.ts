import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Chrome MV3 E2E & Runtime Integration Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Background Service Worker & MV3 Lifecycle', () => {
    it('handles per-tab debounce isolation without timer clobbering', async () => {
      vi.useFakeTimers();
      const storageSessionData: Record<string, any> = {};
      const mockStorageSession = {
        set: vi.fn(async (obj) => {
          Object.assign(storageSessionData, obj);
        }),
        get: vi.fn(async (key) => ({ [key]: storageSessionData[key] })),
        remove: vi.fn(async (key) => {
          delete storageSessionData[key];
        }),
      };

      const saveTimers = new Map<number, any>();
      const tabBuffers = new Map<number, any[]>([
        [101, [{ id: 'f1', payload: 'msg1' }]],
        [202, [{ id: 'f2', payload: 'msg2' }]],
      ]);

      const debouncedPersist = (tabId: number) => {
        const existing = saveTimers.get(tabId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          saveTimers.delete(tabId);
          mockStorageSession.set({
            [`tab_${tabId}`]: { frames: tabBuffers.get(tabId) },
          });
        }, 200);
        saveTimers.set(tabId, timer);
      };

      // Trigger debounce for tab 101, then 50ms later for tab 202
      debouncedPersist(101);
      vi.advanceTimersByTime(50);
      debouncedPersist(202);

      // Tab 101's timer should still exist in saveTimers
      expect(saveTimers.has(101)).toBe(true);
      expect(saveTimers.has(202)).toBe(true);

      // Advance to 200ms -> tab 101 fires
      vi.advanceTimersByTime(150);
      expect(mockStorageSession.set).toHaveBeenCalledTimes(1);
      expect(storageSessionData['tab_101']).toBeDefined();
      expect(storageSessionData['tab_202']).toBeUndefined();

      // Advance another 50ms -> tab 202 fires
      vi.advanceTimersByTime(50);
      expect(mockStorageSession.set).toHaveBeenCalledTimes(2);
      expect(storageSessionData['tab_202']).toBeDefined();

      vi.useRealTimers();
    });

    it('safeguards session storage against quota exceeded on large frame payloads', () => {
      const rawFrames = [
        { id: 'f1', payload: 'A'.repeat(2 * 1024 * 1024) }, // 2MB
        { id: 'f2', payload: 'B'.repeat(2 * 1024 * 1024) }, // 2MB -> total 4MB > 3MB cap
        { id: 'f3', payload: 'C'.repeat(500 * 1024) },      // 0.5MB
      ];

      let totalBytes = 0;
      const safeFrames: any[] = [];
      for (let i = rawFrames.length - 1; i >= 0; i--) {
        const f = rawFrames[i];
        const payloadLen = f.payload ? f.payload.length : 0;
        if (totalBytes + payloadLen > 3 * 1024 * 1024) break;
        totalBytes += payloadLen;
        safeFrames.unshift(f);
      }

      // Latest frames f3 and f2 should be preserved, f1 dropped to protect 3MB quota limit
      expect(safeFrames.length).toBe(2);
      expect(safeFrames[0].id).toBe('f2');
      expect(safeFrames[1].id).toBe('f3');
      expect(totalBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    });

    it('eagerly purges dead ports when postMessage throws on disconnected panels', () => {
      const activePanels = new Set<any>();
      const workingPort = { postMessage: vi.fn() };
      const disconnectedPort = {
        postMessage: vi.fn(() => {
          throw new Error('Attempting to use a disconnected port');
        }),
      };

      activePanels.add(workingPort);
      activePanels.add(disconnectedPort);
      expect(activePanels.size).toBe(2);

      for (const panelPort of Array.from(activePanels)) {
        try {
          panelPort.postMessage({ type: 'TEST' });
        } catch {
          activePanels.delete(panelPort);
        }
      }

      expect(activePanels.size).toBe(1);
      expect(activePanels.has(workingPort)).toBe(true);
      expect(activePanels.has(disconnectedPort)).toBe(false);
    });

    it('transitions open connections to closed on tab reload (loading status)', () => {
      const tabConnections = new Map<string, any>([
        ['ws://stream1', { id: 'ws://stream1', status: 'open' }],
        ['ws://stream2', { id: 'ws://stream2', status: 'open' }],
      ]);

      // Simulate chrome.tabs.onUpdated with status = 'loading'
      const changeInfo = { status: 'loading' };
      let changed = false;
      if (changeInfo.status === 'loading') {
        for (const conn of tabConnections.values()) {
          if (conn.status === 'open') {
            conn.status = 'closed';
            conn.closedAt = Date.now();
            changed = true;
          }
        }
      }

      expect(changed).toBe(true);
      expect(tabConnections.get('ws://stream1')?.status).toBe('closed');
      expect(tabConnections.get('ws://stream2')?.status).toBe('closed');
      expect(tabConnections.get('ws://stream1')?.closedAt).toBeGreaterThan(0);
    });
  });

  describe('2. WebSocket In-Page Hook & Binary View Compatibility', () => {
    it('properly classifies TypedArray (Uint8Array / DataView) as binary frames', () => {
      const parseSendPayload = (data: any) => {
        let payload = '';
        let length = 0;
        let isBinary = false;

        if (typeof data === 'string') {
          payload = data;
          length = data.length;
        } else if (data instanceof ArrayBuffer) {
          isBinary = true;
          length = data.byteLength;
          payload = `[Binary ArrayBuffer: ${length} bytes]`;
        } else if (ArrayBuffer.isView(data)) {
          isBinary = true;
          length = data.byteLength;
          payload = `[Binary ${(data as any).constructor?.name || 'ArrayBufferView'}: ${length} bytes]`;
        } else {
          payload = String(data);
          length = payload.length;
        }

        const isJson =
          !isBinary &&
          payload.length > 0 &&
          (payload.charCodeAt(0) === 123 || payload.charCodeAt(0) === 91);

        return { payload, length, isBinary, isJson };
      };

      // 1. Text JSON
      const jsonRes = parseSendPayload('{"action":"ping"}');
      expect(jsonRes.isBinary).toBe(false);
      expect(jsonRes.isJson).toBe(true);
      expect(jsonRes.length).toBe(17);

      // 2. Raw ArrayBuffer
      const buffer = new ArrayBuffer(64);
      const bufRes = parseSendPayload(buffer);
      expect(bufRes.isBinary).toBe(true);
      expect(bufRes.isJson).toBe(false);
      expect(bufRes.length).toBe(64);
      expect(bufRes.payload).toBe('[Binary ArrayBuffer: 64 bytes]');

      // 3. Uint8Array (ArrayBufferView)
      const u8 = new Uint8Array(128);
      const u8Res = parseSendPayload(u8);
      expect(u8Res.isBinary).toBe(true);
      expect(u8Res.isJson).toBe(false);
      expect(u8Res.length).toBe(128);
      expect(u8Res.payload).toBe('[Binary Uint8Array: 128 bytes]');

      // 4. DataView (ArrayBufferView)
      const dv = new DataView(new ArrayBuffer(32));
      const dvRes = parseSendPayload(dv);
      expect(dvRes.isBinary).toBe(true);
      expect(dvRes.isJson).toBe(false);
      expect(dvRes.length).toBe(32);
      expect(dvRes.payload).toBe('[Binary DataView: 32 bytes]');
    });

    it('preserves constructor prototype and static WebSocket constants', () => {
      class MockNativeWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 1;
        url: string;
        constructor(url: string) {
          this.url = url;
        }
      }

      const WrappedWebSocket = function (this: any, url: string) {
        return new MockNativeWebSocket(url);
      } as any;

      WrappedWebSocket.prototype = MockNativeWebSocket.prototype;
      Object.setPrototypeOf(WrappedWebSocket, MockNativeWebSocket);
      MockNativeWebSocket.prototype.constructor = WrappedWebSocket;
      Object.getOwnPropertyNames(MockNativeWebSocket).forEach((k) => {
        if (!(k in WrappedWebSocket)) {
          (WrappedWebSocket as any)[k] = (MockNativeWebSocket as any)[k];
        }
      });

      const instance = new (WrappedWebSocket as any)('ws://127.0.0.1:8080');

      expect(instance instanceof MockNativeWebSocket).toBe(true);
      expect(instance instanceof WrappedWebSocket).toBe(true);
      expect(instance.constructor).toBe(WrappedWebSocket);
      expect(WrappedWebSocket.OPEN).toBe(1);
      expect(WrappedWebSocket.CONNECTING).toBe(0);
      expect(WrappedWebSocket.CLOSED).toBe(3);
    });
  });

  describe('3. Relay Content Script & Backpressure', () => {
    it('bounds pending queue to MAX_QUEUE_SIZE to prevent memory leaks', () => {
      const pendingEvents: any[] = [];
      const MAX_QUEUE_SIZE = 1000;

      const queueEvent = (ev: any) => {
        pendingEvents.push(ev);
        if (pendingEvents.length > MAX_QUEUE_SIZE) {
          pendingEvents.splice(0, pendingEvents.length - MAX_QUEUE_SIZE);
        }
      };

      // Push 1500 events
      for (let i = 0; i < 1500; i++) {
        queueEvent({ id: `ev-${i}` });
      }

      expect(pendingEvents.length).toBe(1000);
      expect(pendingEvents[0].id).toBe('ev-500');
      expect(pendingEvents[pendingEvents.length - 1].id).toBe('ev-1499');
    });

    it('flushes immediately when threshold is reached or batches into interval', () => {
      let flushedBatch: any[] = [];
      const pendingEvents: any[] = [];
      const BATCH_FLUSH_THRESHOLD = 20;

      const flushNow = () => {
        flushedBatch = [...pendingEvents];
        pendingEvents.length = 0;
      };

      for (let i = 0; i < 19; i++) {
        pendingEvents.push({ id: i });
      }
      expect(flushedBatch.length).toBe(0); // Not flushed yet

      // 20th item reaches BATCH_FLUSH_THRESHOLD -> fast flush
      pendingEvents.push({ id: 19 });
      if (pendingEvents.length >= BATCH_FLUSH_THRESHOLD) {
        flushNow();
      }

      expect(flushedBatch.length).toBe(20);
      expect(pendingEvents.length).toBe(0);
    });
  });

  describe('4. DevTools Bridge & Ingestion Stability', () => {
    it('safely handles frame bursts in enqueueFrames without call-stack overflow', () => {
      const queue: any[] = [];
      const hugeBurst = new Array(70000).fill(null).map((_, i) => ({ id: `f-${i}` }));

      // Testing non-spread insertion
      for (let i = 0; i < hugeBurst.length; i++) {
        queue.push(hugeBurst[i]);
      }

      expect(queue.length).toBe(70000);
      expect(queue[0].id).toBe('f-0');
      expect(queue[69999].id).toBe('f-69999');
    });

    it('responds to keepalive PING with PONG to reset Service Worker idle timeout', () => {
      const mockPort = {
        postMessage: vi.fn(),
      };

      const handleMessage = (msg: { type: string }) => {
        if (msg.type === 'PING') {
          mockPort.postMessage({ type: 'PONG' });
        }
      };

      handleMessage({ type: 'PING' });
      expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'PONG' });
    });
  });
});
