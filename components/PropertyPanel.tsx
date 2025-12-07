

import React, { memo, useState, useEffect } from 'react';
import { Node, Property, Command } from '../types';
import { Terminal, Code2, MonitorPlay, Move, Layers, Pencil, Trash2, Variable } from 'lucide-react';
import { PropertyInput } from './PropertyInput';

interface PropertyPanelProps {
  nodes: Record<string, Node>;
  selection: string | null;
  onUpdateProperty: (nodeId: string, propKey: string, updates: Partial<Property>) => void;
  onCommit: (cmd: Command) => void;
  onRenameNode: (oldId: string, newId: string) => void;
  onDeleteNode: (id: string) => void;
  viewMode: 'ui' | 'json';
  onViewModeChange: (mode: 'ui' | 'json') => void;
  focusTarget?: { nodeId: string; propKey: string; timestamp: number } | null;
}

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scale'];

export const PropertyPanel = memo(({ nodes, selection, onUpdateProperty, onCommit, onRenameNode, onDeleteNode, viewMode, onViewModeChange, focusTarget }: PropertyPanelProps) => {
  const selectedNode = selection ? nodes[selection] : null;
  const [localId, setLocalId] = useState('');

  useEffect(() => {
    if (selectedNode) setLocalId(selectedNode.id);
  }, [selectedNode?.id]);

  if (!selectedNode) {
    return (
      <div className="w-full h-full bg-zinc-900 text-zinc-500 text-sm flex items-center justify-center">
        <span>No node selected</span>
      </div>
    );
  }

  const handleIdBlur = () => {
      if (localId && localId !== selectedNode.id) {
          onRenameNode(selectedNode.id, localId);
      }
  };

  const handleIdKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
      }
  };

  // Group properties
  const allProps = Object.entries(selectedNode.properties);
  
  const transformProps = allProps
    .filter(([key]) => TRANSFORM_KEYS.includes(key))
    .sort((a, b) => TRANSFORM_KEYS.indexOf(a[0]) - TRANSFORM_KEYS.indexOf(b[0])); // Enforce standard order

  const shapeProps = allProps
    .filter(([key]) => !TRANSFORM_KEYS.includes(key));
  
  const isVariable = selectedNode.type === 'value';

  return (
    <div className="w-full bg-zinc-900 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm flex justify-between items-center shrink-0">
        <div className="flex-1 mr-4 overflow-hidden">
             {/* ID Editor */}
            <div className="flex items-center gap-2 mb-1">
                <Terminal size={14} className="text-zinc-400 shrink-0" />
                <input 
                    className="bg-transparent text-sm font-bold text-zinc-100 focus:outline-none focus:bg-zinc-800 rounded px-1 w-full truncate"
                    value={localId}
                    onChange={(e) => setLocalId(e.target.value)}
                    onBlur={handleIdBlur}
                    onKeyDown={handleIdKeyDown}
                    title="Edit Node ID"
                />
            </div>
            
            <div className="flex items-center gap-2">
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-medium">
                    {selectedNode.type}
                </span>
                <button 
                    onClick={() => onDeleteNode(selectedNode.id)}
                    className="p-1 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
                    title="Delete Node (Del)"
                >
                    <Trash2 size={12} />
                </button>
            </div>
        </div>
        
        {/* View Toggle */}
        <div className="flex bg-zinc-800 rounded p-0.5 shrink-0">
            <button 
                onClick={() => onViewModeChange('ui')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'ui' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                title="UI View"
            >
                <MonitorPlay size={14} />
            </button>
             <button 
                onClick={() => onViewModeChange('json')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'json' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                title="Node Source (Code)"
            >
                <Code2 size={14} />
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        {viewMode === 'ui' ? (
            <div className="p-4 space-y-8">
                {isVariable ? (
                    <div className="space-y-3">
                         <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800 pb-1 mb-2">
                             <Variable size={10} />
                             Global Variable
                        </div>
                        <div className="text-xs text-zinc-500 mb-2 italic">
                            This variable can be used in other expressions directly by name: <span className="text-blue-400 font-mono">{selectedNode.id}</span>
                        </div>
                        {allProps.map(([key, prop]) => (
                            <PropertyInput 
                                key={prop.id} 
                                propKey={key} 
                                prop={prop} 
                                nodeId={selectedNode.id} 
                                nodes={nodes}
                                onUpdate={onUpdateProperty}
                                onCommit={onCommit}
                                autoFocusTrigger={focusTarget?.nodeId === selectedNode.id && focusTarget.propKey === key ? focusTarget.timestamp : undefined}
                            />
                        ))}
                    </div>
                ) : (
                    <>
                    {/* Transform Group */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800 pb-1 mb-2">
                            <Move size={10} />
                            Transform
                        </div>
                        <div className="space-y-4">
                            {transformProps.map(([key, prop]) => (
                            <PropertyInput 
                                key={prop.id} 
                                propKey={key}
                                prop={prop} 
                                nodeId={selectedNode.id} 
                                nodes={nodes}
                                onUpdate={onUpdateProperty}
                                onCommit={onCommit}
                                autoFocusTrigger={focusTarget?.nodeId === selectedNode.id && focusTarget.propKey === key ? focusTarget.timestamp : undefined}
                            />
                            ))}
                        </div>
                    </div>

                    {/* Shape Group */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800 pb-1 mb-2">
                            <Layers size={10} />
                            Styles & Shape
                        </div>
                        <div className="space-y-4">
                            {shapeProps.map(([key, prop]) => (
                            <PropertyInput 
                                key={prop.id} 
                                propKey={key} 
                                prop={prop} 
                                nodeId={selectedNode.id} 
                                nodes={nodes}
                                onUpdate={onUpdateProperty}
                                onCommit={onCommit}
                                autoFocusTrigger={focusTarget?.nodeId === selectedNode.id && focusTarget.propKey === key ? focusTarget.timestamp : undefined}
                            />
                            ))}
                        </div>
                    </div>
                    </>
                )}
            </div>
        ) : (
            <div className="flex-col h-full flex">
                <div className="bg-zinc-950 p-2 text-[10px] text-zinc-500 font-mono border-b border-zinc-800 shrink-0">
                    // Direct Node Definition (Read-only view for now)
                </div>
                <textarea 
                    className="flex-1 w-full bg-[#0d1117] text-zinc-300 p-4 font-mono text-xs focus:outline-none resize-none"
                    value={JSON.stringify(selectedNode, null, 2)}
                    readOnly
                />
            </div>
        )}
      </div>
    </div>
  );
});

PropertyPanel.displayName = 'PropertyPanel';