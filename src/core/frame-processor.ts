import type {
  WSFrame,
  WSConnection,
  CustomColumn,
  MethodStat,
  CarriedValue,
  RpcKind,
} from '../types/websocket';
import { extractFrameField } from './field-extractor';

// Deep merge helper for printer status updates
export function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = output[key];

    if (
      srcVal &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      output[key] = deepMerge(tgtVal, srcVal);
    } else {
      // Arrays and primitive values are replaced wholesale in Klipper/Moonraker status model
      output[key] = Array.isArray(srcVal)
        ? [...srcVal]
        : srcVal && typeof srcVal === 'object'
        ? structuredClone(srcVal)
        : srcVal;
    }
  }
  return output;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, z = 2) => ('00' + n).slice(-z);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export interface IngestContext {
  nextSeq: number;
  pendingRequests: Map<string, { id: string; method: string; timestamp: number }>;
  lastKnownValues: Map<string, Record<string, CarriedValue>>;
  methodStats: Map<string, MethodStat>;
  // Connection state snapshots
  connectionSnapshots: Map<
    string,
    {
      current: Record<string, any>;
      checkpoints: Array<{ seq: number; state: Record<string, any> }>;
    }
  >;
}

export class FrameProcessor {
  private ctx: IngestContext;

  constructor() {
    this.ctx = this.createEmptyContext();
  }

  private createEmptyContext(): IngestContext {
    return {
      nextSeq: 1,
      pendingRequests: new Map(),
      lastKnownValues: new Map(),
      methodStats: new Map(),
      connectionSnapshots: new Map(),
    };
  }

  public reset(startSeq = 1): void {
    this.ctx = this.createEmptyContext();
    this.ctx.nextSeq = startSeq;
  }

