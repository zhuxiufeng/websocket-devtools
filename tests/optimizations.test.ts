import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import { FrameProcessor } from '../src/core/frame-processor';
import { exportTraceJson, parseTraceJson } from '../src/core/trace-io';
import type { WSFrame, CustomColumn } from '../src/types/websocket';

describe('Advanced Optimizations & Klipper-Specific Verification Test Suite', () => {
  beforeEach(() => {
    useWSStore.getState().clearFrames();
    useWSStore.getState().setFilterQuery('');
  });

  it('1. Correctly pairs JSON-RPC requests and responses, calculating latency and method linkage', () => {
    const processor = new FrameProcessor();
    const connId = 'ws://192.168.1.100/websocket';
    const now = 1680000000000;

    const reqPayload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'printer.objects.query',
      params: { objects: { toolhead: null } },
      id: 42,
    });

    const resPayload = JSON.stringify({
      jsonrpc: '2.0',
      result: {
        status: {
          toolhead: { position: [100.0, 150.0, 0.2, 0.0] },
        },
      },
      id: 42,
    });

    const framesMap = new Map<string, WSFrame>();

    // 1. Ingest request
    const [reqFrame] = processor.ingestBatch(
      [
        {
          id: 'frame-1',
          connectionId: connId,
          direction: 'out',
          timestamp: now,
          payload: reqPayload,
          length: reqPayload.length,
        },
      ],
      [],
      framesMap
    );

    expect(reqFrame.rpcKind).toBe('request');
    expect(reqFrame.method).toBe('printer.objects.query');
    expect(reqFrame.rpcId).toBe(42);

    // 2. Ingest response 35ms later
    const [resFrame] = processor.ingestBatch(
      [
        {
          id: 'frame-2',
          connectionId: connId,
          direction: 'in',
          timestamp: now + 35,
          payload: resPayload,
          length: resPayload.length,
        },
      ],
      [],
      framesMap
    );

    expect(resFrame.rpcKind).toBe('response');
    expect(resFrame.method).toBe('printer.objects.query');
    expect(resFrame.rpcId).toBe(42);
    expect(resFrame.rpcPeerId).toBe('frame-1');
    expect(resFrame.rpcLatencyMs).toBe(35);

    // Backward peer linking on request frame
    expect(reqFrame.rpcPeerId).toBe('frame-2');
    expect(reqFrame.rpcLatencyMs).toBe(35);
  });

  it('2. Deeply aggregates printer state updates into a complete state snapshot at any frame', () => {
    const processor = new FrameProcessor();
    const connId = 'ws://192.168.1.100/websocket';
    const now = 1680000000000;

    // Delta 1: toolhead position
    const delta1 = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { position: [12.5, 45.0, 0.2, 0.0], homed_axes: 'xyz' } }, now],
    };

    // Delta 2: heater_bed and extruder temp update (toolhead omitted)
    const delta2 = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          heater_bed: { temperature: 59.8, target: 60.0 },
          extruder: { temperature: 205.2, target: 210.0 },
        },
        now + 50,
      ],
    };

    // Delta 3: toolhead updates position only
    const delta3 = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { position: [14.0, 48.0, 0.2, 0.5] } }, now + 100],
    };

    const frames = processor.ingestBatch(
      [
        { id: 'f-1', connectionId: connId, timestamp: now, payload: JSON.stringify(delta1) },
        { id: 'f-2', connectionId: connId, timestamp: now + 50, payload: JSON.stringify(delta2) },
        { id: 'f-3', connectionId: connId, timestamp: now + 100, payload: JSON.stringify(delta3) },
      ],
      []
    );

    // Reconstruct state at Frame 2 (should have toolhead from frame 1, heaters from frame 2)
    const snapshotAt2 = processor.getSnapshotAtSeq(connId, frames[1].seq!, frames);
    expect(snapshotAt2.toolhead.homed_axes).toBe('xyz');
    expect(snapshotAt2.toolhead.position).toEqual([12.5, 45.0, 0.2, 0.0]);
    expect(snapshotAt2.heater_bed.temperature).toBe(59.8);
    expect(snapshotAt2.extruder.temperature).toBe(205.2);

    // Reconstruct state at Frame 3 (toolhead position updated, but homed_axes and heaters still preserved!)
    const snapshotAt3 = processor.getSnapshotAtSeq(connId, frames[2].seq!, frames);
    expect(snapshotAt3.toolhead.position).toEqual([14.0, 48.0, 0.2, 0.5]);
    expect(snapshotAt3.toolhead.homed_axes).toBe('xyz');
    expect(snapshotAt3.extruder.temperature).toBe(205.2);
  });

  it('3. Carries forward last-known values for custom columns when incremental delta frames omit them', () => {
    const processor = new FrameProcessor();
    const connId = 'ws://192.168.1.100/websocket';
    const customCols: CustomColumn[] = [
      { id: 'col-temp', name: 'Extruder Temp', path: 'extruder.temperature' },
      { id: 'col-bed', name: 'Bed Temp', path: 'heater_bed.temperature' },
    ];

    // Frame 1 only has extruder.temperature
    const f1Payload = JSON.stringify({
      params: [{ extruder: { temperature: 215.0 } }],
    });

    // Frame 2 only has heater_bed.temperature
    const f2Payload = JSON.stringify({
      params: [{ heater_bed: { temperature: 60.5 } }],
    });

    const [frame1, frame2] = processor.ingestBatch(
      [
        { id: 'frame-1', connectionId: connId, payload: f1Payload },
        { id: 'frame-2', connectionId: connId, payload: f2Payload },
      ],
      customCols
    );

    // Frame 1 contains extruder directly
    expect(frame1.carried).toBeUndefined();

    // Frame 2 does NOT have extruder directly, but carries it forward from frame-1!
    expect(frame2.carried).toBeDefined();
    expect(frame2.carried!['col-temp']).toEqual({
      value: 215.0,
      fromId: 'frame-1',
    });
  });

  it('4. Trace IO exports and accurately re-imports captured sessions including HAR log formats', () => {
    const rawFrames: WSFrame[] = [
      {
        id: 'f-10',
        seq: 10,
        connectionId: 'ws://printer.local/websocket',
        direction: 'in',
        timestamp: 1680000000000,
        timeFormatted: '12:00:00.000',
        length: 25,
        payload: '{"method":"test"}',
        jsonPayload: { method: 'test' },
        isJson: true,
      },
    ];

    // Export native
    const jsonStr = exportTraceJson(rawFrames, [], [], []);
    expect(jsonStr).toContain('"source": "ws-telemetry-analyzer"');

    // Import native
    const imported = parseTraceJson(jsonStr);
    expect(imported.frames.length).toBe(1);
    expect(imported.frames[0].id).toBe('f-10');

    // Import standard HAR format with WebSocket messages
    const harLog = JSON.stringify({
      log: {
        entries: [
          {
            request: { url: 'ws://printer.local/ws' },
            startedDateTime: '2026-10-15T12:00:00.000Z',
            _webSocketMessages: [
              { type: 'send', time: 0.1, opcode: 1, data: '{"id":1,"method":"gcode"}' },
              { type: 'receive', time: 0.25, opcode: 1, data: '{"id":1,"result":"ok"}' },
            ],
          },
        ],
      },
    });

    const harImported = parseTraceJson(harLog);
    expect(harImported.frames.length).toBe(2);
    expect(harImported.frames[0].direction).toBe('out');
    expect(harImported.frames[1].direction).toBe('in');
  });

  it('5. Aggregates method statistics and handles binary frames', () => {
    const processor = new FrameProcessor();
    const connId = 'ws://printer.local/ws';

    processor.ingestBatch(
      [
        {
          id: 'f-1',
          connectionId: connId,
          direction: 'in',
          length: 120,
          payload: JSON.stringify({ method: 'notify_status_update' }),
        },
        {
          id: 'f-2',
          connectionId: connId,
          direction: 'in',
          length: 150,
          payload: JSON.stringify({ method: 'notify_status_update' }),
        },
        {
          id: 'f-3',
          connectionId: connId,
          direction: 'out',
          length: 45,
          payload: JSON.stringify({ method: 'server.info', id: 1 }),
        },
        {
          id: 'f-4',
          connectionId: connId,
          direction: 'in',
          length: 256,
          opcode: 2,
          isBinary: true,
          rawBase64: 'AQIDBA==',
        },
      ],
      []
    );

    const stats = processor.getMethodStats();
    const statusStat = stats.find((s) => s.method === 'notify_status_update');
    const binStat = stats.find((s) => s.method === '(binary)');

    expect(statusStat).toBeDefined();
    expect(statusStat!.count).toBe(2);
    expect(statusStat!.inCount).toBe(2);
    expect(statusStat!.bytes).toBe(270);

    expect(binStat).toBeDefined();
    expect(binStat!.count).toBe(1);
    expect(binStat!.bytes).toBe(256);
  });

  it('6. Accurately calculates recursive JSON diff between two frames', async () => {
    const { computeJsonDiff } = await import('../src/utils/json-diff');

    const prevObj = {
      toolhead: {
        position: [100, 150, 0.2],
        status: 'printing',
      },
      heater_bed: {
        temperature: 60.0,
      },
      extruder: {
        target: 215.0,
      },
    };

    const nextObj = {
      toolhead: {
        position: [105, 150, 0.4], // modified
        status: 'printing',
      },
      heater_bed: {
        temperature: 60.2, // modified
      },
      fan: {
        speed: 0.8, // added
      },
      // extruder removed
    };

    const diffs = computeJsonDiff(prevObj, nextObj);
    const diffMap = new Map(diffs.map((d) => [d.path, d]));

    expect(diffMap.get('toolhead.position[0]')?.type).toBe('changed');
    expect(diffMap.get('toolhead.position[0]')?.oldValue).toBe(100);
    expect(diffMap.get('toolhead.position[0]')?.newValue).toBe(105);

    expect(diffMap.get('heater_bed.temperature')?.type).toBe('changed');
    expect(diffMap.get('fan')?.type).toBe('added');
    expect(diffMap.get('extruder')?.type).toBe('removed');
  });

  it('7. Manages filter presets, search history, and adjacent frame navigation', () => {
    const store = useWSStore.getState();

    // 1. Presets
    store.addFilterPreset('Errors Only', 'rpc:error');
    let state = useWSStore.getState();
    const addedPreset = state.filterPresets.find((p) => p.name === 'Errors Only')!;
    expect(addedPreset?.query).toBe('rpc:error');

    store.removeFilterPreset(addedPreset.id);
    expect(useWSStore.getState().filterPresets.find((p) => p.name === 'Errors Only')).toBeUndefined();

    // 2. Search History
    store.addFilterHistory('notify_status_update');
    store.addFilterHistory('gcode.script');
    expect(useWSStore.getState().filterHistory[0]).toBe('gcode.script');

    // 3. Toggle Recording
    const initialRec = useWSStore.getState().isRecording;
    store.toggleRecording();
    expect(useWSStore.getState().isRecording).toBe(!initialRec);
    store.toggleRecording();
    expect(useWSStore.getState().isRecording).toBe(initialRec);

    // 4. Adjacent frame navigation
    useWSStore.getState().addFramesBatch([
      { id: 'f-1', connectionId: 'c1', payload: 'msg 1', direction: 'in', length: 5 },
      { id: 'f-2', connectionId: 'c1', payload: 'msg 2', direction: 'in', length: 5 },
      { id: 'f-3', connectionId: 'c1', payload: 'msg 3', direction: 'in', length: 5 },
    ]);

    store.setSelectedFrameId('f-1');
    store.selectAdjacentFrame(1);
    expect(useWSStore.getState().selectedFrameId).toBe('f-2');

    store.selectAdjacentFrame(1);
    expect(useWSStore.getState().selectedFrameId).toBe('f-3');

    store.selectAdjacentFrame(-1);
    expect(useWSStore.getState().selectedFrameId).toBe('f-2');
  });
});
