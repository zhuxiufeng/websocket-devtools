# WebSocket DevTools (WS Telemetry Analyzer)

A powerful, high-performance Chrome DevTools extension for inspecting, filtering, analyzing, and graphing high-frequency WebSocket and JSON-RPC traffic.

[![Chrome MV3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Built with AI](https://img.shields.io/badge/Built%20with-AI%20Pair%20Programming-8a2be2.svg)](https://github.com/zhuxiufeng/websocket-devtools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🤖 **Developed with AI**: This project was architected, engineered, and optimized through human-AI pair programming with Google DeepMind Advanced Agentic AI (Antigravity). From zero-permission in-page hook architecture and 60fps high-throughput stream batching to pixel-level decimated SVG telemetry curves, every component was iteratively designed, benchmarked, and audited with comprehensive automated test suites.

---

## ✨ Features

- **🚀 Non-Intrusive In-Page Hook**: Captures incoming & outgoing WebSocket frames directly in page context (`MAIN` world) with **zero** `chrome.debugger` API warning bars.
- **⚡ High-Throughput Batch Pipeline**: Handles high-frequency streams (up to 1,000+ msgs/sec) via lazy port connection, requestAnimationFrame coalescing, and virtualized list rendering.
- **📊 Real-time Multi-Axis Telemetry Graphs**: Plot any numerical JSON field (speed, temperatures, position, coordinates, latency) directly into interactive SVG line charts with Auto-Fit normalization, Box-Zoom, and SVG/CSV export.
- **🌳 Deep JSON Tree & One-Click Extraction**: Drill down into complex deeply nested JSON objects, extract fields as dynamic table columns, or track them on the chart with one right-click.
- **🔍 Advanced Search & Filter Engine**:
  - Direction filters: `dir:in`, `dir:out`
  - Field matching: `json:method=status`, `has:position`
  - Inverted / Exclusion search: `-heartbeat`, `!/regex/i`
  - Fulltext and Regular Expression search
- **🔄 JSON-RPC Request/Response Correlation**: Automatically matches RPC requests with their responses, measures RTT latency (Round-Trip Time), and allows one-click jumping between paired pairs.
- **🔁 Live Tail & Frame Replay**: Auto-follow the latest incoming frame in real time, or inject/replay customized messages directly into active sockets.
- **💾 Trace Import / Export**: Save live traffic traces to JSON files and reload them anytime for offline debugging and analysis.

---

## 🛠️ Tech Stack

- **Framework**: [WXT](https://wxt.dev/) (Next-gen Web Extension Framework) + [Vite](https://vitejs.dev/)
- **UI & State**: [React 19](https://react.dev/), [Zustand](https://github.com/pmndrs/zustand)
- **Virtualization**: [@tanstack/react-virtual](https://tanstack.com/virtual/latest)
- **Styling & Icons**: [Tailwind CSS](https://tailwindcss.com/), [Lucide React](https://lucide.dev/)
- **Testing**: [Vitest](https://vitest.dev/) (33/33 comprehensive unit & integration tests)

---

## 📦 Getting Started

### Prerequisites

- Node.js >= 18
- [pnpm](https://pnpm.io/) >= 8

### Installation

```bash
# Clone the repository
git clone https://github.com/zhuxiufeng/websocket-devtools.git
cd websocket-devtools

# Install dependencies
pnpm install
```

### Development

```bash
# Start development mode with hot reload
pnpm dev
```

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `.output/chrome-mv3` directory.
4. Open Chrome DevTools on any webpage with WebSocket traffic to access the **WS Telemetry** tab.

### Production Build & Packaging

```bash
# Run type checks & unit tests
pnpm typecheck
pnpm test

# Build production bundle & zip for Chrome Web Store
pnpm build
pnpm zip
```

The ready-to-upload extension zip file will be generated at:
```text
.output/ws-telemetry-analyzer-1.0.0-chrome.zip
```

---

## 🔒 Privacy & Permissions

- **100% Offline Local Processing**: All frame interception, parsing, JSON extraction, and telemetry charting happen locally inside your browser. No data is collected, stored remotely, or transmitted to any external server.
- **Minimal Permissions**:
  - `tabs`: Route traffic exclusively to the matching active DevTools tab.
  - `storage`: Persist your UI preferences, column widths, and favorite filters locally.

Read the full [Privacy Policy](PRIVACY.md).

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
