import React, { useRef, useState, useEffect } from 'react';
import { ProjectState, Property } from '../types';
import { Code2 } from 'lucide-react';

interface NodeGraphProps {
  project: ProjectState;
  onSelect: (id: string, mode?: 'ui' | 'json') => void;
}

export const NodeGraph: React.FC<NodeGraphProps> = ({ project, onSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Monitor container size to center the root lines
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
        for (let entry of entries) {
            setDimensions({
                width: entry.contentRect.width,
                height: entry.contentRect.height
            });
        }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Simple Auto-Layout
  const startX = 140; 
  const startY = 100;
  const gapY = 160;   
  const gapX = 350;

  // Calculate node positions
  const nodePositions = project.rootNodeIds.map((id, index) => {
      return {
          id,
          x: startX + (index % 3) * gapX,
          y: startY + index * gapY
      };
  });

  // Calculate Virtual Root Point (Center Left of Screen)
  const rootX = 60;
  const rootY = dimensions.height / 2;

  return (
    <div ref={containerRef} className="flex-1 bg-zinc-950 relative overflow-hidden bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] group/graph pt-12">
      
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
        {/* Draw connections from Virtual ROOT to Nodes */}
        {nodePositions.map((pos, i) => {
            // Target the LEFT edge of the port (Port is at -6, width 12. Center is 0. Edge is -6.)
            // We want to stop slightly before the port starts to look clean.
            // Port is at `left: -1.5` (tailwind) => -6px.
            // So the port visual circle starts at `pos.x - 6`.
            // Let's stop the line at `pos.x - 6`.
            const inputX = pos.x - 6; 
            
            // Target vertical center of port (Top is 42, Height is 12, Center is 42+6 = 48)
            const inputY = pos.y + 48; 
            
            // Bezier logic
            const cp1X = rootX + (inputX - rootX) * 0.5;
            const cp2X = inputX - (inputX - rootX) * 0.5;
            
            return (
                <path 
                    key={i}
                    d={`M ${rootX} ${rootY} C ${cp1X} ${rootY}, ${cp2X} ${inputY}, ${inputX} ${inputY}`}
                    fill="none"
                    stroke="#52525b"
                    strokeWidth="2"
                    className="opacity-60"
                />
            );
        })}
      </svg>

      {/* Virtual Root Node */}
      <div 
        className="absolute w-12 h-12 bg-zinc-800 rounded-full border-2 border-zinc-600 flex items-center justify-center text-[8px] font-bold text-zinc-500 shadow-xl z-10 select-none"
        style={{ left: rootX - 24, top: rootY - 24 }}
      >
         ROOT
      </div>

      {/* Render Nodes */}
      {nodePositions.map(pos => {
        const node = project.nodes[pos.id];
        
        // Critical Safety Check: Prevent crash if node data is missing
        if (!node) return null;

        const isSelected = project.selection === node.id;
        
        return (
            <div 
                key={node.id}
                className={`absolute w-72 bg-zinc-900 border rounded-lg shadow-2xl transition-all z-20 ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-zinc-700 hover:border-zinc-500'}`}
                style={{ left: pos.x, top: pos.y }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node.id, 'ui');
                }}
            >
                {/* Header */}
                <div className={`h-9 px-3 rounded-t-lg flex items-center justify-between ${isSelected ? 'bg-indigo-900/30' : 'bg-zinc-800'} border-b border-zinc-700`}>
                    <span className="font-bold text-xs text-zinc-200 truncate flex items-center gap-2 font-mono">
                        {node.type === 'rect' ? <div className="w-2 h-2 bg-blue-500 rounded-sm"/> : <div className="w-2 h-2 bg-pink-500 rounded-full"/>}
                        {node.id}
                    </span>
                    <button 
                        className="p-1.5 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors"
                        title="Edit Code JSON"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(node.id, 'json');
                        }}
                        >
                            <Code2 size={12} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-3 space-y-2 bg-zinc-900/90">
                     {Object.entries(node.properties).slice(0, 5).map(([key, rawProp]) => {
                        const prop = rawProp as Property;
                        return (
                        <div key={key} className="flex justify-between items-center text-[10px] h-5 border-b border-zinc-800/50 last:border-0">
                             <span className="text-zinc-500 font-medium">{key}</span>
                             <span className={`font-mono truncate max-w-[120px] ${prop.mode === 'code' ? 'text-blue-400' : 'text-zinc-400'}`}>
                                {prop.mode === 'code' ? 'ƒ(t)' : (typeof prop.value === 'number' ? prop.value.toFixed(1) : String(prop.value))}
                             </span>
                        </div>
                     )})}
                </div>

                {/* Input Port (Visual) */}
                <div 
                    className="absolute top-[42px] -left-1.5 w-3 h-3 bg-zinc-600 rounded-full border-2 border-zinc-900 shadow-sm z-30" 
                    title="Input" 
                />
            </div>
        );
      })}
    </div>
  );
};