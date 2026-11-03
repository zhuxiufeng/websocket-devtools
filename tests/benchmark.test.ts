import { describe, it, expect } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import { IncrementalFilterEngine } from '../src/core/incremental-filter';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
import type { WSFrame } from '../src/types/websocket';

describe('Performance & Benchmark Suite (High Buffer Stress Test)', () => {
  it('Benchmark 1: Lazy AST Eviction memory protection on 50,000 frames', () => {
    const store = useWSStore.getState();
    store.clearFrames();
    store.setMaxFrames(100000);

    const frameCount = 50000;
    const batchSize = 1000;

    const t0 = performance.now();
    for (let i = 0; i < frameCount; i += batchSize) {
      const batch: Partial<WSFrame>[] = [];
      for (let j = 0; j < batchSize; j++) {
        const seq = i + j + 1;
        batch.push({
          id: `bench-${seq}`,
          seq,
          connectionId: 'ws://printer',
          direction: seq % 2 === 0 ? 'in' : 'out',
          timestamp: 1680000000000 + seq * 5,
          payload: JSON.stringify({
            seq,
            method: 'notify_status_update',
            params: [{ toolhead: { position: [seq * 0.1, seq * 0.2, 0.4], status: 'printing' } }],
          }),
          isJson: true,
        });
      }
      store.addFramesBatch(batch);
    }
    const t1 = performance.now();

    const frames = useWSStore.getState().frames;
    expect(frames.length).toBe(frameCount);

    // Count how many frames retain heavy jsonPayload
    let astCount = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].jsonPayload !== null) {
        astCount++;
      }
    }

    // Only recent <= 200 frames + selected frame should retain AST
    expect(astCount).toBeLessThanOrEqual(201);

    // On-demand lazy parse speed test on 1,000 historical frames
    const parseStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      const idx = i * 40; // sample across the 50k frames
      const raw = frames[idx].payload;
      const parsed = JSON.parse(raw);
      expect(parsed.seq).toBe(idx + 1);
    }
    const parseTime = performance.now() - parseStart;
    const avgParseTimeUs = (parseTime / 1000) * 1000; // microseconds

    console.log(`\n  🚀 [Benchmark 1] Ingested ${frameCount} frames in ${(t1 - t0).toFixed(1)}ms (${((frameCount / (t1 - t0)) * 1000).toFixed(0)} frames/sec)`);
    console.log(`  💾 [Benchmark 1] Heavy AST retained: ${astCount} / ${frameCount} frames (Memory eviction rate: ${(((frameCount - astCount) / frameCount) * 100).toFixed(2)}%)`);
    console.log(`  ⚡ [Benchmark 1] On-demand lazy parse avg latency: ${avgParseTimeUs.toFixed(2)} µs/frame`);
  });

  it('Benchmark 2: Incremental Filtering vs Full-Scan on 50,000 frames', () => {
    const store = useWSStore.getState();
    const frames = store.frames;
    expect(frames.length).toBe(50000);

    const criteria = parseFilterQuery('dir:in notify_status_update');
    const engine = new IncrementalFilterEngine();

    // 1. Measure initial Full Scan
    const fullScanStart = performance.now();
    const fullResult = engine.filter(frames, null, criteria);
    const fullScanTime = performance.now() - fullScanStart;

    expect(fullResult.length).toBe(25000);

    // 2. Measure Incremental Filtering on 20 newly arrived frames
    const newBatch: WSFrame[] = [];
    const baseSeq = 50001;
    for (let i = 0; i < 20; i++) {
      const seq = baseSeq + i;
      newBatch.push({
        id: `bench-${seq}`,
        seq,
        connectionId: 'ws://printer',
        direction: seq % 2 === 0 ? 'in' : 'out',
        timestamp: 1680000000000 + seq * 5,
        timeFormatted: '12:00:00.000',
        length: 50,
        payload: JSON.stringify({ seq, method: 'notify_status_update' }),
        jsonPayload: null,
        isJson: true,
      });
    }

    const updatedFrames = frames.concat(newBatch);

    const incStart = performance.now();
    const incResult = engine.filter(updatedFrames, null, criteria);
    const incTime = performance.now() - incStart;

    expect(incResult.length).toBe(25000 + 10); // 10 incoming 'in' frames matched

    const speedup = fullScanTime / Math.max(incTime, 0.001);

    console.log(`\n  🔍 [Benchmark 2] Full-scan 50,000 frames: ${fullScanTime.toFixed(2)}ms`);
    console.log(`  ⚡ [Benchmark 2] Incremental filter (20 new frames): ${incTime.toFixed(3)}ms`);
    console.log(`  🏆 [Benchmark 2] Incremental speedup: ${speedup.toFixed(0)}x faster!\n`);

    expect(incTime).toBeLessThan(fullScanTime);
  });
});
