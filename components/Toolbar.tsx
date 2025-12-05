
import React from 'react';
import { Square, Circle, PenTool, MousePointer2, Music, Type } from 'lucide-react';

interface ToolbarProps {
  onAddNode: (type: 'rect' | 'circle' | 'vector') => void;
  onAddAudio: () => void;
  activeTool?: string; // Future use for tool state
}

export const Toolbar: React.FC<ToolbarProps> = ({ onAddNode, onAddAudio }) => {
  return (
    <div className="w-12 bg-zinc-900 border-r border-zinc-700 flex flex-col items-center py-4 gap-4 z-30 shrink-0">
      
      {/* Selection Tool (Visual only for now) */}
      <div className="tooltip-container group relative">
        <button className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-colors">
            <MousePointer2 size={20} />
        </button>
        <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
            Select
        </span>
      </div>

      <div className="w-8 h-px bg-zinc-800" />

      {/* Creation Tools */}
      <div className="flex flex-col gap-2">
        <div className="tooltip-container group relative">
            <button 
                onClick={() => onAddNode('rect')}
                className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
                <Square size={20} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                Rectangle
            </span>
        </div>

        <div className="tooltip-container group relative">
            <button 
                onClick={() => onAddNode('circle')}
                className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
                <Circle size={20} />
            </button>
             <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                Circle
            </span>
        </div>

        <div className="tooltip-container group relative">
            <button 
                onClick={() => onAddNode('vector')}
                className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
                <PenTool size={20} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                Pen / Path
            </span>
        </div>
      </div>

       <div className="w-8 h-px bg-zinc-800" />

       {/* Audio */}
       <div className="tooltip-container group relative">
            <button 
                onClick={onAddAudio}
                className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
                <Music size={20} />
            </button>
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none">
                Import Audio
            </span>
        </div>

    </div>
  );
};
