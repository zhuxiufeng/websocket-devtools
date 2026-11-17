import { describe, it, expect } from 'vitest';
import { FrameProcessor } from '../src/core/frame-processor';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
import { evaluateMathFormula, extractFrameField } from '../src/core/field-extractor';
import { downsampleLTTB } from '../src/utils/lttb';
import { useWSStore } from '../src/store/ws-store';
import type { WSFrame } from '../src/types/websocket';

describe('Core Logic & Security Audit Verification Suite', () => {
  it('Fix 1: JSON-RPC response with error: null is correctly classified as response', () => {
    const processor = new FrameProcessor();
    const [frame] = processor.ingestBatch(
      [
        {
          id: 'resp-1',
          connectionId: 'conn-1',
          direction: 'in',
          payload: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: 'ok',
            error: null,
          }),
        },
      ],
      []
    );

    // In JSON-RPC 1.0 / 2.0 implementations sending error: null, this is a response, NOT an error!
    expect(frame.rpcKind).toBe('response');
  });

  it('Fix 2: Stateless /g or /y flag in RegExp matches consistently across identical frames', () => {
    const criteria = parseFilterQuery('/error/g');
    const f1: WSFrame = {
      id: 'f1',
      connectionId: 'c1',
      direction: 'in',
      timestamp: 1000,
      timeFormatted: '10:00:00',
      length: 10,
      payload: 'error message here',
      jsonPayload: null,
      isJson: false,
    };
    const f2: WSFrame = { ...f1, id: 'f2' };
    const f3: WSFrame = { ...f1, id: 'f3' };

    const match1 = matchesFilter(f1, criteria);
    const match2 = matchesFilter(f2, criteria);
    const match3 = matchesFilter(f3, criteria);

    // Stateless: All 3 frames must match consistently
    expect(match1).toBe(true);
    expect(match2).toBe(true);
    expect(match3).toBe(true);
  });

  it('Fix 3: Division by zero in evaluateMathFormula safely returns undefined instead of Infinity', () => {
    const resultDivZero = evaluateMathFormula('10 / 0', () => 10);
    // Number.isFinite check -> returns undefined
    expect(resultDivZero).toBeUndefined();

    const resultInfMinusInf = evaluateMathFormula('val / 0', (v) => (v === 'val' ? 10 : 0));
    expect(resultInfMinusInf).toBeUndefined();
  });

  it('Fix 4: Scientific notation in evaluateMathFormula works without being parsed as variable', () => {
    const resultSci = evaluateMathFormula('val * 1e-3', (v) => (v === 'val' ? 1000 : undefined));
    expect(resultSci).toBe(1);

    const resultSciLarge = evaluateMathFormula('val + 2.5e2', (v) => (v === 'val' ? 50 : undefined));
    expect(resultSciLarge).toBe(300);
  });

  it('Fix 5: LTTB decimation handles threshold=1 and invalid thresholds safely', () => {
    const data: import('../src/types/websocket').TelemetryPoint[] = [
      { time: 1, value: 10, formattedTime: '10:00:01' },
      { time: 2, value: 20, formattedTime: '10:00:02' },
      { time: 3, value: 30, formattedTime: '10:00:03' },
      { time: 4, value: 40, formattedTime: '10:00:04' },
      { time: 5, value: 50, formattedTime: '10:00:05' },
    ];

    // threshold = 1 returns 1 point
    const res1 = downsampleLTTB(data, 1);
    expect(res1.length).toBe(1);
    expect(res1[0].time).toBe(1);

    // threshold = 2 returns 2 points (start and end)
    const res2 = downsampleLTTB(data, 2);
    expect(res2.length).toBe(2);
    expect(res2[0].time).toBe(1);
    expect(res2[1].time).toBe(5);

    // Non-finite values in series do not corrupt decimation
    const dataWithNaN: import('../src/types/websocket').TelemetryPoint[] = [
      { time: 1, value: 10, formattedTime: '10:00:01' },
      { time: 2, value: NaN, formattedTime: '10:00:02' },
      { time: 3, value: 100, formattedTime: '10:00:03' },
      { time: 4, value: Infinity, formattedTime: '10:00:04' },
      { time: 5, value: 50, formattedTime: '10:00:05' },
    ];
    const resRobust = downsampleLTTB(dataWithNaN, 3);
    expect(resRobust.length).toBe(3);
    expect(resRobust.every((p) => Number.isFinite(p.time))).toBe(true);
  });

  it('Fix 6: Numeric comparison does not falsely coerce boolean false or empty string to 0', () => {
    const fFalse: WSFrame = {
      id: 'f-false',
      connectionId: 'c1',
      direction: 'in',
      timestamp: 1000,
      timeFormatted: '10:00:00',
      length: 10,
      payload: '{"is_printing": false, "empty_str": "", "real_zero": 0}',
      jsonPayload: { is_printing: false, empty_str: '', real_zero: 0 },
      isJson: true,
    };

    const criteriaZero = parseFilterQuery('is_printing==0');
    expect(matchesFilter(fFalse, criteriaZero)).toBe(false);

    const criteriaEmpty = parseFilterQuery('empty_str==0');
    expect(matchesFilter(fFalse, criteriaEmpty)).toBe(false);

    const criteriaRealZero = parseFilterQuery('real_zero==0');
    expect(matchesFilter(fFalse, criteriaRealZero)).toBe(true);
  });

  it('Fix 7: AST lazy eviction protection behavior', () => {
    const store = useWSStore.getState();
    store.clearFrames();

    // 1. Ingest 300 frames
    const batch: Partial<WSFrame>[] = [];
    for (let i = 1; i <= 300; i++) {
      batch.push({
        id: `ast-frame-${i}`,
        seq: i,
        connectionId: 'ws://printer',
        payload: JSON.stringify({ index: i, data: 'heavy payload' }),
        isJson: true,
      });
    }
    store.addFramesBatch(batch);

    const frames = useWSStore.getState().frames;
    // Frame 50 was evicted initially
    expect(frames[50].jsonPayload).toBeNull();
  });

  it('Fix 8: Frame extraction cache (cachedExtractions) is bounded to prevent memory leaks', () => {
    const f: WSFrame = {
      id: 'f-cache',
      connectionId: 'c1',
      direction: 'in',
      timestamp: 1000,
      timeFormatted: '10:00:00',
      length: 10,
      payload: '{"nested": {"val": 123}}',
      jsonPayload: { nested: { val: 123 } },
      isJson: true,
    };

    for (let i = 0; i < 100; i++) {
      extractFrameField(f, `query_${i}`);
    }

    // Capped at 50 entries
    expect(Object.keys(f.cachedExtractions || {}).length).toBe(50);
  });
});
