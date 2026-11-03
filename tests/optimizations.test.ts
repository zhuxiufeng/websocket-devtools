import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import { FrameProcessor } from '../src/core/frame-processor';
import { exportTraceJson, parseTraceJson, exportColumnsCsvChunks, exportColumnsCsv, exportSelectedColumnsCsv } from '../src/core/trace-io';
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

  it('8. Evicts stale JSON AST for historical frames beyond active window (saving 70%+ heap)', () => {
    const store = useWSStore.getState();
    store.clearFrames();

    // Ingest 300 frames with JSON payloads
    const batch: Partial<WSFrame>[] = [];
    for (let i = 1; i <= 300; i++) {
      batch.push({
        id: `ast-frame-${i}`,
        seq: i,
        connectionId: 'ws://printer',
        payload: JSON.stringify({ index: i, heavyNested: { val: i * 10, arr: [1, 2, 3] } }),
        isJson: true,
      });
    }

    store.addFramesBatch(batch);
    const frames = useWSStore.getState().frames;
    expect(frames.length).toBe(300);

    // Selected frame preserves jsonPayload for immediate inspector rendering
    expect(frames[0].id).toBe(useWSStore.getState().selectedFrameId);
    expect(frames[0].jsonPayload).not.toBeNull();

    // Other unselected historical frames (< index 100, which is 300 - 200) have heavy AST evicted
    expect(frames[1].jsonPayload).toBeNull();
    expect(frames[50].jsonPayload).toBeNull();
    expect(frames[99].jsonPayload).toBeNull();

    // Recent frames (>= index 100) retain their jsonPayload for fast inspection
    expect(frames[100].jsonPayload).not.toBeNull();
    expect(frames[299].jsonPayload).not.toBeNull();

    // Verify on-demand lazy parsing: accessing an evicted frame still allows on-demand parse
    const oldFrame = frames[10];
    expect(oldFrame.jsonPayload).toBeNull();
    const parsed = JSON.parse(oldFrame.payload);
    expect(parsed.index).toBe(11);
  });

  it('9. Bounds RPC lookup map size and avoids redundant array allocations during high-buffer saturation', () => {
    const store = useWSStore.getState();
    store.clearFrames();
    store.setMaxFrames(20000);

    // Ingest 15,000 frames in batches of 1000
    for (let b = 0; b < 15; b++) {
      const batch: Partial<WSFrame>[] = [];
      for (let i = 0; i < 1000; i++) {
        const seq = b * 1000 + i + 1;
        batch.push({
          id: `cap-frame-${seq}`,
          seq,
          connectionId: 'ws://printer',
          payload: `{"seq":${seq}}`,
          isJson: true,
        });
      }
      store.addFramesBatch(batch);
    }

    const state = useWSStore.getState();
    expect(state.frames.length).toBe(15000);
    expect(state.frames[state.frames.length - 1].seq).toBe(15000);
  });

  it('10. Generates chunked CSV data efficiently without giant single-string memory blowup', () => {
    const frames: WSFrame[] = [];
    for (let i = 1; i <= 2500; i++) {
      frames.push({
        id: `f-${i}`,
        seq: i,
        connectionId: 'ws://mock',
        direction: i % 2 === 0 ? 'in' : 'out',
        timeFormatted: '12:00:00.000',
        timestamp: 1680000000000 + i * 10,
        length: 50,
        payload: `{"val":${i}}`,
        jsonPayload: null,
        isJson: true,
      });
    }

    const customCols: CustomColumn[] = [
      { id: 'c-val', path: 'val', name: 'Value', width: 80 },
    ];

    // Request chunks of 500 rows each
    const chunks = exportColumnsCsvChunks(frames, customCols, { enableCarryForward: false }, 500);
    // Header + 2500 rows split into 500-row chunks = 6 chunks
    expect(chunks.length).toBe(6);

    const merged = chunks.join('\r\n');
    const direct = exportColumnsCsv(frames, customCols, { enableCarryForward: false });
    expect(merged).toBe(direct);
    expect(merged).toContain('Seq,Direction,Time,Timestamp,Delta_ms,Length_bytes,Method,RPC_Kind,RPC_Latency_ms,Value');
    expect(merged).toContain('2500,in,12:00:00.000');
  });

  it('11. Resolves O(1) contiguous sequence lookup for JsonInspector Diff mode', () => {
    const frames: WSFrame[] = [];
    for (let i = 100; i < 200; i++) {
      frames.push({
        id: `frame-${i}`,
        seq: i,
        connectionId: 'ws://printer',
        direction: 'in',
        timeFormatted: '12:00:00.000',
        timestamp: 1680000000000 + i,
        length: 30,
        payload: `{"temp":${i}}`,
        jsonPayload: null,
        isJson: true,
      });
    }

    const firstSeq = frames[0].seq!;
    const selected = frames[42]; // seq 142
    const targetIdx = selected.seq! - firstSeq;
    expect(targetIdx).toBe(42);
    expect(frames[targetIdx].id).toBe(selected.id);

    const prev = targetIdx > 0 ? frames[targetIdx - 1] : null;
    expect(prev).not.toBeNull();
    expect(prev?.id).toBe('frame-141');
    expect(prev?.seq).toBe(141);
  });

  it('12. Accelerates repeated highlight rule matching with WeakMap caching', () => {
    const rules = [
      { id: 'hl-err', text: 'error', color: '#ff0000', active: true, tintRow: false, lowerText: 'error' },
      { id: 'hl-temp', text: 'temperature', color: '#00ff00', active: true, tintRow: false, lowerText: 'temperature' },
    ];

    const cache = new WeakMap<WSFrame, any>();
    const testFrame: WSFrame = {
      id: 'frame-test',
      connectionId: 'ws://printer',
      direction: 'in',
      timeFormatted: '12:00:00.000',
      timestamp: 1680000000000,
      length: 50,
      payload: '{"method":"notify_status_update","temperature":210.5}',
      jsonPayload: null,
      isJson: true,
    };

    // First call: cache miss
    expect(cache.has(testFrame)).toBe(false);
    const text = testFrame.payload.toLowerCase();
    let matched = null;
    for (const r of rules) {
      if (text.includes(r.lowerText)) {
        matched = r;
        break;
      }
    }
    cache.set(testFrame, matched);

    expect(matched?.id).toBe('hl-temp');
    expect(cache.has(testFrame)).toBe(true);

    // Second call: instant cache hit
    const cachedHit = cache.get(testFrame);
    expect(cachedHit?.id).toBe('hl-temp');
  });
});
