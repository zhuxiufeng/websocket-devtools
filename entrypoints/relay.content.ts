import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  allFrames: true,
  main() {
    let port: chrome.runtime.Port | null = null;
    let pendingEvents: any[] = [];
    let flushTimer: any = null;
    const MAX_QUEUE_SIZE = 1000;
    const BATCH_FLUSH_THRESHOLD = 20;

    function flushNow() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingEvents.length === 0) return;

      if (!port) {
        connectPort();
      }

      if (port) {
        try {
          const batch = pendingEvents;
          pendingEvents = [];
          port.postMessage({ type: 'EVENTS_BATCH', events: batch });
        } catch {
          port = null;
        }
      }
    }

    function connectPort() {
      if (port) return;
      try {
        port = chrome.runtime.connect({ name: 'ws-telemetry-relay' });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'SEND_DATA') {
            window.postMessage(
              {
                __ws_telemetry__: true,
                type: 'SEND_DATA',
                connectionId: msg.connectionId,
                payload: msg.payload,
              },
              '*'
            );
          }
        });

        port.onDisconnect.addListener(() => {
          port = null;
        });
      } catch {
        port = null;
      }
    }

    function queueEvent(eventDetail: any) {
      pendingEvents.push(eventDetail);

      // Backpressure guard: prevent memory leaks when DevTools is closed or disconnected
      if (pendingEvents.length > MAX_QUEUE_SIZE) {
        pendingEvents.splice(0, pendingEvents.length - MAX_QUEUE_SIZE);
      }

      // Fast-flush for bursts, or batch into 16ms animation frame intervals
      if (pendingEvents.length >= BATCH_FLUSH_THRESHOLD) {
        flushNow();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushNow, 16);
      }
    }

    // Lazy listen: Do not connectPort() upfront. Only connect when first WS event arrives!
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.__ws_telemetry__) return;
      if (event.data.type !== 'SEND_DATA') {
        queueEvent(event.data);
      }
    });
  },
});
