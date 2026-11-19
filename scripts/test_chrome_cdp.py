#!/usr/bin/env python3
"""
Test connection to Windows Host Chrome via Chrome DevTools Protocol (CDP) port 9222.
"""

import json
import sys
import urllib.request

HOSTS = ['http://localhost:9222', 'http://127.0.0.1:9222']


def check_cdp():
    print("🔍 Probing Chrome CDP on Windows Host (Port 9222)...")
    for host in HOSTS:
        try:
            url = f"{host}/json/version"
            with urllib.request.urlopen(url, timeout=2) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                print("=" * 60)
                print("✅ Connected to Host Chrome successfully!")
                print(f"Browser: {data.get('Browser')}")
                print(f"Protocol-Version: {data.get('Protocol-Version')}")
                print(f"WebSocket Debugger: {data.get('webSocketDebuggerUrl')}")
                print("=" * 60)

                # List open pages
                pages_url = f"{host}/json/list"
                with urllib.request.urlopen(pages_url, timeout=2) as p_resp:
                    pages = json.loads(p_resp.read().decode('utf-8'))
                    print(f"\n📑 Detected {len(pages)} open tabs:")
                    for idx, page in enumerate(pages, 1):
                        title = page.get('title', 'Untitled')[:40]
                        p_url = page.get('url', '')[:60]
                        print(f"  [{idx}] {title} ({p_url})")
                return True
        except Exception:
            continue

    print("❌ Could not connect to Chrome on port 9222.")
    print("👉 Please make sure Chrome is started with: --remote-debugging-port=9222")
    return False


if __name__ == '__main__':
    success = check_cdp()
    sys.exit(0 if success else 1)
