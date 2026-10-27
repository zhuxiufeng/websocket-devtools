import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import { FrameProcessor } from '../src/core/frame-processor';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
import { extractField } from '../src/core/field-extractor';
import { highlightSearchText, subtreeHasMatch } from '../src/components/JsonInspector';
import type { WSFrame } from '../src/types/websocket';

describe('Comprehensive Self-Test & Edge Case Audit Suite', () => {
  beforeEach(() => {
    useWSStore.getState().clearFrames();
    useWSStore.getState().setFilterQuery('');
  });

  it('1. Ring buffer saturation: correctly handles 10,000+ frames without freezing or memory leak', () => {
    const store = useWSStore.getState();

    // Ingest 10,050 frames in batches of 500
    const totalFrames = 10050;
    const batchSize = 500;

    for (let i = 0; i < totalFrames; i += batchSize) {
      const batch: Partial<WSFrame>[] = [];
      for (let j = 0; j < batchSize && i + j < totalFrames; j++) {
        const seq = i + j + 1;
        batch.push({
          id: `frame-${seq}`,
          seq,
          connectionId: 'ws://localhost:8080',
          direction: seq % 2 === 0 ? 'in' : 'out',
          timestamp: 1680000000000 + seq * 10,
          payload: JSON.stringify({ seq, val: seq * 2 }),
          isJson: true,
        });
      }
      useWSStore.getState().addFramesBatch(batch);
    }

    const state = useWSStore.getState();
    // 1. Frame buffer must be capped at exactly 10,000
    expect(state.frames.length).toBe(10000);

    // 2. Oldest frame in buffer should be #51 (since 10,050 - 10,000 = 50 dropped)
    expect(state.frames[0].seq).toBe(51);

    // 3. Newest frame in buffer should be #10050
    expect(state.frames[state.frames.length - 1].seq).toBe(10050);

    // 4. Connection cumulative counter must NOT be capped and must equal 10,050
    const conn = state.connections['ws://localhost:8080'];
    expect(conn.frameCount).toBe(10050);
  });

  it('2. Filter engine handles complex edge cases (empty strings, special regex chars, case insensitivity)', () => {
    const criteriaEmpty = parseFilterQuery('   ');
    expect(criteriaEmpty.rawQuery).toBe('   ');
    expect(criteriaEmpty.direction).toBe('all');

    const criteriaComplex = parseFilterQuery('dir:in -heartbeat /status_[a-z]+/i json:method=test');
    expect(criteriaComplex.direction).toBe('in');
    expect(criteriaComplex.excludeKeywords).toContain('heartbeat');
    expect(criteriaComplex.regexes.length).toBe(1);
    expect(criteriaComplex.jsonKeyValues).toEqual([{ key: 'method', value: 'test' }]);

    const sampleFrame: WSFrame = {
      id: 'f-1',
      connectionId: 'conn-1',
      direction: 'in',
      timestamp: 1000,
      timeFormatted: '10:00:00.000',
      length: 50,
      payload: '{"method":"test","type":"status_update"}',
      isJson: true,
      jsonPayload: { method: 'test', type: 'status_update' },
    };

    expect(matchesFilter(sampleFrame, criteriaComplex)).toBe(true);

    // Frame with heartbeat should be excluded
    const heartbeatFrame: WSFrame = {
      ...sampleFrame,
      payload: '{"method":"test","type":"status_update","msg":"heartbeat"}',
    };
    expect(matchesFilter(heartbeatFrame, criteriaComplex)).toBe(false);
  });

  it('3. Binary and non-JSON frame handling in processor', () => {
    const processor = new FrameProcessor();
    const rawBinaryFrame: Partial<WSFrame> = {
      id: 'bin-1',
      connectionId: 'ws://binary-stream',
      direction: 'in',
      timestamp: 12345,
      isBinary: true,
      length: 1024,
      payload: '[Binary ArrayBuffer: 1024 bytes]',
    };

    const [processed] = processor.ingestBatch([rawBinaryFrame], []);
    expect(processed.isBinary).toBe(true);
    expect(processed.isJson).toBe(false);
    expect(processed.jsonPayload).toBeNull();
    expect(processed.payload).toBe('[Binary ArrayBuffer: 1024 bytes]');
  });

  it('4. Custom Column carry-forward state tracking does not leak across connections', () => {
    const processor = new FrameProcessor();
    const customCols = [{ id: 'col-speed', path: 'params.speed', name: 'Speed', width: 120 }];

    // Frame 1 on Conn A sets speed = 500
    const [f1] = processor.ingestBatch(
      [
        {
          id: 'fa-1',
          connectionId: 'conn-A',
          direction: 'in',
          timestamp: 100,
          payload: JSON.stringify({ params: { speed: 500 } }),
        },
      ],
      customCols
    );

    // Frame 2 on Conn B does NOT set speed
    const [f2] = processor.ingestBatch(
      [
        {
          id: 'fb-1',
          connectionId: 'conn-B',
          direction: 'in',
          timestamp: 101,
          payload: JSON.stringify({ params: { other: 123 } }),
        },
      ],
      customCols
    );

    // Frame 3 on Conn A does NOT set speed -> should carry forward 500 from fa-1
    const [f3] = processor.ingestBatch(
      [
        {
          id: 'fa-2',
          connectionId: 'conn-A',
          direction: 'in',
          timestamp: 102,
          payload: JSON.stringify({ params: { other: 456 } }),
        },
      ],
      customCols
    );

    expect(f1.carried?.['col-speed']).toBeUndefined(); // direct value
    expect(f2.carried?.['col-speed']).toBeUndefined(); // Conn B has no prior speed
    expect(f3.carried?.['col-speed']).toBeDefined(); // Conn A carries forward from fa-1
    expect(f3.carried?.['col-speed'].value).toBe(500);
    expect(f3.carried?.['col-speed'].fromId).toBe('fa-1');
  });

  it('5. Real-world ws-hook frames with isJson: true parse jsonPayload and classify JSON-RPC correctly', () => {
    const processor = new FrameProcessor();
    const rawWsHookFrame: Partial<WSFrame> = {
      id: 'hook-1',
      connectionId: 'ws://127.0.0.1:7125/websocket',
      direction: 'in',
      timestamp: Date.now(),
      isJson: true, // emitted by ws-hook.content.ts based on charCodeAt
      isBinary: false,
      payload: JSON.stringify({
        jsonrpc: '2.0',
        result: {
          gcode_store: [{ message: '// aging_test_pause...', time: 1792226409.53, type: 'response' }],
        },
        id: 44,
      }),
    };

    const [processed] = processor.ingestBatch([rawWsHookFrame], []);
    expect(processed.isJson).toBe(true);
    expect(processed.jsonPayload).not.toBeNull();
    expect(processed.jsonPayload.jsonrpc).toBe('2.0');
    expect(processed.rpcKind).toBe('response');
    expect(processed.rpcId).toBe(44);
    expect(processed.jsonPayload.result.gcode_store).toHaveLength(1);
  });

  it('6. JsonInspector search matches deep keys/values and highlights text accurately', () => {
    const deepPayload = {
      jsonrpc: '2.0',
      result: {
        status: {
          print_stats: {
            state: 'standby',
            info: {
              total_layer: 250,
              current_layer: 42,
            },
          },
          heater_bed: {
            temperature: 30.39,
          },
        },
      },
    };

    expect(subtreeHasMatch('root', deepPayload, '', 'current_layer', true)).toBe(true);
    expect(subtreeHasMatch('root', deepPayload, '', 'standby', true)).toBe(true);
    expect(subtreeHasMatch('root', deepPayload, '', 'non_existent_key', true)).toBe(false);
    expect(
      subtreeHasMatch('heater_bed', deepPayload.result.status.heater_bed, 'result.status', 'current_layer', false)
    ).toBe(false);

    const highlighted = highlightSearchText('temperature_sensor chamber_temp', 'chamber_temp');
    expect(highlighted).not.toBe('temperature_sensor chamber_temp');
  });

  it('7. Numeric index path collision prevention: bare numeric key does not match nested child arrays', () => {
    const gcodeFrame = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          gcode_move: {
            speed: 60.0,
            homing_origin: [0.0, 0.0, 0.0, 0.0],
            position: [53.4, 120.0, 0.0, 1.25],
          },
        },
        430.1,
      ],
    };

    // Direct access to params.1
    expect(extractField(gcodeFrame, 'params.1')).toBe(430.1);
    expect(extractField(gcodeFrame, 'params[1]')).toBe(430.1);

    // Bare '1' must not crawl into homing_origin[1]
    const bareOne = extractField(gcodeFrame.params[0], '1');
    expect(bareOne).toBeUndefined();
  });

  it('8. addCustomColumn retroactively backfills carried values for pre-existing frames', () => {
    const store = useWSStore.getState();

    // Ingest 3 frames before custom column exists
    store.addFramesBatch([
      {
        id: 'f-1',
        connectionId: 'conn-1',
        direction: 'in',
        timestamp: 1000,
        payload: JSON.stringify({ params: [{ print_stats: { print_duration: 330.5 } }] }),
      },
      {
        id: 'f-2',
        connectionId: 'conn-1',
        direction: 'in',
        timestamp: 1001,
        payload: JSON.stringify({ params: [{ fan_feedback: { speed: 5000 } }] }),
      },
      {
        id: 'f-3',
        connectionId: 'conn-1',
        direction: 'in',
        timestamp: 1002,
        payload: JSON.stringify({ params: [{ gcode_move: { speed: 60 } }] }),
      },
    ]);

    expect(useWSStore.getState().frames).toHaveLength(3);

    // Now dynamically add custom column
    useWSStore.getState().addCustomColumn('print_stats.print_duration', 'Duration');

    const updatedFrames = useWSStore.getState().frames;
    const colId = useWSStore.getState().customColumns.find((c) => c.path === 'print_stats.print_duration')?.id;
    expect(colId).toBeDefined();

    // Frame 1 has direct value
    // Frame 2 and 3 should have backfilled carried value = 330.5 from f-1
    expect(updatedFrames[1].carried?.[colId!]).toBeDefined();
    expect(updatedFrames[1].carried?.[colId!].value).toBe(330.5);
    expect(updatedFrames[1].carried?.[colId!].fromId).toBe('f-1');

    expect(updatedFrames[2].carried?.[colId!]).toBeDefined();
    expect(updatedFrames[2].carried?.[colId!].value).toBe(330.5);
  });

  it('9. Telemetry series supports numeric strings and heartbeat carry-forward on unchanged frames', () => {
    const store = useWSStore.getState();

    // Ingest frame with numeric string "27.09"
    store.addFramesBatch([
      {
        id: 'f-10',
        connectionId: 'conn-1',
        direction: 'in',
        timestamp: 10000,
        payload: JSON.stringify({ temperature: '27.09' }),
      },
    ]);

    store.addTelemetrySeries('temperature', 'Temp');
    const series = useWSStore.getState().telemetrySeries.find((s) => s.fieldPath === 'temperature');
    expect(series).toBeDefined();
    expect(series?.dataPoints).toHaveLength(1);
    expect(series?.dataPoints[0].value).toBe(27.09);

    // Ingest another frame 1500ms later without temperature (delta frame)
    store.addFramesBatch([
      {
        id: 'f-11',
        connectionId: 'conn-1',
        direction: 'in',
        timestamp: 11500,
        payload: JSON.stringify({ other: 123 }),
      },
    ]);

    const updatedSeries = useWSStore.getState().telemetrySeries.find((s) => s.fieldPath === 'temperature');
    // Should have heartbeat carry-forward point at timestamp 11500 with value 27.09
    expect(updatedSeries?.dataPoints).toHaveLength(2);
    expect(updatedSeries?.dataPoints[1].time).toBe(11500);
    expect(updatedSeries?.dataPoints[1].value).toBe(27.09);
  });

  it('10. FrameProcessor computes deltaMs per connection correctly', () => {
    const processor = new FrameProcessor();
    const rawFrames = [
      {
        id: 'f-1',
        connectionId: 'conn-A',
        direction: 'in' as const,
        timestamp: 1000,
        payload: '{}',
      },
      {
        id: 'f-2',
        connectionId: 'conn-B',
        direction: 'in' as const,
        timestamp: 1020,
        payload: '{}',
      },
      {
        id: 'f-3',
        connectionId: 'conn-A',
        direction: 'in' as const,
        timestamp: 1050,
        payload: '{}',
      },
      {
        id: 'f-4',
        connectionId: 'conn-B',
        direction: 'in' as const,
        timestamp: 1120,
        payload: '{}',
      },
    ];

    const processed = processor.ingestBatch(rawFrames, []);
    expect(processed[0].deltaMs).toBeUndefined(); // First frame on conn-A
    expect(processed[1].deltaMs).toBeUndefined(); // First frame on conn-B
    expect(processed[2].deltaMs).toBe(50); // conn-A: 1050 - 1000 = 50ms
    expect(processed[3].deltaMs).toBe(100); // conn-B: 1120 - 1020 = 100ms
  });
});

