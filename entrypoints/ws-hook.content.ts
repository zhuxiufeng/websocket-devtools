import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  main() {
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket || (NativeWebSocket as any).__ws_telemetry_hooked__) return;

    const activeSockets = new Map<string, WebSocket>();

    const WrappedWebSocket = function (this: any, url: string | URL, protocols?: string | string[]) {
      const resolvedUrl = typeof url === 'string' ? url : url.toString();
      const ws = new NativeWebSocket(url, protocols);
      const startTime = Date.now();

      activeSockets.set(resolvedUrl, ws);

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

          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'FRAME',
              frame: {
                connectionId: resolvedUrl,
                direction: 'out',
                timestamp: sendTime,
                length,
                payload,
                isJson,
                isBinary,
              },
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

          window.postMessage(
            {
              __ws_telemetry__: true,
              type: 'FRAME',
              frame: {
                connectionId: resolvedUrl,
                direction: 'in',
                timestamp: recvTime,
                length,
                payload,
                isJson,
                isBinary,
              },
            },
            '*'
          );
        } catch (err) {
          // Keep fail-safe
        }
      });

      // Hook close
      ws.addEventListener('close', () => {
        activeSockets.delete(resolvedUrl);
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

    // Handle send requests from DevTools Replay / Injector
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.__ws_telemetry__) return;
      if (event.data.type === 'SEND_DATA') {
        const { connectionId, payload } = event.data;
        let targetWs = connectionId ? activeSockets.get(connectionId) : null;
        if (!targetWs) {
          targetWs = activeSockets.values().next().value;
        }

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(payload);
        }
      }
    });

    // Inherit prototype and static properties
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.keys(NativeWebSocket).forEach((k) => {
      try {
        WrappedWebSocket[k] = (NativeWebSocket as any)[k];
      } catch {
        // ignore read-only
      }
    });

    (WrappedWebSocket as any).__ws_telemetry_hooked__ = true;
    window.WebSocket = WrappedWebSocket;
  },
});
