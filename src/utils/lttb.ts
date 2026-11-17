import type { TelemetryPoint } from '../types/websocket';

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm
 * Preserves visual peaks, troughs, and data trends while dramatically reducing points for rendering.
 */
export function downsampleLTTB(data: TelemetryPoint[], threshold: number): TelemetryPoint[] {
  if (!data || data.length === 0) {
    return [];
  }

  if (threshold <= 0 || threshold >= data.length) {
    return data; // No downsampling needed
  }

  if (threshold === 1) {
    return [data[0]];
  }

  if (threshold === 2) {
    return data.length >= 2 ? [data[0], data[data.length - 1]] : data;
  }

  const sampled: TelemetryPoint[] = [];
  let sampledIndex = 0;

  // Bucket size. Leave room for start and end data points
  const every = (data.length - 2) / (threshold - 2);

  let a = 0; // Initially a is the first point in the triangle
  let maxAreaPoint: TelemetryPoint = data[0];
  let maxArea: number;
  let area: number;
  let nextA = 0;

  sampled[sampledIndex++] = data[a]; // Always add the first point

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate point average for next bucket (containing c)
    let avgX = 0;
    let avgY = 0;
    let avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    avgRangeEnd = avgRangeEnd < data.length ? avgRangeEnd : data.length;

    let validCount = 0;
    for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
      const pt = data[avgRangeStart];
      if (pt && Number.isFinite(pt.value) && Number.isFinite(pt.time)) {
        avgX += pt.time;
        avgY += pt.value;
        validCount++;
      }
    }
    avgX = validCount > 0 ? avgX / validCount : 0;
    avgY = validCount > 0 ? avgY / validCount : 0;

    // Get the range for this bucket
    let rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    // Point a
    const pointAX = data[a].time;
    const pointAY = Number.isFinite(data[a].value) ? data[a].value : 0;

    maxArea = -1;
    maxAreaPoint = data[rangeOffs] || data[a];
    nextA = rangeOffs < data.length ? rangeOffs : a;

    for (; rangeOffs < rangeTo && rangeOffs < data.length; rangeOffs++) {
      const ptVal = Number.isFinite(data[rangeOffs].value) ? data[rangeOffs].value : 0;
      const ptTime = data[rangeOffs].time;

      // Calculate triangle area over three buckets
      area =
        Math.abs(
          (pointAX - avgX) * (ptVal - pointAY) -
            (pointAX - ptTime) * (avgY - pointAY)
        ) * 0.5;

      if (Number.isFinite(area) && area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[rangeOffs];
        nextA = rangeOffs; // Next a is this b
      }
    }

    sampled[sampledIndex++] = maxAreaPoint; // Pick this point from the bucket
    a = nextA; // This a is the next a (chosen b)
  }

  sampled[sampledIndex++] = data[data.length - 1]; // Always add the last point

  return sampled;
}
