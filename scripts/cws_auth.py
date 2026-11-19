#!/usr/bin/env python3
"""
Chrome Web Store OAuth 2.0 Refresh Token Helper
Authorizes your Google Account to publish updates to Chrome Web Store via API.
"""

import http.server
import json
import os
import socketserver
import sys
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT_DIR / '.env'
PORT = 8989
REDIRECT_URI = f"http://localhost:{PORT}"
AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/chromewebstore"


def load_env() -> dict:
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def save_env_var(key: str, val: str):
    lines = []
    found = False
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding='utf-8').splitlines()
    new_lines = []
    for l in lines:
        if l.strip().startswith(f"{key}=") or l.strip().startswith(f"{key} ="):
            new_lines.append(f"{key}={val}")
            found = True
        else:
            new_lines.append(l)
    if not found:
        new_lines.append(f"{key}={val}")
    ENV_FILE.write_text("\n".join(new_lines) + "\n", encoding='utf-8')


def exchange_code_for_tokens(client_id: str, client_secret: str, code: str) -> dict:
    data = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'grant_type': 'authorization_code',
        'redirect_uri': REDIRECT_URI,
    }).encode('utf-8')

    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8')
        print(f"❌ Failed to exchange authorization code: {err}", file=sys.stderr)
        sys.exit(1)


def main():
    print("=" * 60)
    print("🔑 Chrome Web Store OAuth 2.0 Authorization Setup")
    print("=" * 60)

    env = load_env()
    client_id = os.environ.get('CWS_CLIENT_ID') or env.get('CWS_CLIENT_ID')
    client_secret = os.environ.get('CWS_CLIENT_SECRET') or env.get('CWS_CLIENT_SECRET')

    if not client_id:
        client_id = input("Enter Google Cloud OAuth Client ID: ").strip()
        if client_id:
            save_env_var('CWS_CLIENT_ID', client_id)

    if not client_secret:
        client_secret = input("Enter Google Cloud OAuth Client Secret: ").strip()
        if client_secret:
            save_env_var('CWS_CLIENT_SECRET', client_secret)

    if not client_id or not client_secret:
        print("❌ Error: Both CWS_CLIENT_ID and CWS_CLIENT_SECRET are required.", file=sys.stderr)
        sys.exit(1)

    auth_params = {
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': REDIRECT_URI,
        'scope': SCOPE,
        'access_type': 'offline',
        'prompt': 'consent',
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(auth_params)}"

    print("\n👉 Please open the following URL in your browser to authorize access:\n")
    print(url)
    print("\nStarting local listener on http://localhost:8989 to capture authorization code...")

    auth_code = None

    class OAuthHandler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            nonlocal auth_code
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)

            if 'code' in query:
                auth_code = query['code'][0]
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(b"""
                    <html>
                    <body style="font-family:sans-serif; text-align:center; padding-top:50px; background:#18181b; color:#ffffff;">
                        <h1 style="color:#22c55e;">&#10004; Authorization Successful!</h1>
                        <p>You may now close this window and return to your terminal.</p>
                    </body>
                    </html>
                """)
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Authorization failed or code missing.")

        def log_message(self, format, *args):
            pass

    try:
        with socketserver.TCPServer(("", PORT), OAuthHandler) as httpd:
            httpd.timeout = 120
            try:
                webbrowser.open(url)
            except Exception:
                pass
            while not auth_code:
                httpd.handle_request()
    except Exception as e:
        print(f"\n⚠️  Local server error ({e}). Falling back to manual code entry.")
        auth_code = input("Paste the authorization code here: ").strip()

    if not auth_code:
        print("❌ No authorization code received. Aborted.", file=sys.stderr)
        sys.exit(1)

    print("\n🔄 Exchanging code for refresh token...")
    tokens = exchange_code_for_tokens(client_id, client_secret, auth_code)
    refresh_token = tokens.get('refresh_token')

    if not refresh_token:
        print("⚠️  Warning: Google did not return a refresh_token.")
        print("This usually happens if access was already granted without prompt=consent.")
        print(f"Token response: {tokens}")
        sys.exit(1)

    save_env_var('CWS_REFRESH_TOKEN', refresh_token)
    print("\n" + "=" * 60)
    print("✅ SUCCESS! Refresh Token has been saved to .env:")
    print(f"CWS_REFRESH_TOKEN={refresh_token[:10]}...{refresh_token[-6:]}")
    print("=" * 60)
    print("You can now run: python3 scripts/publish_cws.py --publish")


if __name__ == '__main__':
    main()
