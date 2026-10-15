import React, { useState } from 'react';
import { useWSStore } from '../store/ws-store';
import { sendBridgeMessage } from '../hooks/useBridge';
import { Terminal, Send, ChevronUp, ChevronDown, Sparkles, Clock } from 'lucide-react';

export const CommandConsole: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>([
    '{"type":"ping"}',
    '{"jsonrpc":"2.0","method":"ping","id":1}',
    '{"jsonrpc":"2.0","method":"subscribe","params":{"topic":"events"},"id":2}',
  ]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const connections = useWSStore((s) => s.connections);
  const connList = Object.values(connections);
  const defaultConn = connList[0]?.id || '';
  const [selectedConn, setSelectedConn] = useState<string>('');

  const targetConn = selectedConn || defaultConn;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const payload = inputVal.trim();
    if (!payload) return;

    try {
      sendBridgeMessage(targetConn, payload);

      // Add to history
      setHistory((prev) => [payload, ...prev.filter((item) => item !== payload)].slice(0, 20));
      setHistoryIndex(-1);
      setInputVal('');
      setStatusMsg('Sent successfully!');
      setTimeout(() => setStatusMsg(null), 2000);
    } catch (err: any) {
      setStatusMsg(`Error: ${err?.message || 'Send failed'}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(nextIdx);
        setInputVal(history[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputVal(history[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputVal('');
      }
    }
  };

  return (
    <div className="bg-[#1f1f1f] border-t border-[#333333] select-none text-xs flex flex-col shrink-0">
      {/* Console Toggle Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="h-6 px-3 bg-[#252526] hover:bg-[#2d2d2d] flex items-center justify-between cursor-pointer border-b border-[#303030] text-[11px]"
      >
        <div className="flex items-center gap-1.5 text-[#aaaaaa]">
          <Terminal className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span className="font-semibold text-[#cccccc]">WS Console & Command Injector</span>
          <span className="text-[10px] text-[#777777] hidden sm:inline">
            (Inject custom messages / JSON-RPC requests directly into active socket)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {statusMsg && (
            <span className="text-emerald-400 font-mono text-[10px] animate-fade-in">{statusMsg}</span>
          )}
          <span className="text-[#888888]">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      {/* Expanded Console Area */}
      {isOpen && (
        <div className="p-2.5 bg-[#181818] flex flex-col gap-2">
          {/* Quick Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[10px]">
            <span className="text-[#666666] flex items-center gap-1 shrink-0 font-mono">
              <Sparkles className="w-2.5 h-2.5 text-amber-400" /> Presets:
            </span>
            {[
              { label: 'Ping', cmd: '{"type":"ping"}' },
              { label: 'JSON-RPC Ping', cmd: '{"jsonrpc":"2.0","method":"ping","id":1}' },
              { label: 'Subscribe', cmd: '{"jsonrpc":"2.0","method":"subscribe","params":{"topic":"events"},"id":2}' },
              { label: 'Echo', cmd: '{"type":"echo","message":"hello"}' },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setInputVal(p.cmd)}
                className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-[#38bdf8] border border-[#3c3c3c] font-mono shrink-0 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSend} className="flex items-center gap-2">
            {/* Connection Selector */}
            {connList.length > 1 && (
              <select
                value={targetConn}
                onChange={(e) => setSelectedConn(e.target.value)}
                className="bg-[#252526] text-[#38bdf8] text-[10px] px-2 py-1 rounded border border-[#3c3c3c] outline-none font-mono max-w-[160px] truncate"
              >
                {connList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.url}
                  </option>
                ))}
              </select>
            )}

            <div className="relative flex-1 flex items-center">
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Type payload (e.g. {"jsonrpc":"2.0","method":"server.info","id":1}) or use ↑/↓ for history'
                className="w-full bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#38bdf8] text-white px-2.5 py-1 rounded text-xs outline-none font-mono placeholder-[#555555]"
              />
              {history.length > 0 && (
                <div
                  title="History available via Up/Down arrow keys"
                  className="absolute right-2 text-[#666666] flex items-center gap-0.5 text-[10px]"
                >
                  <Clock className="w-3 h-3" />
                  <span>{history.length}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!inputVal.trim()}
              className="px-3 py-1 bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-40 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Send className="w-3 h-3" />
              <span>Send</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
