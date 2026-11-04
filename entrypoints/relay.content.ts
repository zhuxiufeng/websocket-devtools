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

    function queueEvent(eventDetail: any) {
      pendingEvents.push(eventDetail);

      // Backpressure guard: prevent memory leaks when DevTools is closed or disconnected
      if (pendingEvents.length > MAX_QUEUE_SIZE) {
        pendingEvents.splice(0, pendingEvents.length - MAX_QUEUE_SIZE);
      }

      // Fast-flush for bursts, or batch into 16ms intervals
      if (pendingEvents.length >= BATCH_FLUSH_THRESHOLD) {
        flushNow();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushNow, 16);
      }
    }

    // Listen to messages from ws-hook in MAIN world
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data?.__ws_telemetry__) return;

      if (event.data.type === 'BUFFERED_FRAMES_SYNC' && Array.isArray(event.data.frames)) {
        for (const frame of event.data.frames) {
          queueEvent({ type: 'FRAME', frame });
        }
        flushNow();
      } else if (event.data.type !== 'SEND_DATA' && event.data.type !== 'QUERY_ACTIVE_STATE') {
        queueEvent(event.data);
      }
    });

    // Listen to query requests from background service worker
    chrome.runtime.onMessage?.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'QUERY_ACTIVE_STATE') {
        connectPort();
        window.postMessage({ __ws_telemetry__: true, type: 'QUERY_ACTIVE_STATE' }, '*');
        sendResponse?.({ status: 'ok' });
      }
    });

    // Proactively connect to service worker
    connectPort();
  },
});
