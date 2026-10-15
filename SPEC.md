# Engineering Specification (SPEC) - Chrome WebSocket Analyzer

## 1. Tech Stack Constraints
- **Framework**: WXT (`wxt.dev`) + React 18 + TypeScript + Vite (Manifest V3).
- **Styling**: Tailwind CSS + Lucide React (Dark theme matching Chrome DevTools `#1e1e1e` / `#252526`).
- **State Management**: Zustand (`src/store/ws-store.ts`) with a configurable Ring Buffer (max 10,000 frames).
- **Virtualization**: `@tanstack/react-virtual` for the Frame Stream Table.
- **Charting**: Lightweight Canvas/SVG line chart (or `uPlot` / custom SVG polyline) for zero-lag real-time telemetry plotting (keep latest 200 data points per tracked series).
- **Unit Testing**: Vitest for `filter-engine.ts` and `field-extractor.ts`.

## 2. Architecture & Performance Redlines
1. **Capture & IPC Batching**:
   - Background Service Worker uses `chrome.debugger` (`1.3`) listening to `Network.webSocketFrameReceived` & `Network.webSocketFrameSent`.
   - Must buffer incoming frames and flush to DevTools Panel via `chrome.runtime.Port` every `50ms` to prevent IPC bottleneck.
2. **Smart Deep Field Extractor (`src/core/field-extractor.ts`)**:
   - Support both explicit path (e.g., `params.0.gcode_move.position`) and **fuzzy deep key search** (e.g., typing `live_position` or `position` automatically extracts and caches the value from deeply nested JSON-RPC payloads like Klipper/Moonraker `notify_status_update`).
   - Memoize extracted column values per frame ID so virtual scrolling never re-parses JSON on scroll.
3. **Zero-DOM-Bloat Highlighting (`src/utils/highlighter.ts`)**:
   - Use **CSS Custom Highlight API** (`CSS.highlights`) for keyword highlighting in text/JSON views, supplemented by row-level background tinting in the virtual table.
4. **Built-in Klipper/Fluidd Mock Generator (`src/core/mock-stream.ts`)**:
   - Automatically activate when running in a standard browser tab (outside `chrome.devtools`).
   - Simulate realistic Moonraker WebSocket frames at 20Hz (`notify_status_update` with changing `gcode_move.position: [x, y, z, e]`, `live_position`, extruder temperatures, and periodic `printer.objects.subscribe` calls) so `/browser` agent can visually verify Custom Columns and Telemetry Graph directly.
