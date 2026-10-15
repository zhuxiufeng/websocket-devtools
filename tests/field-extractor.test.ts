import { describe, it, expect } from 'vitest';
import { extractField, extractFrameField, formatExtractedValue } from '../src/core/field-extractor';
import type { WSFrame } from '../src/types/websocket';

describe('field-extractor', () => {
  const moonrakerStatusPayload = {
    jsonrpc: '2.0',
    method: 'notify_status_update',
    params: [
      {
        gcode_move: {
          speed: 120.0,
          position: [95.47, 133.27, 0.22, 10.45],
        },
        toolhead: {
          position: [95.47, 133.27, 0.22, 10.45],
          live_position: [95.47, 133.27, 0.22, 10.45],
          estimated_print_time: 1234.56,
        },
        extruder: {
          temperature: 215.2,
          target: 220.0,
        },
        heater_bed: {
          temperature: 59.8,
          target: 60.0,
        },
      },
      1729000000.123,
    ],
  };

  it('extracts via direct dot path and bracket index', () => {
    const val = extractField(moonrakerStatusPayload, 'params.0.gcode_move.speed');
    expect(val).toBe(120.0);

    const pos = extractField(moonrakerStatusPayload, 'params[0].gcode_move.position');
    expect(pos).toEqual([95.47, 133.27, 0.22, 10.45]);
  });

  it('extracts deep fuzzy keys like live_position and temperature', () => {
    const livePos = extractField(moonrakerStatusPayload, 'live_position');
    expect(livePos).toEqual([95.47, 133.27, 0.22, 10.45]);

    const temp = extractField(moonrakerStatusPayload, 'extruder.temperature');
    expect(temp).toBe(215.2);
  });

  it('caches extractions on WSFrame for zero duplicate overhead', () => {
    const frame: WSFrame = {
      id: 'frame-1',
      connectionId: 'conn-1',
      direction: 'in',
      timestamp: Date.now(),
      timeFormatted: '12:00:00.000',
      length: 100,
      payload: JSON.stringify(moonrakerStatusPayload),
      jsonPayload: moonrakerStatusPayload,
      isJson: true,
    };

    const first = extractFrameField(frame, 'live_position');
    expect(first).toEqual([95.47, 133.27, 0.22, 10.45]);
    expect(frame.cachedExtractions?.['live_position']).toEqual([95.47, 133.27, 0.22, 10.45]);

    // Modifying cached value demonstrates cache hit
    frame.cachedExtractions!['live_position'] = [1, 2, 3];
    const second = extractFrameField(frame, 'live_position');
    expect(second).toEqual([1, 2, 3]);
  });

  it('formats extracted values nicely', () => {
    expect(formatExtractedValue([95.4712, 133.2789, 0.22])).toBe('[95.47, 133.28, 0.22]');
    expect(formatExtractedValue(215.2)).toBe('215.20');
    expect(formatExtractedValue(100)).toBe('100');
    expect(formatExtractedValue(-7.105427357601002e-15)).toBe('0.00');
    expect(formatExtractedValue(null)).toBe('-');
    expect(formatExtractedValue(undefined)).toBe('-');
  });

  it('correctly extracts from real multi-extruder CFS Moonraker payload', () => {
    const realPayload = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          gcode_move: { speed: 1200.0, position: [99.723, 132.275, 3.621, 1.91422] },
          box: { T1: { type: 'CFS-Nano', state: 'connect' } },
          virtual_sdcard: { progress: 0.1851799741434006 },
          nozzle_manager: { selected: 3, current_extruder: { temperature: 203.61 } },
          'temperature_sensor chamber_temp': { temperature: 34.22 },
          motion_report: {
            live_position: [213.45, 311.52, 3.8379668622222223, 0.0],
            live_velocity: -7.105427357601002e-15,
          },
          toolhead: { position: [99.723, 132.275, 3.6571943664203346, 1.91422] },
        },
        32667.536,
      ],
    };

    expect(extractField(realPayload, 'live_position')).toEqual([213.45, 311.52, 3.8379668622222223, 0.0]);
    expect(extractField(realPayload, 'motion_report.live_position')).toEqual([213.45, 311.52, 3.8379668622222223, 0.0]);
    expect(extractField(realPayload, 'chamber_temp.temperature')).toBe(34.22);
    expect(extractField(realPayload, 'virtual_sdcard.progress')).toBe(0.1851799741434006);
    expect(extractField(realPayload, 'box.T1.type')).toBe('CFS-Nano');
  });

  it('strictly distinguishes live_position and gcode_move.position without aliasing', () => {
    const deltaPayload = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [
        {
          gcode_move: { speed: 1200.0, position: [99.723, 132.275, 3.621, 1.91422] },
          print_stats: { total_duration: 791.79 },
        },
        12345.67,
      ],
    };

    // live_position is NOT in this frame, so it strictly returns undefined
    expect(extractField(deltaPayload, 'live_position')).toBeUndefined();
    // position / gcode_move.position is in this frame, so it extracts accurately
    expect(extractField(deltaPayload, 'position')).toEqual([99.723, 132.275, 3.621, 1.91422]);
    expect(extractField(deltaPayload, 'gcode_move.position')).toEqual([99.723, 132.275, 3.621, 1.91422]);
  });
});
