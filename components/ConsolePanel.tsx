
import React, { useEffect, useState, useRef } from 'react';
import { LogEntry } from '../types';
import { consoleService } from '../services/console';
import { Trash2, AlertTriangle, Info, XCircle, Search, Terminal, ChevronRight } from 'lucide-react';

interface ConsolePanelProps {
  onJumpToSource: (nodeId: string, propKey: string) => void;
  onRunScript?: (code: string) => void;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ onJumpToSource, onRunScript }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  
  // Script Input State
  const [inputCode, setInputCode] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [draft, setDraft] = useState(''); // To store current input when navigating history
  
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputCode]);

  const handleScroll = () => {
      if (scrollRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
          setAutoScroll(isAtBottom);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
          if (!e.shiftKey) {
              e.preventDefault();
              if (inputCode.trim()) {
                  if (onRunScript) onRunScript(inputCode);
                  setCommandHistory(prev => [inputCode, ...prev]);
                  setHistoryIndex(-1);
                  setInputCode('');
                  setDraft('');
              }
          }
      } else if (e.key === 'ArrowUp') {
          // Navigate History Up
          const isAtStart = inputRef.current && inputRef.current.selectionStart === 0;
          if (isAtStart) {
              if (historyIndex < commandHistory.length - 1) {
                  e.preventDefault();
                  // Save draft if we are starting navigation from the "current" input
                  if (historyIndex === -1) setDraft(inputCode);
                  
                  const nextIndex = historyIndex + 1;
                  setHistoryIndex(nextIndex);
                  setInputCode(commandHistory[nextIndex]);
              }
          }
      } else if (e.key === 'ArrowDown') {
          // Navigate History Down
          const isAtEnd = inputRef.current && inputRef.current.selectionStart === inputCode.length;
          if (isAtEnd) {
              if (historyIndex > -1) {
                  e.preventDefault();
                  if (historyIndex > 0) {
                      const nextIndex = historyIndex - 1;
                      setHistoryIndex(nextIndex);
                      setInputCode(commandHistory[nextIndex]);
                  } else {
                      // Return to draft
                      setHistoryIndex(-1);
                      setInputCode(draft);
                  }
              }
          }
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
      {/* Header */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
         <div className="flex items-center gap-2 text-zinc-400">
             <Terminal size={12} />
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

      {/* Logs Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onScroll={handleScroll}
      >
          {logs.length === 0 && (
              <div className="text-zinc-600 italic text-center mt-4 opacity-50">
                  Execute commands or see system logs...
              </div>
          )}
          {logs.map(log => (
              <div 
                key={log.id} 
                className={`flex gap-2 p-1.5 rounded hover:bg-zinc-900 group ${log.nodeId ? 'cursor-pointer' : ''}`}
                onClick={() => log.nodeId && log.propKey && onJumpToSource(log.nodeId, log.propKey)}
              >
                  <div className="shrink-0">{getIcon(log.level)}</div>
                  <div className="flex-1 break-all text-zinc-300 whitespace-pre-wrap">
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

      {/* Input Area */}
      <div className="border-t border-zinc-800 p-2 bg-zinc-900 flex items-start gap-2 shrink-0">
        <ChevronRight size={14} className="text-indigo-400 shrink-0 mt-1" />
        <textarea 
            ref={inputRef}
            className="flex-1 bg-transparent text-zinc-200 focus:outline-none placeholder:text-zinc-700 resize-none overflow-y-auto min-h-[1.5rem]"
            placeholder="Run script (Shift+Enter for newline)..."
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            rows={1}
        />
      </div>
    </div>
  );
};
