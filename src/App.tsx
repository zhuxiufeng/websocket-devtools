import React, { useState, useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { ConnectionsSidebar } from './components/ConnectionsSidebar';
import { FrameTable } from './components/FrameTable';
import { JsonInspector } from './components/JsonInspector';
import { TelemetryTracker } from './components/TelemetryTracker';
import { CommandConsole } from './components/CommandConsole';
import { useWSStore } from './store/ws-store';
import { useBridge } from './hooks/useBridge';

export const App: React.FC = () => {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(true);

  // Initialize data stream bridge
  useBridge();

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

      // Down / J: next frame
      if (e.key === 'ArrowDown' || e.key === 'j') {
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
        onToggleTelemetry={() => setShowTelemetry(!showTelemetry)}
      />

      {/* Main 3-Pane Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: Connections */}
        <ConnectionsSidebar
          selectedConnectionId={selectedConnectionId}
          onSelectConnection={setSelectedConnectionId}
        />

        {/* Middle Pane: Virtualized Frame Stream Table + Command Console */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <FrameTable selectedConnectionId={selectedConnectionId} />
          <CommandConsole />
        </div>

        {/* Right Pane: JSON Inspector & Telemetry Tracker */}
        <div className="w-[420px] xl:w-[480px] shrink-0 flex flex-col min-h-0 border-l border-[#3c3c3c] bg-[#1e1e1e]">
          <JsonInspector />
          {showTelemetry && <TelemetryTracker />}
        </div>
      </div>
    </div>
  );
};

export default App;
