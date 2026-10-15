import { describe, it, expect } from 'vitest';
import { getDisambiguatedPathAndName, formatColumnHeader } from '../src/utils/path-helper';

describe('path-helper disambiguation', () => {
  it('disambiguates identical field names by including parent object qualifier', () => {
    // extruder.temperature vs extruder1.temperature
    const res1 = getDisambiguatedPathAndName('params.0.extruder.temperature', 'temperature');
    expect(res1.cleanPath).toBe('extruder.temperature');
    expect(res1.displayName).toBe('extruder.temperature');

    const res2 = getDisambiguatedPathAndName('params[0].extruder1.temperature', 'temperature');
    expect(res2.cleanPath).toBe('extruder1.temperature');
    expect(res2.displayName).toBe('extruder1.temperature');

    const res3 = getDisambiguatedPathAndName('params.0.temperature_sensor chamber_temp.temperature', 'temperature');
    expect(res3.cleanPath).toBe('temperature_sensor chamber_temp.temperature');
    expect(res3.displayName).toBe('chamber_temp.temperature');
  });

  it('keeps single-level fields concise', () => {
    const res = getDisambiguatedPathAndName('speed', 'speed');
    expect(res.cleanPath).toBe('speed');
    expect(res.displayName).toBe('speed');
  });

  it('respects explicitly customized non-trivial names', () => {
    const res = getDisambiguatedPathAndName('extruder.temperature', 'Hotend 0 Temp');
    expect(res.cleanPath).toBe('extruder.temperature');
    expect(res.displayName).toBe('Hotend 0 Temp');
  });

  it('formats column headers to disambiguate bare leaf names with parent paths', () => {
    // When saved name was just 'temperature', but path is 'extruder1.temperature'
    expect(formatColumnHeader('temperature', 'extruder1.temperature')).toBe('extruder1.temperature');
    expect(formatColumnHeader('temperature', 'params.0.extruder.temperature')).toBe('extruder.temperature');
    expect(formatColumnHeader('Hotend 1', 'extruder1.temperature')).toBe('Hotend 1');
  });

  it('correctly handles array index parents like nozzle_manager.nozzle_temp.0.temperature', () => {
    const res0 = getDisambiguatedPathAndName('nozzle_manager.nozzle_temp.0.temperature', '0.temperature');
    expect(res0.displayName).toBe('nozzle_temp[0].temperature');

    const res2 = getDisambiguatedPathAndName('nozzle_manager.nozzle_temp.2.temperature', 'temperature');
    expect(res2.displayName).toBe('nozzle_temp[2].temperature');

    // And formatColumnHeader should fix existing '0.temperature' columns
    expect(formatColumnHeader('0.temperature', 'nozzle_manager.nozzle_temp.0.temperature')).toBe('nozzle_temp[0].temperature');
    expect(formatColumnHeader('2.temperature', 'nozzle_manager.nozzle_temp.2.temperature')).toBe('nozzle_temp[2].temperature');
  });
});
