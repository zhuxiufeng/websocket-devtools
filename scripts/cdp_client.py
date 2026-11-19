#!/usr/bin/env python3
"""
Host Chrome CDP Automation Client (Windows Desktop 2, Port 9222)
Provides high-level commands to control the host Chrome instance from WSL.
"""

import argparse
import asyncio
import base64
import json
import sys
import urllib.request
import websockets

CDP_HTTP = 'http://localhost:9222'


def get_tabs() -> list:
    try:
        with urllib.request.urlopen(f"{CDP_HTTP}/json/list", timeout=2) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return []


def get_active_page_tab() -> dict:
    tabs = get_tabs()
    page_tabs = [t for t in tabs if t.get('type') == 'page']
    if not page_tabs:
        raise RuntimeError("No open page tabs found in host Chrome.")
    return page_tabs[0]


async def send_cdp_command(ws_url: str, method: str, params: dict = None) -> dict:
    if params is None:
        params = {}
    async with websockets.connect(ws_url) as ws:
        msg = {
            'id': 1,
            'method': method,
            'params': params,
        }
        await ws.send(json.dumps(msg))
        resp = await ws.recv()
        return json.loads(resp)


async def eval_js(ws_url: str, expr: str) -> any:
    res = await send_cdp_command(ws_url, 'Runtime.evaluate', {
        'expression': expr,
        'returnByValue': True,
        'awaitPromise': True,
    })
    return res.get('result', {}).get('result', {}).get('value')


def cmd_status():
    tabs = get_tabs()
    if not tabs:
        print("❌ Host Chrome is not connected on port 9222.")
        sys.exit(1)
    print("=" * 60)
    print("✅ Host Chrome on Windows Desktop 2 is ACTIVE and CONNECTED!")
    print("=" * 60)
    for idx, t in enumerate([x for x in tabs if x.get('type') == 'page'], 1):
        print(f"[{idx}] {t.get('title', 'Untitled')} --> {t.get('url')}")


def cmd_open(url: str):
    if not url.startswith('http://') and not url.startswith('https://') and not url.startswith('chrome://'):
        url = 'https://' + url
    req = urllib.request.Request(f"{CDP_HTTP}/json/new?{url}", method='PUT')
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        print(f"✅ Opened: {res.get('url')} (Tab ID: {res.get('id')})")


def cmd_eval(expr: str):
    tab = get_active_page_tab()
    val = asyncio.run(eval_js(tab['webSocketDebuggerUrl'], expr))
    print(val)


def cmd_text():
    tab = get_active_page_tab()
    text = asyncio.run(eval_js(tab['webSocketDebuggerUrl'], 'document.body.innerText'))
    print(text)


def cmd_click(selector: str):
    tab = get_active_page_tab()
    script = f'''
        (() => {{
            const el = document.querySelector("{selector}");
            if (!el) return false;
            el.scrollIntoView({{ behavior: "instant", block: "center" }});
            el.click();
            return true;
        }})()
    '''
    clicked = asyncio.run(eval_js(tab['webSocketDebuggerUrl'], script))
    if clicked:
        print(f"✅ Clicked selector: {selector}")
    else:
        print(f"❌ Element not found matching selector: {selector}", file=sys.stderr)
        sys.exit(1)


def cmd_fill(selector: str, text: str):
    tab = get_active_page_tab()
    script = f'''
        (() => {{
            const el = document.querySelector("{selector}");
            if (!el) return false;
            el.focus();
            el.value = {json.dumps(text)};
            el.dispatchEvent(new Event("input", {{ bubbles: true }}));
            el.dispatchEvent(new Event("change", {{ bubbles: true }}));
            return true;
        }})()
    '''
    filled = asyncio.run(eval_js(tab['webSocketDebuggerUrl'], script))
    if filled:
        print(f"✅ Filled input {selector} with text length: {len(text)}")
    else:
        print(f"❌ Element not found matching selector: {selector}", file=sys.stderr)
        sys.exit(1)


def cmd_screenshot(output_path: str):
    tab = get_active_page_tab()
    async def capture():
        res = await send_cdp_command(tab['webSocketDebuggerUrl'], 'Page.captureScreenshot', {
            'format': 'png',
        })
        b64 = res.get('result', {}).get('data', '')
        with open(output_path, 'wb') as f:
            f.write(base64.b64decode(b64))
    asyncio.run(capture())
    print(f"📸 Screenshot saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Host Chrome CDP Automation Tool")
    subparsers = parser.add_subparsers(dest='command', required=True)

    subparsers.add_parser('status', help="Check Chrome CDP connection and list tabs")
    
    open_p = subparsers.add_parser('open', help="Open URL in new tab")
    open_p.add_argument('url', help="URL to open")

    eval_p = subparsers.add_parser('eval', help="Evaluate JavaScript expression on active tab")
    eval_p.add_argument('expression', help="JavaScript code to evaluate")

    subparsers.add_parser('text', help="Dump body innerText of active tab")

    click_p = subparsers.add_parser('click', help="Click element by CSS selector")
    click_p.add_argument('selector', help="CSS selector")

    fill_p = subparsers.add_parser('fill', help="Fill input element by CSS selector")
    fill_p.add_argument('selector', help="CSS selector")
    fill_p.add_argument('text', help="Text to fill")

    shot_p = subparsers.add_parser('screenshot', help="Capture screenshot of active tab")
    shot_p.add_argument('output', help="Output PNG path")

    args = parser.parse_args()

    if args.command == 'status':
        cmd_status()
    elif args.command == 'open':
        cmd_open(args.url)
    elif args.command == 'eval':
        cmd_eval(args.expression)
    elif args.command == 'text':
        cmd_text()
    elif args.command == 'click':
        cmd_click(args.selector)
    elif args.command == 'fill':
        cmd_fill(args.selector, args.text)
    elif args.command == 'screenshot':
        cmd_screenshot(args.output)


if __name__ == '__main__':
    main()
