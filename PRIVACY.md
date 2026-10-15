# Privacy Policy for WS Stream Analyzer & Telemetry Monitor

**Last Updated:** October 15, 2026

## 1. Overview
**WS Stream Analyzer & Telemetry Monitor** ("the Extension") is a developer tool designed to assist web developers in inspecting, filtering, and visualizing WebSocket & JSON-RPC data streams directly inside Chrome DevTools.

We respect your privacy. This Privacy Policy explains our practices regarding user data.

## 2. Information Collection and Use
- **No Personal Data Collected:** The Extension does **not** collect, store, transmit, or sell any personally identifiable information (PII).
- **100% Local Processing:** All message interception, parsing, JSON extraction, filtering, and telemetry graphing take place entirely on the user's local machine inside the browser instance.
- **No External Servers or Telemetry:** The Extension does not connect to any external tracking services, advertising networks, or analytics servers. No network requests are made outside of the DevTools panel and the webpage under test.

## 3. Chrome Permissions
The Extension requires the following permissions strictly for its declared developer tool functionality:
- `tabs`: Used solely to identify the active tab ID currently open in DevTools so WebSocket frames can be routed to the matching DevTools panel instance.
- `storage`: Used solely to persist local user UI preferences (such as custom column definitions, highlight rules, and favorite filter queries) on the user's local machine via `chrome.storage.local`.
- `content_scripts (<all_urls>)`: Required to inject an in-page WebSocket hook into the webpage being inspected so frames can be relayed to the DevTools panel without using the intrusive `chrome.debugger` API.

## 4. Third-Party Services
The Extension does not use any third-party APIs, remote scripts, or cloud analytics services.

## 5. Contact
If you have any questions or feedback regarding this Privacy Policy, please open an issue in the project repository.
