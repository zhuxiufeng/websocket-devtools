import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWSStore } from '../store/ws-store';
import { matchesFilter } from '../core/filter-engine';
import { IncrementalFilterEngine } from '../core/incremental-filter';
import { extractFrameField, formatExtractedValue } from '../core/field-extractor';
import { highlightText } from '../utils/highlighter';
import { formatColumnHeader } from '../utils/path-helper';
import { ArrowDownLeft, ArrowUpRight, X, ExternalLink, ArrowDown, ArrowUp, Download, Copy, Check, RotateCw } from 'lucide-react';
import type { WSFrame, HighlightRule, CustomColumn } from '../types/websocket';
import { exportSingleColumnCsv, downloadCsvFile } from '../core/trace-io';

interface FrameTableProps {
  selectedConnectionId: string | null;
}

interface FrameRowProps {
  frame: WSFrame;
  isSelected: boolean;
  virtualRow: { size: number; start: number; index: number };
  customColumns: CustomColumn[];
  matchedRule: (HighlightRule & { lowerText: string }) | null;
  enableRowTinting: boolean;
  enableCarryForward: boolean;
  highlightRules: HighlightRule[];
  onSelect: (id: string) => void;
  onJumpToPeer: (peerId: string) => void;
}

const FrameRow = React.memo<FrameRowProps>(({
  frame,
  isSelected,
  virtualRow,
  customColumns,
  matchedRule,
  enableRowTinting,
  enableCarryForward,
  highlightRules,
  onSelect,
  onJumpToPeer,
}) => {
  const highlightColor = matchedRule?.color || null;
  const shouldTintRow = enableRowTinting && !!matchedRule;

  return (
    <div
      onClick={() => onSelect(frame.id)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        backgroundColor: isSelected
          ? '#094771'
          : shouldTintRow && highlightColor
          ? `${highlightColor}22`
          : virtualRow.index % 2 === 0
          ? '#1e1e1e'
          : '#232323',
      }}
      className={`flex items-center border-b border-[#2d2d2d] hover:bg-[#2a2d2e] cursor-pointer transition-colors ${
        isSelected ? 'text-white' : 'text-[#cccccc]'
      }`}
    >
      {/* Index / Seq */}
      <div className="w-14 px-2 text-right text-[#777777] shrink-0 border-r border-[#2d2d2d]/50">
        {frame.seq ?? virtualRow.index + 1}
      </div>

      {/* Direction */}
      <div className="w-12 px-1 text-center shrink-0 border-r border-[#2d2d2d]/50">
        {frame.direction === 'in' ? (
          <span className="inline-flex items-center text-emerald-400 font-bold" title="Received (In)">
            <ArrowDownLeft className="w-3.5 h-3.5" />
          </span>
        ) : (
          <span className="inline-flex items-center text-amber-400 font-bold" title="Sent (Out)">
            <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      {/* Time */}
      <div className="w-28 px-2 text-[#999999] shrink-0 truncate border-r border-[#2d2d2d]/50 font-mono">
        {frame.timeFormatted}
      </div>

      {/* Inter-frame Interval (Δt) / Rate */}
      <div
        className="w-16 px-1.5 text-right font-mono text-[10px] shrink-0 border-r border-[#2d2d2d]/50 truncate"
        title={
          frame.deltaMs !== undefined
            ? `Δt: ${frame.deltaMs.toFixed(1)}ms (${(frame.deltaMs > 0 ? 1000 / frame.deltaMs : 0).toFixed(1)} Hz)`
            : 'First frame'
        }
      >
        {frame.deltaMs !== undefined ? (
          <span
            className={
              frame.deltaMs >= 1000
                ? 'text-amber-400 font-medium'
                : frame.deltaMs >= 100
                ? 'text-sky-400'
                : frame.deltaMs >= 20
                ? 'text-emerald-400'
                : 'text-[#888888]'
            }
          >
            {frame.deltaMs >= 1000
              ? `${(frame.deltaMs / 1000).toFixed(2)}s`
              : `${frame.deltaMs.toFixed(0)}ms`}
          </span>
        ) : (
          <span className="text-[#555555]">-</span>
        )}
      </div>

      {/* Length */}
      <div className="w-16 px-2 text-right text-[#888888] shrink-0 border-r border-[#2d2d2d]/50">
        {frame.length}
      </div>

      {/* Method / RPC pairing */}
      <div className="w-56 px-2 shrink-0 border-r border-[#2d2d2d]/50 flex items-center justify-between overflow-hidden">
        <span className="truncate font-semibold text-[10.5px] flex items-center gap-1 min-w-0">
          {frame.rpcKind === 'response' ? (
            <span className="text-emerald-400 flex items-center gap-1 truncate" title="JSON-RPC Response">
              <span className="px-1 py-0.2 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 rounded text-[8.5px] font-mono shrink-0">RESP</span>
              <span className="truncate">{frame.method}</span>
            </span>
          ) : frame.rpcKind === 'request' ? (
            <span className="text-cyan-400 flex items-center gap-1 truncate" title="JSON-RPC Request">
              <span className="px-1 py-0.2 bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 rounded text-[8.5px] font-mono shrink-0">REQ</span>
              <span className="truncate">{frame.method}</span>
            </span>
          ) : frame.rpcKind === 'error' ? (
            <span className="text-rose-400 flex items-center gap-1 truncate" title="JSON-RPC Error">
              <span className="px-1 py-0.2 bg-rose-950/80 border border-rose-500/40 text-rose-400 rounded text-[8.5px] font-mono shrink-0">ERR</span>
              <span className="truncate">{frame.method}</span>
            </span>
          ) : frame.rpcKind === 'notification' ? (
            <span className="text-purple-300 flex items-center gap-1 truncate" title="JSON-RPC Notification">
              <span className="px-1 py-0.2 bg-purple-950/80 border border-purple-500/40 text-purple-300 rounded text-[8.5px] font-mono shrink-0">NTF</span>
              <span className="truncate">{frame.method}</span>
            </span>
          ) : (
            <span className="text-[#777777] truncate">{frame.method || '-'}</span>
          )}
        </span>

        {/* Latency badge and jump link */}
        {frame.rpcLatencyMs !== undefined && (
          <span className="text-[9px] text-[#93c5fd] bg-[#1e293b] px-1 py-0.2 rounded font-mono shrink-0 ml-1">
            {frame.rpcLatencyMs.toFixed(0)}ms
          </span>
        )}
        {frame.rpcPeerId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onJumpToPeer(frame.rpcPeerId!);
            }}
            className="text-[#666666] hover:text-[#38bdf8] p-0.5 ml-0.5 shrink-0"
            title={`Jump to paired ${frame.rpcKind === 'request' ? 'Response' : 'Request'} (${frame.rpcPeerId})`}
          >
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* Dynamic Custom Columns with Carry-Forward Support */}
      {customColumns.map((col) => {
        const colWidth = col.width || 190;
        const directVal = extractFrameField(frame, col.path);
        let isCarried = false;
        let fromId: string | undefined;
        let displayVal = directVal;

        if ((displayVal === undefined || displayVal === null) && enableCarryForward && frame.carried?.[col.id]) {
          displayVal = frame.carried[col.id].value;
          isCarried = true;
          fromId = frame.carried[col.id].fromId;
        }

        const formatted = formatExtractedValue(displayVal);
        return (
          <div
            key={col.id}
            style={{ width: `${colWidth}px` }}
            className={`px-2 shrink-0 truncate font-mono border-r border-[#2d2d2d]/50 flex items-center gap-1 ${
              isCarried ? 'text-[#888888] italic' : 'text-[#38bdf8] font-medium'
            }`}
            title={isCarried ? `${formatted} (Last seen in ${fromId})` : formatted}
          >
            {isCarried && (
              <span className="text-[9px] text-[#555555] not-italic shrink-0">
                [last]
              </span>
            )}
            <span className="truncate">{highlightText(formatted, highlightRules)}</span>
          </div>
        );
      })}

      {/* Payload Preview */}
      <div
        className="flex-1 min-w-[400px] px-2 whitespace-nowrap overflow-hidden text-ellipsis text-[#888888] hover:text-[#cccccc]"
        title={frame.payload && frame.payload.length > 2000 ? frame.payload.slice(0, 2000) + '...' : frame.payload}
      >
        {highlightText(
          frame.payload && frame.payload.length > 1500
            ? frame.payload.slice(0, 1500) + ' …'
            : frame.payload || '',
          highlightRules
        )}
      </div>
    </div>
  );
});

