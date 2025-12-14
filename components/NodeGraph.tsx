import React, { useRef, useState, useMemo, useEffect } from 'react';
import { ProjectState, Property, Command, Node } from '../types';
import { Code2, Circle as CircleIcon, Square, Type, Plus, X } from 'lucide-react';
import { Commands } from '../services/commands';

interface NodeGraphProps {
  project: ProjectState;
  onSelect: (id: string, mode?: 'ui' | 'json') => void;
  onCommit: (cmd: Command) => void;
  onAddNode: (type: 'rect' | 'circle' | 'vector' | 'value') => string;
}

const HEADER_HEIGHT = 40;
const PROP_ROW_HEIGHT = 28;
const NODE_WIDTH = 240;

// Colors
const COLOR_EXPR = '#4ade80'; // Green-400
const COLOR_REF = '#c084fc'; // Purple-400
const COLOR_WIRE_Default = '#71717a'; // Zinc-500
const COLOR_WIRE_ACTIVE = '#fbbf24'; // Amber-400
const COLOR_PORT = '#52525b'; // Zinc-600
const COLOR_PORT_HOVER = '#e4e4e7'; // Zinc-200

export const NodeGraph: React.FC<NodeGraphProps> = ({ project, onSelect, onCommit, onAddNode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Viewport Transform
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Node Dragging
  const [draggingNode, setDraggingNode] = useState<{ id: string, startX: number, startY: number } | null>(null);
  const [tempPositions, setTempPositions] = useState<Record<string, {x:number, y:number}>>({});
  
  // Wire Connection
  // sourceKey is required now because we connect Property -> Property
  const [connecting, setConnecting] = useState<{ sourceNodeId: string, sourceKey: string, mouseX: number, mouseY: number } | null>(null);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, graphX: number, graphY: number } | null>(null);

  // Helper: Get Node Position (Logic or Temp UI)
  const getNodePos = (id: string) => {
      const temp = tempPositions[id];
      if (temp) return temp;
      const node = project.nodes[id];
      return node?.ui || { x: 0, y: 0 };
  };

  // --- EVENTS ---

  const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
          const zoomSensitivity = 0.001;
          const delta = -e.deltaY * zoomSensitivity;
          const newScale = Math.min(Math.max(transform.k * (1 + delta), 0.1), 2);
          
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          const gx = (mouseX - transform.x) / transform.k;
          const gy = (mouseY - transform.y) / transform.k;
          
          const newX = mouseX - gx * newScale;
          const newY = mouseY - gy * newScale;
          
          setTransform({ x: newX, y: newY, k: newScale });
      } else {
          setTransform(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
      setContextMenu(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      // Middle Click or Alt+Click
      if (e.button === 1 || e.altKey) {
          setIsPanning(true);
          lastMouse.current = { x: e.clientX, y: e.clientY };
          e.preventDefault();
      } else if (e.button === 0) {
           setContextMenu(null);
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isPanning) {
          const dx = e.clientX - lastMouse.current.x;
          const dy = e.clientY - lastMouse.current.y;
          setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          lastMouse.current = { x: e.clientX, y: e.clientY };
      }

      if (draggingNode) {
          const scale = transform.k;
          const dx = e.movementX / scale;
          const dy = e.movementY / scale;
          
          const nodeEl = document.getElementById(`node-${draggingNode.id}`);
          if (nodeEl) {
               const currentX = parseFloat(nodeEl.dataset.x || '0');
               const currentY = parseFloat(nodeEl.dataset.y || '0');
               const newX = currentX + dx;
               const newY = currentY + dy;
               
               // Direct DOM update for performance
               nodeEl.style.transform = `translate(${newX}px, ${newY}px)`;
               nodeEl.dataset.x = String(newX);
               nodeEl.dataset.y = String(newY);
               
               // React State update for Wires
               setTempPositions(prev => ({
                   ...prev,
                   [draggingNode.id]: { x: newX, y: newY }
               }));
          }
      }

      if (connecting) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const gx = (e.clientX - rect.left - transform.x) / transform.k;
            const gy = (e.clientY - rect.top - transform.y) / transform.k;
            setConnecting(prev => prev ? { ...prev, mouseX: gx, mouseY: gy } : null);
        }
      }
  };

  const handleMouseUp = () => {
      setIsPanning(false);
      
      if (draggingNode) {
          const finalPos = tempPositions[draggingNode.id];
          if (finalPos) {
             const node = project.nodes[draggingNode.id];
             if (node) {
                 const originalPos = node.ui || { x: 0, y: 0 };
                 if (Math.abs(finalPos.x - originalPos.x) > 1 || Math.abs(finalPos.y - originalPos.y) > 1) {
                     onCommit(Commands.updateNodeUi(draggingNode.id, originalPos, finalPos));
                 }
             }
          }
          setDraggingNode(null);
          setTempPositions({});
      }

      if (connecting) {
          setConnecting(null);
      }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const gx = (mouseX - transform.x) / transform.k;
      const gy = (mouseY - transform.y) / transform.k;

      setContextMenu({ x: e.clientX, y: e.clientY, graphX: gx, graphY: gy });
  };

  const handleAddFromMenu = (type: 'rect' | 'circle' | 'vector' | 'value') => {
      if (!contextMenu) return;
      const newId = onAddNode(type);
      // Move to cursor position
      setTimeout(() => {
          onCommit(Commands.updateNodeUi(newId, {x:0, y:0}, { x: contextMenu.graphX - NODE_WIDTH/2, y: contextMenu.graphY }));
      }, 0);
      
      setContextMenu(null);
  };

  // --- WIRING LOGIC ---

  // Calculate the absolute coordinate of a specific port (Input or Output)
  const getPortPosition = (nodeId: string, propKey: string, isInput: boolean) => {
      const pos = getNodePos(nodeId);
      const node = project.nodes[nodeId];
      if (!node) return { x: 0, y: 0 };
      
      const index = Object.keys(node.properties).indexOf(propKey);
      if (index === -1) return { x: 0, y: 0 };

      // Geometry constants
      const y = pos.y + HEADER_HEIGHT + (index * PROP_ROW_HEIGHT) + (PROP_ROW_HEIGHT / 2);
      const x = isInput ? pos.x : pos.x + NODE_WIDTH;

      return { x, y };
  };

  const wires = useMemo(() => {
      const list: { fromId: string, fromKey: string, toId: string, toKey: string, type: 'ref' | 'expr' }[] = [];
      
      project.rootNodeIds.forEach(targetId => {
          const node = project.nodes[targetId];
          if (!node) return;
          
          Object.entries(node.properties).forEach(([targetKey, prop]: [string, Property]) => {
              if (prop.type === 'ref') {
                  const val = String(prop.value);
                  if (val.includes(':')) {
                      const [sourceId, sourceKey] = val.split(':');
                      if (project.nodes[sourceId]) {
                          list.push({ fromId: sourceId, fromKey: sourceKey, toId: targetId, toKey: targetKey, type: 'ref' });
                      }
                  }
              } else if (prop.type === 'expression') {
                  // Naive parsing for visual wires in expressions
                  const expr = String(prop.value);
                  const regex = /ctx\.get\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
                  let match;
                  while ((match = regex.exec(expr)) !== null) {
                      const sourceId = match[1];
                      const sourceKey = match[2];
                      if (project.nodes[sourceId]) {
                          list.push({ fromId: sourceId, fromKey: sourceKey, toId: targetId, toKey: targetKey, type: 'expr' });
                      }
                  }
                  // Check direct variable usage
                   Object.values(project.nodes).forEach((n: Node) => {
                        if (n.type === 'value') {
                             const varRegex = new RegExp(`\\b${n.id}\\b`);
                             if (varRegex.test(expr)) {
                                 // Variable usually connects from 'value'
                                 list.push({ fromId: n.id, fromKey: 'value', toId: targetId, toKey: targetKey, type: 'expr' });
                             }
                        }
                   });
              }
          });
      });
      return list;
  }, [project.nodes, project.rootNodeIds]);

  const handleOutputMouseDown = (e: React.MouseEvent, sourceId: string, sourceKey: string) => {
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if(rect) {
          setConnecting({ 
              sourceNodeId: sourceId, 
              sourceKey: sourceKey,
              mouseX: (e.clientX - rect.left - transform.x)/transform.k, 
              mouseY: (e.clientY - rect.top - transform.y)/transform.k
          });
      }
  };

  const handleInputMouseUp = (e: React.MouseEvent, targetId: string, targetKey: string) => {
      e.stopPropagation();
      if (connecting) {
          const { sourceNodeId, sourceKey } = connecting;
          if (sourceNodeId === targetId) return; // No self connect logic for now
          
          const targetNode = project.nodes[targetId] as Node;
          const oldProp = targetNode.properties[targetKey] as Property;
          
          // Construct Reference: "NodeID:PropKey"
          const newVal = `${sourceNodeId}:${sourceKey}`;
          
          const update = { type: 'ref' as const, value: newVal };
          const prev = { type: oldProp.type, value: oldProp.value, keyframes: oldProp.keyframes };
          
          onCommit(Commands.set(project, targetId, targetKey, update, prev, `Link ${targetId}.${targetKey}`));
          setConnecting(null);
      }
  };

  const renderWirePath = (x1: number, y1: number, x2: number, y2: number) => {
      const dist = Math.abs(x1 - x2);
      const cp1x = x1 + dist * 0.5;
      const cp2x = x2 - dist * 0.5;
      return `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div 
        ref={containerRef}
        className="flex-1 bg-zinc-950 relative overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
    >
        {/* Infinite Grid */}
        <div 
            className="absolute inset-0 pointer-events-none"
            style={{
                backgroundImage: `
                    linear-gradient(to right, #27272a 1px, transparent 1px),
                    linear-gradient(to bottom, #27272a 1px, transparent 1px)
                `,
                backgroundSize: `${20 * transform.k}px ${20 * transform.k}px`,
                backgroundPosition: `${transform.x}px ${transform.y}px`,
                opacity: 0.4
            }}
        />
        
        {/* World Container */}
        <div 
            className="absolute top-0 left-0 origin-top-left will-change-transform"
            style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}
        >
            {/* Layer 1: Wires */}
            <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" style={{ width: 1, height: 1 }}>
                {wires.map((wire, i) => {
                    const start = getPortPosition(wire.fromId, wire.fromKey, false);
                    const end = getPortPosition(wire.toId, wire.toKey, true);
                    
                    if (start.x === 0 || end.x === 0) return null;
                    
                    return (
                        <path 
                            key={i}
                            d={renderWirePath(start.x, start.y, end.x, end.y)}
                            fill="none"
                            stroke={wire.type === 'expr' ? COLOR_EXPR : COLOR_REF}
                            strokeWidth={2}
                            opacity={0.8}
                        />
                    );
                })}
                
                {connecting && (
                    <path 
                        d={renderWirePath(
                            getPortPosition(connecting.sourceNodeId, connecting.sourceKey, false).x, 
                            getPortPosition(connecting.sourceNodeId, connecting.sourceKey, false).y, 
                            connecting.mouseX,
                            connecting.mouseY
                        )}
                        fill="none"
                        stroke={COLOR_WIRE_ACTIVE}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        className="animate-pulse"
                    />
                )}
            </svg>

            {/* Layer 2: Nodes */}
            {project.rootNodeIds.map(id => {
                const node = project.nodes[id] as Node;
                const pos = tempPositions[id] || node.ui || { x: 0, y: 0 };
                const isSelected = project.selection === id;
                
                return (
                    <div
                        key={id}
                        id={`node-${id}`}
                        data-x={pos.x}
                        data-y={pos.y}
                        className={`absolute rounded-lg shadow-xl border w-[240px] flex flex-col bg-zinc-900 transition-shadow ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-zinc-700'}`}
                        style={{ 
                            transform: `translate(${pos.x}px, ${pos.y}px)`,
                            width: NODE_WIDTH 
                        }}
                        onMouseDown={(e) => e.stopPropagation()} 
                    >
                        {/* Header */}
                        <div 
                            className={`h-[40px] px-3 flex items-center gap-2 border-b border-zinc-700 rounded-t-lg cursor-grab active:cursor-grabbing ${isSelected ? 'bg-indigo-900/30' : 'bg-zinc-800'}`}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                onSelect(id, 'ui');
                                setDraggingNode({ id, startX: e.clientX, startY: e.clientY });
                            }}
                        >
                             {node.type === 'value' ? <Type size={14} className="text-blue-400" /> : 
                              node.type === 'rect' ? <Square size={14} className="text-blue-500" /> : 
                              <CircleIcon size={14} className="text-pink-500" />}
                             <span className="truncate font-bold text-xs text-zinc-200 flex-1">{id}</span>
                        </div>

                        {/* Properties */}
                        <div className="py-2 bg-zinc-900/95 rounded-b-lg relative">
                            {Object.entries(node.properties).slice(0, 15).map(([key, prop]: [string, Property]) => {
                                const isRef = prop.type === 'ref';
                                const isExpr = prop.type === 'expression';
                                
                                return (
                                    <div key={key} className="h-[28px] px-0 flex items-center relative group">
                                         
                                         {/* INPUT PORT (Left) */}
                                         <div className="w-4 h-full flex items-center justify-center relative">
                                            <div 
                                                className={`w-3 h-3 rounded-full border border-zinc-800 cursor-pointer transition-colors hover:scale-125 z-10 ${isRef ? 'bg-purple-500' : isExpr ? 'bg-green-500' : 'bg-zinc-700 hover:bg-zinc-400'}`}
                                                onMouseUp={(e) => handleInputMouseUp(e, id, key)}
                                                title={`Input: ${key}`}
                                            >
                                                <div className="w-1 h-1 bg-black/50 rounded-full absolute top-1 left-1 pointer-events-none" />
                                            </div>
                                         </div>

                                         <div className="flex-1 flex justify-between items-center text-[10px] px-2 overflow-hidden">
                                             <span className="text-zinc-400 font-medium truncate mr-2">{key}</span>
                                             <span className={`font-mono truncate text-right opacity-70 ${isRef ? 'text-purple-400' : isExpr ? 'text-green-400' : 'text-zinc-500'}`}>
                                                 {isRef ? 'LINK' : isExpr ? 'EXPR' : String(prop.value).substring(0, 10)}
                                             </span>
                                         </div>

                                         {/* OUTPUT PORT (Right) */}
                                         <div className="w-4 h-full flex items-center justify-center relative">
                                             <div 
                                                className="w-3 h-3 rounded-full border border-zinc-800 bg-zinc-700 hover:bg-zinc-400 cursor-crosshair transition-colors hover:scale-125 z-10"
                                                onMouseDown={(e) => handleOutputMouseDown(e, id, key)}
                                                title={`Output: ${key}`}
                                             />
                                         </div>
                                    </div>
                                );
                            })}
                             {Object.keys(node.properties).length > 15 && (
                                <div className="px-3 text-[9px] text-zinc-600 italic pb-1 text-center">...</div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>

        {/* Context Menu */}
        {contextMenu && (
            <div 
                className="fixed bg-zinc-800 border border-zinc-700 shadow-xl rounded-lg p-1 min-w-[120px] z-50 flex flex-col gap-1"
                style={{ top: contextMenu.y, left: contextMenu.x }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-700 mb-1">
                    Add Node
                </div>
                <button className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 rounded text-left" onClick={() => handleAddFromMenu('rect')}>
                    <Square size={14} className="text-blue-500"/> Rectangle
                </button>
                <button className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 rounded text-left" onClick={() => handleAddFromMenu('circle')}>
                    <CircleIcon size={14} className="text-pink-500"/> Circle
                </button>
                <button className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 rounded text-left" onClick={() => handleAddFromMenu('value')}>
                    <Type size={14} className="text-blue-400"/> Variable
                </button>
            </div>
        )}

        {/* Legend / Status */}
        <div className="absolute bottom-4 left-4 flex gap-4 text-[10px] font-mono bg-black/50 p-2 rounded backdrop-blur border border-zinc-800 pointer-events-none">
             <div className="flex items-center gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-purple-400" />
                 <span className="text-zinc-300">Link</span>
             </div>
             <div className="flex items-center gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-green-400" />
                 <span className="text-zinc-300">Expression</span>
             </div>
             <div className="text-zinc-500 border-l border-zinc-700 pl-4">
                 Right Click to Add. Drag Port to Connect. Middle Click Pan.
             </div>
        </div>
    </div>
  );
};