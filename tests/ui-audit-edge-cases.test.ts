import { describe, it, expect, beforeEach } from 'vitest';
import { downsampleLTTB } from '../src/utils/lttb';
import { useWSStore } from '../src/store/ws-store';
import type { TelemetryPoint } from '../src/types/websocket';

describe('UI Audit: LTTB & Store Edge Cases', () => {
  describe('LTTB downsampling edge cases', () => {
    it('handles empty data series safely', () => {
      const res = downsampleLTTB([], 100);
      expect(res).toEqual([]);
    });

    it('handles 1-point data series safely', () => {
      const single: TelemetryPoint[] = [{ time: 100, value: 42, formattedTime: '10:00:00' }];
      const res = downsampleLTTB(single, 100);
      expect(res).toEqual(single);
    });

    it('handles edge threshold values <= 2 without division by zero', () => {
      const points: TelemetryPoint[] = [
        { time: 1, value: 10, formattedTime: '1' },
        { time: 2, value: 20, formattedTime: '2' },
        { time: 3, value: 30, formattedTime: '3' },
        { time: 4, value: 40, formattedTime: '4' },
      ];
      // threshold = 2 should return at most 2 points without throwing or NaN
      const res2 = downsampleLTTB(points, 2);
      expect(Array.isArray(res2)).toBe(true);
      expect(res2.length).toBeLessThanOrEqual(points.length);
      for (const p of res2) {
        expect(Number.isFinite(p.time)).toBe(true);
        expect(Number.isFinite(p.value)).toBe(true);
      }

      // threshold = 1
      const res1 = downsampleLTTB(points, 1);
      expect(Array.isArray(res1)).toBe(true);

      // threshold = 0
      const res0 = downsampleLTTB(points, 0);
      expect(res0).toEqual(points);
    });
  });

  describe('Zustand store immutability & finite telemetry points', () => {
    beforeEach(() => {
      useWSStore.getState().clearFrames();
    });

    it('does not mutate connection object in place on subsequent batches', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-test', timestamp: 1000, direction: 'in', payload: '{}' },
      ]);

      const connBefore = useWSStore.getState().connections['ws-test'];
      expect(connBefore).toBeDefined();
      expect(connBefore.frameCount).toBe(1);

      // Add second frame on same connection
      useWSStore.getState().addFramesBatch([
        { id: 'f-2', connectionId: 'ws-test', timestamp: 1001, direction: 'out', payload: '{}' },
      ]);

      const connAfter = useWSStore.getState().connections['ws-test'];
      expect(connAfter.frameCount).toBe(2);

      // Immutability: connBefore must NOT have been mutated in place!
      expect(connBefore.frameCount).toBe(1);
      expect(connBefore).not.toBe(connAfter);
    });

    it('does not ingest NaN or Infinity into telemetry points when frame has numeric Infinity', () => {
      const store = useWSStore.getState();
      store.addTelemetrySeries('temp', 'Temperature');

      store.addFramesBatch([
        {
          id: 'f-1',
          connectionId: 'ws-1',
          timestamp: 1000,
          direction: 'in',
          payload: '{"temp": 25.5}',
          jsonPayload: { temp: 25.5 },
        },
        {
          id: 'f-2',
          connectionId: 'ws-1',
          timestamp: 1001,
          direction: 'in',
          payload: '{"temp": "Infinity"}',
          jsonPayload: { temp: Infinity },
        },
      ]);

      const series = useWSStore.getState().telemetrySeries[0];
      expect(series).toBeDefined();
      for (const pt of series.dataPoints) {
        expect(Number.isFinite(pt.value)).toBe(true);
      }
      expect(series.dataPoints.length).toBe(1);
    });
  });
});
