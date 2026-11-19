import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useCompanionStore } from '../store/companion-store';
import { useWSStore } from '../store/ws-store';
import {
  Radio,
  Cpu,
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
  Play,
  Pause,
  Trash2,
  Search,
  Download,
  X,
  FileJson,
  Check,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import type { CompanionFrame } from '../types/companion';

interface Props {
  onClose?: () => void;
}

export const HardwareObservabilityPanel: React.FC<Props> = ({ onClose }) => {
  const connectionStatus = useCompanionStore((s) => s.connectionStatus);
  const serverUrl = useCompanionStore((s) => s.serverUrl);
  const targetIp = useCompanionStore((s) => s.targetIp);
  const rttMs = useCompanionStore((s) => s.rttMs);
  const hardwareStatus = useCompanionStore((s) => s.hardwareStatus);
  const frames = useCompanionStore((s) => s.frames);
  const metrics = useCompanionStore((s) => s.metrics);
  const activeTab = useCompanionStore((s) => s.activeTab);
  const setActiveTab = useCompanionStore((s) => s.setActiveTab);
  const searchQuery = useCompanionStore((s) => s.searchQuery);
  const setSearchQuery = useCompanionStore((s) => s.setSearchQuery);
  const selectedSource = useCompanionStore((s) => s.selectedSource);
  const setSelectedSource = useCompanionStore((s) => s.setSelectedSource);
  const selectedDirection = useCompanionStore((s) => s.selectedDirection);
  const setSelectedDirection = useCompanionStore((s) => s.setSelectedDirection);
  const isAutoScroll = useCompanionStore((s) => s.isAutoScroll);
  const setIsAutoScroll = useCompanionStore((s) => s.setIsAutoScroll);
  const isRecording = useCompanionStore((s) => s.isRecording);
  const setIsRecording = useCompanionStore((s) => s.setIsRecording);
  const clearFrames = useCompanionStore((s) => s.clearFrames);
  const connect = useCompanionStore((s) => s.connect);
  const disconnect = useCompanionStore((s) => s.disconnect);
  const exportUnifiedIncident = useCompanionStore((s) => s.exportUnifiedIncident);

  const [selectedFrame, setSelectedFrame] = useState<CompanionFrame | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportTitle, setExportTitle] = useState('Hardware & Web Incident Report');
  const [exportDesc, setExportDesc] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of waterfall
  useEffect(() => {
    if (isAutoScroll && listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [frames.length, isAutoScroll]);

  // Unique sources for filter pills
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].source) set.add(frames[i].source);
    }
    return Array.from(set);
  }, [frames]);

  // Filtered frames
  const filteredFrames = useMemo(() => {
    return frames.filter((frame) => {
      if (selectedSource && frame.source !== selectedSource) return false;
      if (selectedDirection !== 'all') {
        const dir = frame.direction.toLowerCase();
        if (selectedDirection === 'tx' && dir !== 'tx' && dir !== 'out') return false;
        if (selectedDirection === 'rx' && dir !== 'rx' && dir !== 'in') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const payloadStr =
          typeof frame.payload === 'string' ? frame.payload : JSON.stringify(frame.payload);
        return (
          frame.source.toLowerCase().includes(q) ||
          (frame.hex && frame.hex.toLowerCase().includes(q)) ||
          payloadStr.toLowerCase().includes(q) ||
          (frame.type && frame.type.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [frames, selectedSource, selectedDirection, searchQuery]);

  const handleCopyHex = (hex: string, id: string) => {
    navigator.clipboard?.writeText(hex);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleTriggerExport = async () => {
    setIsExporting(true);
    try {
      const webFrames = useWSStore.getState().frames;
      await exportUnifiedIncident(webFrames, {
        title: exportTitle,
        description: exportDesc,
        severity: 'high',
        targetIp,
        timestamp: Date.now(),
      });
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1b1b1c] text-[#cccccc] select-none font-sans border-t border-[#3c3c3c]">
      {/* Top Banner & Control Bar */}
      <div className="h-9 px-3 bg-[#242426] flex items-center justify-between border-b border-[#333333] shrink-0 text-xs">
        {/* Left: Bridge Status Badge & Connection Info */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Radio className="w-3.5 h-3.5 text-[#38bdf8] animate-pulse" />
            <span>Companion Bridge</span>
          </div>

          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
              connectionStatus === 'connected'
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                : connectionStatus === 'connecting'
                ? 'bg-amber-950/60 text-amber-300 border-amber-800'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400'
                  : connectionStatus === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-zinc-500'
              }`}
            />
            <span>
              {connectionStatus === 'connected'
                ? `Connected (:8088)`
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Offline (:8088)'}
            </span>
          </div>

          {connectionStatus === 'connected' && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#888888] font-mono">
              <span>Target: <span className="text-[#38bdf8]">{targetIp}</span></span>
              {rttMs > 0 && <span>RTT: <span className="text-emerald-400">{rttMs.toFixed(1)}ms</span></span>}
              <span className="capitalize px-1.5 py-0.2 bg-[#2d2d2d] rounded text-[10px] text-[#aaaaaa]">
                {hardwareStatus}
              </span>
            </div>
          )}
        </div>

        {/* Center: Tabs */}
        <div className="flex items-center bg-[#1e1e1e] rounded p-0.5 border border-[#3c3c3c]">
          <button
            onClick={() => setActiveTab('stream')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'stream'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc]'
            }`}
          >
            Stream Waterfall ({filteredFrames.length})
          </button>
          <button
            onClick={() => setActiveTab('metrics')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'metrics'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc]'
            }`}
          >
            Live Metrics ({Object.keys(metrics).length})
          </button>
          <button
            onClick={() => setActiveTab('incident')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              activeTab === 'incident'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc]'
            }`}
          >
            Export Incident
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {connectionStatus === 'connected' ? (
            <button
              onClick={() => disconnect()}
              className="px-2 py-0.5 rounded bg-[#2d2d2d] hover:bg-[#383838] text-rose-400 text-[10px] border border-[#444444]"
              title="Disconnect companion bridge"
            >
              <WifiOff className="w-3 h-3 inline mr-1" />
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => connect()}
              className="px-2 py-0.5 rounded bg-[#094771] hover:bg-[#115d91] text-white text-[10px] border border-[#38bdf8]"
              title="Connect to companion bridge (:8088)"
            >
              <Wifi className="w-3 h-3 inline mr-1" />
              Connect
            </button>
          )}

          <button
            onClick={() => setIsRecording(!isRecording)}
            className={`p-1 rounded border transition-colors ${
              isRecording
                ? 'bg-red-950/60 text-red-400 border-red-800'
                : 'bg-[#2d2d2d] text-[#888888] border-[#444444]'
            }`}
            title={isRecording ? 'Pause stream capture' : 'Resume stream capture'}
          >
            {isRecording ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 text-emerald-400" />}
          </button>

          <button
            onClick={clearFrames}
            className="p-1 rounded bg-[#2d2d2d] hover:bg-[#383838] text-[#888888] hover:text-white border border-[#444444]"
            title="Clear sidecar stream buffer"
          >
            <Trash2 className="w-3 h-3" />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#383838] text-[#888888] hover:text-white ml-1"
              title="Close companion panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'stream' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Subheader: Filter & Direction Bar */}
          <div className="h-8 px-3 bg-[#1e1e1e] flex items-center justify-between gap-2 border-b border-[#2d2d2d] text-xs">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3 h-3 absolute left-2 top-2 text-[#666666]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search command, hex, payload, or source..."
                className="w-full bg-[#252526] border border-[#3c3c3c] focus:border-[#38bdf8] text-[#cccccc] pl-7 pr-6 py-0.5 rounded text-[11px] outline-none font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1.5 text-[#666666] hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Direction pills */}
            <div className="flex items-center gap-1">
              {(['all', 'tx', 'rx'] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => setSelectedDirection(dir)}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono font-medium border transition-colors ${
                    selectedDirection === dir
                      ? 'bg-[#094771] text-white border-[#38bdf8]'
                      : 'bg-[#252526] text-[#888888] border-[#3c3c3c] hover:text-[#cccccc]'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>

            {/* Source pills */}
            {availableSources.length > 0 && (
              <div className="hidden md:flex items-center gap-1 overflow-x-auto max-w-xs">
                <button
                  onClick={() => setSelectedSource(null)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    selectedSource === null
                      ? 'bg-[#38bdf8]/20 text-[#38bdf8] border-[#38bdf8]'
                      : 'bg-[#252526] text-[#777777] border-[#3c3c3c]'
                  }`}
                >
                  all-src
                </button>
                {availableSources.map((src) => (
                  <button
                    key={src}
                    onClick={() => setSelectedSource(selectedSource === src ? null : src)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border truncate max-w-[100px] ${
                      selectedSource === src
                        ? 'bg-[#38bdf8]/20 text-[#38bdf8] border-[#38bdf8]'
                        : 'bg-[#252526] text-[#777777] border-[#3c3c3c]'
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>
            )}

            {/* Auto scroll checkbox */}
            <label className="flex items-center gap-1 text-[10px] text-[#888888] cursor-pointer hover:text-white ml-auto">
              <input
                type="checkbox"
                checked={isAutoScroll}
                onChange={(e) => setIsAutoScroll(e.target.checked)}
                className="accent-[#38bdf8] w-3 h-3 rounded"
              />
              <span>Auto-scroll</span>
            </label>
          </div>

          {/* Stream Waterfall Table */}
          <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-[#2a2a2a]">
            {filteredFrames.length === 0 ? (
              <div className="p-8 text-center text-[#666666] flex flex-col items-center justify-center h-full">
                <Activity className="w-8 h-8 text-[#444444] mb-2 stroke-[1.5]" />
                <p>No companion frames captured yet.</p>
                <p className="text-[10px] text-[#555555] mt-1">
                  Ensure companion bridge server is running on {serverUrl}
                </p>
              </div>
            ) : (
              filteredFrames.map((frame) => {
                const isTx = frame.direction.toLowerCase() === 'tx' || frame.direction.toLowerCase() === 'out';
                const isSelected = selectedFrame?.id === frame.id;
                return (
                  <div
                    key={frame.id}
                    onClick={() => setSelectedFrame(isSelected ? null : frame)}
                    className={`flex items-center gap-3 px-3 py-1 hover:bg-[#252526] cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#094771]/30 border-l-2 border-[#38bdf8]' : ''
                    }`}
                  >
                    <span className="text-[#666666] w-20 shrink-0 text-[10px]">
                      {frame.timeFormatted}
                    </span>

                    {/* Direction badge */}
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold shrink-0 ${
                        isTx
                          ? 'bg-blue-950/80 text-blue-400 border border-blue-800'
                          : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                      }`}
                    >
                      {frame.direction}
                    </span>

                    {/* Source badge */}
                    <span className="px-1.5 py-0.2 rounded bg-[#2d2d2d] text-[#aaaaaa] text-[10px] shrink-0 border border-[#3c3c3c]">
                      {frame.source}
                    </span>

                    {/* Command / Type */}
                    {frame.type && (
                      <span className="text-[#38bdf8] font-semibold shrink-0">
                        {frame.type}
                      </span>
                    )}

                    {/* Hex preview */}
                    {frame.hex && (
                      <span className="text-[#e2b714] truncate max-w-[200px]" title={frame.hex}>
                        {frame.hex}
                      </span>
                    )}

                    {/* Payload text */}
                    <span className="text-[#cccccc] truncate flex-1" title={String(frame.payload)}>
                      {typeof frame.payload === 'string' ? frame.payload : JSON.stringify(frame.payload)}
                    </span>

                    {/* Latency */}
                    {frame.latencyUs !== undefined && (
                      <span className="text-[#888888] text-[10px] shrink-0">
                        {frame.latencyUs}µs
                      </span>
                    )}

                    {/* Copy Hex Button */}
                    {frame.hex && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyHex(frame.hex!, frame.id);
                        }}
                        className="text-[#666666] hover:text-[#38bdf8] shrink-0 px-1 py-0.5 rounded bg-[#222222]"
                        title="Copy raw hex bytes"
                      >
                        {copiedId === frame.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <span className="text-[9px]">HEX</span>
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            )}
            <div ref={listEndRef} />
          </div>

          {/* Selected Frame Detail Drawer */}
          {selectedFrame && (
            <div className="h-44 bg-[#181818] border-t border-[#3c3c3c] p-3 flex flex-col font-mono text-xs overflow-y-auto">
              <div className="flex items-center justify-between pb-1 mb-2 border-b border-[#2d2d2d]">
                <span className="font-semibold text-[#38bdf8] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Frame Inspection [{selectedFrame.id}]
                </span>
                <button
                  onClick={() => setSelectedFrame(null)}
                  className="text-[#888888] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] mb-2 text-[#888888]">
                <div>Time: <span className="text-[#cccccc]">{selectedFrame.timeFormatted}</span></div>
                <div>Source: <span className="text-[#cccccc]">{selectedFrame.source}</span></div>
                <div>Direction: <span className="text-[#cccccc]">{selectedFrame.direction}</span></div>
                <div>Status: <span className="text-emerald-400">{selectedFrame.status || 'ok'}</span></div>
              </div>
              {selectedFrame.hex && (
                <div className="mb-2">
                  <span className="text-[#777777] text-[10px] block mb-0.5">Raw Hex:</span>
                  <div className="bg-[#111111] p-1.5 rounded border border-[#2c2c2c] text-[#e2b714] break-all select-all">
                    {selectedFrame.hex}
                  </div>
                </div>
              )}
              <div>
                <span className="text-[#777777] text-[10px] block mb-0.5">Decoded Payload / Metadata:</span>
                <pre className="bg-[#111111] p-2 rounded border border-[#2c2c2c] text-[#cccccc] text-[10px] overflow-x-auto">
                  {JSON.stringify(selectedFrame.metadata || selectedFrame.payload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <div className="flex-1 p-4 overflow-y-auto">
          {Object.keys(metrics).length === 0 ? (
            <div className="text-center text-[#666666] py-12">
              <Activity className="w-8 h-8 mx-auto text-[#444444] mb-2" />
              <p>No real-time metrics received yet.</p>
              <p className="text-[11px] text-[#555555] mt-1">
                Metrics published by the companion bridge will appear here in dynamic gauge cards.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(metrics).map(([key, metric]) => (
                <div
                  key={key}
                  className="bg-[#242426] border border-[#383838] rounded-lg p-3 flex flex-col justify-between shadow"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-[#aaaaaa] truncate" title={key}>
                      {key}
                    </span>
                    <Cpu className="w-3.5 h-3.5 text-[#38bdf8]" />
                  </div>
                  <div className="text-2xl font-bold font-mono text-white my-1">
                    {typeof metric.value === 'number' ? metric.value.toFixed(1) : metric.value}
                    {metric.unit && <span className="text-xs text-[#888888] ml-1 font-normal">{metric.unit}</span>}
                  </div>
                  <div className="text-[10px] text-[#666666] truncate mt-1">
                    Updated: {new Date(metric.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incident Exporter Tab */}
      {activeTab === 'incident' && (
        <div className="flex-1 p-6 max-w-xl mx-auto flex flex-col justify-center">
          <div className="bg-[#242426] border border-[#3c3c3c] rounded-xl p-5 shadow-2xl">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#333333]">
              <FileJson className="w-5 h-5 text-[#38bdf8]" />
              <h3 className="font-semibold text-white text-sm">Unified Incident Snapshot Package</h3>
            </div>
            <p className="text-xs text-[#888888] mb-4">
              Export an integrated diagnostic package containing both DevTools WebSocket telemetry frames
              and companion sidecar/hardware stream events for end-to-end root-cause correlation.
            </p>

            <div className="space-y-3 mb-4 text-xs">
              <div>
                <label className="block text-[#aaaaaa] mb-1 font-medium">Incident Title</label>
                <input
                  type="text"
                  value={exportTitle}
                  onChange={(e) => setExportTitle(e.target.value)}
                  className="w-full bg-[#1b1b1c] border border-[#3c3c3c] focus:border-[#38bdf8] text-white px-3 py-1.5 rounded outline-none"
                />
              </div>

              <div>
                <label className="block text-[#aaaaaa] mb-1 font-medium">Description / Observations</label>
                <textarea
                  value={exportDesc}
                  onChange={(e) => setExportDesc(e.target.value)}
                  placeholder="Notes on unexpected behaviors, disconnected streams, or timing spikes..."
                  rows={3}
                  className="w-full bg-[#1b1b1c] border border-[#3c3c3c] focus:border-[#38bdf8] text-white px-3 py-1.5 rounded outline-none"
                />
              </div>

              <div className="bg-[#1b1b1c] p-2.5 rounded border border-[#333333] text-[11px] text-[#aaaaaa] space-y-1 font-mono">
                <div>DevTools Web Frames: <span className="text-white">{useWSStore.getState().frames.length}</span></div>
                <div>Sidecar Stream Frames: <span className="text-white">{frames.length}</span></div>
                <div>Companion Bridge Status: <span className="text-emerald-400">{connectionStatus}</span></div>
              </div>
            </div>

            <button
              onClick={handleTriggerExport}
              disabled={isExporting}
              className="w-full py-2 bg-[#094771] hover:bg-[#115d91] text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {exportSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Incident Package Exported!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{isExporting ? 'Generating Bundle...' : 'Export & Download Unified Bundle (.json)'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HardwareObservabilityPanel;
