
import React, { useEffect, useState, useRef } from 'react';
import { LogEntry } from '../types';
import { consoleService } from '../services/console';
import { Trash2, AlertCircle, Info, AlertTriangle, XCircle, Search } from 'lucide-react';

interface ConsolePanelProps {
  onJumpToSource: (nodeId: string, propKey: string) => void;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ onJumpToSource }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const unsub = consoleService.subscribe((updatedLogs) => {
        setLogs(updatedLogs);
    });
    setLogs(consoleService.getLogs()); // Initial load
    return unsub;
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
      if (scrollRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          // If user scrolls up, disable autoscroll
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
          setAutoScroll(isAtBottom);
      }
  };

  const getIcon = (level: string) => {
      switch(level) {
          case 'error': return <XCircle size={12} className="text-red-500 mt-0.5" />;
          case 'warn': return <AlertTriangle size={12} className="text-yellow-500 mt-0.5" />;
          default: return <Info size={12} className="text-blue-500 mt-0.5" />;
      }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono text-xs">
      <div className="h-8 flex items-center justify-between px-2 border-b border-zinc-800 bg-zinc-900">
         <div className="flex items-center gap-2 text-zinc-400">
             <Search size={12} />
             <span className="font-bold">Console</span>
             <span className="text-zinc-600">({logs.length})</span>
         </div>
         <button 
            onClick={() => consoleService.clear()}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Clear Console"
         >
             <Trash2 size={12} />
         </button>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onScroll={handleScroll}
      >
          {logs.length === 0 && (
              <div className="text-zinc-600 italic text-center mt-10">No logs to display</div>
          )}
          {logs.map(log => (
              <div 
                key={log.id} 
                className={`flex gap-2 p-1.5 rounded hover:bg-zinc-900 group ${log.nodeId ? 'cursor-pointer' : ''}`}
                onClick={() => log.nodeId && log.propKey && onJumpToSource(log.nodeId, log.propKey)}
              >
                  <div className="shrink-0">{getIcon(log.level)}</div>
                  <div className="flex-1 break-all text-zinc-300">
                      <span className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-zinc-300'}>
                        {log.message}
                      </span>
                      {log.count > 1 && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 bg-zinc-800 rounded-full text-[10px] text-zinc-400">
                              x{log.count}
                          </span>
                      )}
                  </div>
                  {log.nodeId && (
                      <div className="shrink-0 text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 flex items-center">
                          {log.nodeId}::{log.propKey}
                      </div>
                  )}
              </div>
          ))}
      </div>
    </div>
  );
};
