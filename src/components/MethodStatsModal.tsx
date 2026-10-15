import React from 'react';
import { useWSStore } from '../store/ws-store';
import { X, BarChart3, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface MethodStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MethodStatsModal: React.FC<MethodStatsModalProps> = ({ isOpen, onClose }) => {
  const getMethodStats = useWSStore((s) => s.getMethodStats);
  const setFilterQuery = useWSStore((s) => s.setFilterQuery);

  if (!isOpen) return null;

  const stats = getMethodStats();
  const totalFrames = stats.reduce((acc, s) => acc + s.count, 0);
  const totalBytes = stats.reduce((acc, s) => acc + s.bytes, 0);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleFilterByMethod = (method: string) => {
    setFilterQuery(method);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs select-none">
      <div className="bg-[#252526] border border-[#444444] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col text-xs overflow-hidden">
        {/* Header */}
        <div className="h-10 px-4 bg-[#2d2d2d] border-b border-[#3c3c3c] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-white">
            <BarChart3 className="w-4 h-4 text-[#38bdf8]" />
            <span>WebSocket Message & Method Statistics</span>
            <span className="text-[10px] text-[#888888] font-normal">
              ({stats.length} methods, {totalFrames} frames, {formatBytes(totalBytes)})
            </span>
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-white p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Table */}
        <div className="flex-1 overflow-auto p-4 font-mono">
          {stats.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-[#777777]">
              No message methods captured yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#3c3c3c] text-[11px] text-[#aaaaaa]">
                  <th className="py-1.5 px-2">Method / Type</th>
                  <th className="py-1.5 px-2 text-right">Count</th>
                  <th className="py-1.5 px-2 text-right">Direction</th>
                  <th className="py-1.5 px-2 text-right">Size</th>
                  <th className="py-1.5 px-2 text-right">% Frames</th>
                  <th className="py-1.5 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const pct = totalFrames > 0 ? ((s.count / totalFrames) * 100).toFixed(1) : '0';
                  return (
                    <tr
                      key={s.method}
                      className="border-b border-[#2d2d2d] hover:bg-[#2e2e2e] transition-colors text-[11px]"
                    >
                      <td className="py-1.5 px-2 text-[#38bdf8] font-medium truncate max-w-[220px]">
                        {s.method}
                      </td>
                      <td className="py-1.5 px-2 text-right text-white font-bold">{s.count}</td>
                      <td className="py-1.5 px-2 text-right text-[#aaaaaa]">
                        <span className="inline-flex items-center gap-1">
                          {s.inCount > 0 && (
                            <span className="text-emerald-400 flex items-center">
                              <ArrowDownLeft className="w-3 h-3" />
                              {s.inCount}
                            </span>
                          )}
                          {s.outCount > 0 && (
                            <span className="text-amber-400 flex items-center ml-1">
                              <ArrowUpRight className="w-3 h-3" />
                              {s.outCount}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right text-[#888888]">{formatBytes(s.bytes)}</td>
                      <td className="py-1.5 px-2 text-right text-[#bbbbbb]">{pct}%</td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          onClick={() => handleFilterByMethod(s.method)}
                          className="px-2 py-0.5 rounded bg-[#1e1e1e] hover:bg-[#094771] text-[#38bdf8] hover:text-white border border-[#3c3c3c] text-[10px]"
                        >
                          Filter
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="h-9 px-4 bg-[#202020] border-t border-[#3c3c3c] flex items-center justify-between text-[11px] text-[#777777] shrink-0">
          <span>Tip: Click "Filter" on any method to isolate its stream in the main frame table.</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#333333] hover:bg-[#444444] text-white rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
