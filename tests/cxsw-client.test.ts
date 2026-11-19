import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionClient } from '../src/core/companion-client';
import { CXSWClient, cxswClient } from '../src/core/cxsw-client';
import { useCompanionStore } from '../src/store/companion-store';
import { useCXSWStore } from '../src/store/cxsw-store';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }

  // Helper to simulate server connection opened
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  // Helper to simulate server message
  simulateMessage(data: any) {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.onmessage) this.onmessage({ data: raw });
  }

  // Helper to simulate error
  simulateError(err: any) {
    if (this.onerror) this.onerror(err);
  }
}

describe('CXSW / Companion Client & Store Test Suite', () => {
  let originalWebSocket: any;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    (MockWebSocket as any).OPEN = 1;
    (MockWebSocket as any).CONNECTING = 0;
    (MockWebSocket as any).CLOSING = 2;
    (MockWebSocket as any).CLOSED = 3;

    useCompanionStore.getState().clearFrames();
    useCompanionStore.getState().disconnect();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it('1. Initializes with ws://127.0.0.1:8088 and disconnected status', () => {
    const client = new CompanionClient();
    expect(client.getUrl()).toBe('ws://127.0.0.1:8088');
    expect(client.getStatus()).toBe('disconnected');
    expect(client.getBridgeStatus()).toBeNull();
  });

  it('2. CXSWClient alias inherits CompanionClient with full compatibility', () => {
    const client = new CXSWClient({ url: 'ws://127.0.0.1:8088' });
    expect(client.getUrl()).toBe('ws://127.0.0.1:8088');
    expect(cxswClient).toBeDefined();
    expect(useCXSWStore).toBe(useCompanionStore);
  });

  it('3. Connects, sends handshake, and subscribes to streams', () => {
    const client = new CompanionClient({ heartbeatInterval: 1000 });
    const statusChanges: string[] = [];
    client.onStatusChange((s) => statusChanges.push(s));

    client.connect();
    expect(client.getStatus()).toBe('connecting');
    expect(MockWebSocket.instances.length).toBe(1);

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(client.getStatus()).toBe('connected');

    // Should have sent handshake and subscription messages
    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sent.some((m) => m.type === 'cxsw.handshake' || m.method === 'handshake')).toBe(true);
    expect(sent.some((m) => m.type === 'cxsw.subscribe' || m.method === 'subscribe')).toBe(true);

    // Heartbeat ping after interval
    vi.advanceTimersByTime(1100);
    const sentAfterTick = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sentAfterTick.some((m) => m.type === 'ping')).toBe(true);

    client.disconnect();
    expect(client.getStatus()).toBe('disconnected');
  });

  it('4. Handles incoming cxsw.status and updates bridge status', () => {
    const client = new CompanionClient();
    let updatedStatus: any = null;
    client.onBridgeStatus((st) => {
      updatedStatus = st;
    });

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'cxsw.status',
      target_ip: '172.18.10.115',
      rtt_ms: 2.4,
      metadata: { klipper_state: 'ready', overlay: true },
    });

    expect(updatedStatus).not.toBeNull();
    expect(updatedStatus.target).toBe('172.18.10.115');
    expect(updatedStatus.rttMs).toBe(2.4);
    expect(client.getBridgeStatus()?.target).toBe('172.18.10.115');
  });

  it('5. Handles live serial packets / stream events and buffers them', () => {
    const client = new CompanionClient();
    const receivedFrames: any[] = [];
    client.onFrame((f) => receivedFrames.push(f));

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'cxsw.sniff.stream',
      packet: {
        id: 'pkt-100',
        timestamp: Date.now(),
        direction: 'tx',
        source: 'mcu_nano',
        cmd: 'query_status',
        hex: '55 AA 01 02',
        latency_us: 140,
        status: 'ok',
      },
    });

    expect(receivedFrames.length).toBe(1);
    expect(receivedFrames[0].id).toBe('pkt-100');
    expect(receivedFrames[0].direction).toBe('tx');
    expect(receivedFrames[0].source).toBe('mcu_nano');
    expect(receivedFrames[0].hex).toBe('55 AA 01 02');
    expect(receivedFrames[0].latencyUs).toBe(140);
    expect(client.getBufferedFrames().length).toBe(1);
  });

  it('6. Ingests cfs.metrics and updates metrics map', () => {
    const client = new CompanionClient();
    let receivedMetric: any = null;
    client.onMetric((m) => {
      receivedMetric = m;
    });

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'cfs.metrics',
      name: 'extruder_tension',
      metrics: {
        value: 18.5,
        unit: 'N',
        timestamp: Date.now(),
      },
    });

    expect(receivedMetric).not.toBeNull();
    expect(receivedMetric.name).toBe('extruder_tension');
    expect(receivedMetric.value).toBe(18.5);
    expect(receivedMetric.unit).toBe('N');
  });

  it('7. Reconnects automatically on unexpected disconnect', () => {
    const client = new CompanionClient({
      autoReconnect: true,
      reconnectBaseInterval: 500,
      reconnectMaxInterval: 2000,
    });

    client.connect();
    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();
    expect(client.getStatus()).toBe('connected');

    // Simulate unexpected drop
    ws1.close();
    expect(client.getStatus()).toBe('disconnected');

    // Advance time for reconnect timer
    vi.advanceTimersByTime(600);
    expect(MockWebSocket.instances.length).toBe(2);

    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();
    expect(client.getStatus()).toBe('connected');

    client.disconnect();
  });

  it('8. exportUnifiedIncident produces unified diagnostic bundle JSON', async () => {
    const client = new CompanionClient();
    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Push a mock frame
    ws.simulateMessage({
      type: 'stream',
      packet: {
        id: 'f-1',
        timestamp: 1000,
        direction: 'rx',
        source: 'serial',
        hex: '12 34',
      },
    });

    const webFrames = [
      { id: 'web-1', direction: 'in', payload: '{"method":"notify_status_update"}' },
    ];

    const result = await client.exportUnifiedIncident(webFrames, {
      title: 'Heater Fault Report',
      description: 'Extruder thermal spike detected',
      severity: 'critical',
      targetIp: '172.18.10.115',
    });

    expect(result.success).toBe(true);
    expect(result.bundle.version).toBe(1);
    expect(result.bundle.bundleType).toBe('unified_companion_trace');
    expect(result.bundle.metadata.title).toBe('Heater Fault Report');
    expect(result.bundle.metadata.severity).toBe('critical');
    expect(result.bundle.webFrames.length).toBe(1);
    expect(result.bundle.sidecarFrames.length).toBe(1);

    // Verify it sent to bridge socket
    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sent.some((m) => m.type === 'cxsw.incident.export')).toBe(true);
  });

  it('9. useCompanionStore updates state smoothly and bounds memory buffers', () => {
    const store = useCompanionStore.getState();

    store.setConnectionStatus('connected');
    expect(useCompanionStore.getState().connectionStatus).toBe('connected');

    store.setBridgeStatus({
      connected: true,
      target: '192.168.1.50',
      rttMs: 3.5,
      metadata: { status: 'printing' },
    });

    expect(useCompanionStore.getState().targetIp).toBe('192.168.1.50');
    expect(useCompanionStore.getState().rttMs).toBe(3.5);
    expect(useCompanionStore.getState().hardwareStatus).toBe('printing');

    // Add batch of frames
    const batch = Array.from({ length: 100 }, (_, i) => ({
      id: `frame-${i}`,
      timestamp: Date.now(),
      timeFormatted: '12:00:00.000',
      source: 'serial',
      direction: (i % 2 === 0 ? 'tx' : 'rx') as any,
      payload: `payload-${i}`,
    }));

    store.addFramesBatch(batch);
    expect(useCompanionStore.getState().frames.length).toBe(100);

    // Clear frames
    store.clearFrames();
    expect(useCompanionStore.getState().frames.length).toBe(0);

    // Toggle hardware panel
    expect(useCompanionStore.getState().isHardwareObservabilityOpen).toBe(false);
    store.toggleHardwareObservability();
    expect(useCompanionStore.getState().isHardwareObservabilityOpen).toBe(true);
  });
});
