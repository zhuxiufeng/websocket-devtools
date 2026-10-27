export type FrameDirection = 'in' | 'out';

export type RpcKind = 'request' | 'response' | 'error' | 'notification' | 'none';

export interface CarriedValue {
  value: any;
  /** id of the frame the value was last seen in */
  fromId: string;
}

export interface WSFrame {
  /** Unique, store-assigned id: `frame-${seq}` */
  id: string;
  /** Monotonic, contiguous sequence number assigned at ingestion (frames[i].seq === frames[0].seq + i) */
  seq?: number;
  connectionId: string;
  direction: FrameDirection;
  timestamp: number;
  timeFormatted: string; // HH:mm:ss.SSS
  /** Payload size in bytes (UTF-8 for text frames, raw bytes for binary frames) */
  length: number;
  /** Display payload: text as-is; binary frames rendered as a hex preview */
  payload: string;
  jsonPayload: any | null;
  isJson: boolean;
  opcode?: number;
  isBinary?: boolean;
  /** Raw base64 data for binary frames (kept for export / raw view) */
  rawBase64?: string;
  cachedExtractions?: Record<string, any>;

  // ---- Derived at ingestion ----
  /** Display method, e.g. `notify_status_update`, `↩ server.info`, `(binary)` */
  method?: string;
  rpcKind?: RpcKind;
  rpcId?: string | number;
  /** Paired request/response frame id */
  rpcPeerId?: string;
  rpcLatencyMs?: number;
  /** Moonraker status delta contained in this frame (reference into jsonPayload) */
  statusDelta?: Record<string, any>;
  /** Time delta in milliseconds from the previous frame on this connection (or stream) */
  deltaMs?: number;
  /** Last-known values for custom columns this frame does not contain itself */
  carried?: Record<string, CarriedValue>;
}

export interface WSConnection {
  id: string;
  url: string;
  status: 'open' | 'closed';
  frameCount: number;
  inCount: number;
  outCount: number;
  startTime: number;
  closedAt?: number;
}

export interface CustomColumn {
  id: string;
  name: string;
  path: string;
  width?: number;
}

export interface TelemetryPoint {
  time: number;
  value: number;
  formattedTime: string;
}

export interface TelemetrySeries {
  id: string;
  label: string;
  fieldPath: string;
  color: string;
  dataPoints: TelemetryPoint[];
  subIndex?: number;
}

export interface HighlightRule {
  id: string;
  text: string;
  color: string; // Tailwind hex or class: e.g. '#f59e0b'
  active: boolean;
  tintRow: boolean;
}

export interface FilterCriteria {
  rawQuery: string;
  direction: 'all' | 'in' | 'out';
  excludeKeywords: string[];
  hasFields: string[];
  jsonKeyValues: { key: string; value: string }[];
  textKeywords: string[];
  regexes: RegExp[];
  excludeRegexes: RegExp[];
}

export interface MethodStat {
  method: string;
  count: number;
  inCount: number;
  outCount: number;
  bytes: number;
  lastTs: number;
}

export type CaptureStatus = 'idle' | 'mock' | 'attaching' | 'attached' | 'error' | 'detached' | 'imported';

export type MockStreamSpeed = '10Hz' | '20Hz' | '50Hz';
