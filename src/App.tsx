import React, { useState, useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { ConnectionsSidebar } from './components/ConnectionsSidebar';
import { FrameTable } from './components/FrameTable';
import { JsonInspector } from './components/JsonInspector';
import { TelemetryTracker } from './components/TelemetryTracker';
import { CommandConsole } from './components/CommandConsole';
import { useWSStore } from './store/ws-store';
import { useBridge } from './hooks/useBridge';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const App: React.FC = () => {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ws_inspector_width');
      return saved ? Math.max(280, Number(saved)) : 480;
    } catch {
      return 480;
    }
  });
  const [isResizingInspector, setIsResizingInspector] = useState(false);

  // Left sidebar & Right details panel collapsible state (persisted in localStorage)
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ws_show_left_sidebar');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [showRightPanel, setShowRightPanel] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ws_show_right_panel');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // Persist layout states
  useEffect(() => {
    try {
      localStorage.setItem('ws_show_left_sidebar', String(showLeftSidebar));
    } catch {}
  }, [showLeftSidebar]);

  useEffect(() => {
    try {
      localStorage.setItem('ws_show_right_panel', String(showRightPanel));
    } catch {}
  }, [showRightPanel]);

  useEffect(() => {
    try {
      localStorage.setItem('ws_inspector_width', String(inspectorWidth));
    } catch {}
  }, [inspectorWidth]);

  // Initialize data stream bridge
  useBridge();

  useEffect(() => {
    if (!isResizingInspector) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(280, Math.min(window.innerWidth - 360, window.innerWidth - e.clientX));
      setInspectorWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizingInspector(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingInspector]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable);

      // ESC to blur active inputs
      if (e.key === 'Escape') {
        if (isInput) {
          (activeEl as HTMLElement).blur();
        }
        return;
      }

      // Do not intercept hotkeys when actively typing in an input
      if (isInput) return;

      // [ : Toggle Left Sidebar
      if (e.key === '[') {
        e.preventDefault();
        setShowLeftSidebar((prev) => !prev);
      }
      // ] : Toggle Right Details Panel
      else if (e.key === ']') {
        e.preventDefault();
        setShowRightPanel((prev) => !prev);
      }
      // Down / J: next frame
      else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        useWSStore.getState().selectAdjacentFrame(1);
      }
      // Up / K: previous frame
      else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        useWSStore.getState().selectAdjacentFrame(-1);
      }
      // Space: Toggle recording (pause/resume)
      else if (e.key === ' ') {
        e.preventDefault();
        useWSStore.getState().toggleRecording();
      }
      // Slash or Ctrl+F / Cmd+F: Focus filter bar
      else if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        const filterInput = document.getElementById('ws-filter-input');
        if (filterInput) {
          filterInput.focus();
          (filterInput as HTMLInputElement).select?.();
        }
      }
      // Home: First frame
      else if (e.key === 'Home') {
        e.preventDefault();
        const frames = useWSStore.getState().frames;
        if (frames.length > 0) {
          useWSStore.getState().setSelectedFrameId(frames[0].id);
        }
      }
      // End: Last frame
      else if (e.key === 'End') {
        e.preventDefault();
        const frames = useWSStore.getState().frames;
        if (frames.length > 0) {
          useWSStore.getState().setSelectedFrameId(frames[frames.length - 1].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen w-screen bg-[#1e1e1e] text-[#cccccc] flex flex-col overflow-hidden select-none font-sans">
      {/* Top Toolbar */}
      <Toolbar
        showTelemetry={showTelemetry}
        onToggleTelemetry={() => {
          if (!showRightPanel) {
            setShowRightPanel(true);
            setShowTelemetry(true);
          } else {
            setShowTelemetry(!showTelemetry);
          }
        }}
        showLeftSidebar={showLeftSidebar}
        onToggleLeftSidebar={() => setShowLeftSidebar(!showLeftSidebar)}
        showRightPanel={showRightPanel}
        onToggleRightPanel={() => setShowRightPanel(!showRightPanel)}
      />

      {/* Main 3-Pane Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Left Pane: Connections Sidebar or Collapsed Toggle Strip */}
        {showLeftSidebar ? (
          <ConnectionsSidebar
            selectedConnectionId={selectedConnectionId}
            onSelectConnection={setSelectedConnectionId}
            onToggleCollapse={() => setShowLeftSidebar(false)}
          />
        ) : (
          <div
            onClick={() => setShowLeftSidebar(true)}
            className="w-5 bg-[#252526] hover:bg-[#2d2d2d] border-r border-[#3c3c3c] flex flex-col items-center py-2 cursor-pointer transition-colors group select-none shrink-0"
            title="Expand Connections Sidebar (Shortcut: [ )"
          >
            <ChevronRight className="w-3.5 h-3.5 text-[#777777] group-hover:text-[#38bdf8] mb-2" />
            <span
              className="text-[9px] text-[#777777] group-hover:text-[#cccccc] font-semibold uppercase tracking-wider"
              style={{ writingMode: 'vertical-rl' }}
            >
              Streams
            </span>
          </div>
        )}

        {/* Middle Pane: Virtualized Frame Stream Table + Command Console */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <FrameTable selectedConnectionId={selectedConnectionId} />
          <CommandConsole />
        </div>

        {/* Right Pane: JSON Inspector & Telemetry Tracker (Resizable) or Collapsed Strip */}
        {showRightPanel ? (
          <div
            style={{ width: `${inspectorWidth}px` }}
            className="shrink-0 flex flex-col min-h-0 border-l border-[#3c3c3c] bg-[#1e1e1e] relative"
          >
            {/* Drag Resize Handle */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingInspector(true);
              }}
              className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[#38bdf8]/60 z-40 transition-colors"
              title="Drag to resize Inspector width"
            />
            <JsonInspector onClose={() => setShowRightPanel(false)} />
            {showTelemetry && <TelemetryTracker />}
          </div>
        ) : (
          <div
            onClick={() => setShowRightPanel(true)}
            className="w-5 bg-[#252526] hover:bg-[#2d2d2d] border-l border-[#3c3c3c] flex flex-col items-center py-2 cursor-pointer transition-colors group select-none shrink-0"
            title="Expand Details & JSON Inspector (Shortcut: ] )"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-[#777777] group-hover:text-[#38bdf8] mb-2" />
            <span
              className="text-[9px] text-[#777777] group-hover:text-[#cccccc] font-semibold uppercase tracking-wider"
              style={{ writingMode: 'vertical-rl' }}
            >
              Details
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
