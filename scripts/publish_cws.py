#!/usr/bin/env python3
"""
Chrome Web Store Package & Release Automation Script
- Tests, builds, and packages the Chrome MV3 extension (.zip)
- Copies the release package to Windows Desktop for 1-click CWS upload
- Generates standardized release notes in the exact user-required format:
    ---
    What's new in v<version>:
    - <bullet 1>
    - <bullet 2>
- Synchronizes CHROMEWEBSTORE.md metadata and commits/tags to Git
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DESKTOP_DIR = Path('/mnt/c/Users/sageb/Desktop')


def run_cmd(cmd: str, check: bool = True) -> str:
    res = subprocess.run(cmd, shell=True, cwd=ROOT_DIR, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"Error running command: {cmd}\n{res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)
    return res.stdout.strip()


def get_current_version() -> str:
    pkg_file = ROOT_DIR / 'package.json'
    with open(pkg_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('version', '1.0.0')


def bump_version(current: str) -> str:
    parts = current.split('.')
    if len(parts) == 3 and parts[-1].isdigit():
        parts[-1] = str(int(parts[-1]) + 1)
        return '.'.join(parts)
    return current


def update_version_in_files(new_ver: str):
    # 1. package.json
    pkg_file = ROOT_DIR / 'package.json'
    with open(pkg_file, 'r', encoding='utf-8') as f:
        pkg = json.load(f)
    pkg['version'] = new_ver
    with open(pkg_file, 'w', encoding='utf-8') as f:
        json.dump(pkg, f, indent=2)
        f.write('\n')

    # 2. wxt.config.ts
    wxt_file = ROOT_DIR / 'wxt.config.ts'
    if wxt_file.exists():
        content = wxt_file.read_text(encoding='utf-8')
        content = re.sub(r"version:\s*'[^']+'", f"version: '{new_ver}'", content)
        wxt_file.write_text(content, encoding='utf-8')


def generate_release_notes(version: str, manual_notes: list[str] = None) -> str:
    bullets = []
    if manual_notes:
        for n in manual_notes:
            clean = n.strip()
            if not clean.startswith('- '):
                clean = f"- {clean}"
            bullets.append(clean)
    else:
        # Extract from git commits since previous tag
        try:
            prev_tag = run_cmd("git describe --tags --abbrev=0 HEAD~1 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null", check=False)
            commit_range = f"{prev_tag}..HEAD" if prev_tag else "HEAD~5..HEAD"
            log_out = run_cmd(f'git log {commit_range} --pretty=format:"%s"', check=False)
            raw_commits = [c.strip() for c in log_out.split('\n') if c.strip()]
        except Exception:
            raw_commits = []

        for msg in raw_commits:
            # Strip tag/version suffix
            msg = re.sub(r'\s*\(v\d+\.\d+\.\d+\)\s*$', '', msg, flags=re.I)
            if re.match(r'^feat(\([^\)]+\))?:\s*', msg, re.I):
                clean = re.sub(r'^feat(\([^\)]+\))?:\s*', '', msg, flags=re.I).strip()
                if clean.lower().startswith('add '):
                    clean = clean[4:].strip()
                bullets.append(f"- Added {clean}.")
            elif re.match(r'^fix(\([^\)]+\))?:\s*', msg, re.I):
                clean = re.sub(r'^fix(\([^\)]+\))?:\s*', '', msg, flags=re.I).strip()
                if clean.lower().startswith('resolve '):
                    clean = clean[8:].strip()
                bullets.append(f"- Fixed {clean}.")
            elif re.match(r'^perf(\([^\)]+\))?:\s*', msg, re.I):
                clean = re.sub(r'^perf(\([^\)]+\))?:\s*', '', msg, flags=re.I).strip()
                bullets.append(f"- Improved performance of {clean}.")
            elif re.match(r'^refactor(\([^\)]+\))?:\s*', msg, re.I):
                clean = re.sub(r'^refactor(\([^\)]+\))?:\s*', '', msg, flags=re.I).strip()
                bullets.append(f"- Refactored {clean}.")

    if not bullets:
        bullets = [
            "- Improved stream ingestion stability and real-time telemetry rendering.",
            "- Enhanced navigation controls and memory buffer persistence.",
        ]

    # De-duplicate bullets preserving order
    seen = set()
    deduped = []
    for b in bullets:
        if b not in seen:
            seen.add(b)
            deduped.append(b)

    # Construct exact format:
    # ---
    # What's new in v<version>:
    # - ...
    return f"---\nWhat's new in v{version}:\n" + "\n".join(deduped)


def update_chromewebstore_doc(version: str, notes_block: str):
    doc_path = ROOT_DIR / 'CHROMEWEBSTORE.md'
    if not doc_path.exists():
        return
    text = doc_path.read_text(encoding='utf-8')
    text = re.sub(r'> Current Version:\s*\S+', f'> Current Version: {version}', text)
    doc_path.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description="Automate Chrome Web Store build & release")
    parser.add_argument('--bump', action='store_true', help="Bump patch version in package.json & wxt.config.ts")
    parser.add_argument('--version', type=str, default=None, help="Explicit version string")
    parser.add_argument('--notes', type=str, nargs='*', help="Custom release notes bullets")
    parser.add_argument('--skip-test', action='store_true', help="Skip running test suites")
    parser.add_argument('--skip-git', action='store_true', help="Skip git commit & tag push")
    args = parser.parse_args()

    current_ver = get_current_version()
    new_ver = current_ver

    if args.version:
        new_ver = args.version
    elif args.bump:
        new_ver = bump_version(current_ver)

    if new_ver != current_ver:
        print(f"📦 Bumping version: {current_ver} -> {new_ver}")
        update_version_in_files(new_ver)
    else:
        print(f"📦 Packaging version: {new_ver}")

    # 1. Run tests
    if not args.skip_test:
        print("🧪 Running unit and integration tests (pnpm test)...")
        run_cmd("pnpm test")
        print("✅ All tests passed!")

    # 2. Build and package
    print("🔨 Compiling and packaging extension (pnpm build && pnpm zip)...")
    run_cmd("pnpm build && pnpm zip")

    zip_name = f"ws-telemetry-analyzer-{new_ver}-chrome.zip"
    src_zip = ROOT_DIR / '.output' / zip_name
    if not src_zip.exists():
        # Fallback search in .output
        zips = list((ROOT_DIR / '.output').glob(f"*{new_ver}*.zip"))
        if zips:
            src_zip = zips[0]
        else:
            print(f"❌ Zip file not found in .output: {zip_name}", file=sys.stderr)
            sys.exit(1)

    print(f"✅ Generated package: {src_zip} ({src_zip.stat().st_size // 1024} KB)")

    # 3. Copy to Windows Desktop
    if DESKTOP_DIR.exists():
        dest_zip = DESKTOP_DIR / src_zip.name
        shutil.copy2(src_zip, dest_zip)
        print(f"🚀 Copied to Windows Desktop: {dest_zip}")

    # 4. Generate release notes
    notes = generate_release_notes(new_ver, args.notes)
    notes_file = ROOT_DIR / '.output' / 'release-notes.txt'
    notes_file.parent.mkdir(parents=True, exist_ok=True)
    notes_file.write_text(notes, encoding='utf-8')
    update_chromewebstore_doc(new_ver, notes)

    # 5. Git commit & tag
    if not args.skip_git:
        status = run_cmd("git status --porcelain", check=False)
        if status:
            print("📝 Committing changes to git...")
            run_cmd(f'git commit -am "chore(release): prepare v{new_ver} for Chrome Web Store"')
        tag_exists = run_cmd(f'git tag -l "v{new_ver}"', check=False)
        if not tag_exists:
            print(f"🏷️  Tagging v{new_ver}...")
            run_cmd(f'git tag v{new_ver}')
            run_cmd("git push && git push --tags", check=False)

    print("\n" + "=" * 60)
    print("📋 CHROME WEB STORE RELEASE NOTES (Ready to Copy & Paste):")
    print("=" * 60)
    print(notes)
    print("=" * 60 + "\n")


if __name__ == '__main__':
    main()
