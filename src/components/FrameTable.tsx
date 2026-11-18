import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWSStore } from '../store/ws-store';
import { matchesFilter } from '../core/filter-engine';
import { IncrementalFilterEngine } from '../core/incremental-filter';
import { extractFrameField, extractCustomColumnValue, formatExtractedValue } from '../core/field-extractor';
import { highlightText } from '../utils/highlighter';
import { formatColumnHeader } from '../utils/path-helper';
import { appendFilterToken, toggleFilterToken, hasFilterToken } from '../utils/filter-helper';
import { ArrowDownLeft, ArrowUpRight, X, ExternalLink, ArrowDown, ArrowUp, Download, Copy, Check, RotateCw, Filter, EyeOff, Calculator } from 'lucide-react';
import type { WSFrame, HighlightRule, CustomColumn } from '../types/websocket';
import { exportSingleColumnCsv, downloadCsvFile } from '../core/trace-io';

interface FrameTableProps {
  selectedConnectionId: string | null;
}

interface FrameRowProps {
  frame: WSFrame;
  isSelected: boolean;
  isTelemetryHovered?: boolean;
  virtualRow: { size: number; start: number; index: number };
  customColumns: CustomColumn[];
  matchedRule: (HighlightRule & { lowerText: string }) | null;
  enableRowTinting: boolean;
  enableCarryForward: boolean;
  highlightRules: HighlightRule[];
  onSelect: (id: string) => void;
  onJumpToPeer: (peerId: string) => void;
  onContextMenu?: (e: React.MouseEvent, frame: WSFrame, col?: CustomColumn, directVal?: any) => void;
  onFilterToken?: (token: string) => void;
}

