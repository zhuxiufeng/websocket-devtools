export interface DiffEntry {
  path: string;
  key: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: any;
  newValue?: any;
}

/**
 * Computes deep differences between two JSON objects/primitives
 */
export function computeJsonDiff(
  prev: any,
  curr: any,
  currentPath = ''
): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  // If one of them is primitive or null
  if (
    typeof prev !== 'object' ||
    prev === null ||
    typeof curr !== 'object' ||
    curr === null
  ) {
    if (prev !== curr) {
      diffs.push({
        path: currentPath || 'root',
        key: currentPath ? currentPath.split('.').pop()! : 'root',
        type: 'changed',
        oldValue: prev,
        newValue: curr,
      });
    }
    return diffs;
  }

  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));

  // Check current keys (added or changed)
  for (const key of currKeys) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    const prevVal = prev[key];
    const currVal = curr[key];

    if (!prevKeys.has(key)) {
      diffs.push({
        path: nextPath,
        key,
        type: 'added',
        newValue: currVal,
      });
    } else if (
      typeof prevVal === 'object' &&
      prevVal !== null &&
      typeof currVal === 'object' &&
      currVal !== null &&
      !Array.isArray(prevVal) &&
      !Array.isArray(currVal)
    ) {
      // Recurse into nested objects
      const subDiffs = computeJsonDiff(prevVal, currVal, nextPath);
      diffs.push(...subDiffs);
    } else if (Array.isArray(prevVal) && Array.isArray(currVal)) {
      // Element-by-element diff for arrays
      if (JSON.stringify(prevVal) !== JSON.stringify(currVal)) {
        const maxLen = Math.max(prevVal.length, currVal.length);
        for (let i = 0; i < maxLen; i++) {
          const itemPath = `${nextPath}[${i}]`;
          if (i >= prevVal.length) {
            diffs.push({
              path: itemPath,
              key: `[${i}]`,
              type: 'added',
              newValue: currVal[i],
            });
          } else if (i >= currVal.length) {
            diffs.push({
              path: itemPath,
              key: `[${i}]`,
              type: 'removed',
              oldValue: prevVal[i],
            });
          } else if (JSON.stringify(prevVal[i]) !== JSON.stringify(currVal[i])) {
            if (
              typeof prevVal[i] === 'object' &&
              prevVal[i] !== null &&
              typeof currVal[i] === 'object' &&
              currVal[i] !== null
            ) {
              diffs.push(...computeJsonDiff(prevVal[i], currVal[i], itemPath));
            } else {
              diffs.push({
                path: itemPath,
                key: `[${i}]`,
                type: 'changed',
                oldValue: prevVal[i],
                newValue: currVal[i],
              });
            }
          }
        }
      }
    } else {
      // Compare primitives
      if (prevVal !== currVal) {
        diffs.push({
          path: nextPath,
          key,
          type: 'changed',
          oldValue: prevVal,
          newValue: currVal,
        });
      }
    }
  }

  // Check removed keys
  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      diffs.push({
        path: nextPath,
        key,
        type: 'removed',
        oldValue: prev[key],
      });
    }
  }

  return diffs;
}
