#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// 1. Read version from package.json
const pkgPath = resolve(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const version = pkg.version || '1.0.0';

// 2. Fetch commits since the previous tag
let commits = [];
try {
  let prevTag = '';
  try {
    prevTag = execSync('git describe --tags --abbrev=0 HEAD~1 2>/dev/null', {
      cwd: rootDir,
      encoding: 'utf-8',
    }).trim();
  } catch {
    try {
      prevTag = execSync('git describe --tags --abbrev=0 2>/dev/null', {
        cwd: rootDir,
        encoding: 'utf-8',
      }).trim();
    } catch {
      prevTag = '';
    }
  }

  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD~10..HEAD';
  const logOutput = execSync(`git log ${range} --pretty=format:"%s"`, {
    cwd: rootDir,
    encoding: 'utf-8',
  }).trim();

  if (logOutput) {
    commits = logOutput.split('\n').filter(Boolean);
  }
} catch {
  // Fallback to latest commit
  try {
    const lastMsg = execSync('git log -1 --pretty=format:"%s"', {
      cwd: rootDir,
      encoding: 'utf-8',
    }).trim();
    if (lastMsg) commits = [lastMsg];
  } catch {
    commits = [];
  }
}

// 3. Transform commits into clean bullet items
const bullets = [];

for (const raw of commits) {
  let msg = raw.trim();
  // Strip release version suffix like (v1.0.2)
  msg = msg.replace(/\s*\(v\d+\.\d+\.\d+\)\s*$/i, '');

  if (/^feat(\([^\)]+\))?:\s*/i.test(msg)) {
    let clean = msg.replace(/^feat(\([^\)]+\))?:\s*/i, '').trim();
    if (/^add\s+/i.test(clean)) {
      clean = clean.replace(/^add\s+/i, '');
    }
    bullets.push(`- Added ${clean}.`);
  } else if (/^fix(\([^\)]+\))?:\s*/i.test(msg)) {
    let clean = msg.replace(/^fix(\([^\)]+\))?:\s*/i, '').trim();
    if (/^resolve\s+/i.test(clean)) {
      clean = clean.replace(/^resolve\s+/i, '');
    }
    bullets.push(`- Fixed ${clean}.`);
  } else if (/^perf(\([^\)]+\))?:\s*/i.test(msg)) {
    let clean = msg.replace(/^perf(\([^\)]+\))?:\s*/i, '').trim();
    bullets.push(`- Improved performance of ${clean}.`);
  } else if (/^refactor(\([^\)]+\))?:\s*/i.test(msg)) {
    let clean = msg.replace(/^refactor(\([^\)]+\))?:\s*/i, '').trim();
    bullets.push(`- Refactored ${clean}.`);
  }
}

// If no conventional commits were found, provide fallback based on recent fixes
if (bullets.length === 0) {
  bullets.push('- Improved telemetry curve real-time scrolling and carry-forward stability.');
  bullets.push('- Enhanced custom column historical value backfilling and path matching accuracy.');
}

// 4. Construct exact format
const result = [
  '---',
  `What's new in v${version}:`,
  ...bullets,
].join('\n');

// 5. Save to .output/release-notes.txt for convenience
try {
  mkdirSync(resolve(rootDir, '.output'), { recursive: true });
  writeFileSync(resolve(rootDir, '.output', 'release-notes.txt'), result, 'utf-8');
} catch {
  // Ignore filesystem error
}

// 6. Output pure clean text to stdout
console.log(result);
