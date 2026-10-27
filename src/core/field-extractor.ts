import type { WSFrame } from '../types/websocket';

/**
 * Normalizes path strings like 'params[0].foo[1]' to 'params.0.foo.1'
 */
function normalizePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\./, '')
    .split('.')
    .filter(Boolean);
}

/**
 * Direct path traversal
 */
function getByDirectPath(obj: any, segments: string[]): any {
  let curr = obj;
  for (const seg of segments) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = curr[seg];
  }
  return curr;
}

/**
 * Fuzzy deep key / partial path search
 * Recursively looks for a matching key or subpath.
 */
function findDeep(obj: any, targetKeyOrSegments: string | string[], maxDepth = 10): any {
  if (obj == null || typeof obj !== 'object' || maxDepth <= 0) {
    return undefined;
  }

  const segments = Array.isArray(targetKeyOrSegments)
    ? targetKeyOrSegments
    : targetKeyOrSegments.includes('.')
    ? targetKeyOrSegments.split('.')
    : [targetKeyOrSegments];

  if (segments.length === 1) {
    const key = segments[0];
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }

    // Bare numeric index (e.g. '0', '1') has no semantic meaning across deep recursive tree traversal.
    // Prevent diving into unrelated child arrays where it would falsely match indices like position[1].
    if (/^\d+$/.test(key)) {
      return undefined;
    }

    // Support fuzzy subkey with spaces (e.g. matching "temperature_sensor chamber_temp" with "chamber_temp")
    if (!Array.isArray(obj)) {
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === key.toLowerCase() || k.toLowerCase().endsWith(` ${key.toLowerCase()}`)) {
          return obj[k];
        }
      }
    }
  } else {
    // Check if the entire multi-segment subpath starts here
    let matched = true;
    let curr = obj;
    for (const seg of segments) {
      if (curr != null && typeof curr === 'object') {
        if (seg in curr) {
          curr = curr[seg];
        } else {
          // Check fuzzy key match (e.g. "temperature_sensor chamber_temp")
          let foundKey: string | undefined;
          for (const k of Object.keys(curr)) {
            if (k.toLowerCase() === seg.toLowerCase() || k.toLowerCase().endsWith(` ${seg.toLowerCase()}`)) {
              foundKey = k;
              break;
            }
          }
          if (foundKey) {
            curr = curr[foundKey];
          } else {
            matched = false;
            break;
          }
        }
      } else {
        matched = false;
        break;
      }
    }
    if (matched && curr !== undefined) {
      return curr;
    }
  }

  // Recurse children
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findDeep(item, segments, maxDepth - 1);
      if (res !== undefined) return res;
    }
  } else {
    for (const k of Object.keys(obj)) {
      const res = findDeep(obj[k], segments, maxDepth - 1);
      if (res !== undefined) return res;
    }
  }

  return undefined;
}

/**
 * Extracts a field from a JSON object:
 * 1. Tries direct exact path (e.g. params[0].gcode_move.position)
 * 2. Tries deep search strictly for the specified key or subpath
 */
export function extractField(data: any, path: string): any {
  if (data == null || !path) return undefined;

  const segments = normalizePath(path);
  if (segments.length > 0) {
    const direct = getByDirectPath(data, segments);
    if (direct !== undefined) return direct;
  }

  // Deep search strictly for the target key or segments
  return findDeep(data, path.includes('.') ? segments : path);
}

/**
 * Extract field with per-frame caching to avoid re-parsing during virtual scroll
 */
export function extractFrameField(frame: WSFrame, path: string): any {
  if (!frame) return undefined;
  if (!frame.cachedExtractions) {
    frame.cachedExtractions = {};
  }

  if (path in frame.cachedExtractions) {
    return frame.cachedExtractions[path];
  }

  let value: any = undefined;
  if (frame.jsonPayload) {
    value = extractField(frame.jsonPayload, path);
  } else if (frame.payload && frame.isJson) {
    try {
      const parsed = JSON.parse(frame.payload);
      frame.jsonPayload = parsed;
      value = extractField(parsed, path);
    } catch {
      // Not valid JSON
    }
  }

  frame.cachedExtractions[path] = value;
  return value;
}

/**
 * Format extracted value nicely for table cell display
 */
export function formatExtractedValue(value: any): string {
  if (value === undefined || value === null) {
    return '-';
  }

  if (typeof value === 'number') {
    // Handle floating point precision underflow (e.g. -7.1054e-15 velocity)
    if (Math.abs(value) < 1e-6) {
      return '0.00';
    }
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    // Check if it's an array of numbers (e.g. coordinates [x, y, z, e])
    if (value.every((v) => typeof v === 'number')) {
      return `[${value.map((v) => {
        if (Math.abs(v) < 1e-6) return '0.00';
        return Number.isInteger(v) ? v.toString() : v.toFixed(2);
      }).join(', ')}]`;
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
