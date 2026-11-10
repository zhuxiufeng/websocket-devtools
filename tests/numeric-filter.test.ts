import { describe, it, expect } from 'vitest';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
import type { WSFrame } from '../src/types/websocket';

describe('Numeric Comparison & OR Syntax Filters', () => {
  const sampleFrame: WSFrame = {
    id: 'frame-1',
    seq: 42,
    connectionId: 'conn-1',
    direction: 'in',
    timestamp: 1000,
    timeFormatted: '10:00:00.000',
    length: 1500,
    payload: JSON.stringify({
      method: 'notify_status_update',
      params: [
        {
          heater_bed: { temperature: 65.4 },
          extruder: { temperature: 215.8 },
          gcode_move: { speed: 1200 },
        },
      ],
    }),
    jsonPayload: {
      method: 'notify_status_update',
      params: [
        {
          heater_bed: { temperature: 65.4 },
          extruder: { temperature: 215.8 },
          gcode_move: { speed: 1200 },
        },
      ],
    },
    isJson: true,
    rpcLatencyMs: 45,
    deltaMs: 80,
  };

  it('matches numeric comparisons with operators (> , >= , < , <= , == , !=)', () => {
    // Greater than
    expect(matchesFilter(sampleFrame, parseFilterQuery('extruder.temperature>200'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('extruder.temperature>220'))).toBe(false);

    // Fuzzy deep key matching
    expect(matchesFilter(sampleFrame, parseFilterQuery('speed>=1200'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('speed>1200'))).toBe(false);

    // Less than
    expect(matchesFilter(sampleFrame, parseFilterQuery('heater_bed.temperature<70'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('heater_bed.temperature<60'))).toBe(false);
  });

  it('evaluates built-in frame attributes (length, latency, deltaMs)', () => {
    // Frame length
    expect(matchesFilter(sampleFrame, parseFilterQuery('len>1000'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('len<500'))).toBe(false);

    // Latency
    expect(matchesFilter(sampleFrame, parseFilterQuery('latency<=50ms'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('latency<30ms'))).toBe(false);

    // DeltaMs
    expect(matchesFilter(sampleFrame, parseFilterQuery('deltaMs>=80ms'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('deltaMs>100ms'))).toBe(false);
  });

  it('evaluates OR clauses properly', () => {
    expect(matchesFilter(sampleFrame, parseFilterQuery('extruder.temperature>300 OR heater_bed.temperature>60'))).toBe(true);
    expect(matchesFilter(sampleFrame, parseFilterQuery('extruder.temperature>300 OR heater_bed.temperature>80'))).toBe(false);
  });
});
