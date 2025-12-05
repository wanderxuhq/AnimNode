

import React, { useEffect, useRef } from 'react';
import { Command } from '../types';
import { History, RotateCcw, RotateCw, Trash2, CheckCircle2 } from 'lucide-react';

interface HistoryPanelProps {
  history: { past: Command[]; future: Command[] };
  onUndo: () => void;
  onRedo: () => void;
  onJump: (index: number) => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, onUndo, onRedo, onJump }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto scroll to bottom when new items added
  useEffect(() => {
      if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
  }, [history.past.length]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-sans text-xs border-l border-zinc-800">
      <div className="h-8 flex items-center justify-between px-2 border-b border-zinc-800 bg-zinc-900">
         <div className="flex items-center gap-2 text-zinc-400">
             <History size={12} />
             <span className="font-bold">History</span>
         </div>
         <div className="flex gap-1">
             <button 
                onClick={onUndo} 
                disabled={history.past.length === 0}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 disabled:opacity-30 transition-colors"
                title="Undo (Ctrl+Z)"
             >
                 <RotateCcw size={12} />
             </button>
             <button 
                onClick={onRedo} 
                disabled={history.future.length === 0}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 disabled:opacity-30 transition-colors"
                title="Redo (Ctrl+Shift+Z)"
             >
                 <RotateCw size={12} />
             </button>
         </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Initial State Marker */}
          <div className="px-2 py-1.5 rounded text-zinc-600 italic flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
             <span>Project Opened</span>
          </div>

          {history.past.map((cmd, index) => (
              <div 
                key={cmd.id} 
                className={`px-2 py-1.5 rounded flex items-center gap-2 cursor-pointer transition-colors ${index === history.past.length - 1 ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}
                onClick={() => onJump(index)}
              >
                  <div className={`w-1.5 h-1.5 rounded-full ${index === history.past.length - 1 ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-zinc-600'}`} />
                  <span className="truncate flex-1">{cmd.name}</span>
                  {index === history.past.length - 1 && <CheckCircle2 size={10} className="text-indigo-500 opacity-50" />}
              </div>
          ))}

          {history.future.length > 0 && (
             <div className="my-2 border-t border-dashed border-zinc-800" />
          )}

          {history.future.map((cmd, index) => (
             <div 
                key={cmd.id} 
                className="px-2 py-1.5 rounded flex items-center gap-2 text-zinc-600 opacity-50 cursor-not-allowed"
             >
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 border border-zinc-700" />
                  <span className="truncate flex-1">{cmd.name}</span>
             </div>
          ))}
      </div>
      
      <div className="h-6 border-t border-zinc-900 bg-zinc-950 flex items-center justify-center text-[10px] text-zinc-600">
         {history.past.length} states in memory
      </div>
    </div>
  );
};
