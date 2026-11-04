import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  main() {
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket || (NativeWebSocket as any).__ws_telemetry_hooked__) return;

    interface SocketMeta {
      id: string;
      url: string;
      ws: WebSocket;
      startTime: number;
      frameCount: number;
      inCount: number;
      outCount: number;
    }

    const activeSockets = new Map<WebSocket, SocketMeta>();
    const inPageFrameBuffer: any[] = [];
    const MAX_INPAGE_BUFFER = 500;
    let frameCounter = 0;

    const WrappedWebSocket = function (this: any, url: string | URL, protocols?: string | string[]) {
      const resolvedUrl = typeof url === 'string' ? url : url.toString();
      const ws = protocols !== undefined ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
      const startTime = Date.now();

      const meta: SocketMeta = {
        id: resolvedUrl,
        url: resolvedUrl,
        ws,
        startTime,
        frameCount: 0,
        inCount: 0,
        outCount: 0,
      };
      activeSockets.set(ws, meta);

      // Notify socket created
      window.postMessage(
        {
          __ws_telemetry__: true,
          type: 'SOCKET_CREATED',
          connection: {
            id: resolvedUrl,
            url: resolvedUrl,
            status: 'open',
            frameCount: 0,
            inCount: 0,
            outCount: 0,
            startTime,
          },
        },
        '*'
      );

      // Hook send (outgoing frames)
      const originalSend = ws.send;
      ws.send = function (data: any) {
        try {
          const sendTime = Date.now();
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
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            isBinary = true;
            length = data.size;
            payload = `[Binary Blob: ${length} bytes]`;
          } else {
            payload = String(data);
            length = payload.length;
          }

          // Zero-overhead JSON detection without blocking main thread
          const isJson =
            !isBinary &&
            payload.length > 0 &&
            (payload.charCodeAt(0) === 123 || payload.charCodeAt(0) === 91);

          meta.frameCount++;
          meta.outCount++;

          const frame = {
            id: `f_${startTime}_${++frameCounter}`,
            connectionId: resolvedUrl,
            direction: 'out',
            timestamp: sendTime,
            length,
            payload,
            isJson,
            isBinary,
          };

          inPageFrameBuffer.push(frame);
          if (inPageFrameBuffer.length > MAX_INPAGE_BUFFER) {
            inPageFrameBuffer.shift();
          }

          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'FRAME',
              frame,
            },
            '*'
          );
        } catch (err) {
          // Keep fail-safe
        }
        return originalSend.apply(this, arguments as any);
      };

      // Hook message (incoming frames)
      ws.addEventListener('message', (event) => {
        try {
          const recvTime = Date.now();
          const data = event.data;
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
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            isBinary = true;
            length = data.size;
            payload = `[Binary Blob: ${length} bytes]`;
          }

          // Zero-overhead JSON detection without blocking main thread
          const isJson =
            !isBinary &&
            payload.length > 0 &&
            (payload.charCodeAt(0) === 123 || payload.charCodeAt(0) === 91);

          meta.frameCount++;
          meta.inCount++;

          const frame = {
            id: `f_${startTime}_${++frameCounter}`,
            connectionId: resolvedUrl,
            direction: 'in',
            timestamp: recvTime,
            length,
            payload,
            isJson,
            isBinary,
          };

          inPageFrameBuffer.push(frame);
          if (inPageFrameBuffer.length > MAX_INPAGE_BUFFER) {
            inPageFrameBuffer.shift();
          }

          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'FRAME',
              frame,
            },
            '*'
          );
        } catch (err) {
          // Keep fail-safe
        }
      });

      // Hook close
      ws.addEventListener('close', () => {
        activeSockets.delete(ws);
        window.postMessage(
          {
            __ws_telemetry__: true,
            type: 'SOCKET_CLOSED',
            connectionId: resolvedUrl,
            closedAt: Date.now(),
          },
          '*'
        );
      });

      return ws;
    } as any;

    // Handle send requests from DevTools & active state query
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.__ws_telemetry__) return;

      if (event.data.type === 'QUERY_ACTIVE_STATE') {
        // 1. Send all active sockets
        for (const [ws, meta] of activeSockets.entries()) {
          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'SOCKET_CREATED',
              connection: {
                id: meta.url,
                url: meta.url,
                status: ws.readyState === 1 ? 'open' : ws.readyState === 0 ? 'connecting' : 'closed',
                frameCount: meta.frameCount,
                inCount: meta.inCount,
                outCount: meta.outCount,
                startTime: meta.startTime,
              },
            },
            '*'
          );
        }

        // 2. Send all buffered frames from in-page ring buffer
        if (inPageFrameBuffer.length > 0) {
          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'BUFFERED_FRAMES_SYNC',
              frames: [...inPageFrameBuffer],
            },
            '*'
          );
        }
        return;
      }

      if (event.data.type === 'SEND_DATA') {
        const { connectionId, payload } = event.data;
        let targetWs: WebSocket | null = null;
        for (const [ws, meta] of activeSockets.entries()) {
          if (!connectionId || meta.url === connectionId) {
            if (ws.readyState === WebSocket.OPEN) {
              targetWs = ws;
              break;
            }
          }
        }

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(payload);
        }
      }
    });

    // Inherit prototype and static properties
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
    try {
      Object.getOwnPropertyNames(NativeWebSocket).forEach((k) => {
        if (!(k in WrappedWebSocket)) {
          try {
            (WrappedWebSocket as any)[k] = (NativeWebSocket as any)[k];
          } catch {
            // ignore read-only
          }
        }
      });
    } catch {}

    (WrappedWebSocket as any).__ws_telemetry_hooked__ = true;
    window.WebSocket = WrappedWebSocket;
  },
});
