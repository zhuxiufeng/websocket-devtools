import React from 'react';
import type { HighlightRule } from '../types/websocket';

/**
 * Highlights keywords in a string based on active HighlightRules
 */
export function highlightText(
  text: string,
  rules: HighlightRule[],
  className = ''
): React.ReactNode {
  if (!text || !rules || rules.length === 0) {
    return text;
  }

  const activeRules = rules.filter((r) => r.active && r.text.trim().length > 0);
  if (activeRules.length === 0) {
    return text;
  }

  // Create a combined regex pattern
  // Escape special regex characters in rule texts
  const escapedKeywords = activeRules.map((r) =>
    r.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

  const pattern = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');
  const parts = text.split(pattern);

  if (parts.length === 1) {
    return text;
  }

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const matchingRule = activeRules.find(
          (r) => r.text.toLowerCase() === part.toLowerCase()
        );

        if (matchingRule) {
          return (
            <mark
              key={i}
              style={{
                backgroundColor: `${matchingRule.color}35`,
                color: matchingRule.color,
                border: `1px solid ${matchingRule.color}60`,
              }}
              className="px-1 py-0.2 rounded font-semibold transition-all inline-block leading-tight font-mono text-[11px]"
            >
              {part}
            </mark>
          );
        }

        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
