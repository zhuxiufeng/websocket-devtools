import type { WSFrame, FilterCriteria, NumericComparison, ComparisonOp } from '../types/websocket';
import { extractFrameField } from './field-extractor';

/**
 * Parses numeric unit strings like '100ms', '1.5s', '2kb' into pure numbers
 */
function parseNumericValueWithUnit(valStr: string): number | null {
  const clean = valStr.trim().toLowerCase();
  const unitMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s|b|kb|mb)?$/);
  if (!unitMatch) return null;

  const baseNum = parseFloat(unitMatch[1]);
  if (isNaN(baseNum)) return null;

  const unit = unitMatch[2];
  if (unit === 's') return baseNum * 1000;
  if (unit === 'kb') return baseNum * 1024;
  if (unit === 'mb') return baseNum * 1024 * 1024;
  return baseNum; // 'ms', 'b', or unitless
}

/**
 * Parses a single condition token string (without OR logic)
 */
function parseSingleCriteria(rawQuery: string): FilterCriteria {
  const criteria: FilterCriteria = {
    rawQuery,
    direction: 'all',
    excludeKeywords: [],
    hasFields: [],
    jsonKeyValues: [],
    numericComparisons: [],
    textKeywords: [],
    regexes: [],
    excludeRegexes: [],
  };

  const trimmed = rawQuery.trim();
  if (!trimmed) return criteria;

  // Split tokens by spaces, preserving quotes if any
  const tokenRegex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  const tokens: string[] = [];

  while ((match = tokenRegex.exec(trimmed)) !== null) {
    tokens.push(match[1] || match[2] || match[0]);
  }

  for (const token of tokens) {
    if (!token) continue;

    // Direction filter: dir:in or dir:out
    if (/^dir:(in|out)$/i.test(token)) {
      criteria.direction = token.toLowerCase().endsWith('in') ? 'in' : 'out';
      continue;
    }

    // Exclude regex: !/pattern/flags
    if (/^!\/([^\/]+)\/([gimsuy]*)$/.test(token)) {
      const regMatch = token.match(/^!\/([^\/]+)\/([gimsuy]*)$/);
      if (regMatch) {
        try {
          criteria.excludeRegexes.push(new RegExp(regMatch[1], regMatch[2] || 'i'));
          continue;
        } catch {
          // Fallback to text exclusion
        }
      }
    }

    // Exclude keyword: -word or !word
    if (token.startsWith('-') || token.startsWith('!')) {
      const word = token.slice(1).trim();
      if (word) {
        criteria.excludeKeywords.push(word.toLowerCase());
      }
      continue;
    }

    // Has field: has:field_name
    if (/^has:(.+)$/i.test(token)) {
      const field = token.slice(4).trim();
      if (field) {
        criteria.hasFields.push(field);
      }
      continue;
    }

    // JSON key-value: json:path=val or json:key=val
    if (/^json:([^=]+)=(.*)$/i.test(token)) {
      const parts = token.slice(5).split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (key) {
        criteria.jsonKeyValues.push({ key, value });
      }
      continue;
    }

    // Numeric comparison: e.g. temp>200, speed>=1000, latency<50ms, len>1024, deltaMs>100
    const numCompMatch = token.match(/^([a-zA-Z0-9_\.\[\]]+)\s*(>=|<=|!=|==|>|<|=)\s*(-?\d+(?:\.\d+)?[a-zA-Z]*)$/);
    if (numCompMatch) {
      const field = numCompMatch[1].trim();
      const op = numCompMatch[2] as ComparisonOp;
      const parsedVal = parseNumericValueWithUnit(numCompMatch[3]);
      if (parsedVal !== null) {
        criteria.numericComparisons.push({
          field,
          op,
          value: parsedVal,
        });
        continue;
      }
    }

    // Regex match: /pattern/flags
    if (/^\/([^\/]+)\/([gimsuy]*)$/.test(token)) {
      const regMatch = token.match(/^\/([^\/]+)\/([gimsuy]*)$/);
      if (regMatch) {
        try {
          criteria.regexes.push(new RegExp(regMatch[1], regMatch[2] || 'i'));
          continue;
        } catch {
          // Fallback to text match
        }
      }
    }

    // Plain text match
    criteria.textKeywords.push(token.toLowerCase());
  }

  return criteria;
}

/**
 * Parses user input query string into structured FilterCriteria (supports OR syntax)
 */