export const FrameTable: React.FC<FrameTableProps> = ({ selectedConnectionId }) => {
  const frames = useWSStore((s) => s.frames);
  const connections = useWSStore((s) => s.connections);
  const selectedFrameId = useWSStore((s) => s.selectedFrameId);
  const setSelectedFrameId = useWSStore((s) => s.setSelectedFrameId);
  const jumpToFrameId = useWSStore((s) => s.jumpToFrameId);
  const filterCriteria = useWSStore((s) => s.filterCriteria);
  const customColumns = useWSStore((s) => s.customColumns);
  const updateCustomColumnWidth = useWSStore((s) => s.updateCustomColumnWidth);
  const removeCustomColumn = useWSStore((s) => s.removeCustomColumn);
  const highlightRules = useWSStore((s) => s.highlightRules);
  const enableRowTinting = useWSStore((s) => s.enableRowTinting);
  const enableCarryForward = useWSStore((s) => s.enableCarryForward);
  const isAutoScrollPaused = useWSStore((s) => s.isAutoScrollPaused);
  const followLatestInspector = useWSStore((s) => s.followLatestInspector);
  const unseenNewFramesCount = useWSStore((s) => s.unseenNewFramesCount);
  const lastScrollRequest = useWSStore((s) => s.lastScrollRequest);
  const setIsAutoScrollPaused = useWSStore((s) => s.setIsAutoScrollPaused);
  const resetUnseenCount = useWSStore((s) => s.resetUnseenCount);

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // Column resizing state
  const [resizingCol, setResizingCol] = useState<{ id: string; startX: number; startWidth: number } | null>(null);
  const [copiedColId, setCopiedColId] = useState<string | null>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  // Incremental filter engine instance
  const filterEngineRef = useRef<IncrementalFilterEngine | null>(null);
  if (!filterEngineRef.current) {
    filterEngineRef.current = new IncrementalFilterEngine();
  }

  // Filtered frames computation:
  // - O(1) instant return when no query/connection is active
  // - O(k) incremental append when frames stream into large buffers (up to 1M)
  // - O(N) full re-filter only on query, regex, or connection selection change
  const filteredFrames = useMemo(() => {
    return filterEngineRef.current!.filter(frames, selectedConnectionId, filterCriteria);
  }, [frames, selectedConnectionId, filterCriteria]);

  const handleExportSingleColumn = useCallback(
    (col: CustomColumn) => {
      const targetFrames = filteredFrames.length > 0 ? filteredFrames : frames;
      const csv = exportSingleColumnCsv(targetFrames, col, enableCarryForward);
      const cleanName = (col.name || col.path).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
      downloadCsvFile(csv, `ws-col-${cleanName}-${Date.now()}.csv`);
    },
    [filteredFrames, frames, enableCarryForward]
  );

  const handleCopySingleColumn = useCallback(
    async (col: CustomColumn) => {
      const targetFrames = filteredFrames.length > 0 ? filteredFrames : frames;
      const csv = exportSingleColumnCsv(targetFrames, col, enableCarryForward);
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(csv);
          setCopiedColId(col.id);
          setTimeout(() => setCopiedColId(null), 1500);
        }
      } catch {}
    },
    [filteredFrames, frames, enableCarryForward]
  );

  // Fast active highlight rules pre-matching
  const activeHighlightRules = useMemo(() => {
    return highlightRules
      .filter((r) => r.active && r.text.trim().length > 0)
      .map((r) => ({ ...r, lowerText: r.text.toLowerCase() }));
  }, [highlightRules]);

  // WeakMap cache for matched rules per frame object, avoiding repeated toLowerCase() during rapid scrolling
  const highlightRuleCacheRef = useRef<WeakMap<WSFrame, (HighlightRule & { lowerText: string }) | null>>(new WeakMap());

  useEffect(() => {
    highlightRuleCacheRef.current = new WeakMap();
  }, [activeHighlightRules]);

  const getMatchedHighlightRule = useCallback(
    (frame: WSFrame): (HighlightRule & { lowerText: string }) | null => {
      if (activeHighlightRules.length === 0) return null;
      const cached = highlightRuleCacheRef.current.get(frame);
      if (cached !== undefined) return cached;

      const text = (frame.payload || '').toLowerCase();
      let matched: (HighlightRule & { lowerText: string }) | null = null;
      for (const rule of activeHighlightRules) {
        if (text.includes(rule.lowerText)) {
          matched = rule;
          break;
        }
      }
      highlightRuleCacheRef.current.set(frame, matched);
      return matched;
    },
    [activeHighlightRules]
  );

  const handleSelect = useCallback((id: string) => setSelectedFrameId(id), [setSelectedFrameId]);
  const handleJumpToPeer = useCallback((id: string) => jumpToFrameId(id), [jumpToFrameId]);

  const rowVirtualizer = useVirtualizer({
    count: filteredFrames.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 26,
    overscan: 12, // Reduced from 25 to 12 for 60% fewer invisible DOM nodes
  });

  const latestFrameId = filteredFrames[filteredFrames.length - 1]?.id;

  // Auto-scroll on new frames when not paused (depends on latestFrameId so it continues to auto-scroll even after reaching MAX_FRAMES cap)
  useEffect(() => {
    if (!isAutoScrollPaused && shouldAutoScrollRef.current && containerRef.current && filteredFrames.length > 0) {
      rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
    }
  }, [latestFrameId, rowVirtualizer, isAutoScrollPaused]);

  // Keep selected frame visible in virtualizer ONLY when user actively changes selection
  const prevSelectedFrameIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFrameId) {
      prevSelectedFrameIdRef.current = null;
      return;
    }
    // Only scroll if the selected frame ID itself has changed (e.g. keyboard navigation / click)
    if (prevSelectedFrameIdRef.current === selectedFrameId) return;
    prevSelectedFrameIdRef.current = selectedFrameId;

    // If auto-scroll is paused (user scrolled up to inspect history), do not jump when Live Tail advances
    if (isAutoScrollPaused && followLatestInspector) return;

    const idx = filteredFrames.findIndex((f) => f.id === selectedFrameId);
    if (idx !== -1) {
      rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
    }
  }, [selectedFrameId, filteredFrames, rowVirtualizer, isAutoScrollPaused, followLatestInspector]);

  // Handle column resize drag
  useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizingCol.startX;
      updateCustomColumnWidth(resizingCol.id, resizingCol.startWidth + diff);
    };

    const handleMouseUp = () => {
      setResizingCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, updateCustomColumnWidth]);

  // Scroll to target from store action (jumpToFirstFrame / jumpToLatestFrame)
  useEffect(() => {
    if (!lastScrollRequest) return;
    if (lastScrollRequest.target === 'first') {
      if (filteredFrames.length > 0) {
        rowVirtualizer.scrollToIndex(0, { align: 'start' });
        if (containerRef.current) {
          containerRef.current.scrollTop = 0;
        }
      }
    } else if (lastScrollRequest.target === 'latest') {
      if (filteredFrames.length > 0) {
        rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
      }
    }
  }, [lastScrollRequest, filteredFrames, rowVirtualizer]);

  // Synchronize horizontal scrolling between header and virtual rows & detect user scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (headerRef.current) {
      headerRef.current.scrollLeft = el.scrollLeft;
    }
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    shouldAutoScrollRef.current = isAtBottom;
    setShowScrollToTop(el.scrollTop > 250);

    if (!isAtBottom) {
      if (!isAutoScrollPaused) {
        setIsAutoScrollPaused(true);
      }
    } else {
      if (isAutoScrollPaused) {
        setIsAutoScrollPaused(false);
        resetUnseenCount();
      }
    }
  };

  const scrollToTop = useCallback(() => {
    setIsAutoScrollPaused(true);
    shouldAutoScrollRef.current = false;
    if (filteredFrames.length > 0) {
      setSelectedFrameId(filteredFrames[0].id);
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    setShowScrollToTop(false);
  }, [filteredFrames, rowVirtualizer, setIsAutoScrollPaused, setSelectedFrameId]);

  const scrollToBottom = () => {
    setIsAutoScrollPaused(false);
    resetUnseenCount();
    shouldAutoScrollRef.current = true;
    if (filteredFrames.length > 0) {
      rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
    }
  };

  const totalMinWidth = useMemo(() => {
    const baseColsWidth = 56 + 48 + 112 + 64 + 64 + 224; // w-14 (56) + w-12 (48) + w-28 (112) + w-16(Δt 64) + w-16(Len 64) + w-56(Method 224) = 568px
    const customColsWidth = customColumns.reduce((sum, col) => sum + (col.width || 190), 0);
    let maxPayloadLen = 0;
    for (let i = 0; i < filteredFrames.length; i++) {
      const len = filteredFrames[i].length || 0;
      if (len > maxPayloadLen) {
        maxPayloadLen = len;
        if (maxPayloadLen >= 1500) {
          maxPayloadLen = 1500;
          break;
        }
      }
    }
    const payloadWidth = Math.max(400, Math.ceil(maxPayloadLen * 6.8) + 32);
    return baseColsWidth + customColsWidth + payloadWidth;
  }, [customColumns, filteredFrames]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] border-r border-[#3c3c3c] overflow-hidden select-none relative">
      {/* Floating Jump to First Notification Pill */}
      {showScrollToTop && filteredFrames.length > 0 && (
        <button
          onClick={scrollToTop}
          className="absolute top-9 left-1/2 -translate-x-1/2 z-30 bg-[#252526]/95 hover:bg-[#2d2d2d] text-[#cccccc] hover:text-[#38bdf8] px-3 py-1 rounded-full text-[11px] font-medium shadow-2xl flex items-center gap-1.5 transition-all cursor-pointer border border-[#444444] backdrop-blur-sm"
          title="Jump to first frame (Shortcut: Home)"
        >
          <ArrowUp className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Jump to First (#1)</span>
        </button>
      )}

      {/* Floating Unseen Frames Notification Pill */}
      {unseenNewFramesCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[#0284c7] hover:bg-[#0369a1] text-white px-3.5 py-1 rounded-full text-[11px] font-semibold shadow-2xl flex items-center gap-1.5 transition-all cursor-pointer border border-[#38bdf8]/50"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>{unseenNewFramesCount} new frames</span>
          <span className="text-[10px] text-sky-200 underline ml-1">Follow latest</span>
        </button>
      )}

      {/* Synchronized Header */}
      <div
        ref={headerRef}
        className="h-7 bg-[#252526] border-b border-[#3c3c3c] overflow-hidden select-none shrink-0"
      >
        <div
          style={{ minWidth: `${totalMinWidth}px` }}
          className="flex items-center h-full text-[11px] font-semibold text-[#aaaaaa] w-full"
        >
          <div
            onClick={scrollToTop}
            className="w-14 px-2 text-right border-r border-[#3c3c3c]/60 shrink-0 cursor-pointer hover:text-[#38bdf8] hover:bg-[#2a2d32] transition-colors flex items-center justify-end gap-1 group/hash"
            title="Click to jump to First frame (Shortcut: Home)"
          >
            <ArrowUp className="w-2.5 h-2.5 opacity-0 group-hover/hash:opacity-100 transition-opacity text-[#38bdf8]" />
            <span>#</span>
          </div>
          <div className="w-12 px-1 text-center border-r border-[#3c3c3c]/60 shrink-0">Dir</div>
          <div className="w-28 px-2 border-r border-[#3c3c3c]/60 shrink-0">Time</div>
          <div className="w-16 px-1.5 text-right border-r border-[#3c3c3c]/60 shrink-0" title="Inter-frame interval (Δt) / Frequency">Δt</div>
          <div className="w-16 px-2 text-right border-r border-[#3c3c3c]/60 shrink-0">Len</div>
          <div className="w-56 px-2 border-r border-[#3c3c3c]/60 shrink-0">Method / RPC</div>

          {/* Dynamic Custom Columns */}
          {customColumns.map((col) => {
            const colWidth = col.width || 190;
            return (
              <div
                key={col.id}
                style={{ width: `${colWidth}px` }}
                className="px-2 border-r border-[#3c3c3c]/60 shrink-0 flex items-center justify-between text-[#38bdf8] bg-[#1e293b]/40 font-mono relative group"
              >
                <span className="truncate" title={col.path}>
                  {formatColumnHeader(col.name, col.path)}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportSingleColumn(col);
                    }}
                    className="text-[#888888] hover:text-[#38bdf8] p-0.5 rounded transition-colors"
                    title={`Export column "${col.name || col.path}" as CSV`}
                  >
                    <Download className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopySingleColumn(col);
                    }}
                    className="text-[#888888] hover:text-[#38bdf8] p-0.5 rounded transition-colors"
                    title={`Copy column "${col.name || col.path}" values to clipboard`}
                  >
                    {copiedColId === col.id ? (
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-2.5 h-2.5" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustomColumn(col.id);
                    }}
                    className="text-[#888888] hover:text-red-400 p-0.5 rounded transition-colors"
                    title="Remove column"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {/* Drag resize handle */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizingCol({ id: col.id, startX: e.clientX, startWidth: colWidth });
                  }}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[#38bdf8]/60 transition-colors"
                />
              </div>
            );
          })}

          {/* Payload Preview Header */}
          <div className="flex-1 min-w-[400px] px-2 truncate">Payload Preview</div>
        </div>
      </div>

      {/* Virtualized Table Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto font-mono text-[11px] relative"
      >
        {filteredFrames.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-[#888888] gap-2.5 p-4 select-none">
            {frames.length === 0 ? (
              <>
                <p className="text-[#888888]">
                  {Object.keys(connections).length > 0
                    ? `WebSocket connected (${Object.keys(connections).length} stream). Waiting for incoming frames...`
                    : 'Waiting for WebSocket traffic...'}
                </p>
                {typeof chrome !== 'undefined' && Boolean(chrome.devtools?.inspectedWindow) && (
                  <button
                    onClick={() => {
                      try {
                        chrome.devtools.inspectedWindow.reload({ ignoreCache: false });
                      } catch {}
                    }}
                    className="px-3 py-1 bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] hover:text-[#38bdf8] rounded border border-[#3c3c3c] text-[11px] transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                    title="Reload inspected webpage to capture initial connection frames"
                  >
                    <RotateCw className="w-3 h-3" />
                    <span>Reload Inspected Page</span>
                  </button>
                )}
              </>
            ) : (
              'No frames match current filter.'
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              minWidth: `${totalMinWidth}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const frame = filteredFrames[virtualRow.index];
              if (!frame) return null;
              return (
                <FrameRow
                  key={frame.id}
                  frame={frame}
                  isSelected={frame.id === selectedFrameId}
                  virtualRow={virtualRow}
                  customColumns={customColumns}
                  matchedRule={getMatchedHighlightRule(frame)}
                  enableRowTinting={enableRowTinting}
                  enableCarryForward={enableCarryForward}
                  highlightRules={highlightRules}
                  onSelect={handleSelect}
                  onJumpToPeer={handleJumpToPeer}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
