import { describe, it, expect } from 'vitest';
import {
  hasFilterToken,
  appendFilterToken,
  removeFilterToken,
  toggleFilterToken,
} from '../src/utils/filter-helper';

describe('Filter Helper Utilities', () => {
  it('detects if token exists in query string', () => {
    expect(hasFilterToken('', 'has:position')).toBe(false);
    expect(hasFilterToken('has:position', 'has:position')).toBe(true);
    expect(hasFilterToken('dir:in has:position', 'has:position')).toBe(true);
    expect(hasFilterToken('has:position_extra', 'has:position')).toBe(false);
    expect(hasFilterToken('has:Position', 'has:position')).toBe(true);
  });

  it('appends token without duplication', () => {
    expect(appendFilterToken('', 'has:heater_bed')).toBe('has:heater_bed');
    expect(appendFilterToken('dir:in', 'has:heater_bed')).toBe('dir:in has:heater_bed');
    expect(appendFilterToken('dir:in has:heater_bed', 'has:heater_bed')).toBe('dir:in has:heater_bed');
  });

  it('removes token cleanly', () => {
    expect(removeFilterToken('dir:in has:heater_bed', 'has:heater_bed')).toBe('dir:in');
    expect(removeFilterToken('has:heater_bed', 'has:heater_bed')).toBe('');
    expect(removeFilterToken('a has:heater_bed b', 'has:heater_bed')).toBe('a b');
  });

  it('toggles token dynamically', () => {
    let q = 'dir:in';
    q = toggleFilterToken(q, 'has:extruder');
    expect(q).toBe('dir:in has:extruder');
    q = toggleFilterToken(q, 'has:extruder');
    expect(q).toBe('dir:in');
  });
});
