import type { WSFrame, WSConnection, CustomColumn, HighlightRule } from '../types/websocket';
import { extractFrameField } from './field-extractor';

export interface TraceFileFormat {
  version: 1;
  exportedAt: string;
  source: 'ws-telemetry-analyzer' | 'klipper-ws-analyzer';
  connections: WSConnection[];
  customColumns: CustomColumn[];
  highlightRules: HighlightRule[];
  frames: WSFrame[];
}

export interface CsvExportOptions {
  enableCarryForward?: boolean;
  includePayload?: boolean;
}

/**
 * Escapes a single cell for CSV formatting (RFC 4180).
 */
export function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  let str: string;
  if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
 * Exports frames with standard columns and dynamic custom columns into CSV format.
 */
export function exportColumnsCsv(
  frames: WSFrame[],
  customColumns: CustomColumn[] = [],
  options: CsvExportOptions = {}
): string {
  const { enableCarryForward = true, includePayload = false } = options;

  // Build column headers
  const headers = [
    'Seq',
    'Direction',
    'Time',
    'Timestamp',
    'Delta_ms',
    'Length_bytes',
    'Method',
    'RPC_Kind',
    'RPC_Latency_ms',
  ];

  for (const col of customColumns) {
    headers.push(col.name || col.path);
  }

  if (includePayload) {
    headers.push('Payload');
  }

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const frame of frames) {
    const row: any[] = [
      frame.seq ?? '',
      frame.direction || 'in',
      frame.timeFormatted || '',
      frame.timestamp || '',
      frame.deltaMs !== undefined ? frame.deltaMs : '',
      frame.length ?? (frame.payload?.length || 0),
      frame.method || '',
      frame.rpcKind || '',
      frame.rpcLatencyMs !== undefined ? frame.rpcLatencyMs : '',
    ];

    // Dynamic custom columns with carry-forward support
    for (const col of customColumns) {
      let val = extractFrameField(frame, col.path);
      if ((val === undefined || val === null) && enableCarryForward && frame.carried?.[col.id]) {
        val = frame.carried[col.id].value;
      }
      row.push(val);
    }

    if (includePayload) {
      row.push(frame.payload || '');
    }

    rows.push(row.map(escapeCsvCell).join(','));
  }

  return rows.join('\r\n');
}

/**
 * Exports a single column's values as CSV with Seq and Time.
 */
export function exportSingleColumnCsv(
  frames: WSFrame[],
  col: CustomColumn | { path: string; name?: string; id?: string },
  enableCarryForward = true
): string {
  const colName = col.name || col.path;
  const colId = (col as any).id || col.path;
  const rows: string[] = [`Seq,Time,${escapeCsvCell(colName)}`];

  for (const frame of frames) {
    let val = extractFrameField(frame, col.path);
    if ((val === undefined || val === null) && enableCarryForward && frame.carried?.[colId]) {
      val = frame.carried[colId].value;
    }
    rows.push(`${frame.seq ?? ''},${escapeCsvCell(frame.timeFormatted || '')},${escapeCsvCell(val)}`);
  }

  return rows.join('\r\n');
}

/**
 * Trigger download of CSV file with UTF-8 BOM for Microsoft Excel / Sheets compatibility.
 */
export function downloadCsvFile(
  csvContent: string,
  filename = `ws-columns-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
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
