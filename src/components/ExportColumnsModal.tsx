import React, { useState, useMemo } from 'react';
import type { WSFrame, CustomColumn } from '../types/websocket';
import { useWSStore } from '../store/ws-store';
import { matchesFilter } from '../core/filter-engine';
import {
  exportSelectedColumnsCsv,
  downloadCsvFile,
  ColumnExportConfig,
} from '../core/trace-io';
import {
  X,
  FileSpreadsheet,
  Copy,
  Check,
  Download,
  Clock,
  Columns,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ExportColumnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filteredFrames?: WSFrame[];
  allFrames?: WSFrame[];
  customColumns?: CustomColumn[];
  defaultCarryForward?: boolean;
  isFilterActive?: boolean;
}

export const ExportColumnsModal: React.FC<ExportColumnsModalProps> = ({
  isOpen,
  onClose,
  filteredFrames: propFilteredFrames,
  allFrames: propAllFrames,
  customColumns: propCustomColumns,
  defaultCarryForward = true,
  isFilterActive: propIsFilterActive,
}) => {
  // Snapshot data on demand when modal opens to eliminate constant live re-renders in Toolbar
  const storeState = useWSStore.getState();
  const allFrames = propAllFrames ?? storeState.frames;
  const filterCriteria = storeState.filterCriteria;
  const isFilterActive = propIsFilterActive ?? Boolean(filterCriteria.rawQuery.trim());
  const customColumns = propCustomColumns ?? storeState.customColumns;

  const filteredFrames = useMemo(() => {
    if (propFilteredFrames) return propFilteredFrames;
    if (!isFilterActive) return allFrames;
    return allFrames.filter((f) => matchesFilter(f, filterCriteria));
  }, [propFilteredFrames, allFrames, isFilterActive, filterCriteria]);

  // Scope selection: 'filtered' | 'all'
  const [scope, setScope] = useState<'filtered' | 'all'>(isFilterActive ? 'filtered' : 'all');

  // Timestamps & Time
  const [includeTime, setIncludeTime] = useState(true);
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [includeDeltaMs, setIncludeDeltaMs] = useState(false);

  // Standard frame metadata
  const [includeSeq, setIncludeSeq] = useState(true);
  const [includeDirection, setIncludeDirection] = useState(false);
  const [includeMethod, setIncludeMethod] = useState(false);
  const [includeRpcKind, setIncludeRpcKind] = useState(false);
  const [includeRpcLatency, setIncludeRpcLatency] = useState(false);
  const [includeLength, setIncludeLength] = useState(false);
  const [includePayload, setIncludePayload] = useState(false);

  // Carry forward
  const [enableCarryForward, setEnableCarryForward] = useState(defaultCarryForward);

  // Selected custom columns (defaults to all active custom columns)
  const [selectedColIds, setSelectedColIds] = useState<Set<string>>(
    () => new Set(customColumns.map((c) => c.id))
  );

  const [copySuccess, setCopySuccess] = useState(false);

  const targetFrames = scope === 'filtered' && isFilterActive ? filteredFrames : allFrames;

  // Toggle individual custom column
  const toggleCustomCol = (id: string) => {
    setSelectedColIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Quick preset: Telemetry + Timestamp Only (Clean dataset for Python/Excel)
  const applyTelemetryOnlyPreset = () => {
    setIncludeTime(true);
    setIncludeTimestamp(true);
    setIncludeDeltaMs(false);
    setIncludeSeq(false);
    setIncludeDirection(false);
    setIncludeMethod(false);
    setIncludeRpcKind(false);
    setIncludeRpcLatency(false);
    setIncludeLength(false);
    setIncludePayload(false);
    setSelectedColIds(new Set(customColumns.map((c) => c.id)));
  };

  // Quick preset: All columns
  const applyAllColumnsPreset = () => {
    setIncludeTime(true);
    setIncludeTimestamp(true);
    setIncludeDeltaMs(true);
    setIncludeSeq(true);
    setIncludeDirection(true);
    setIncludeMethod(true);
    setIncludeRpcKind(true);
    setIncludeRpcLatency(true);
    setIncludeLength(true);
    setIncludePayload(false);
    setSelectedColIds(new Set(customColumns.map((c) => c.id)));
  };

  // Generate CSV text
  const generateCsv = (): string => {
    const config: ColumnExportConfig = {
      includeSeq,
      includeTime,
      includeTimestamp,
      includeDeltaMs,
      includeDirection,
      includeMethod,
      includeRpcKind,
      includeRpcLatency,
      includeLength,
      includePayload,
      selectedColumnIds: Array.from(selectedColIds),
      enableCarryForward,
    };
    return exportSelectedColumnsCsv(targetFrames, customColumns, config);
  };

  const handleDownload = () => {
    const csv = generateCsv();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ws-export-${scope}-${dateStr}.csv`;
    downloadCsvFile(csv, filename);
    onClose();
  };

  const handleCopy = async () => {
    const csv = generateCsv();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(csv);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
      }
    } catch {
      // Ignore
    }
  };

  // Dynamic preview of columns header
  const headerPreview = useMemo(() => {
    const headers: string[] = [];
    if (includeSeq) headers.push('Seq');
    if (includeDirection) headers.push('Direction');
    if (includeTime) headers.push('Time');
    if (includeTimestamp) headers.push('Timestamp_ms');
    if (includeDeltaMs) headers.push('Delta_ms');
    if (includeLength) headers.push('Length_bytes');
    if (includeMethod) headers.push('Method');
    if (includeRpcKind) headers.push('RPC_Kind');
    if (includeRpcLatency) headers.push('RPC_Latency_ms');
    for (const c of customColumns) {
      if (selectedColIds.has(c.id)) {
        headers.push(c.name || c.path);
      }
    }
    if (includePayload) headers.push('Payload');
    return headers;
  }, [
    includeSeq,
    includeDirection,
    includeTime,
    includeTimestamp,
    includeDeltaMs,
    includeLength,
    includeMethod,
    includeRpcKind,
    includeRpcLatency,
    includePayload,
    customColumns,
    selectedColIds,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs select-none">
      <div className="bg-[#252526] border border-[#444444] rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col text-xs overflow-hidden">
        {/* Header */}
        <div className="h-11 px-4 bg-[#2d2d2d] border-b border-[#3c3c3c] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-white">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="text-sm">Export Selected Columns as CSV / Excel</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#888888] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Quick Presets Bar */}
          <div className="flex items-center justify-between bg-[#1e1e1e] p-2.5 rounded border border-[#383838]">
            <span className="text-[#888888] flex items-center gap-1.5 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Quick Presets:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applyTelemetryOnlyPreset}
                className="px-2.5 py-1 bg-[#094771] hover:bg-[#0c598d] text-white rounded text-[11px] font-medium border border-[#38bdf8]/40 transition-colors"
                title="Only exports Timestamps + User-configured Custom Telemetry Columns"
              >
                📊 Telemetry + Timestamps
              </button>
              <button
                type="button"
                onClick={applyAllColumnsPreset}
                className="px-2.5 py-1 bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] rounded text-[11px] border border-[#444444] transition-colors"
              >
                All Columns
              </button>
            </div>
          </div>

          {/* Scope Selection */}
          <div className="bg-[#1e1e1e] p-3 rounded border border-[#333333]">
            <div className="text-[11px] font-semibold text-[#aaaaaa] mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
              Data Scope
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white">
                <input
                  type="radio"
                  name="export-scope"
                  checked={scope === 'filtered'}
                  onChange={() => setScope('filtered')}
                  className="accent-[#38bdf8]"
                  disabled={!isFilterActive}
                />
                <span>
                  Filtered View (<strong>{filteredFrames.length.toLocaleString()}</strong> frames)
                  {!isFilterActive && <span className="text-[#777777] ml-1">(No filter active)</span>}
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white">
                <input
                  type="radio"
                  name="export-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="accent-[#38bdf8]"
                />
                <span>
                  All Frames in Buffer (<strong>{allFrames.length.toLocaleString()}</strong> frames)
                </span>
              </label>
            </div>
          </div>

          {/* Timestamp & Time Section */}
          <div className="bg-[#1e1e1e] p-3 rounded border border-[#333333]">
            <div className="text-[11px] font-semibold text-emerald-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" />
              Timestamp & Timing Columns (Recommended)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeTime}
                  onChange={(e) => setIncludeTime(e.target.checked)}
                  className="accent-emerald-500 rounded"
                />
                <span>Time (Formatted HH:mm:ss.SSS)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeTimestamp}
                  onChange={(e) => setIncludeTimestamp(e.target.checked)}
                  className="accent-emerald-500 rounded"
                />
                <span className="font-semibold text-emerald-300">Timestamp (Epoch ms)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeDeltaMs}
                  onChange={(e) => setIncludeDeltaMs(e.target.checked)}
                  className="accent-emerald-500 rounded"
                />
                <span>Δt Interval (ms)</span>
              </label>
            </div>
          </div>

          {/* Custom Telemetry Columns */}
          <div className="bg-[#1e1e1e] p-3 rounded border border-[#333333]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold text-[#38bdf8] flex items-center gap-1.5 uppercase tracking-wider">
                <Columns className="w-3.5 h-3.5" />
                Custom Telemetry Columns ({customColumns.length})
              </div>
              {customColumns.length > 0 && (
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setSelectedColIds(new Set(customColumns.map((c) => c.id)))}
                    className="text-[#38bdf8] hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-[#555555]">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedColIds(new Set())}
                    className="text-[#888888] hover:underline"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {customColumns.length === 0 ? (
              <div className="p-3 text-center text-[#777777] italic bg-[#252526] rounded border border-dashed border-[#444444]">
                No custom columns added yet. Add columns using "+ Column" or by right-clicking fields in the JSON tree.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                {customColumns.map((col) => {
                  const isChecked = selectedColIds.has(col.id);
                  return (
                    <label
                      key={col.id}
                      className={`flex items-center gap-2 p-1.5 rounded cursor-pointer border transition-colors ${
                        isChecked
                          ? 'bg-[#094771]/30 border-[#38bdf8]/40 text-[#ffffff]'
                          : 'bg-[#252526] border-[#3c3c3c] text-[#888888] hover:text-[#cccccc]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCustomCol(col.id)}
                        className="accent-[#38bdf8] rounded"
                      />
                      <span className="truncate font-mono font-medium" title={col.path}>
                        {col.name || col.path}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Carry-Forward option */}
            <div className="mt-3 pt-2.5 border-t border-[#2d2d2d] flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white">
                <input
                  type="checkbox"
                  checked={enableCarryForward}
                  onChange={(e) => setEnableCarryForward(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span className="text-[11px]">
                  Fill omitted values using <strong>Carry-Forward</strong> (Inherit previous delta states)
                </span>
              </label>
            </div>
          </div>

          {/* Standard Frame Metadata */}
          <div className="bg-[#1e1e1e] p-3 rounded border border-[#333333]">
            <div className="text-[11px] font-semibold text-[#aaaaaa] mb-2 uppercase tracking-wider">
              Standard Frame Metadata
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeSeq}
                  onChange={(e) => setIncludeSeq(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>Seq (#)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeDirection}
                  onChange={(e) => setIncludeDirection(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>Direction (in/out)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeMethod}
                  onChange={(e) => setIncludeMethod(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>Method / RPC</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeRpcKind}
                  onChange={(e) => setIncludeRpcKind(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>RPC Kind</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeRpcLatency}
                  onChange={(e) => setIncludeRpcLatency(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>RPC Latency (ms)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includeLength}
                  onChange={(e) => setIncludeLength(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>Length (bytes)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#cccccc] hover:text-white p-1 rounded hover:bg-[#252526]">
                <input
                  type="checkbox"
                  checked={includePayload}
                  onChange={(e) => setIncludePayload(e.target.checked)}
                  className="accent-[#38bdf8] rounded"
                />
                <span>Raw Payload</span>
              </label>
            </div>
          </div>

          {/* Live Header Preview Bar */}
          <div className="bg-[#18181b] p-2.5 rounded border border-[#333333] font-mono text-[11px]">
            <span className="text-[#777777] block mb-1">CSV Column Headers ({headerPreview.length} columns):</span>
            <div className="text-[#38bdf8] truncate font-medium">
              {headerPreview.length > 0 ? headerPreview.join(', ') : '(No columns selected)'}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="h-12 px-4 bg-[#2d2d2d] border-t border-[#3c3c3c] flex items-center justify-between shrink-0">
          <span className="text-[#888888] text-[11px]">
            Total rows to export: <strong className="text-white">{targetFrames.length.toLocaleString()}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-[#383838] hover:bg-[#444444] text-[#cccccc] rounded transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleCopy}
              disabled={headerPreview.length === 0 || targetFrames.length === 0}
              className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] hover:text-white rounded border border-[#555555] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {copySuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-amber-400" />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={headerPreview.length === 0 || targetFrames.length === 0}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
