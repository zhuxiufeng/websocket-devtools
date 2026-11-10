import { describe, it, expect } from 'vitest';
import { downsampleLTTB } from '../src/utils/lttb';
import type { TelemetryPoint } from '../src/types/websocket';

describe('LTTB Downsampling', () => {
  it('returns original points if count is below threshold', () => {
    const points: TelemetryPoint[] = [
      { time: 1, value: 10, formattedTime: '1' },
      { time: 2, value: 20, formattedTime: '2' },
    ];
    expect(downsampleLTTB(points, 5)).toEqual(points);
  });

  it('preserves start, end and highest peak point', () => {
    const points: TelemetryPoint[] = [
      { time: 0, value: 0, formattedTime: '0' },
      { time: 1, value: 1, formattedTime: '1' },
      { time: 2, value: 100, formattedTime: '2' }, // Sharp peak
      { time: 3, value: 1, formattedTime: '3' },
      { time: 4, value: 0, formattedTime: '4' },
    ];
    const sampled = downsampleLTTB(points, 3);
    expect(sampled.length).toBe(3);
    expect(sampled[0].time).toBe(0);
    expect(sampled[2].time).toBe(4);
    // Middle point should capture the sharp peak
    expect(sampled[1].value).toBe(100);
  });
});