export function parseFilterQuery(rawQuery: string): FilterCriteria {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return parseSingleCriteria(rawQuery);
  }

  // Check for top-level OR clauses: e.g. "extruder OR heater_bed"
  if (/\bOR\b/.test(trimmed)) {
    const rawClauses = trimmed.split(/\s+\bOR\b\s+/);
    if (rawClauses.length > 1) {
      const subCriteria = rawClauses.map((c) => parseSingleCriteria(c));
      const base = parseSingleCriteria(rawQuery);
      base.orClauses = subCriteria;
      return base;
    }
  }

  return parseSingleCriteria(rawQuery);
}

/**
 * Evaluates numeric comparison against a value
 */
function evaluateNumericComparison(actualVal: number, op: ComparisonOp, targetVal: number): boolean {
  switch (op) {
    case '>':
      return actualVal > targetVal;
    case '>=':
      return actualVal >= targetVal;
    case '<':
      return actualVal < targetVal;
    case '<=':
      return actualVal <= targetVal;
    case '==':
    case '=':
      return Math.abs(actualVal - targetVal) < 1e-6;
    case '!=':
      return Math.abs(actualVal - targetVal) >= 1e-6;
    default:
      return false;
  }
}

/**
 * Checks if a WSFrame satisfies single filter criteria
 */
function matchesSingleFilter(frame: WSFrame, criteria: FilterCriteria): boolean {
  // 1. Direction check
  if (criteria.direction !== 'all' && frame.direction !== criteria.direction) {
    return false;
  }

  const payloadText = (frame.payload || '').toLowerCase();

  // 2. Exclude keywords
  for (const excl of criteria.excludeKeywords) {
    if (payloadText.includes(excl)) {
      return false;
    }
  }

  // 3. Exclude regexes
  for (const reg of criteria.excludeRegexes) {
    if (reg.test(frame.payload || '')) {
      return false;
    }
  }

  // 4. has:field check
  for (const field of criteria.hasFields) {
    const val = extractFrameField(frame, field);
    if (val === undefined || val === null) {
      return false;
    }
  }

  // 5. json:key=val check
  for (const { key, value } of criteria.jsonKeyValues) {
    const extracted = extractFrameField(frame, key);
    if (extracted === undefined || extracted === null) {
      return false;
    }
    const strVal = String(extracted).toLowerCase();
    if (strVal !== value.toLowerCase() && !strVal.includes(value.toLowerCase())) {
      return false;
    }
  }

  // 6. Numeric comparisons: temp>200, speed>=1000, latency<50ms, len>1024, deltaMs>100
  for (const { field, op, value } of criteria.numericComparisons) {
    let rawNum: number | undefined;

    // Check frame built-in properties
    const lowerField = field.toLowerCase();
    if (lowerField === 'len' || lowerField === 'length') {
      rawNum = frame.length;
    } else if (lowerField === 'latency' || lowerField === 'rpclatency' || lowerField === 'rpclatencyms') {
      rawNum = frame.rpcLatencyMs;
    } else if (lowerField === 'deltams' || lowerField === 'delta' || lowerField === 'dt') {
      rawNum = frame.deltaMs;
    } else if (lowerField === 'seq') {
      rawNum = frame.seq;
    } else {
      // Dynamic JSON extraction
      const extracted = extractFrameField(frame, field);
      if (extracted !== undefined && extracted !== null) {
        const num = Number(extracted);
        if (!isNaN(num)) {
          rawNum = num;
        }
      }
    }

    if (rawNum === undefined || isNaN(rawNum)) {
      return false;
    }

    if (!evaluateNumericComparison(rawNum, op, value)) {
      return false;
    }
  }

  // 7. Regexes
  for (const reg of criteria.regexes) {
    if (!reg.test(frame.payload || '')) {
      return false;
    }
  }

  // 8. Plain text keywords
  for (const kw of criteria.textKeywords) {
    if (!payloadText.includes(kw)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a WSFrame satisfies all parsed filter criteria (supports OR clauses)
 */
export function matchesFilter(frame: WSFrame, criteria: FilterCriteria): boolean {
  if (criteria.orClauses && criteria.orClauses.length > 0) {
    return criteria.orClauses.some((clause) => matchesSingleFilter(frame, clause));
  }
  return matchesSingleFilter(frame, criteria);
}
