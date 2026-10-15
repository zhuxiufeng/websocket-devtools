import React from 'react';
import { useWSStore } from '../store/ws-store';
import { Network, Radio, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface ConnectionsSidebarProps {
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}

export const ConnectionsSidebar: React.FC<ConnectionsSidebarProps> = ({
  selectedConnectionId,
  onSelectConnection,
}) => {
  const connections = useWSStore((s) => s.connections);
  const totalFrameCount = useWSStore((s) => s.frames.length);
  const connList = Object.values(connections);

  return (
    <div className="w-52 bg-[#252526] border-r border-[#3c3c3c] flex flex-col select-none text-xs shrink-0">
      <div className="h-7 px-3 bg-[#1e1e1e] border-b border-[#3c3c3c] flex items-center justify-between text-[#888888] font-semibold uppercase tracking-wider text-[10px]">
        <span className="flex items-center gap-1.5">
          <Network className="w-3 h-3 text-[#38bdf8]" />
          Connections ({connList.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {/* All Connections option */}
        <div
          onClick={() => onSelectConnection(null)}
          className={`px-2.5 py-1.5 rounded cursor-pointer transition-colors flex items-center justify-between ${
            selectedConnectionId === null
              ? 'bg-[#094771] text-white font-medium'
              : 'text-[#cccccc] hover:bg-[#2d2d2d]'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <Radio className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span className="truncate">All Streams</span>
          </div>
          <span className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded text-[#aaaaaa] font-mono">
            {totalFrameCount}
          </span>
        </div>

        {/* Individual Connections */}
        {connList.map((conn) => {
          let label = conn.url;
          try {
            const urlObj = new URL(conn.url);
            label = `${urlObj.host}${urlObj.pathname}`;
          } catch {
            // Keep full url if not parseable
          }

          const isSelected = selectedConnectionId === conn.id;

          return (
            <div
              key={conn.id}
              onClick={() => onSelectConnection(conn.id)}
              className={`px-2.5 py-2 rounded cursor-pointer transition-colors flex flex-col gap-1 border ${
                isSelected
                  ? 'bg-[#094771] text-white border-[#1d69a6]'
                  : 'text-[#cccccc] bg-[#1e1e1e]/60 hover:bg-[#2d2d2d] border-[#333333]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      conn.status === 'open' ? 'bg-emerald-400' : 'bg-zinc-500'
                    }`}
                  />
                  <span className="font-mono text-[11px] truncate" title={conn.url}>
                    {label}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-[#888888] font-mono">
                <span className="flex items-center gap-1">
                  <ArrowDownLeft className="w-2.5 h-2.5 text-emerald-400" />
                  {conn.inCount}
                  <ArrowUpRight className="w-2.5 h-2.5 text-amber-400 ml-1" />
                  {conn.outCount}
                </span>
                <span>{conn.frameCount} msgs</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
