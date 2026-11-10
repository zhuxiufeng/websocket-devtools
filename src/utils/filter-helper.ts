/**
 * Utility functions for manipulating filterQuery strings
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a specific token is already present in the query string (case-insensitive)
 */
export function hasFilterToken(query: string, token: string): boolean {
  if (!query || !token) return false;
  const trimmedToken = token.trim();
  const trimmedQuery = query.trim();
  const regex = new RegExp(`(^|\\s)${escapeRegex(trimmedToken)}(\\s|$)`, 'i');
  return regex.test(trimmedQuery);
}

/**
 * Appends a token to the query string if not already present
 */
export function appendFilterToken(query: string, token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return query;
  if (!query || !query.trim()) return trimmedToken;
  if (hasFilterToken(query, trimmedToken)) return query.trim();
  return `${query.trim()} ${trimmedToken}`;
}

/**
 * Removes a specific token from the query string
 */
export function removeFilterToken(query: string, token: string): string {
  if (!query || !token) return query;
  const trimmedToken = token.trim().toLowerCase();
  const tokens = query.trim().split(/\s+/);
  const remaining = tokens.filter((t) => t.toLowerCase() !== trimmedToken);
  return remaining.join(' ');
}

/**
 * Toggles a token in the query: removes it if present, otherwise appends it
 */
export function toggleFilterToken(query: string, token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return query;
  if (!query || !query.trim()) return trimmedToken;

  if (hasFilterToken(query, trimmedToken)) {
    return removeFilterToken(query, trimmedToken);
  }
  return `${query.trim()} ${trimmedToken}`;
}
