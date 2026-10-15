import { describe, it, expect } from 'vitest';
import { parseFilterQuery, matchesFilter } from '../src/core/filter-engine';
import type { WSFrame } from '../src/types/websocket';

describe('filter-engine', () => {
  const sampleFrame1: WSFrame = {
    id: 'f1',
    connectionId: 'c1',
    direction: 'in',
    timestamp: 1000,
    timeFormatted: '10:00:00.000',
    length: 120,
    payload: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { live_position: [100.5, 200.2, 5.0] } }],
    }),
    jsonPayload: {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ toolhead: { live_position: [100.5, 200.2, 5.0] } }],
    },
    isJson: true,
  };

  const sampleFrame2: WSFrame = {
    id: 'f2',
    connectionId: 'c1',
    direction: 'out',
    timestamp: 1005,
    timeFormatted: '10:00:00.005',
    length: 45,
    payload: JSON.stringify({
      jsonrpc: '2.0',
      method: 'printer.gcode.script',
      params: { script: 'G28 X Y' },
    }),
    jsonPayload: {
      jsonrpc: '2.0',
      method: 'printer.gcode.script',
      params: { script: 'G28 X Y' },
    },
    isJson: true,
  };

  it('parses direction, exclusion, has:field and text tokens', () => {
    const q = 'dir:in -heartbeat has:live_position notify_status';
    const criteria = parseFilterQuery(q);

    expect(criteria.direction).toBe('in');
    expect(criteria.excludeKeywords).toContain('heartbeat');
    expect(criteria.hasFields).toContain('live_position');
    expect(criteria.textKeywords).toContain('notify_status');
  });

  it('matches direction correctly', () => {
    const inCriteria = parseFilterQuery('dir:in');
    expect(matchesFilter(sampleFrame1, inCriteria)).toBe(true);
    expect(matchesFilter(sampleFrame2, inCriteria)).toBe(false);

    const outCriteria = parseFilterQuery('dir:out');
    expect(matchesFilter(sampleFrame1, outCriteria)).toBe(false);
    expect(matchesFilter(sampleFrame2, outCriteria)).toBe(true);
  });

  it('excludes keywords with - or !', () => {
    const criteria = parseFilterQuery('-gcode');
    expect(matchesFilter(sampleFrame1, criteria)).toBe(true);
    expect(matchesFilter(sampleFrame2, criteria)).toBe(false);
  });

  it('matches has:field correctly', () => {
    const hasLivePos = parseFilterQuery('has:live_position');
    expect(matchesFilter(sampleFrame1, hasLivePos)).toBe(true);
    expect(matchesFilter(sampleFrame2, hasLivePos)).toBe(false);
  });

  it('matches json:key=val correctly', () => {
    const methodFilter = parseFilterQuery('json:method=printer.gcode.script');
    expect(matchesFilter(sampleFrame1, methodFilter)).toBe(false);
    expect(matchesFilter(sampleFrame2, methodFilter)).toBe(true);
  });

  it('matches regex pattern', () => {
    const regexCriteria = parseFilterQuery('/G28\\s+X/i');
    expect(matchesFilter(sampleFrame1, regexCriteria)).toBe(false);
    expect(matchesFilter(sampleFrame2, regexCriteria)).toBe(true);
  });
});