  public getMethodStats(): MethodStat[] {
    return Array.from(this.ctx.methodStats.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Reconstruct the merged printer status at a given frame sequence.
   */
  public getSnapshotAtSeq(
    connectionId: string,
    targetSeq: number,
    frames: WSFrame[]
  ): Record<string, any> {
    const connState = this.ctx.connectionSnapshots.get(connectionId);
    if (!connState) return {};

    // Find closest checkpoint <= targetSeq
    let baseState: Record<string, any> = {};
    let startSeq = 0;

    for (let i = connState.checkpoints.length - 1; i >= 0; i--) {
      const cp = connState.checkpoints[i];
      if (cp.seq <= targetSeq) {
        baseState = structuredClone(cp.state);
        startSeq = cp.seq;
        break;
      }
    }

    // Replay status deltas from startSeq to targetSeq
    for (const frame of frames) {
      if (frame.connectionId !== connectionId) continue;
      if (!frame.seq || frame.seq <= startSeq) continue;
      if (frame.seq > targetSeq) break;

      if (frame.statusDelta) {
        baseState = deepMerge(baseState, frame.statusDelta);
      }
    }

    return baseState;
  }

  /**
   * Process and ingest an incoming batch of frames
   */
  public ingestBatch(
    rawFrames: Partial<WSFrame>[],
    customColumns: CustomColumn[],
    existingFramesMap?: Map<string, WSFrame>
  ): WSFrame[] {
    const processed: WSFrame[] = [];

    for (const raw of rawFrames) {
      const seq = raw.seq ?? this.ctx.nextSeq++;
      const id = raw.id || `frame-${seq}`;
      const connId = raw.connectionId || 'default-ws';
      const timestamp = raw.timestamp || Date.now();
      const timeFormatted = raw.timeFormatted || formatTimestamp(timestamp);
      const isBinary = Boolean(raw.isBinary || raw.opcode === 2);

      let payload = raw.payload || '';
      let jsonPayload = raw.jsonPayload ?? null;
      let isJson = Boolean(raw.isJson);

      if (isBinary) {
        if (!payload && raw.rawBase64) {
          payload = `[Binary Frame: ${raw.length || 0} bytes]`;
        }
      } else if (!jsonPayload && payload && !isJson) {
        try {
          jsonPayload = JSON.parse(payload);
          isJson = true;
        } catch {
          isJson = false;
        }
      }

      // JSON-RPC classification & RPC tracking
      let method: string | undefined = raw.method;
      let rpcKind: RpcKind = raw.rpcKind || 'none';
      let rpcId: string | number | undefined = raw.rpcId;
      let rpcPeerId: string | undefined = raw.rpcPeerId;
      let rpcLatencyMs: number | undefined = raw.rpcLatencyMs;
      let statusDelta: Record<string, any> | undefined = raw.statusDelta;

      if (isBinary) {
        method = '(binary)';
      } else if (isJson && jsonPayload && typeof jsonPayload === 'object') {
        // Detect Request
        if (jsonPayload.method && jsonPayload.id !== undefined) {
          rpcKind = 'request';
          rpcId = jsonPayload.id;
          method = String(jsonPayload.method);

          // Track pending request
          const reqKey = `${connId}:${rpcId}`;
          this.ctx.pendingRequests.set(reqKey, {
            id,
            method,
            timestamp,
          });

          // Prevent memory leak on pending map
          if (this.ctx.pendingRequests.size > 2000) {
            const firstKey = this.ctx.pendingRequests.keys().next().value;
            if (firstKey) this.ctx.pendingRequests.delete(firstKey);
          }
        }
        // Detect Notification
        else if (jsonPayload.method && jsonPayload.id === undefined) {
          rpcKind = 'notification';
          method = String(jsonPayload.method);

          // Check if Moonraker status update
          if (
            method === 'notify_status_update' &&
            Array.isArray(jsonPayload.params) &&
            typeof jsonPayload.params[0] === 'object'
          ) {
            statusDelta = jsonPayload.params[0];
          }
        }
        // Detect Response or Error
        else if (jsonPayload.id !== undefined && (jsonPayload.result !== undefined || jsonPayload.error !== undefined)) {
          rpcKind = jsonPayload.error !== undefined ? 'error' : 'response';
          rpcId = jsonPayload.id;

          const reqKey = `${connId}:${rpcId}`;
          const pending = this.ctx.pendingRequests.get(reqKey);
          if (pending) {
            method = pending.method;
            rpcPeerId = pending.id;
            rpcLatencyMs = Math.max(0, timestamp - pending.timestamp);
            this.ctx.pendingRequests.delete(reqKey);

            // Update peer frame backwards if existing map provided
            if (existingFramesMap && existingFramesMap.has(pending.id)) {
              const peer = existingFramesMap.get(pending.id)!;
              peer.rpcPeerId = id;
              peer.rpcLatencyMs = rpcLatencyMs;
            }
          } else {
            method = `id:${rpcId}`;
          }

          // Check if query status result
          if (jsonPayload.result?.status && typeof jsonPayload.result.status === 'object') {
            statusDelta = jsonPayload.result.status;
          }
        } else {
          method = method || '(json)';
        }
      } else {
        method = method || '(text)';
      }

      // Update snapshot state machine if statusDelta present
      if (statusDelta) {
        let connState = this.ctx.connectionSnapshots.get(connId);
        if (!connState) {
          connState = { current: {}, checkpoints: [] };
          this.ctx.connectionSnapshots.set(connId, connState);
        }

        connState.current = deepMerge(connState.current, statusDelta);

        // Checkpoint every 50 status frames
        if (connState.checkpoints.length === 0 || seq - connState.checkpoints[connState.checkpoints.length - 1].seq >= 50) {
          connState.checkpoints.push({
            seq,
            state: structuredClone(connState.current),
          });

          // Keep maximum 100 checkpoints per connection
          if (connState.checkpoints.length > 100) {
            connState.checkpoints.shift();
          }
        }
      }

      // Record Method Stats
      if (method) {
        const statKey = method;
        let stat = this.ctx.methodStats.get(statKey);
        if (!stat) {
          stat = {
            method: statKey,
            count: 0,
            inCount: 0,
            outCount: 0,
            bytes: 0,
            lastTs: timestamp,
          };
          this.ctx.methodStats.set(statKey, stat);
        }
        stat.count += 1;
        if (raw.direction === 'in') stat.inCount += 1;
        else stat.outCount += 1;
        stat.bytes += raw.length || payload.length;
        stat.lastTs = timestamp;
      }

      // Construct WSFrame
      const frame: WSFrame = {
        id,
        seq,
        connectionId: connId,
        direction: raw.direction || 'in',
        timestamp,
        timeFormatted,
        length: raw.length || payload.length,
        payload,
        jsonPayload,
        isJson,
        opcode: raw.opcode,
        isBinary,
        rawBase64: raw.rawBase64,
        method,
        rpcKind,
        rpcId,
        rpcPeerId,
        rpcLatencyMs,
        statusDelta,
      };

      // Carry-forward calculation for custom columns
      if (customColumns.length > 0) {
        let connLast = this.ctx.lastKnownValues.get(connId);
        if (!connLast) {
          connLast = {};
          this.ctx.lastKnownValues.set(connId, connLast);
        }

        const carried: Record<string, CarriedValue> = {};
        for (const col of customColumns) {
          const val = extractFrameField(frame, col.path);
          if (val !== undefined && val !== null) {
            connLast[col.id] = { value: val, fromId: frame.id };
          } else if (connLast[col.id]) {
            carried[col.id] = connLast[col.id];
          }
        }
        if (Object.keys(carried).length > 0) {
          frame.carried = carried;
        }
      }

      processed.push(frame);
      if (existingFramesMap) {
        existingFramesMap.set(id, frame);
      }
    }

    return processed;
  }
}

export const globalFrameProcessor = new FrameProcessor();
