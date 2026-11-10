import type { TelemetryPoint } from '../types/websocket';

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm
 * Preserves visual peaks, troughs, and data trends while dramatically reducing points for rendering.
 */
export function downsampleLTTB(data: TelemetryPoint[], threshold: number): TelemetryPoint[] {
  if (threshold >= data.length || threshold === 0) {
    return data; // No downsampling needed
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

    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
      avgX += data[avgRangeStart].time;
      avgY += data[avgRangeStart].value;
    }
    avgX /= avgRangeLength || 1;
    avgY /= avgRangeLength || 1;

    // Get the range for this bucket
    let rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    // Point a
    const pointAX = data[a].time;
    const pointAY = data[a].value;

    maxArea = -1;

    for (; rangeOffs < rangeTo; rangeOffs++) {
      // Calculate triangle area over three buckets
      area =
        Math.abs(
          (pointAX - avgX) * (data[rangeOffs].value - pointAY) -
            (pointAX - data[rangeOffs].time) * (avgY - pointAY)
        ) * 0.5;

      if (area > maxArea) {
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
