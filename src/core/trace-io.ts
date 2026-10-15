import type { WSFrame, WSConnection, CustomColumn, HighlightRule } from '../types/websocket';

export interface TraceFileFormat {
  version: 1;
  exportedAt: string;
  source: 'ws-telemetry-analyzer' | 'klipper-ws-analyzer';
  connections: WSConnection[];
  customColumns: CustomColumn[];
  highlightRules: HighlightRule[];
  frames: WSFrame[];
}

/**
 * Export frames and settings to a JSON trace string
 */
export function exportTraceJson(
  frames: WSFrame[],
  connections: WSConnection[],
  customColumns: CustomColumn[],
  highlightRules: HighlightRule[]
): string {
  const data: TraceFileFormat = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'ws-telemetry-analyzer',
    connections,
    customColumns,
    highlightRules,
    frames,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Trigger download of trace JSON in browser
 */
export function downloadTraceFile(
  frames: WSFrame[],
  connections: WSConnection[],
  customColumns: CustomColumn[],
  highlightRules: HighlightRule[],
  filename = `ws-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
) {
  const jsonStr = exportTraceJson(frames, connections, customColumns, highlightRules);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse trace JSON content (supporting native format or HAR log)
 */
export function parseTraceJson(jsonStr: string): {
  frames: WSFrame[];
  connections: WSConnection[];
  customColumns?: CustomColumn[];
  highlightRules?: HighlightRule[];
} {
  const parsed = JSON.parse(jsonStr);

  // 1. Native format (support current and legacy source tags)
  if (
    (parsed.source === 'ws-telemetry-analyzer' || parsed.source === 'klipper-ws-analyzer') &&
    Array.isArray(parsed.frames)
  ) {
    return {
      frames: parsed.frames,
      connections: parsed.connections || [],
      customColumns: parsed.customColumns,
      highlightRules: parsed.highlightRules,
    };
  }

  // 2. Standard HAR format check
  if (parsed.log && Array.isArray(parsed.log.entries)) {
    const frames: WSFrame[] = [];
    const connections: WSConnection[] = [];
    let seq = 1;

    for (const entry of parsed.log.entries) {
      const url = entry.request?.url || 'ws://unknown';
      if (Array.isArray(entry._webSocketMessages)) {
        let inCount = 0;
        let outCount = 0;
        const startTime = new Date(entry.startedDateTime || Date.now()).getTime();

        for (const msg of entry._webSocketMessages) {
          const dir = msg.type === 'receive' ? 'in' : 'out';
          if (dir === 'in') inCount++;
          else outCount++;

          const ts = startTime + (msg.time ? msg.time * 1000 : 0);
          const d = new Date(ts);
          const pad = (n: number, z = 2) => ('00' + n).slice(-z);
          const timeFormatted = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
          const payload = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);

          let jsonPayload: any = null;
          let isJson = false;
          try {
            jsonPayload = JSON.parse(payload);
            isJson = true;
          } catch {
            isJson = false;
          }

          frames.push({
            id: `frame-${seq}`,
            seq: seq++,
            connectionId: url,
            direction: dir,
            timestamp: ts,
            timeFormatted,
            length: payload.length,
            payload,
            jsonPayload,
            isJson,
            opcode: msg.opcode ?? 1,
          });
        }

        connections.push({
          id: url,
          url,
          status: 'closed',
          frameCount: inCount + outCount,
          inCount,
          outCount,
          startTime,
        });
      }
    }

    return { frames, connections };
  }

  // 3. Fallback: Array of frames directly
  if (Array.isArray(parsed)) {
    return {
      frames: parsed,
      connections: [],
    };
  }

  throw new Error('Unrecognized trace file format');
}