const FrameRow = React.memo<FrameRowProps>(({
  frame,
  isSelected,
  isTelemetryHovered = false,
  virtualRow,
  customColumns,
  matchedRule,
  enableRowTinting,
  enableCarryForward,
  highlightRules,
  onSelect,
  onJumpToPeer,
  onContextMenu,
  onFilterToken,
}) => {
  const highlightColor = matchedRule?.color || null;
  const shouldTintRow = enableRowTinting && !!matchedRule;

  return (
    <div
      onClick={() => onSelect(frame.id)}
      onContextMenu={(e) => {
        onContextMenu?.(e, frame);
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        backgroundColor: isSelected
          ? '#094771'
          : isTelemetryHovered
          ? '#0c4a6e'
          : shouldTintRow && highlightColor
          ? `${highlightColor}22`
          : virtualRow.index % 2 === 0
          ? '#1e1e1e'
          : '#232323',
      }}
      className={`flex items-center border-b border-[#2d2d2d] hover:bg-[#2a2d2e] cursor-pointer transition-colors ${
        isSelected
          ? 'text-white'
          : isTelemetryHovered
          ? 'text-white ring-1 ring-[#38bdf8] z-10'
          : 'text-[#cccccc]'
      }`}
    >
      {/* Index / Seq */}
      <div className="w-16 px-1.5 text-right text-[#777777] shrink-0 border-r border-[#2d2d2d]/50 font-mono">
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

      {/* Time - w-32 (128px) ensures HH:mm:ss.SSS never clips or truncates */}
      <div
        className="w-32 px-1.5 text-[#999999] shrink-0 truncate border-r border-[#2d2d2d]/50 font-mono text-[11px]"
        title={frame.timeFormatted}
      >
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
            <span className="text-emerald-400 flex items-center gap-1 truncate" title="JSON-RPC Response. Click method to filter">
              <span className="px-1 py-0.2 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 rounded text-[8.5px] font-mono shrink-0">RESP</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (frame.method) onFilterToken?.(frame.method);
                }}
                className="truncate cursor-pointer hover:underline"
              >
                {frame.method}
              </span>
            </span>
          ) : frame.rpcKind === 'request' ? (
            <span className="text-cyan-400 flex items-center gap-1 truncate" title="JSON-RPC Request. Click method to filter">
              <span className="px-1 py-0.2 bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 rounded text-[8.5px] font-mono shrink-0">REQ</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (frame.method) onFilterToken?.(frame.method);
                }}
                className="truncate cursor-pointer hover:underline"
              >
                {frame.method}
              </span>
            </span>
          ) : frame.rpcKind === 'error' ? (
            <span className="text-rose-400 flex items-center gap-1 truncate" title="JSON-RPC Error. Click method to filter">
              <span className="px-1 py-0.2 bg-rose-950/80 border border-rose-500/40 text-rose-400 rounded text-[8.5px] font-mono shrink-0">ERR</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (frame.method) onFilterToken?.(frame.method);
                }}
                className="truncate cursor-pointer hover:underline"
              >
                {frame.method}
              </span>
            </span>
          ) : frame.rpcKind === 'notification' ? (
            <span className="text-purple-300 flex items-center gap-1 truncate" title="JSON-RPC Notification. Click method to filter">
              <span className="px-1 py-0.2 bg-purple-950/80 border border-purple-500/40 text-purple-300 rounded text-[8.5px] font-mono shrink-0">NTF</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (frame.method) onFilterToken?.(frame.method);
                }}
                className="truncate cursor-pointer hover:underline"
              >
                {frame.method}
              </span>
            </span>
          ) : (
            <span
              onClick={(e) => {
                if (frame.method) {
                  e.stopPropagation();
                  onFilterToken?.(frame.method);
                }
              }}
              className={`truncate ${frame.method ? 'cursor-pointer hover:underline' : ''}`}
              title={frame.method ? `Click method "${frame.method}" to filter` : undefined}
            >
              {frame.method || '-'}
            </span>
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
        const directVal = extractCustomColumnValue(frame, col);
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
            onContextMenu={(e) => {
              e.stopPropagation();
              onContextMenu?.(e, frame, col, directVal);
            }}
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
  const filterQuery = useWSStore((s) => s.filterQuery);
  const setFilterQuery = useWSStore((s) => s.setFilterQuery);
  const customColumns = useWSStore((s) => s.customColumns);
  const updateCustomColumnWidth = useWSStore((s) => s.updateCustomColumnWidth);
  const updateCustomColumnFormula = useWSStore((s) => s.updateCustomColumnFormula);
  const removeCustomColumn = useWSStore((s) => s.removeCustomColumn);
  const [editingFormulaColId, setEditingFormulaColId] = useState<string | null>(null);
  const [formulaInput, setFormulaInput] = useState('');
  const highlightRules = useWSStore((s) => s.highlightRules);
  const enableRowTinting = useWSStore((s) => s.enableRowTinting);
  const enableCarryForward = useWSStore((s) => s.enableCarryForward);
  const isAutoScrollPaused = useWSStore((s) => s.isAutoScrollPaused);
  const followLatestInspector = useWSStore((s) => s.followLatestInspector);
  const unseenNewFramesCount = useWSStore((s) => s.unseenNewFramesCount);
  const lastScrollRequest = useWSStore((s) => s.lastScrollRequest);
  const setIsAutoScrollPaused = useWSStore((s) => s.setIsAutoScrollPaused);
  const resetUnseenCount = useWSStore((s) => s.resetUnseenCount);
  const hoveredTelemetryFrameId = useWSStore((s) => s.hoveredTelemetryFrameId);

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const prevScrollTopRef = useRef<number>(0);
  const handledScrollTimestampRef = useRef<number>(lastScrollRequest?.timestamp ?? 0);
  const isAutoScrollPausedRef = useRef<boolean>(isAutoScrollPaused);
  const programmaticScrollUntilRef = useRef<number>(0);

  // Synchronize isAutoScrollPausedRef with Zustand store
  useEffect(() => {
    isAutoScrollPausedRef.current = isAutoScrollPaused;
  }, [isAutoScrollPaused]);

  // Frame Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    frame: WSFrame;
    column?: CustomColumn;
    columnValue?: any;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu?.visible) {
      window.addEventListener('mousedown', handleOutsideClick);
    }
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [contextMenu?.visible]);

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, frame: WSFrame, col?: CustomColumn, columnValue?: any) => {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX, window.innerWidth - 240);
      const y = Math.min(e.clientY, window.innerHeight - 260);
      setContextMenu({
        visible: true,
        x,
        y,
        frame,
        column: col,
        columnValue,
      });
    },
    []
  );

  const handleFilterToken = useCallback(
    (token: string) => {
      setFilterQuery(toggleFilterToken(filterQuery, token));
    },
    [filterQuery, setFilterQuery]
  );

  // Column resizing state
  const [resizingCol, setResizingCol] = useState<{ id: string; startX: number; startWidth: number } | null>(null);
  const [copiedColId, setCopiedColId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadCountdown, setReloadCountdown] = useState<number>(0);
  const reloadLockRef = useRef<boolean>(false);
  const reloadIntervalRef = useRef<any>(null);

  const handleReloadPage = useCallback(() => {
    if (reloadLockRef.current || isReloading || typeof chrome === 'undefined' || !chrome.devtools?.inspectedWindow) return;
    reloadLockRef.current = true;
    setIsReloading(true);
    const TOTAL_COOLDOWN_SEC = 6;
    setReloadCountdown(TOTAL_COOLDOWN_SEC);

    try {
      chrome.devtools.inspectedWindow.reload({ ignoreCache: true });
    } catch {
      reloadLockRef.current = false;
      setIsReloading(false);
      setReloadCountdown(0);
      return;
    }

    if (reloadIntervalRef.current) {
      clearInterval(reloadIntervalRef.current);
    }

    let remaining = TOTAL_COOLDOWN_SEC;
    reloadIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (reloadIntervalRef.current) {
          clearInterval(reloadIntervalRef.current);
          reloadIntervalRef.current = null;
        }
        reloadLockRef.current = false;
        setIsReloading(false);
        setReloadCountdown(0);
      } else {
        setReloadCountdown(remaining);
      }
    }, 1000);
  }, [isReloading]);

  useEffect(() => {
    return () => {
      if (reloadIntervalRef.current) {
        clearInterval(reloadIntervalRef.current);
      }
    };
  }, []);

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

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedFrameId(id);
      if (filteredFrames.length > 0 && id !== filteredFrames[filteredFrames.length - 1]?.id) {
        isAutoScrollPausedRef.current = true;
        setIsAutoScrollPaused(true);
      }
    },
    [setSelectedFrameId, filteredFrames, setIsAutoScrollPaused]
  );
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
    if (!isAutoScrollPaused && !isAutoScrollPausedRef.current && containerRef.current && filteredFrames.length > 0) {
      programmaticScrollUntilRef.current = performance.now() + 100;
      rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
      // Direct DOM scroll pinning ensures 100% reliable pinning to bottom
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      prevScrollTopRef.current = containerRef.current.scrollTop;
    }
  }, [latestFrameId, rowVirtualizer, isAutoScrollPaused, filteredFrames.length]);

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
      programmaticScrollUntilRef.current = performance.now() + 100;
      rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
      if (containerRef.current) {
        prevScrollTopRef.current = containerRef.current.scrollTop;
      }
    }
  }, [selectedFrameId, filteredFrames, rowVirtualizer, isAutoScrollPaused, followLatestInspector]);

  // Handle column resize drag with requestAnimationFrame throttling for smooth 60fps dragging
  useEffect(() => {
    if (!resizingCol) return;

    let rafId: number | null = null;
    let latestClientX = resizingCol.startX;

    const handleMouseMove = (e: MouseEvent) => {
      latestClientX = e.clientX;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const diff = latestClientX - resizingCol.startX;
          updateCustomColumnWidth(resizingCol.id, resizingCol.startWidth + diff);
        });
      }
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setResizingCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, updateCustomColumnWidth]);

  // Scroll to target from store action (jumpToFirstFrame / jumpToLatestFrame)
  useEffect(() => {
    if (!lastScrollRequest || lastScrollRequest.timestamp <= handledScrollTimestampRef.current) {
      return;
    }
    handledScrollTimestampRef.current = lastScrollRequest.timestamp;

    if (lastScrollRequest.target === 'first') {
      isAutoScrollPausedRef.current = true;
      setIsAutoScrollPaused(true);
      if (filteredFrames.length > 0) {
        programmaticScrollUntilRef.current = performance.now() + 100;
        rowVirtualizer.scrollToIndex(0, { align: 'start' });
        if (containerRef.current) {
          containerRef.current.scrollTop = 0;
          prevScrollTopRef.current = 0;
        }
      }
    } else if (lastScrollRequest.target === 'latest') {
      isAutoScrollPausedRef.current = false;
      setIsAutoScrollPaused(false);
      resetUnseenCount();
      if (filteredFrames.length > 0) {
        programmaticScrollUntilRef.current = performance.now() + 100;
        rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          prevScrollTopRef.current = containerRef.current.scrollTop;
        }
      }
    }
  }, [lastScrollRequest, filteredFrames, rowVirtualizer, setIsAutoScrollPaused, resetUnseenCount]);

  // Synchronize horizontal scrolling between header and virtual rows & detect user scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (headerRef.current) {
      headerRef.current.scrollLeft = el.scrollLeft;
    }

    const currentScrollTop = el.scrollTop;
    const prevScrollTop = prevScrollTopRef.current;
    const scrollDelta = currentScrollTop - prevScrollTop;
    prevScrollTopRef.current = currentScrollTop;

    // Ignore scroll events generated by programmatic auto-scroll or jumps
    if (performance.now() < programmaticScrollUntilRef.current) {
      return;
    }

    // Check if container is near bottom (within 20px buffer)
    const isAtBottom = el.scrollHeight - currentScrollTop - el.clientHeight <= 20;

    // Detect user scrolling up (any negative delta beyond subpixel jitter)
    const isScrollingUp = scrollDelta < -1;
    // Detect user scrolling down
    const isScrollingDown = scrollDelta > 1;

    if (isScrollingUp) {
      // User scrolled up away from bottom: immediately pause auto-scroll
      if (!isAutoScrollPausedRef.current) {
        isAutoScrollPausedRef.current = true;
        setIsAutoScrollPaused(true);
      }
    } else if (isScrollingDown && isAtBottom) {
      // Only unpause if the user intentionally scrolled down to/at the bottom
      if (isAutoScrollPausedRef.current) {
        isAutoScrollPausedRef.current = false;
        setIsAutoScrollPaused(false);
        resetUnseenCount();
      }
    }
  };

  const scrollToTop = useCallback(() => {
    isAutoScrollPausedRef.current = true;
    setIsAutoScrollPaused(true);
    if (filteredFrames.length > 0) {
      setSelectedFrameId(filteredFrames[0].id);
      programmaticScrollUntilRef.current = performance.now() + 100;
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      prevScrollTopRef.current = 0;
    }
  }, [filteredFrames, rowVirtualizer, setIsAutoScrollPaused, setSelectedFrameId]);

  const scrollToBottom = useCallback(() => {
    isAutoScrollPausedRef.current = false;
    setIsAutoScrollPaused(false);
    resetUnseenCount();
    if (filteredFrames.length > 0) {
      programmaticScrollUntilRef.current = performance.now() + 100;
      rowVirtualizer.scrollToIndex(filteredFrames.length - 1, { align: 'end' });
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
        prevScrollTopRef.current = containerRef.current.scrollTop;
      }
    }
  }, [filteredFrames, rowVirtualizer, setIsAutoScrollPaused, resetUnseenCount]);

  // User intent detection: Listen to native wheel, pointerdown/move, touchstart/move, keydown on container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 1. Wheel listener (passive: true for smooth 60fps/120fps scrolling)
    const onWheel = (e: WheelEvent) => {
      programmaticScrollUntilRef.current = 0;
      if (e.deltaY < 0) {
        // User wheels UP: immediately pause auto-scroll synchronously
        if (!isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = true;
          setIsAutoScrollPaused(true);
        }
      } else if (e.deltaY > 0) {
        // User wheels DOWN: resume auto-scroll only if reached/at bottom
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
        if (isAtBottom && isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = false;
          setIsAutoScrollPaused(false);
          resetUnseenCount();
        }
      }
    };

    // 2. Scrollbar drag detection via pointer events
    let isDraggingScrollbar = false;
    let pointerStartY = 0;
    let initialScrollTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const isScrollbar = e.clientX >= rect.left + el.clientWidth;
      if (isScrollbar) {
        programmaticScrollUntilRef.current = 0;
        isDraggingScrollbar = true;
        pointerStartY = e.clientY;
        initialScrollTop = el.scrollTop;
      }
    };

    const onWindowPointerMove = (e: PointerEvent) => {
      if (!isDraggingScrollbar) return;
      programmaticScrollUntilRef.current = 0;
      if (e.clientY < pointerStartY || el.scrollTop < initialScrollTop) {
        // Dragging scrollbar upward
        if (!isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = true;
          setIsAutoScrollPaused(true);
        }
      } else if (e.clientY > pointerStartY) {
        // Dragging scrollbar downward
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
        if (isAtBottom && isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = false;
          setIsAutoScrollPaused(false);
          resetUnseenCount();
        }
      }
    };

    const onWindowPointerUp = () => {
      isDraggingScrollbar = false;
    };

    // 3. Touch listeners for mobile / touch devices
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        programmaticScrollUntilRef.current = 0;
        touchStartY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        programmaticScrollUntilRef.current = 0;
        const deltaY = e.touches[0].clientY - touchStartY;
        // deltaY > 4 means dragging finger down, scrolling page UP towards older frames
        if (deltaY > 4) {
          if (!isAutoScrollPausedRef.current) {
            isAutoScrollPausedRef.current = true;
            setIsAutoScrollPaused(true);
          }
        } else if (deltaY < -4) {
          const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
          if (isAtBottom && isAutoScrollPausedRef.current) {
            isAutoScrollPausedRef.current = false;
            setIsAutoScrollPaused(false);
            resetUnseenCount();
          }
        }
      }
    };

    // 4. Keyboard navigation on container (PageUp, Home, ArrowUp, PageDown, ArrowDown)
    const onKeyDown = (e: KeyboardEvent) => {
      programmaticScrollUntilRef.current = 0;
      if (e.key === 'PageUp' || e.key === 'Home' || e.key === 'ArrowUp') {
        if (!isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = true;
          setIsAutoScrollPaused(true);
        }
      } else if (e.key === 'PageDown' || e.key === 'ArrowDown') {
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
        if (isAtBottom && isAutoScrollPausedRef.current) {
          isAutoScrollPausedRef.current = false;
          setIsAutoScrollPaused(false);
          resetUnseenCount();
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [setIsAutoScrollPaused, resetUnseenCount]);

  const totalMinWidth = useMemo(() => {
    const baseColsWidth = 64 + 48 + 128 + 64 + 64 + 224; // w-16(64) + w-12(48) + w-32(128) + w-16(Δt 64) + w-16(Len 64) + w-56(Method 224) = 592px
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
            className="w-16 px-1.5 text-right border-r border-[#3c3c3c]/60 shrink-0 cursor-pointer hover:text-[#38bdf8] hover:bg-[#2a2d32] transition-colors flex items-center justify-end gap-1 group/hash"
            title="Click to jump to First frame (Shortcut: Home)"
          >
            <ArrowUp className="w-2.5 h-2.5 opacity-0 group-hover/hash:opacity-100 transition-opacity text-[#38bdf8]" />
            <span>#</span>
          </div>
          <div className="w-12 px-1 text-center border-r border-[#3c3c3c]/60 shrink-0">Dir</div>
          <div className="w-32 px-1.5 border-r border-[#3c3c3c]/60 shrink-0">Time</div>
          <div className="w-16 px-1.5 text-right border-r border-[#3c3c3c]/60 shrink-0" title="Inter-frame interval (Δt) / Frequency">Δt</div>
          <div className="w-16 px-2 text-right border-r border-[#3c3c3c]/60 shrink-0">Len</div>
          <div className="w-56 px-2 border-r border-[#3c3c3c]/60 shrink-0">Method / RPC</div>

          {/* Dynamic Custom Columns */}
          {customColumns.map((col) => {
            const colWidth = col.width || 190;
            const isColFiltered = hasFilterToken(filterQuery, `has:${col.path}`);
            const hasFormula = Boolean(col.formula?.trim());
            return (
              <div
                key={col.id}
                style={{ width: `${colWidth}px` }}
                className="px-2 border-r border-[#3c3c3c]/60 shrink-0 flex items-center justify-between text-[#38bdf8] bg-[#1e293b]/40 font-mono relative group"
              >
                <span className="truncate flex items-center gap-1" title={col.path + (col.formula ? ` | Formula: ${col.formula}` : '')}>
                  {isColFiltered && (
                    <span title="Filtered (non-empty only)">
                      <Filter className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                    </span>
                  )}
                  {hasFormula && (
                    <span
                      title={`Formula: ${col.formula}`}
                      className="px-1 py-0.2 bg-purple-900/70 border border-purple-500/60 text-purple-300 rounded text-[9px] font-bold shrink-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFormulaColId(col.id);
                        setFormulaInput(col.formula || '');
                      }}
                    >
                      fx
                    </span>
                  )}
                  <span className="truncate">{formatColumnHeader(col.name, col.path)}</span>
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterQuery(toggleFilterToken(filterQuery, `has:${col.path}`));
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      isColFiltered
                        ? 'text-emerald-400 bg-emerald-950/80 border border-emerald-500/50'
                        : 'text-[#888888] hover:text-emerald-400'
                    }`}
                    title={
                      isColFiltered
                        ? `Remove filter "has:${col.path}"`
                        : `Filter non-empty: only show frames with column "${col.name || col.path}" (has:${col.path})`
                    }
                  >
                    <Filter className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingFormulaColId(editingFormulaColId === col.id ? null : col.id);
                      setFormulaInput(col.formula || '');
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      hasFormula
                        ? 'text-purple-400 bg-purple-950/80 border border-purple-500/50'
                        : 'text-[#888888] hover:text-purple-400'
                    }`}
                    title={hasFormula ? `Edit Formula (${col.formula})` : 'Add Math Formula (e.g. val * 60, val - 20)'}
                  >
                    <Calculator className="w-2.5 h-2.5" />
                  </button>
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

                {/* Formula Editor Popover */}
                {editingFormulaColId === col.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full left-0 mt-1 z-50 bg-[#1e1e1e] border border-[#3c3c3c] shadow-2xl rounded p-2 text-xs w-64 font-sans text-white normal-case"
                  >
                    <div className="font-semibold text-[11px] text-[#38bdf8] mb-1 flex items-center justify-between">
                      <span>Formula: {formatColumnHeader(col.name, col.path)}</span>
                      <button onClick={() => setEditingFormulaColId(null)} className="text-[#888888] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[10px] text-[#888888] mb-1.5 leading-tight">
                      Use <code className="text-amber-300">val</code> (or <code className="text-amber-300">self</code>), e.g. <code className="text-amber-300">val * 60</code>, <code className="text-amber-300">val - 25</code>, <code className="text-amber-300">abs(val)</code>
                    </div>
                    <input
                      type="text"
                      value={formulaInput}
                      onChange={(e) => setFormulaInput(e.target.value)}
                      placeholder="e.g. val * 1000"
                      className="w-full bg-[#2d2d2d] border border-[#444444] rounded px-2 py-1 text-xs text-white font-mono focus:border-[#38bdf8] focus:outline-none mb-2"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateCustomColumnFormula(col.id, formulaInput);
                          setEditingFormulaColId(null);
                        } else if (e.key === 'Escape') {
                          setEditingFormulaColId(null);
                        }
                      }}
                    />
                    <div className="flex items-center justify-between gap-1">
                      <button
                        onClick={() => {
                          updateCustomColumnFormula(col.id, '');
                          setEditingFormulaColId(null);
                        }}
                        className="px-2 py-0.5 bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[10px]"
                      >
                        Clear
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingFormulaColId(null)}
                          className="px-2 py-0.5 bg-[#333333] hover:bg-[#444444] text-[#cccccc] rounded text-[10px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            updateCustomColumnFormula(col.id, formulaInput);
                            setEditingFormulaColId(null);
                          }}
                          className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-medium rounded text-[10px]"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
        tabIndex={0}
        className="flex-1 overflow-auto font-mono text-[11px] relative outline-none"
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
                    onClick={handleReloadPage}
                    disabled={isReloading}
                    className={`px-3 py-1 bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] hover:text-[#38bdf8] rounded border border-[#3c3c3c] text-[11px] transition-colors flex items-center gap-1.5 shadow-sm select-none ${
                      isReloading
                        ? 'opacity-60 cursor-not-allowed text-[#888888] pointer-events-none'
                        : 'cursor-pointer hover:border-[#38bdf8]'
                    }`}
                    title={
                      isReloading
                        ? `Reloading inspected page, please wait (${reloadCountdown}s)...`
                        : 'Reload inspected webpage to capture initial connection frames'
                    }
                  >
                    <RotateCw className={`w-3 h-3 ${isReloading ? 'animate-spin text-[#38bdf8]' : ''}`} />
                    <span>
                      {isReloading
                        ? `Reloading (${reloadCountdown}s)...`
                        : 'Reload Inspected Page'}
                    </span>
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
                  isTelemetryHovered={frame.id === hoveredTelemetryFrameId}
                  virtualRow={virtualRow}
                  customColumns={customColumns}
                  matchedRule={getMatchedHighlightRule(frame)}
                  enableRowTinting={enableRowTinting}
                  enableCarryForward={enableCarryForward}
                  highlightRules={highlightRules}
                  onSelect={handleSelect}
                  onJumpToPeer={handleJumpToPeer}
                  onContextMenu={handleRowContextMenu}
                  onFilterToken={handleFilterToken}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Frame / Row Context Menu Popup */}
      {contextMenu?.visible && (
        <div
          ref={contextMenuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-56 bg-[#252526] border border-[#454545] rounded-md shadow-2xl py-1 text-xs select-none backdrop-blur-md"
        >
          <div className="px-3 py-1 text-[10px] text-[#888888] border-b border-[#3c3c3c] font-mono truncate">
            Frame #{contextMenu.frame.seq ?? contextMenu.frame.id}
          </div>

          {contextMenu.frame.method && (
            <>
              <button
                onClick={() => {
                  setFilterQuery(appendFilterToken(filterQuery, contextMenu.frame.method!));
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
              >
                <Filter className="w-3.5 h-3.5 text-emerald-400" />
                <span>🔍 Filter method ({contextMenu.frame.method})</span>
              </button>
              <button
                onClick={() => {
                  setFilterQuery(appendFilterToken(filterQuery, `-${contextMenu.frame.method!}`));
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
              >
                <EyeOff className="w-3.5 h-3.5 text-rose-400" />
                <span>🚫 Exclude method (-{contextMenu.frame.method})</span>
              </button>
            </>
          )}

          <button
            onClick={() => {
              setFilterQuery(appendFilterToken(filterQuery, `dir:${contextMenu.frame.direction}`));
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-sky-400" />
            <span>🔍 Filter direction (dir:{contextMenu.frame.direction})</span>
          </button>

          {contextMenu.column && (
            <>
              <div className="my-1 border-t border-[#3c3c3c]" />
              {contextMenu.columnValue !== undefined && contextMenu.columnValue !== null && (
                <button
                  onClick={() => {
                    const valStr =
                      typeof contextMenu.columnValue === 'object'
                        ? JSON.stringify(contextMenu.columnValue)
                        : String(contextMenu.columnValue);
                    setFilterQuery(appendFilterToken(filterQuery, `json:${contextMenu.column!.path}=${valStr}`));
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
                >
                  <Filter className="w-3.5 h-3.5 text-teal-400" />
                  <span>🔍 Filter by Value ({String(contextMenu.columnValue).slice(0, 12)})</span>
                </button>
              )}
              <button
                onClick={() => {
                  setFilterQuery(appendFilterToken(filterQuery, `has:${contextMenu.column!.path}`));
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[#dddddd] hover:bg-[#094771] flex items-center gap-2 transition-colors"
              >
                <Filter className="w-3.5 h-3.5 text-emerald-400" />
                <span>🔍 Filter non-empty (has:{contextMenu.column!.path})</span>
              </button>
            </>
          )}

          <div className="my-1 border-t border-[#3c3c3c]" />

          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.frame.payload || '');
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[#aaaaaa] hover:bg-[#333333] flex items-center gap-2 transition-colors text-[11px]"
          >
            <Copy className="w-3 h-3" />
            <span>Copy Payload</span>
          </button>
        </div>
      )}
    </div>
  );
};
