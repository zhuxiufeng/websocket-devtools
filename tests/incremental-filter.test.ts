import { describe, it, expect, beforeEach } from 'vitest';
import { IncrementalFilterEngine } from '../src/core/incremental-filter';
import { parseFilterQuery } from '../src/core/filter-engine';
import type { WSFrame } from '../src/types/websocket';

function makeFrame(seq: number, payload: string, dir: 'in' | 'out' = 'in', connId = 'ws://printer'): WSFrame {
  return {
    id: `f-${seq}`,
    seq,
    connectionId: connId,
    direction: dir,
    timestamp: 1680000000000 + seq * 10,
    timeFormatted: `00:00:00.${seq}`,
    length: payload.length,
    payload,
    jsonPayload: null,
    isJson: payload.startsWith('{'),
  };
}

describe('IncrementalFilterEngine', () => {
  let engine: IncrementalFilterEngine;

  beforeEach(() => {
    engine = new IncrementalFilterEngine();
  });

  it('1. Returns frames by reference in O(1) when no filter query or connection is selected', () => {
    const frames = [makeFrame(1, '{"status":"ok"}'), makeFrame(2, '{"status":"err"}')];
    const criteria = parseFilterQuery('');

    const res1 = engine.filter(frames, null, criteria);
    expect(res1).toBe(frames); // Exact same reference, zero allocation
  });

  it('2. Performs full filter scan on initial query or when criteria changes', () => {
    const frames = [
      makeFrame(1, '{"method":"toolhead"}'),
      makeFrame(2, '{"method":"heater_bed"}'),
      makeFrame(3, '{"method":"toolhead"}'),
    ];

    const criteria1 = parseFilterQuery('toolhead');
    const res1 = engine.filter(frames, null, criteria1);
    expect(res1.length).toBe(2);
    expect(res1[0].id).toBe('f-1');
    expect(res1[1].id).toBe('f-3');

    // Change query to heater_bed
    const criteria2 = parseFilterQuery('heater_bed');
    const res2 = engine.filter(frames, null, criteria2);
    expect(res2.length).toBe(1);
    expect(res2[0].id).toBe('f-2');
  });

  it('3. Incrementally appends newly arrived matching frames without re-filtering previous frames', () => {
    const initialFrames = [
      makeFrame(1, '{"method":"toolhead"}'),
      makeFrame(2, '{"method":"gcode"}'),
      makeFrame(3, '{"method":"toolhead"}'),
    ];

    const criteria = parseFilterQuery('toolhead');
    const res1 = engine.filter(initialFrames, null, criteria);
    expect(res1.length).toBe(2);

    // Stream 2 new frames: f-4 (not matching), f-5 (matching)
    const updatedFrames = [
      ...initialFrames,
      makeFrame(4, '{"method":"extruder"}'),
      makeFrame(5, '{"method":"toolhead"}'),
    ];

    const res2 = engine.filter(updatedFrames, null, criteria);
    expect(res2.length).toBe(3);
    expect(res2[0].id).toBe('f-1');
    expect(res2[1].id).toBe('f-3');
    expect(res2[2].id).toBe('f-5');
  });

  it('4. Correctly drops expired frames from filtered cache when ring-buffer cap overflows', () => {
    const criteria = parseFilterQuery('toolhead');

    // Initial 5 frames: f-1, f-3, f-5 match
    const initialFrames = [
      makeFrame(1, '{"method":"toolhead"}'),
      makeFrame(2, '{"method":"other"}'),
      makeFrame(3, '{"method":"toolhead"}'),
      makeFrame(4, '{"method":"other"}'),
      makeFrame(5, '{"method":"toolhead"}'),
    ];

    const res1 = engine.filter(initialFrames, null, criteria);
    expect(res1.map((f) => f.id)).toEqual(['f-1', 'f-3', 'f-5']);

    // Simulate ring buffer drop: drop first 2 frames (f-1, f-2), add f-6 (matches)
    // Surviving frames in buffer: f-3, f-4, f-5, f-6
    const updatedFrames = [
      initialFrames[2], // f-3
      initialFrames[3], // f-4
      initialFrames[4], // f-5
      makeFrame(6, '{"method":"toolhead"}'),
    ];

    const res2 = engine.filter(updatedFrames, null, criteria);
    expect(res2.map((f) => f.id)).toEqual(['f-3', 'f-5', 'f-6']);
  });

  it('5. Handles connectionId switching and filtering accurately', () => {
    const frames = [
      makeFrame(1, '{"type":"a"}', 'in', 'conn-1'),
      makeFrame(2, '{"type":"a"}', 'in', 'conn-2'),
      makeFrame(3, '{"type":"a"}', 'in', 'conn-1'),
    ];

    const criteria = parseFilterQuery('');

    // Select conn-1
    const res1 = engine.filter(frames, 'conn-1', criteria);
    expect(res1.length).toBe(2);
    expect(res1[0].id).toBe('f-1');
    expect(res1[1].id).toBe('f-3');

    // Switch to conn-2
    const res2 = engine.filter(frames, 'conn-2', criteria);
    expect(res2.length).toBe(1);
    expect(res2[0].id).toBe('f-2');

    // Clear connection selection
    const res3 = engine.filter(frames, null, criteria);
    expect(res3).toBe(frames);
  });

  it('6. Handles reset and clear operations safely', () => {
    const criteria = parseFilterQuery('test');
    const frames = [makeFrame(1, 'test')];
    engine.filter(frames, null, criteria);

    // Empty buffer
    const resEmpty = engine.filter([], null, criteria);
    expect(resEmpty).toEqual([]);

    engine.reset();
    const resAfterReset = engine.filter(frames, null, criteria);
    expect(resAfterReset.length).toBe(1);
  });
});
