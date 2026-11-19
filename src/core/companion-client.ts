import type {
  CompanionConnectionStatus,
  CompanionBridgeStatus,
  CompanionFrame,
  CompanionMetric,
  UnifiedIncidentMetadata,
  UnifiedTraceBundle,
} from '../types/companion';

export interface CompanionClientOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectBaseInterval?: number;
  reconnectMaxInterval?: number;
  heartbeatInterval?: number;
}

export type StatusListener = (status: CompanionConnectionStatus) => void;
export type BridgeStatusListener = (status: CompanionBridgeStatus) => void;
export type FrameListener = (frame: CompanionFrame) => void;
export type FramesBatchListener = (frames: CompanionFrame[]) => void;
export type MetricListener = (metric: CompanionMetric) => void;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export class CompanionClient {
  private url: string;
  private ws: WebSocket | null = null;
  private status: CompanionConnectionStatus = 'disconnected';
  private autoReconnect: boolean;
  private reconnectBaseInterval: number;
  private reconnectMaxInterval: number;
  private heartbeatInterval: number;

  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private isExplicitlyClosed = false;

  private bridgeStatus: CompanionBridgeStatus | null = null;
  private frameBuffer: CompanionFrame[] = [];
  private maxFrameBuffer = 5000;
  private frameCounter = 0;
  private lastFrameTimestamp = 0;

  // Listeners
  private statusListeners = new Set<StatusListener>();
  private bridgeStatusListeners = new Set<BridgeStatusListener>();
  private frameListeners = new Set<FrameListener>();
  private framesBatchListeners = new Set<FramesBatchListener>();
  private metricListeners = new Set<MetricListener>();

  constructor(options: CompanionClientOptions = {}) {
    this.url = options.url || 'ws://127.0.0.1:8088';
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectBaseInterval = options.reconnectBaseInterval ?? 1000;
    this.reconnectMaxInterval = options.reconnectMaxInterval ?? 10000;
    this.heartbeatInterval = options.heartbeatInterval ?? 5000;
  }

  public getUrl(): string {
    return this.url;
  }

  public setUrl(newUrl: string): void {
    if (this.url === newUrl) return;
    this.url = newUrl;
    if (this.status !== 'disconnected') {
      this.disconnect();
      this.connect();
    }
  }

  public getStatus(): CompanionConnectionStatus {
    return this.status;
  }

  public getBridgeStatus(): CompanionBridgeStatus | null {
    return this.bridgeStatus;
  }

  public getBufferedFrames(): CompanionFrame[] {
    return [...this.frameBuffer];
  }

  public clearFrameBuffer(): void {
    this.frameBuffer = [];
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public onBridgeStatus(listener: BridgeStatusListener): () => void {
    this.bridgeStatusListeners.add(listener);
    if (this.bridgeStatus) listener(this.bridgeStatus);
    return () => this.bridgeStatusListeners.delete(listener);
  }

  public onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  public onFramesBatch(listener: FramesBatchListener): () => void {
    this.framesBatchListeners.add(listener);
    return () => this.framesBatchListeners.delete(listener);
  }

  public onMetric(listener: MetricListener): () => void {
    this.metricListeners.add(listener);
    return () => this.metricListeners.delete(listener);
  }

  public connect(url?: string): void {
    if (url) this.url = url;
    this.isExplicitlyClosed = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.setupSocketHandlers();
    } catch (err) {
      this.handleSocketError(err);
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    this.stopReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  public send(data: any): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Export unified incident / trace bundle combining web frames, companion sidecar frames, and metadata.
   * Sends to the companion bridge server (:8088) if connected and triggers client-side file download.
   */
  public async exportUnifiedIncident(
    webFrames: any[] = [],
    incidentMetadata?: UnifiedIncidentMetadata
  ): Promise<{ success: boolean; bundle: UnifiedTraceBundle; downloaded: boolean }> {
    const bundle: UnifiedTraceBundle = {
      version: 1,
      bundleType: 'unified_companion_trace',
      createdAt: new Date().toISOString(),
      metadata: {
        title: incidentMetadata?.title || 'Unified System Incident Trace',
        description: incidentMetadata?.description || 'Synchronized Web and Sidecar Stream Incident Snapshot',
        severity: incidentMetadata?.severity || 'medium',
        tags: incidentMetadata?.tags || ['companion-stream', 'devtools'],
        timestamp: Date.now(),
        ...incidentMetadata,
      },
      bridgeStatus: this.bridgeStatus,
      sidecarFrames: this.getBufferedFrames(),
      webFrames,
    };

    let sentToBridge = false;
    if (this.status === 'connected') {
      sentToBridge = this.send({
        type: 'cxsw.incident.export',
        method: 'exportUnifiedIncident',
        payload: bundle,
      });
    }

    let downloaded = false;
    try {
      this.downloadBundleJson(bundle);
      downloaded = true;
    } catch {
      // In non-browser / headless test environments, download may be skipped
    }

    return {
      success: true,
      bundle,
      downloaded,
    };
  }

  private downloadBundleJson(bundle: UnifiedTraceBundle): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `unified-incident-trace-${timestampStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private setStatus(newStatus: CompanionConnectionStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (e) {
        console.error('[CompanionClient] Status listener error:', e);
      }
    }
  }

  private setupSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();

      // Handshake & Subscriptions
      this.sendHandshakeAndSubscribe();
    };

    this.ws.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };

    this.ws.onclose = () => {
      this.handleSocketClose();
    };

    this.ws.onerror = (err) => {
      this.handleSocketError(err);
    };
  }

  private sendHandshakeAndSubscribe(): void {
    // Handshake
    this.send({ type: 'cxsw.handshake', method: 'handshake' });
    this.send({ type: 'cxsw.status', method: 'status' });

    // Subscribe to companion/hardware topics
    this.send({
      type: 'cxsw.subscribe',
      method: 'subscribe',
      topics: ['streams', 'metrics', 'serial.packets', 'cfs.metrics', 'klipper.telemetry'],
    });
  }

  private handleIncomingMessage(raw: any): void {
    let msg: any;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      // Raw string payload
      msg = { type: 'stream', payload: String(raw) };
    }

    if (!msg || typeof msg !== 'object') return;

    // Heartbeat pong
    if (msg.type === 'pong' || msg.result === 'pong') {
      return;
    }

    // Bridge status update
    if (
      msg.type === 'cxsw.status' ||
      msg.type === 'cxsw.handshake' ||
      msg.type === 'status' ||
      (msg.target_ip || msg.targetIp)
    ) {
      const status: CompanionBridgeStatus = {
        name: msg.name || 'Local Companion Bridge',
        version: msg.version || '1.0.0',
        connected: true,
        target: msg.target_ip || msg.targetIp || msg.target || '127.0.0.1',
        rttMs: msg.rtt_ms ?? msg.rttMs ?? 0,
        sources: msg.sources || ['serial', 'telemetry'],
        metadata: msg.metadata || msg,
        lastSeen: Date.now(),
      };
      this.bridgeStatus = status;
      for (const listener of this.bridgeStatusListeners) {
        try {
          listener(status);
        } catch (e) {
          console.error('[CompanionClient] Bridge status listener error:', e);
        }
      }
      return;
    }

    // Metric event
    if (msg.type === 'cfs.metrics' || msg.type === 'metric' || msg.type === 'metrics') {
      const metricData = msg.metrics || msg.payload || msg;
      const metric: CompanionMetric = {
        name: msg.name || msg.type,
        value: typeof metricData.value === 'number' ? metricData.value : 0,
        unit: metricData.unit,
        timestamp: metricData.timestamp || Date.now(),
        metadata: metricData,
      };
      for (const listener of this.metricListeners) {
        try {
          listener(metric);
        } catch (e) {
          console.error('[CompanionClient] Metric listener error:', e);
        }
      }
      return;
    }

    // Stream frame / serial packet event
    if (
      msg.type === 'cxsw.sniff.stream' ||
      msg.type === 'serial.packet' ||
      msg.type === 'stream' ||
      msg.type === 'frame' ||
      msg.packet ||
      msg.payload !== undefined ||
      msg.hex !== undefined
    ) {
      const item = msg.packet || msg;
      const now = Date.now();
      const ts = item.timestamp || now;
      const deltaMs = this.lastFrameTimestamp > 0 ? Math.max(0, ts - this.lastFrameTimestamp) : 0;
      this.lastFrameTimestamp = ts;

      const frame: CompanionFrame = {
        id: item.id || `companion-${++this.frameCounter}`,
        timestamp: ts,
        timeFormatted: formatTimestamp(ts),
        source: item.source || item.mcu || 'stream',
        type: item.type || msg.type || 'packet',
        direction: item.direction || 'event',
        payload: item.payload || item.payloadStr || item.cmd || item.hex || '',
        hex: item.hex,
        status: item.status || 'ok',
        latencyUs: item.latencyUs ?? item.latency_us,
        deltaMs,
        metadata: item,
      };

      // Ingest into buffer
      this.frameBuffer.push(frame);
      if (this.frameBuffer.length > this.maxFrameBuffer) {
        this.frameBuffer.splice(0, this.frameBuffer.length - this.maxFrameBuffer);
      }

      for (const listener of this.frameListeners) {
        try {
          listener(frame);
        } catch (e) {
          console.error('[CompanionClient] Frame listener error:', e);
        }
      }

      for (const listener of this.framesBatchListeners) {
        try {
          listener([frame]);
        } catch (e) {
          console.error('[CompanionClient] Frames batch listener error:', e);
        }
      }
    }
  }

  private handleSocketClose(): void {
    this.stopHeartbeat();
    this.ws = null;
    this.setStatus('disconnected');

    if (!this.isExplicitlyClosed && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleSocketError(_err: any): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.handleSocketClose();
  }

  private scheduleReconnect(): void {
    this.stopReconnectTimer();

    const delay = Math.min(
      this.reconnectBaseInterval * Math.pow(1.5, this.reconnectAttempts),
      this.reconnectMaxInterval
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, delay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'connected') {
        this.send({ type: 'ping', method: 'ping' });
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// Global companion client singleton
export const companionClient = new CompanionClient();
