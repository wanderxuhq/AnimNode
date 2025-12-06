
import React, { useEffect, useState } from 'react';
import { ProjectState, Command } from '../types';
import { Activity, Database, MousePointer2, Clock, X } from 'lucide-react';

interface DebugPanelProps {
  project: ProjectState;
  history: { past: Command[]; future: Command[] };
  onClose: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ project, history, onClose }) => {
  const [activeElementInfo, setActiveElementInfo] = useState<{ tagName: string, type?: string, id?: string, undoable: string | null }>({
      tagName: 'BODY',
      undoable: null
  });

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Track Focus Changes to diagnose Input blocking issues
  useEffect(() => {
    const handleFocusChange = () => {
      const el = document.activeElement;
      if (el) {
        setActiveElementInfo({
            tagName: el.tagName,
            type: (el as HTMLInputElement).type,
            id: el.id,
            undoable: el.getAttribute('data-undoable')
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY });
    };

    // Initial check
    handleFocusChange();

    window.addEventListener('focusin', handleFocusChange);
    window.addEventListener('focusout', handleFocusChange);
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('focusin', handleFocusChange);
      window.removeEventListener('focusout', handleFocusChange);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const selectedNode = project.selection ? project.nodes[project.selection] : null;

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-black/90 border border-zinc-800 text-zinc-400 font-mono text-[10px] rounded-lg shadow-2xl z-[100] backdrop-blur overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="font-bold text-zinc-100 flex items-center gap-2">
            <Activity size={12} className="text-indigo-500"/> System Debug
        </span>
        <button onClick={onClose} className="hover:text-white"><X size={12}/></button>
      </div>

      <div className="p-3 space-y-4 overflow-y-auto max-h-[400px]">
        
        {/* SECTION: Focus & Input Diagnostics */}
        <div className="space-y-1">
            <div className="text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-1 mb-1">
                <MousePointer2 size={10} /> Focus & Input
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
                <span className="text-zinc-500">Active Tag:</span>
                <span className="text-zinc-200">{activeElementInfo.tagName}</span>
                
                <span className="text-zinc-500">Input Type:</span>
                <span className="text-zinc-200">{activeElementInfo.type || '-'}</span>
                
                <span className="text-zinc-500">Undoable:</span>
                <span className={`${activeElementInfo.undoable === 'true' ? 'text-emerald-400' : 'text-red-400'} font-bold`}>
                    {String(activeElementInfo.undoable)}
                </span>
                
                <span className="text-zinc-500">Global Undo:</span>
                <span className="text-zinc-200">
                    {/* Logic duplicated from App.tsx for visualization */}
                    {(activeElementInfo.tagName !== 'INPUT' && activeElementInfo.tagName !== 'TEXTAREA') || 
                     activeElementInfo.undoable === 'true' || 
                     activeElementInfo.type === 'color' 
                     ? <span className="text-emerald-400">ALLOWED</span> 
                     : <span className="text-red-400">BLOCKED</span>}
                </span>

                <span className="text-zinc-500">Mouse:</span>
                <span>{mousePos.x}, {mousePos.y}</span>
            </div>
        </div>

        {/* SECTION: History Diagnostics */}
        <div className="space-y-1">
             <div className="text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-1 mb-1">
                <Clock size={10} /> History Stack
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
                <span className="text-zinc-500">Past Size:</span>
                <span className="text-zinc-200">{history.past.length}</span>
                
                <span className="text-zinc-500">Future Size:</span>
                <span className="text-zinc-200">{history.future.length}</span>

                <span className="text-zinc-500">Last Cmd:</span>
                <span className="text-indigo-300 truncate">
                    {history.past.length > 0 ? history.past[history.past.length - 1].name : '<none>'}
                </span>
            </div>
        </div>

        {/* SECTION: Selection Data */}
        <div className="space-y-1">
             <div className="text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-1 mb-1">
                <Database size={10} /> Selection Data
            </div>
            {selectedNode ? (
                <div className="space-y-1">
                    <div className="flex justify-between">
                        <span className="text-zinc-500">ID:</span>
                        <span className="text-zinc-200 truncate max-w-[150px]">{selectedNode.id}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-zinc-500">Type:</span>
                        <span className="text-zinc-200">{selectedNode.type}</span>
                    </div>
                    {/* Dump raw properties briefly */}
                    <div className="bg-zinc-950 p-1 rounded border border-zinc-800 mt-2">
                        <pre className="text-[9px] text-zinc-500 overflow-x-hidden whitespace-pre-wrap">
                            {JSON.stringify(selectedNode.properties, (key, value) => {
                                if (key === 'keyframes' && Array.isArray(value) && value.length === 0) return undefined;
                                if (key === 'id') return undefined;
                                return value;
                            }, 2)}
                        </pre>
                    </div>
                </div>
            ) : (
                <span className="text-zinc-600 italic">No selection</span>
            )}
        </div>

      </div>
    </div>
  );
};
