import React, { useMemo } from 'react';
import { useWSStore } from '../store/ws-store';
import {
  Network,
  Radio,
  ArrowDownLeft,
  ArrowUpRight,
  PanelLeftClose,
  Eye,
  EyeOff,
  Trash2,
  X,
} from 'lucide-react';
import { purgeBridgeConnections, removeBridgeConnection } from '../hooks/useBridge';

interface ConnectionsSidebarProps {
  selectedConnectionId?: string | null;
  onSelectConnection?: (id: string | null) => void;
  onToggleCollapse?: () => void;
}

export const ConnectionsSidebar: React.FC<ConnectionsSidebarProps> = ({
  selectedConnectionId: propSelectedId,
  onSelectConnection,
  onToggleCollapse,
}) => {
  const connections = useWSStore((s) => s.connections);
  const totalFrameCount = useWSStore((s) => s.frames.length);
  const maxFrames = useWSStore((s) => s.maxFrames);
  const hideClosedConnections = useWSStore((s) => s.hideClosedConnections);
  const toggleHideClosedConnections = useWSStore((s) => s.toggleHideClosedConnections);
  const purgeInactiveConnections = useWSStore((s) => s.purgeInactiveConnections);
  const removeConnection = useWSStore((s) => s.removeConnection);
  const storeSelectedId = useWSStore((s) => s.selectedConnectionId);
  const setStoreSelectedId = useWSStore((s) => s.setSelectedConnectionId);

  const selectedConnectionId = propSelectedId !== undefined ? propSelectedId : storeSelectedId;
  const handleSelectConnection = (id: string | null) => {
    if (onSelectConnection) {
      onSelectConnection(id);
    } else {
      setStoreSelectedId(id);
    }
  };

  const allConns = Object.values(connections);
  const closedCount = allConns.filter((c) => c.status === 'closed').length;
  const totalHistoricalMsgs = allConns.reduce((acc, c) => acc + c.frameCount, 0);

  // Group connections by base label (host + pathname) to disambiguate identical URLs
  const { sessionIndexMap, duplicateBaseSet } = useMemo(() => {
    const map = new Map<string, typeof allConns>();
    for (const c of allConns) {
      let base = c.url;
      try {
        const u = new URL(c.url);
        base = `${u.host}${u.pathname}`;
      } catch {}
      if (!map.has(base)) map.set(base, []);
      map.get(base)!.push(c);
    }

    const sessionIdx = new Map<string, number>();
    const dupes = new Set<string>();

    for (const [base, conns] of map.entries()) {
      if (conns.length > 1) {
        dupes.add(base);
        // Sort chronologically
        conns.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        conns.forEach((c, idx) => {
          sessionIdx.set(c.id, idx + 1);
        });
      }
    }

    return { sessionIndexMap: sessionIdx, duplicateBaseSet: dupes };
  }, [allConns]);

  // Filter out 0-msg closed connections by default, or all closed connections when toggled
  const visibleConns = useMemo(() => {
    return allConns.filter((c) => {
      if (hideClosedConnections && c.status === 'closed') {
        return false;
      }
      // Auto-prune 0 msgs closed connections from view if there are other streams
      if (c.status === 'closed' && (c.frameCount === 0 || !c.frameCount) && allConns.length > 1) {
        return false;
      }
      return true;
    });
  }, [allConns, hideClosedConnections]);

  const formattedCap =
    maxFrames >= 1000000
      ? `${(maxFrames / 1000000).toFixed(maxFrames % 1000000 === 0 ? 0 : 1)}M`
      : maxFrames >= 1000
      ? `${maxFrames / 1000}k`
      : `${maxFrames}`;

  const handlePurgeClosed = () => {
    purgeInactiveConnections();
    purgeBridgeConnections();
  };

  const handleRemoveConnection = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeConnection(id);
    removeBridgeConnection(id);
  };

  return (
    <div className="w-56 bg-[#252526] border-r border-[#3c3c3c] flex flex-col select-none text-xs shrink-0">
      {/* Sidebar Header */}
      <div className="h-7 px-2.5 bg-[#1e1e1e] border-b border-[#3c3c3c] flex items-center justify-between text-[#888888] font-semibold uppercase tracking-wider text-[10px]">
        <span className="flex items-center gap-1.5 truncate">
          <Network className="w-3 h-3 text-[#38bdf8] shrink-0" />
          <span className="truncate">
            Streams ({visibleConns.length}
            {visibleConns.length !== allConns.length ? `/${allConns.length}` : ''})
          </span>
        </span>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Hide/Show Closed Streams Toggle */}
          <button
            onClick={toggleHideClosedConnections}
            className={`p-1 rounded transition-colors ${
              hideClosedConnections
                ? 'text-amber-400 bg-amber-950/40 hover:bg-amber-900/60'
                : 'text-[#777777] hover:text-white hover:bg-[#333333]'
            }`}
            title={
              hideClosedConnections
                ? 'Closed streams hidden (Click to show)'
                : 'Hide closed streams'
            }
          >
            {hideClosedConnections ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Purge Closed Streams Button */}
          <button
            onClick={handlePurgeClosed}
            disabled={closedCount === 0}
            className={`p-1 rounded transition-colors ${
              closedCount > 0
                ? 'text-[#888888] hover:text-red-400 hover:bg-[#333333]'
                : 'text-[#444444] cursor-not-allowed opacity-40'
            }`}
            title={
              closedCount > 0
                ? `Purge ${closedCount} closed connection(s)`
                : 'No closed connections to purge'
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Collapse Sidebar Button */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1 text-[#777777] hover:text-white hover:bg-[#333333] rounded transition-colors ml-0.5"
              title="Collapse Streams Sidebar (Shortcut: [ )"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {/* All Streams Master Item */}
        <div
          onClick={() => handleSelectConnection(null)}
          className={`px-2 py-1.5 rounded cursor-pointer transition-colors flex items-center justify-between ${
            selectedConnectionId === null
              ? 'bg-[#094771] text-white font-medium'
              : 'text-[#cccccc] hover:bg-[#2d2d2d]'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <Radio className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
            <span className="truncate">All Streams</span>
          </div>
          <span
            className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded text-[#aaaaaa] font-mono shrink-0"
            title={
              totalHistoricalMsgs > totalFrameCount
                ? `Retaining latest ${totalFrameCount.toLocaleString()} of max ${maxFrames.toLocaleString()} frames in memory (${totalHistoricalMsgs.toLocaleString()} total received)`
                : `${totalFrameCount.toLocaleString()} / ${maxFrames.toLocaleString()} frames in memory`
            }
          >
            {totalFrameCount.toLocaleString()} / {formattedCap}
          </span>
        </div>

        {/* Empty State */}
        {visibleConns.length === 0 && (
          <div className="text-center py-6 text-[#777777] text-[11px] italic">
            {hideClosedConnections && allConns.length > 0
              ? 'All streams closed (hidden)'
              : 'No active streams'}
          </div>
        )}

        {/* Individual Stream Cards */}
        {visibleConns.map((conn) => {
          let label = conn.url;
          let baseLabel = conn.url;
          try {
            const urlObj = new URL(conn.url);
            baseLabel = `${urlObj.host}${urlObj.pathname}`;
            label = baseLabel;
          } catch {
            // Keep full url if not parseable
          }

          const sessionSeq = sessionIndexMap.get(conn.id);
          const isDupe = duplicateBaseSet.has(baseLabel);
          const isSelected = selectedConnectionId === conn.id;
          const startTimeFormatted = conn.startTime
            ? new Date(conn.startTime).toLocaleTimeString([], { hour12: false })
            : '';

          return (
            <div
              key={conn.id}
              onClick={() => handleSelectConnection(conn.id)}
              className={`group px-2.5 py-2 rounded cursor-pointer transition-colors flex flex-col gap-1 border relative ${
                isSelected
                  ? 'bg-[#094771] text-white border-[#1d69a6]'
                  : 'text-[#cccccc] bg-[#1e1e1e]/60 hover:bg-[#2d2d2d] border-[#333333]'
              }`}
            >
              {/* Row 1: Status Dot, URL Label, Disambiguation Badge, Remove Button */}
              <div className="flex items-center justify-between gap-1 min-w-0">
                <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      conn.status === 'open' ? 'bg-emerald-400' : 'bg-zinc-500'
                    }`}
                    title={conn.status === 'open' ? 'Connected (Open)' : 'Disconnected (Closed)'}
                  />
                  <span className="font-mono text-[11px] truncate" title={conn.url}>
                    {label}
                  </span>
                  {isDupe && sessionSeq !== undefined && (
                    <span
                      className="text-[9px] bg-[#333333] text-[#38bdf8] px-1 py-0.2 rounded font-mono shrink-0"
                      title={`Session #${sessionSeq} (Started: ${startTimeFormatted})`}
                    >
                      #{sessionSeq}
                    </span>
                  )}
                </div>

                {/* Hover Remove '×' for closed connections */}
                {conn.status === 'closed' && (
                  <button
                    onClick={(e) => handleRemoveConnection(e, conn.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-950/70 hover:text-red-300 rounded text-[#888888] transition-all shrink-0"
                    title="Remove closed stream from list"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Row 2: In/Out telemetry counts, frame count, session start time */}
              <div className="flex items-center justify-between text-[10px] text-[#888888] font-mono">
                <span className="flex items-center gap-1">
                  <ArrowDownLeft className="w-2.5 h-2.5 text-emerald-400" />
                  {conn.inCount}
                  <ArrowUpRight className="w-2.5 h-2.5 text-amber-400 ml-0.5" />
                  {conn.outCount}
                </span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {startTimeFormatted && (
                    <span className="text-[9px] text-[#666666]" title={`Started at ${startTimeFormatted}`}>
                      {startTimeFormatted}
                    </span>
                  )}
                  <span>{conn.frameCount} msgs</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
