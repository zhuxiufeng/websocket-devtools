import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import { FrameProcessor } from '../src/core/frame-processor';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
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
});
