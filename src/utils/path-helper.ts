/**
 * Helper to produce clean, disambiguated field names for columns and telemetry tracking
 */
export function getDisambiguatedPathAndName(fullPath: string, givenName?: string): {
  cleanPath: string;
  displayName: string;
} {
  if (!fullPath) {
    const fallback = givenName || 'unknown';
    return { cleanPath: fallback, displayName: fallback };
  }

  // Normalize path by stripping JSON-RPC transport boilerplate (e.g. params[0]., params.0., params., result.)
  let cleanPath = fullPath
    .replace(/^params\[\d+\]\./i, '')
    .replace(/^params\.\d+\./i, '')
    .replace(/^params\./i, '')
    .replace(/^result\./i, '')
    .trim();

  // If stripping left a bare numeric index (e.g. 'params.1' -> '1'), retain fullPath
  // so direct access targets params[1] instead of randomly colliding with nested arrays.
  if (/^\d+$/.test(cleanPath)) {
    cleanPath = fullPath.trim();
  }

  const segments = cleanPath.split('.').filter(Boolean);
  const leafKey = segments[segments.length - 1] || cleanPath;

  // If segments has 2 or more parts (e.g. ['extruder1', 'temperature'] or ['nozzle_temp', '0', 'temperature'])
  if (segments.length >= 2) {
    const parentRaw = segments[segments.length - 2];
    const isParentNumeric = /^\d+$/.test(parentRaw);

    let disambiguatedName = '';
    if (isParentNumeric && segments.length >= 3) {
      // E.g. ['nozzle_manager', 'nozzle_temp', '0', 'temperature']
      // Parent is numeric index '0', so look at grandparent 'nozzle_temp'
      const grandparent = segments[segments.length - 3].replace(/^temperature_sensor\s+/i, '');
      disambiguatedName = `${grandparent}[${parentRaw}].${leafKey}`;
    } else {
      const parent = parentRaw.replace(/^temperature_sensor\s+/i, '');
      disambiguatedName = `${parent}.${leafKey}`;
    }

    // If givenName is just the leaf (e.g. 'temperature'), or starts with an index (e.g. '0.temperature'),
    // or is identical to fullPath/cleanPath, use disambiguatedName
    if (
      !givenName ||
      givenName === leafKey ||
      givenName === fullPath ||
      givenName === cleanPath ||
      /^\d+\./.test(givenName)
    ) {
      return { cleanPath, displayName: disambiguatedName };
    }

    return { cleanPath, displayName: givenName };
  }

  // Single segment (e.g. 'speed' or 'live_position')
  return {
    cleanPath: cleanPath || leafKey,
    displayName: givenName && givenName !== fullPath ? givenName : cleanPath || leafKey,
  };
}

/**
 * Resolves a display title for a column, automatically disambiguating if the name is a bare leaf key
 * or starts with a numeric index (like '0.temperature')
 */
export function formatColumnHeader(name: string, path: string): string {
  if (!name || name === path || /^\d+\./.test(name)) {
    return getDisambiguatedPathAndName(path).displayName;
  }

  const { cleanPath, displayName } = getDisambiguatedPathAndName(path, name);
  const segments = cleanPath.split('.');
  const leaf = segments[segments.length - 1];

  // If the user's stored name is just the common bare leaf key (like 'temperature', 'speed', 'target')
  // or starts with an array index like '0.temperature', display the disambiguated name
  if ((name === leaf || /^\d+\./.test(name)) && segments.length >= 2) {
    return displayName;
  }

  return name;
}
