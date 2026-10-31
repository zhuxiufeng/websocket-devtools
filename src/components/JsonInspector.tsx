import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useWSStore } from '../store/ws-store';
import {
  ChevronRight,
  ChevronDown,
  Columns,
  TrendingUp,
  Filter,
  EyeOff,
  Copy,
  Check,
  FileCode,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Radio,
  ArrowDown,
  ExternalLink,
  Layers,
  GitCompare,
  Search,
  X,
  ChevronUp,
} from 'lucide-react';
import { getDisambiguatedPathAndName } from '../utils/path-helper';
import { computeJsonDiff } from '../utils/json-diff';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  path: string;
  keyName: string;
  value: any;
}

export function isNumericValue(val: any): boolean {
  if (typeof val === 'number') return !isNaN(val);
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    return !isNaN(num) && isFinite(num);
  }
  return false;
}

export function highlightSearchText(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !text) return text;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;

  let matchCount = 0;
  const MAX_HIGHLIGHTS = 500;

  return (
    <>
      {parts.map((part, idx) => {
        if (idx % 2 === 1 && matchCount < MAX_HIGHLIGHTS) {
          matchCount++;
          return (
            <mark
              key={idx}
              data-inspector-match="true"
              className="bg-amber-500/35 text-amber-200 border border-amber-400/60 rounded px-0.5 font-semibold"
            >
              {part}
            </mark>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
}

export function subtreeHasMatch(
  keyName: string,
  value: any,
  currentPath: string,
  queryLower: string,
  isRoot = false
): boolean {
  if (!queryLower) return true;
  const thisPath = isRoot ? '' : currentPath ? `${currentPath}.${keyName}` : keyName;

  if (!isRoot) {
    if (keyName.toLowerCase().includes(queryLower) || thisPath.toLowerCase().includes(queryLower)) {
      return true;
    }
  }

  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (subtreeHasMatch(k, value[k], thisPath, queryLower, false)) {
        return true;
      }
    }
    return false;
  }

  const valStr = String(value).toLowerCase();
  return valStr.includes(queryLower);
}

export const JsonInspector: React.FC = () => {
  const selectedFrame = useWSStore((state) => {
    if (state.followLatestInspector) {
      return state.frames[state.frames.length - 1] || null;
    }
    return (
      state.frames.find((f) => f.id === state.selectedFrameId) ||
      state.frames[0] ||
      null
    );
  });

  const allFrames = useWSStore((state) => state.frames);
  const followLatest = useWSStore((state) => state.followLatestInspector);
  const setFollowLatest = useWSStore((state) => state.setFollowLatestInspector);
  const jumpToLatestFrame = useWSStore((state) => state.jumpToLatestFrame);
  const jumpToFrameId = useWSStore((state) => state.jumpToFrameId);
  const addCustomColumn = useWSStore((state) => state.addCustomColumn);
  const addTelemetrySeries = useWSStore((state) => state.addTelemetrySeries);
  const filterQuery = useWSStore((state) => state.filterQuery);
  const setFilterQuery = useWSStore((state) => state.setFilterQuery);
  const getSnapshotAtSeq = useWSStore((state) => state.getSnapshotAtSeq);

  const [viewMode, setViewMode] = useState<'tree' | 'diff' | 'snapshot' | 'formatted' | 'raw'>('tree');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMatchesOnly, setFilterMatchesOnly] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
    keyName: '',
    value: null,
  });

  const menuRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fallback lazy parse to ensure Tree/Diff always works even if jsonPayload wasn't pre-populated
  const effectiveJsonPayload = useMemo(() => {
    if (!selectedFrame) return null;
    if (selectedFrame.jsonPayload) return selectedFrame.jsonPayload;
    if (selectedFrame.payload && !selectedFrame.isBinary) {
      try {
        const parsed = JSON.parse(selectedFrame.payload);
        selectedFrame.jsonPayload = parsed;
        selectedFrame.isJson = true;
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }, [selectedFrame]);

  // Compute Diff vs Previous frame
  const diffEntries = useMemo(() => {
    if (!selectedFrame || viewMode !== 'diff') return [];
    const idx = allFrames.findIndex((f) => f.id === selectedFrame.id);
    const prev = idx > 0 ? allFrames[idx - 1] : null;
    const currentJson = effectiveJsonPayload;
    let prevJson = prev?.jsonPayload;
    if (!prevJson && prev?.payload && !prev?.isBinary) {
      try {
        prevJson = JSON.parse(prev.payload);
        prev.jsonPayload = prevJson;
        prev.isJson = true;
      } catch {
        prevJson = null;
      }
    }
    if (!prevJson || !currentJson) return [];
    return computeJsonDiff(prevJson, currentJson);
  }, [selectedFrame, allFrames, viewMode, effectiveJsonPayload]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const handleCopyJson = () => {
    if (!selectedFrame) return;
    navigator.clipboard.writeText(selectedFrame.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string, keyName: string, value: any) => {
    e.preventDefault();
    e.stopPropagation();

    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 230);

    setContextMenu({
      visible: true,
      x,
      y,
      path,
      keyName,
      value,
    });
  };

  // Reconstruct printer snapshot at selected frame
  const snapshotData = useMemo(() => {
    if (!selectedFrame || viewMode !== 'snapshot') return null;
    return getSnapshotAtSeq(selectedFrame.connectionId, selectedFrame.seq ?? 0);
  }, [selectedFrame, viewMode, getSnapshotAtSeq]);

  const trimmedQuery = searchQuery.trim();
  const queryLower = trimmedQuery.toLowerCase();

  const filteredDiffEntries = useMemo(() => {
    if (!queryLower || !filterMatchesOnly) return diffEntries;
    return diffEntries.filter((d) => {
      const oldStr = typeof d.oldValue === 'object' ? JSON.stringify(d.oldValue) : String(d.oldValue ?? '');
      const newStr = typeof d.newValue === 'object' ? JSON.stringify(d.newValue) : String(d.newValue ?? '');
      return (
        d.path.toLowerCase().includes(queryLower) ||
        oldStr.toLowerCase().includes(queryLower) ||
        newStr.toLowerCase().includes(queryLower)
      );
    });
  }, [diffEntries, queryLower, filterMatchesOnly]);

  // Reset activeMatchIndex when search query or viewMode changes
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [trimmedQuery, viewMode, filterMatchesOnly, selectedFrame?.id]);

  // Count rendered <mark data-inspector-match="true"> elements and highlight/scroll to active match
  useEffect(() => {
    if (!contentRef.current || !trimmedQuery) {
      setTotalMatches(0);
      return;
    }

    const marks = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>('mark[data-inspector-match="true"]')
    );
    setTotalMatches(marks.length);

    if (marks.length === 0) return;

    const safeIdx = ((activeMatchIndex % marks.length) + marks.length) % marks.length;
    marks.forEach((el, idx) => {
      if (idx === safeIdx) {
        el.className =
          'bg-orange-500 text-black border border-orange-300 rounded px-0.5 font-bold ring-1 ring-orange-300';
      } else {
        el.className =
          'bg-amber-500/35 text-amber-200 border border-amber-400/60 rounded px-0.5 font-semibold';
      }
    });

    const target = marks[safeIdx];
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center' });
    }
  }, [trimmedQuery, activeMatchIndex, viewMode, filterMatchesOnly, selectedFrame?.id, effectiveJsonPayload, snapshotData]);

  const handleNextMatch = () => {
    if (totalMatches === 0) return;
    setActiveMatchIndex((prev) => (prev + 1) % totalMatches);
  };

  const handlePrevMatch = () => {
    if (totalMatches === 0) return;
    setActiveMatchIndex((prev) => (prev - 1 + totalMatches) % totalMatches);
  };

  if (!selectedFrame) {
    return (
      <div className="flex-1 bg-[#1e1e1e] flex flex-col items-center justify-center text-xs text-[#858585] p-4 select-none">
        <FileCode className="w-8 h-8 mb-2 text-[#444444]" />
        <span>No WebSocket frame selected</span>
        <span className="text-[11px] text-[#666666] mt-1">
          Select a frame from the stream table to inspect its JSON structure.
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e] overflow-hidden select-text text-xs"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }}
    >
      {/* Header with Freeze/Follow Controls */}
      <div className="h-8 px-3 bg-[#252526] border-b border-[#3c3c3c] flex items-center justify-between select-none shrink-0 gap-2">
        {/* Frame Info */}
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-semibold text-[#cccccc]">
            Frame #{selectedFrame.seq ?? selectedFrame.id.replace('frame-', '')}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-0.5 ${
              selectedFrame.direction === 'in'
                ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800'
                : 'bg-amber-950/70 text-amber-400 border border-amber-800'
            }`}
          >
            {selectedFrame.direction === 'in' ? (
              <>
                <ArrowDownLeft className="w-2.5 h-2.5" /> RX
              </>
            ) : (
              <>
                <ArrowUpRight className="w-2.5 h-2.5" /> TX
              </>
            )}
          </span>
          <span className="text-[#888888] font-mono text-[11px]">{selectedFrame.timeFormatted}</span>
        </div>

        {/* Freeze / Follow Status & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setFollowLatest(!followLatest)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1.5 transition-colors ${
              followLatest
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60 hover:bg-emerald-900/80 shadow-sm'
                : 'bg-amber-950/80 text-amber-300 border-amber-600/60 hover:bg-amber-900/80 shadow-sm'
            }`}
            title={
              followLatest
                ? 'Currently auto-following latest incoming frame (Click to freeze on current frame)'
                : 'Locked/Frozen on this frame (Click to resume live tail)'
            }
          >
            {followLatest ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                <span className="font-semibold text-emerald-300">Live 实时跟随</span>
              </>
            ) : (
              <>
                <Lock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                <span className="font-semibold text-amber-300">
                  锁定检视 #{selectedFrame.seq ?? selectedFrame.id.replace('frame-', '')}
                </span>
              </>
            )}
          </button>

          {/* Jump to Latest Frame button */}
          <button
            onClick={jumpToLatestFrame}
            className="px-2 py-0.5 bg-[#2d2d2d] hover:bg-[#383838] text-[#aaaaaa] hover:text-[#38bdf8] rounded border border-[#444444] flex items-center gap-1 text-[10px] transition-colors"
            title="Jump inspection to latest received frame"
          >
            <ArrowDown className="w-2.5 h-2.5" />
            <span>Latest</span>
          </button>

          {/* Copy Payload */}
          <button
            onClick={handleCopyJson}
            className="px-2 py-0.5 bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] rounded border border-[#444444] flex items-center gap-1 text-[10px] transition-colors"
            title="Copy raw JSON payload"
          >
            {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* RPC Pairing Information Banner */}
      {selectedFrame.rpcKind === 'request' && (
        <div className="px-3 py-1 bg-[#102a3a] border-b border-[#1e4976] flex items-center justify-between text-[11px] text-[#93c5fd] shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-cyan-400">JSON-RPC Request:</span>
            <span className="font-mono text-white font-bold">{selectedFrame.method}</span>
            <span className="text-[#888888] font-mono">(id: {selectedFrame.rpcId})</span>
          </div>
          {selectedFrame.rpcPeerId ? (
            <button
              onClick={() => jumpToFrameId(selectedFrame.rpcPeerId!)}
              className="text-[#38bdf8] hover:text-white flex items-center gap-1 text-[10px] font-medium bg-[#0369a1]/40 px-2 py-0.5 rounded border border-[#38bdf8]/40 shrink-0 ml-2"
            >
              <span>Jump to Response</span>
              {selectedFrame.rpcLatencyMs !== undefined && (
                <span className="text-white font-mono font-bold">({selectedFrame.rpcLatencyMs.toFixed(1)}ms)</span>
              )}
              <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
            </button>
          ) : (
            <span className="text-[#777777] text-[10px] italic">Awaiting response...</span>
          )}
        </div>
      )}

      {(selectedFrame.rpcKind === 'response' || selectedFrame.rpcKind === 'error') && (
        <div className="px-3 py-1 bg-[#0f2d1e] border-b border-[#1b5e3b] flex items-center justify-between text-[11px] text-[#a7f3d0] shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-emerald-400">
              {selectedFrame.rpcKind === 'error' ? 'JSON-RPC Error:' : 'JSON-RPC Response:'}
            </span>
            <span className="font-mono text-white font-bold">{selectedFrame.method}</span>
            <span className="text-[#888888] font-mono">(id: {selectedFrame.rpcId})</span>
            {selectedFrame.rpcLatencyMs !== undefined && (
              <span className="text-emerald-300 font-mono bg-emerald-950/80 px-1.5 py-0.2 rounded text-[10px] border border-emerald-800">
                RTT: {selectedFrame.rpcLatencyMs.toFixed(1)}ms
              </span>
            )}
          </div>
          {selectedFrame.rpcPeerId && (
            <button
              onClick={() => jumpToFrameId(selectedFrame.rpcPeerId!)}
              className="text-emerald-300 hover:text-white flex items-center gap-1 text-[10px] font-medium bg-emerald-900/50 px-2 py-0.5 rounded border border-emerald-600/40 shrink-0 ml-2"
            >
              <span>Jump to Request</span>
              <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
            </button>
          )}
        </div>
      )}

      {/* Sub-header: View Mode Tabs */}
      <div className="h-7 px-3 bg-[#1e1e1e] border-b border-[#303030] flex items-center justify-between select-none shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('tree')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              viewMode === 'tree'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
          >
            🌳 Tree
          </button>

          <button
            onClick={() => setViewMode('diff')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              viewMode === 'diff'
                ? 'bg-[#7c2d12] text-amber-200 shadow-sm border border-amber-600'
                : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
            title="Inspect changes compared to previous frame"
          >
            <GitCompare className="w-3 h-3 text-amber-400" />
            <span>Diff ({diffEntries.length})</span>
          </button>

          <button
            onClick={() => setViewMode('snapshot')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              viewMode === 'snapshot'
                ? 'bg-[#065f46] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
            title="Inspect the complete merged printer status at this exact point in time"
          >
            <Layers className="w-3 h-3 text-emerald-400" />
            <span>Snapshot</span>
          </button>

          <button
            onClick={() => setViewMode('formatted')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              viewMode === 'formatted'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
          >
            ✨ JSON
          </button>

          <button
            onClick={() => setViewMode('raw')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              viewMode === 'raw'
                ? 'bg-[#094771] text-white shadow-sm'
                : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
          >
            📄 Raw
          </button>
        </div>

        <div className="text-[10px] text-[#777777] font-mono">
          {selectedFrame.length} bytes {selectedFrame.isBinary ? '(binary)' : ''}
        </div>
      </div>

      {/* Inspector Search Bar */}
      <div className="h-7 px-2.5 bg-[#222223] border-b border-[#303030] flex items-center gap-1.5 select-none shrink-0">
        <div className="relative flex-1 flex items-center">
          <Search className="w-3 h-3 text-[#777777] absolute left-2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                  handlePrevMatch();
                } else {
                  handleNextMatch();
                }
              } else if (e.key === 'Escape') {
                setSearchQuery('');
              }
            }}
            placeholder="Search key or value in payload... (Enter / Shift+Enter)"
            className="w-full h-5 pl-6 pr-6 bg-[#181818] border border-[#383838] focus:border-[#007acc] rounded text-[11px] text-[#dddddd] placeholder-[#666666] outline-none font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 text-[#777777] hover:text-[#cccccc]"
              title="Clear search (Esc)"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {trimmedQuery && (
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`text-[10px] font-mono px-1 ${
                totalMatches > 0 ? 'text-amber-300' : 'text-rose-400'
              }`}
            >
              {totalMatches > 0 ? `${(activeMatchIndex % totalMatches) + 1}/${totalMatches}` : '0/0'}
            </span>
            <button
              onClick={handlePrevMatch}
              disabled={totalMatches === 0}
              className="p-0.5 rounded bg-[#2d2d2d] hover:bg-[#383838] disabled:opacity-40 text-[#cccccc] border border-[#3c3c3c]"
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              onClick={handleNextMatch}
              disabled={totalMatches === 0}
              className="p-0.5 rounded bg-[#2d2d2d] hover:bg-[#383838] disabled:opacity-40 text-[#cccccc] border border-[#3c3c3c]"
              title="Next match (Enter)"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        )}

        {(viewMode === 'tree' || viewMode === 'snapshot' || viewMode === 'diff') && (
          <button
            onClick={() => setFilterMatchesOnly(!filterMatchesOnly)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1 transition-colors shrink-0 ${
              filterMatchesOnly
                ? 'bg-[#094771] text-white border-[#38bdf8]/60'
                : 'bg-[#2a2d2e] text-[#999999] hover:text-[#dddddd] border-[#3c3c3c]'
            }`}
            title="Filter tree/diff to only show matching branches"
          >
            <Filter className="w-2.5 h-2.5" />
            <span>Filter</span>
          </button>
        )}
      </div>

      {/* Main Content View */}
      <div
        ref={contentRef}
        className="flex-1 overflow-auto p-2.5 font-mono text-[12px] leading-5 select-text"
      >
        {viewMode === 'diff' ? (
          filteredDiffEntries.length === 0 ? (
            <div className="p-4 text-center text-[#777777] text-xs font-sans">
              {diffEntries.length === 0
                ? 'No differences detected compared to the previous frame (or no previous frame recorded).'
                : `No diff fields matching "${trimmedQuery}".`}
            </div>
          ) : (
            <div className="space-y-1.5 p-1 font-mono text-[11px]">
              <div className="text-[10px] text-[#888888] pb-1 border-b border-[#333333] mb-2 flex items-center justify-between">
                <span>Changes vs previous frame ({filteredDiffEntries.length} fields):</span>
                <span className="text-[#38bdf8]">[+] added, [~] changed, [-] removed</span>
              </div>
              {filteredDiffEntries.map((d, i) => {
                const oldStr = typeof d.oldValue === 'object' ? JSON.stringify(d.oldValue) : String(d.oldValue);
                const newStr = typeof d.newValue === 'object' ? JSON.stringify(d.newValue) : String(d.newValue);
                return (
                  <div
                    key={i}
                    className={`p-1.5 rounded border text-[11px] flex flex-col gap-0.5 ${
                      d.type === 'added'
                        ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300'
                        : d.type === 'removed'
                        ? 'bg-rose-950/30 border-rose-800 text-rose-300'
                        : 'bg-amber-950/30 border-amber-800 text-amber-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1 font-mono">
                        <span>{d.type === 'added' ? '+' : d.type === 'removed' ? '-' : '~'}</span>
                        <span className="text-white">{highlightSearchText(d.path, trimmedQuery)}</span>
                      </span>
                      <span className="text-[9px] uppercase px-1 rounded bg-black/40 text-[#aaaaaa]">
                        {d.type}
                      </span>
                    </div>

                    {d.type === 'changed' ? (
                      <div className="text-[10px] pl-3 flex items-center gap-2 font-mono">
                        <span className="text-rose-400 line-through truncate max-w-[150px]">
                          {highlightSearchText(oldStr, trimmedQuery)}
                        </span>
                        <span className="text-[#888888]">→</span>
                        <span className="text-emerald-400 font-bold truncate max-w-[200px]">
                          {highlightSearchText(newStr, trimmedQuery)}
                        </span>
                      </div>
                    ) : d.type === 'added' ? (
                      <div className="text-[10px] pl-3 text-emerald-400 font-mono truncate">
                        {highlightSearchText(newStr, trimmedQuery)}
                      </div>
                    ) : (
                      <div className="text-[10px] pl-3 text-rose-400 font-mono truncate">
                        (was: {highlightSearchText(oldStr, trimmedQuery)})
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === 'snapshot' ? (
          snapshotData && Object.keys(snapshotData).length > 0 ? (
            <div>
              <div className="mb-2 p-1.5 bg-[#064e3b]/30 border border-[#065f46] rounded text-[11px] text-emerald-300 font-sans flex items-center justify-between">
                <span>
                  🖨️ <strong>Printer State Snapshot</strong> merged up to Frame #{selectedFrame.seq ?? selectedFrame.id}
                </span>
                <span className="text-[10px] text-emerald-400/80 font-mono">
                  {Object.keys(snapshotData).length} status modules
                </span>
              </div>
              <JsonTreeNode
                keyName="printer_state"
                value={snapshotData}
                currentPath=""
                onContextMenu={handleContextMenu}
                onShowAsColumn={(path, key) => addCustomColumn(path, key)}
                onTrackOnGraph={(path, key) => addTelemetrySeries(path, key)}
                isRoot
                depth={0}
                searchQuery={trimmedQuery}
                filterMatchesOnly={filterMatchesOnly}
              />
            </div>
          ) : (
            <div className="p-4 text-center text-[#777777]">
              No status update frames recorded prior to Frame #{selectedFrame.seq ?? selectedFrame.id} for this connection.
            </div>
          )
        ) : viewMode === 'tree' ? (
          effectiveJsonPayload ? (
            <JsonTreeNode
              keyName="root"
              value={effectiveJsonPayload}
              currentPath=""
              onContextMenu={handleContextMenu}
              onShowAsColumn={(path, key) => addCustomColumn(path, key)}
              onTrackOnGraph={(path, key) => addTelemetrySeries(path, key)}
              isRoot
              depth={0}
              searchQuery={trimmedQuery}
              filterMatchesOnly={filterMatchesOnly}
            />
          ) : (
            <pre className="text-[#ce9178] whitespace-pre-wrap break-all font-mono select-text">
              {highlightSearchText(selectedFrame.payload, trimmedQuery)}
            </pre>
          )
        ) : viewMode === 'formatted' ? (
          <pre className="text-[#9cdcfe] whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed select-text p-2 bg-[#181818] rounded border border-[#2d2d2d]">
            {highlightSearchText(
              (() => {
                try {
                  const parsed = effectiveJsonPayload || JSON.parse(selectedFrame.payload);
                  return JSON.stringify(parsed, null, 2);
                } catch {
                  return selectedFrame.payload;
                }
              })(),
              trimmedQuery
            )}
          </pre>
        ) : (
          <pre className="text-[#ce9178] whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed select-text p-2 bg-[#181818] rounded border border-[#2d2d2d]">
            {highlightSearchText(selectedFrame.payload, trimmedQuery)}
          </pre>
        )}
      </div>

      {/* Context Menu Popup */}
      {contextMenu.visible && (
        <div
          ref={menuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-52 bg-[#252526] border border-[#454545] rounded-md shadow-2xl py-1 text-xs select-none backdrop-blur-md"
        >
          <div className="px-3 py-1 text-[10px] text-[#888888] border-b border-[#3c3c3c] font-mono truncate">
            {contextMenu.path || contextMenu.keyName}
          </div>

          <button
            onClick={() => {
              const { cleanPath, displayName } = getDisambiguatedPathAndName(
                contextMenu.path || contextMenu.keyName,
                contextMenu.keyName
              );
              addCustomColumn(cleanPath, displayName);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
          >
            <Columns className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span>📌 Show as Column</span>
          </button>

          {isNumericValue(contextMenu.value) && (
            <button
              onClick={() => {
                const { cleanPath, displayName } = getDisambiguatedPathAndName(
                  contextMenu.path || contextMenu.keyName,
                  contextMenu.keyName
                );
                addTelemetrySeries(cleanPath, displayName);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>📊 Track on Graph</span>
            </button>
          )}

          <div className="my-1 border-t border-[#3c3c3c]" />

          <button
            onClick={() => {
              const valStr =
                typeof contextMenu.value === 'object'
                  ? JSON.stringify(contextMenu.value)
                  : String(contextMenu.value);
              setFilterQuery(`${filterQuery ? filterQuery + ' ' : ''}json:${contextMenu.keyName}=${valStr}`);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            <span>🔍 Filter by Value</span>
          </button>

          <button
            onClick={() => {
              const valStr =
                typeof contextMenu.value === 'object'
                  ? contextMenu.keyName
                  : String(contextMenu.value);
              setFilterQuery(`${filterQuery ? filterQuery + ' ' : ''}-${valStr}`);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5 text-rose-400" />
            <span>🚫 Exclude Value</span>
          </button>

          <div className="my-1 border-t border-[#3c3c3c]" />

          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.path || contextMenu.keyName);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 text-left text-[#aaaaaa] hover:bg-[#333333] flex items-center gap-2 transition-colors text-[11px]"
          >
            <Copy className="w-3 h-3" />
            <span>Copy Path</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface JsonTreeNodeProps {
  keyName: string;
  value: any;
  currentPath: string;
  onContextMenu: (e: React.MouseEvent, path: string, keyName: string, value: any) => void;
  onShowAsColumn: (path: string, keyName: string) => void;
  onTrackOnGraph: (path: string, keyName: string) => void;
  isRoot?: boolean;
  depth: number;
  searchQuery?: string;
  filterMatchesOnly?: boolean;
  ancestorMatched?: boolean;
}

const JsonTreeNode: React.FC<JsonTreeNodeProps> = React.memo(({
  keyName,
  value,
  currentPath,
  onContextMenu,
  onShowAsColumn,
  onTrackOnGraph,
  isRoot = false,
  depth,
  searchQuery = '',
  filterMatchesOnly = false,
  ancestorMatched = false,
}) => {
  const [collapsed, setCollapsed] = useState(depth > 3);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const thisPath = isRoot ? '' : currentPath ? `${currentPath}.${keyName}` : keyName;
  const queryLower = searchQuery.toLowerCase();

  const selfKeyMatches =
    Boolean(queryLower) &&
    !isRoot &&
    (keyName.toLowerCase().includes(queryLower) || thisPath.toLowerCase().includes(queryLower));

  const hasSubtreeMatch = useMemo(() => {
    if (!queryLower) return true;
    return subtreeHasMatch(keyName, value, currentPath, queryLower, isRoot);
  }, [keyName, value, currentPath, queryLower, isRoot]);

  // Auto-expand when searching and this subtree contains a match
  useEffect(() => {
    if (queryLower && hasSubtreeMatch) {
      setCollapsed(false);
    } else if (!queryLower) {
      setCollapsed(depth > 3);
    }
  }, [queryLower, hasSubtreeMatch, depth]);

  if (queryLower && filterMatchesOnly && !ancestorMatched && !hasSubtreeMatch) {
    return null;
  }

  if (isObject) {
    const keys = Object.keys(value);
    const count = keys.length;
    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';

    const isNumberArray = isArray && value.every((v: any) => typeof v === 'number');

    return (
      <div className={isRoot ? '' : 'pl-3.5 border-l border-[#2e2e2e]/60 hover:border-[#444444]'}>
        <div
          className="flex items-center justify-between group py-0.5 hover:bg-[#252526] rounded px-1 cursor-pointer select-text"
          onClick={() => setCollapsed(!collapsed)}
          onContextMenu={(e) => onContextMenu(e, thisPath, keyName, value)}
        >
          <div className="flex items-center gap-1 truncate select-text">
            <span className="text-[#888888] hover:text-white shrink-0 select-none">
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>

            {!isRoot && (
              <span className="text-[#9cdcfe] font-semibold select-text">
                {highlightSearchText(keyName, searchQuery)}:{' '}
              </span>
            )}

            <span className="text-[#808080] select-text">
              {bracketOpen}
              {collapsed && ` ...${count} items `}
              {isNumberArray && !collapsed && (
                <span className="text-[#b5cea8] font-mono text-[11px] select-text">
                  {' '}
                  {highlightSearchText(
                    value.map((v: number) => (Number.isInteger(v) ? v : v.toFixed(2))).join(', '),
                    searchQuery
                  )}{' '}
                </span>
              )}
              {(!collapsed && count === 0) || (isNumberArray && !collapsed) ? bracketClose : ''}
            </span>
          </div>

          {/* Quick Action Hover Buttons */}
          {!isRoot && (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-2 select-none">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const { cleanPath, displayName } = getDisambiguatedPathAndName(thisPath, keyName);
                  onShowAsColumn(cleanPath, displayName);
                }}
                className="px-1.5 py-0.5 bg-[#1e293b] hover:bg-[#0284c7] text-[#38bdf8] hover:text-white rounded text-[10px] flex items-center gap-0.5 transition-colors font-medium"
                title="Show as Column in table"
              >
                <Columns className="w-2.5 h-2.5" />
                <span>Col</span>
              </button>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="space-y-0.5">
            {keys.map((k) => (
              <JsonTreeNode
                key={k}
                keyName={k}
                value={value[k]}
                currentPath={thisPath}
                onContextMenu={onContextMenu}
                onShowAsColumn={onShowAsColumn}
                onTrackOnGraph={onTrackOnGraph}
                depth={depth + 1}
                searchQuery={searchQuery}
                filterMatchesOnly={filterMatchesOnly}
                ancestorMatched={ancestorMatched || selfKeyMatches}
              />
            ))}
            <div className="text-[#808080] pl-1">{bracketClose}</div>
          </div>
        )}
      </div>
    );
  }

  // Primitive value rendering with refined syntax colors
  const isNumeric = isNumericValue(value);
  let valueColor = 'text-[#38bdf8]'; // strings in clear sky blue
  let displayValue = String(value);

  if (typeof value === 'number') {
    valueColor = 'text-[#4ade80] font-semibold'; // numbers in bright emerald
    displayValue = Number.isInteger(value) ? String(value) : value.toFixed(3);
  } else if (typeof value === 'boolean') {
    valueColor = 'text-[#fbbf24] font-medium'; // booleans in warm amber
    displayValue = value ? 'true' : 'false';
  } else if (value === null) {
    valueColor = 'text-[#888888] italic';
    displayValue = 'null';
  } else if (typeof value === 'string') {
    displayValue = `"${value}"`;
  }

  return (
    <div
      className="flex items-center justify-between group pl-4 py-0.5 hover:bg-[#252526] rounded px-1 cursor-pointer select-text"
      onContextMenu={(e) => onContextMenu(e, thisPath, keyName, value)}
    >
      <div className="flex items-center gap-1 truncate select-text">
        <span className="text-[#9cdcfe] font-semibold select-text">
          {highlightSearchText(keyName, searchQuery)}:{' '}
        </span>
        <span className={`${valueColor} font-mono select-text truncate max-w-md`} title={String(value)}>
          {highlightSearchText(displayValue, searchQuery)}
        </span>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-2 select-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            const { cleanPath, displayName } = getDisambiguatedPathAndName(thisPath, keyName);
            onShowAsColumn(cleanPath, displayName);
          }}
          className="px-1.5 py-0.5 bg-[#1e293b] hover:bg-[#0284c7] text-[#38bdf8] hover:text-white rounded text-[10px] flex items-center gap-0.5 transition-colors font-medium"
          title="Show as Column in table"
        >
          <Columns className="w-2.5 h-2.5" />
          <span>Col</span>
        </button>

        {isNumeric && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const { cleanPath, displayName } = getDisambiguatedPathAndName(thisPath, keyName);
              onTrackOnGraph(cleanPath, displayName);
            }}
            className="px-1.5 py-0.5 bg-[#451a03] hover:bg-[#d97706] text-[#fbbf24] hover:text-white rounded text-[10px] flex items-center gap-0.5 transition-colors font-medium shadow-sm"
            title="Track numeric value on Telemetry Graph"
          >
            <TrendingUp className="w-2.5 h-2.5" />
            <span>Track</span>
          </button>
        )}
      </div>
    </div>
  );
});
