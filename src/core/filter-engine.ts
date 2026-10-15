import type { WSFrame, FilterCriteria } from '../types/websocket';
import { extractFrameField } from './field-extractor';

/**
 * Parses user input query string into structured FilterCriteria
 */
export function parseFilterQuery(rawQuery: string): FilterCriteria {
  const criteria: FilterCriteria = {
    rawQuery,
    direction: 'all',
    excludeKeywords: [],
    hasFields: [],
    jsonKeyValues: [],
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
 * Checks if a WSFrame satisfies all parsed filter criteria (AND logic)
 */
export function matchesFilter(frame: WSFrame, criteria: FilterCriteria): boolean {
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

  // 6. Regexes
  for (const reg of criteria.regexes) {
    if (!reg.test(frame.payload || '')) {
      return false;
    }
  }

  // 7. Plain text keywords
  for (const kw of criteria.textKeywords) {
    if (!payloadText.includes(kw)) {
      return false;
    }
  }

  return true;
}
