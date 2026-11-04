# Chrome Web Store Listing — WS Telemetry Analyzer

> Last Updated: 2026-11-04  
> Current Version: 1.0.19

## Store Listing

**Extension Name** [REQUIRED]
WS Telemetry Analyzer - Real-Time Stream & JSON-RPC DevTools

**Short Description** [REQUIRED]
High-frequency WebSocket Telemetry, JSON-RPC & Real-time Stream Analyzer for Chrome DevTools.

**Detailed Description** [REQUIRED]
A powerful, high-performance Chrome DevTools extension for inspecting, filtering, analyzing, and graphing high-frequency WebSocket and JSON-RPC traffic.

Key Features:
- Non-Intrusive In-Page Hook: Captures incoming and outgoing WebSocket frames directly in page context with zero chrome.debugger warning bars.
- High-Throughput Stream Pipeline: Handles high-frequency streams (up to 1,000+ messages/sec) smoothly without freezing your browser.
- Real-Time Multi-Axis Telemetry Graphs: Plot any numerical JSON field (speed, temperatures, position, coordinates, latency) directly into interactive SVG line charts with auto-scaling and zoom.
- Deep JSON Tree & One-Click Extraction: Drill down into complex nested JSON objects, extract fields as dynamic table columns, or track them on the chart with one right-click.
- Powerful Filter & Search Engine: Compound search supporting direction filters (dir:in, dir:out), JSON field matching, exclusions, and regular expressions.
- JSON-RPC Correlation: Automatically matches RPC requests with their responses and measures round-trip time (RTT) latency.
- Live Tail & Frame Replay: Auto-follow incoming frames in real time, jump to first/latest frames instantly, and test sockets with direct message injection.
- Trace Import / Export: Export column data to CSV or save full session archives to JSON for offline analysis.

How to Use:
1. Open Chrome DevTools on any webpage with WebSocket traffic (press F12 or right-click > Inspect).
2. Click on the "WS Telemetry" panel in the DevTools tab bar.
3. Watch WebSocket frames appear in real time with live telemetry, or click any frame to inspect its JSON structure.
4. Use the "First" and "Latest" buttons in the top toolbar or press Home/End to quickly navigate through the stream.

Privacy & Security:
100% of frame interception, parsing, JSON extraction, and telemetry charting happen locally on your computer inside your browser instance. No data is collected, stored remotely, or transmitted to any external server.

Support & Feedback:
Open-source on GitHub: https://github.com/zhuxiufeng/websocket-devtools

**Category** [REQUIRED]
Developer Tools

**Single Purpose** [REQUIRED]
Inspect, filter, analyze, and chart real-time WebSocket and JSON-RPC telemetry streams directly in Chrome DevTools.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | public/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | screenshots/screenshot-main.png |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | screenshots/screenshot-chart.png |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Saves user configuration preferences locally on the client (such as custom table columns, highlight rules, telemetry chart series, and buffer limits) and maintains recent stream state across background service worker suspensions via chrome.storage.session. |
| `<all_urls>` | content_scripts | Injects an in-page WebSocket hook into the webpage being inspected in DevTools so WebSocket frames can be captured and visualized without using the disruptive chrome.debugger warning bar. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

The extension does not collect, store, or transmit any user data. All processing occurs locally.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | No | No | None | No |
| Health info | No | No | None | No |
| Financial info | No | No | None | No |
| Authentication info | No | No | None | No |
| Personal communications | No | No | None | No |
| Location | No | No | None | No |
| Web history | No | No | None | No |
| User activity | No | No | None | No |
| Website content | No | No | None | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/zhuxiufeng/websocket-devtools/blob/main/PRIVACY.md

---

## Version History

### 1.0.19 (Current Release)
- **Policy Compliance (v1.0.17)**: Removed unused `tabs` permission from manifest in strict compliance with Chrome Web Store least privilege policy (resolving rejection: Purple Potassium).
- **Auto-Scroll Performance & Reliability (v1.0.18)**: Fixed table auto-scroll stutter, state desync deadlock, and stale scroll request loops during high-speed frame streaming; accurately distinguished intentional upward history scrolling from incoming frame updates.
- **Page Reload Optimization (v1.0.19)**: Eliminated DevTools evaluation queue deadlock on navigation; replaced blocking eval calls with non-blocking native runtime messaging and added instant UI reload feedback.

### 1.0.16
- **Navigation Controls**: Moved "Jump to First" and "Latest" navigation buttons to the top Toolbar to completely prevent any data cell obstruction in high-density tables.
- **Late DevTools Open Sync**: Implemented in-page ring buffering (500 frames) and active WebSocket query synchronization (`QUERY_ACTIVE_STATE`) so DevTools displays live connections and data immediately without requiring page reloads.
- **Session Persistence**: Backed background buffers with `chrome.storage.session` to protect against Manifest V3 Service Worker terminations.
- **Unfocused Stream Ingestion**: Replaced requestAnimationFrame with setTimeout throttled batching in stream ingestion to prevent Chrome from pausing traffic when DevTools is unfocused.
- **Sidebar Collapsing**: Added hotkeys `[` and `]` to toggle left connections and right inspector sidebars.
- **Row Tinting**: Enabled row tinting by default for matched highlight rules.

---

## Review Notes & Rejection History

| Date | Ref ID | Reason | Fix Applied | Status |
|---|---|---|---|---|
| 2026-11-04 | Purple Potassium | Requesting but not using `tabs` permission | Removed `tabs` from manifest permissions; verified `chrome.tabs.sendMessage`, `chrome.tabs.onRemoved`, and DevTools inspectedWindow require no permissions | Rectified in v1.0.19 (Ready for submission) |

