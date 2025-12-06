
import React, { useState, useEffect, useRef } from 'react';
import { Property, Node, Command } from '../types';
import { Code, Key, Hash, Link as LinkIcon, AlertTriangle } from 'lucide-react';
import { detectLinkCycle } from '../services/engine';
import { consoleService } from '../services/console';
import { Commands } from '../services/commands';

interface PropertyInputProps {
  prop: Property;
  propKey: string;
  nodeId: string;
  nodes: Record<string, Node>;
  onUpdate: (nid: string, pKey: string, u: Partial<Property>) => void;
  onCommit: (cmd: Command) => void;
  autoFocusTrigger?: number;
}

export const PropertyInput: React.FC<PropertyInputProps> = ({ prop, propKey, nodeId, nodes, onUpdate, onCommit, autoFocusTrigger }) => {
  // Local state for the input field value (what the user sees)
  const [localValue, setLocalValue] = useState<string>(String(prop.value));
  const [localExpression, setLocalExpression] = useState<string>(prop.expression);

  // Track if we are currently editing (focused/interacting)
  const isEditingRef = useRef(false);
  
  // Store the value AT THE START of the interaction for Undo history
  // For 'code' mode, we store the full partial { mode: 'code', expression: ... }
  // For 'static' mode, we store the full partial { mode: 'static', value: ... }
  // This ensures Commands.set can restore the exact previous state/mode.
  const snapshotRef = useRef<Partial<Property> | null>(null);

  // Refs for auto-focus
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // State for Stale Closure Protection during cleanup/unmount
  const latestState = useRef({ localValue, localExpression, prop, nodeId, propKey, nodes });

  // Link Mode State
  const [linkTargetNode, setLinkTargetNode] = useState<string>("");
  const [linkTargetProp, setLinkTargetProp] = useState<string>("");
  const [cycleDetected, setCycleDetected] = useState<boolean>(false);

  // --- SYNC STATE REFS ---
  useEffect(() => {
      latestState.current = { localValue, localExpression, prop, nodeId, propKey, nodes };
  }, [localValue, localExpression, prop, nodeId, propKey, nodes]);

  // --- SYNC EXTERNAL CHANGES ---
  useEffect(() => {
    if (!isEditingRef.current) {
        setLocalValue(String(prop.value));
        setLocalExpression(prop.expression);
    }
    if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.includes(':')) {
        const [nid, pid] = prop.value.split(':');
        if (nodes[nid]) {
            setLinkTargetNode(nid);
            setLinkTargetProp(pid);
        }
    }
  }, [prop.value, prop.expression, prop.mode, nodes]); 

  // --- HISTORY LOGIC ---

  const captureSnapshot = () => {
      if (!isEditingRef.current) {
          isEditingRef.current = true;
          // IMPORTANT: Capture the FULL state source of truth before edit
          if (snapshotRef.current === null) {
              snapshotRef.current = {
                  mode: prop.mode,
                  value: prop.value,
                  expression: prop.expression
              };
          }
      }
  };

  // Robust Commit Function
  const performCommit = () => {
      const state = latestState.current;
      
      if (!isEditingRef.current) return;

      const oldState = snapshotRef.current ?? { mode: state.prop.mode, value: state.prop.value, expression: state.prop.expression };
      
      let newState: Partial<Property> = {};
      let hasChanged = false;

      if (state.prop.mode === 'static') {
          let val: any = state.localValue;
          if (state.prop.type === 'number') {
              const parsed = parseFloat(val);
              val = isNaN(parsed) ? (oldState.value ?? 0) : parsed;
          }
          newState = { mode: 'static', value: val };
          hasChanged = val != oldState.value || oldState.mode !== 'static';

      } else if (state.prop.mode === 'code') {
          newState = { mode: 'code', expression: state.localExpression };
          hasChanged = state.localExpression !== oldState.expression || oldState.mode !== 'code';

      } else if (state.prop.mode === 'link') {
          newState = { mode: 'link', value: state.prop.value };
          hasChanged = state.prop.value !== oldState.value || oldState.mode !== 'link';
      }

      if (hasChanged) {
          consoleService.log('info', [`Commit ${state.propKey}`], { nodeId: state.nodeId, propKey: state.propKey });
          
          // Use Unified Commands.set
          // We pass explicit partials to avoid ambiguity
          const command = Commands.set(
              // We can't access 'project' directly here easily without prop drilling or context.
              // But Commands.set needs project mainly to lookup node/prop existence and fallback oldState.
              // Since we provide prevInput (oldState), we can pass a dummy or partial project if needed, 
              // BUT 'Commands.set' logic expects 'project.nodes'.
              // We have 'nodes' in props. We can construct a minimal project object.
              { nodes: state.nodes } as any, 
              state.nodeId,
              state.propKey,
              newState, // Input
              oldState, // Prev Input
              `Set ${state.prop.name}`
          );
          
          onCommit(command);
      }

      // Reset
      isEditingRef.current = false;
      snapshotRef.current = null;
  };

  // Unmount Protection
  useEffect(() => {
      return () => {
          if (isEditingRef.current) {
              performCommit();
          }
      };
  }, []);

  // --- HANDLERS ---

  const handleFocus = () => {
      captureSnapshot();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      captureSnapshot();
      const val = e.target.value;
      setLocalValue(val);
      
      let updateVal: any = val;
      if (prop.type === 'number') {
          const num = parseFloat(val);
          if (!isNaN(num)) updateVal = num;
      }
      onUpdate(nodeId, propKey, { value: updateVal });
  };

  const handleBlur = () => {
      if (prop.type === 'number') {
          const num = parseFloat(localValue);
          if (!isNaN(num)) {
              setLocalValue(String(num));
          } else {
              const revertVal = snapshotRef.current?.value ?? prop.value;
              setLocalValue(String(revertVal));
              onUpdate(nodeId, propKey, { value: revertVal });
          }
      }
      performCommit();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      captureSnapshot();
      const val = e.target.value;
      setLocalExpression(val);
      onUpdate(nodeId, propKey, { expression: val });
  };

  const handleCodeBlur = () => {
      consoleService.stopEditing(nodeId, propKey);
      try {
          new Function('t', 'val', 'ctx', 'console', localExpression);
      } catch (e: any) {
          consoleService.log('error', [e.message], { nodeId, propKey });
      }
      performCommit();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          (e.target as HTMLElement).blur();
          return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
           const start = snapshotRef.current;
           if (start) {
               e.preventDefault();
               e.stopPropagation(); 
               // Cancel Edit
               if (prop.mode === 'code') {
                   setLocalExpression(String(start.expression));
                   onUpdate(nodeId, propKey, { expression: start.expression });
               } else {
                   setLocalValue(String(start.value));
                   let val: any = start.value;
                   if (prop.type === 'number') val = parseFloat(String(start.value));
                   onUpdate(nodeId, propKey, { value: val });
               }
           }
      }
  };

  const handleModeChange = (mode: Property['mode']) => {
    const oldMode = prop.mode;
    if (oldMode === mode) return;
    
    const oldState = { mode: oldMode, value: prop.value, expression: prop.expression };
    const newState = { mode: mode };

    onUpdate(nodeId, propKey, { mode });
    
    // Use Unified Commands.set
    onCommit(Commands.set(
        { nodes } as any,
        nodeId, 
        propKey, 
        newState, 
        oldState, 
        `Change ${prop.name} Mode`
    ));
  };

  const handleLinkChange = (targetNodeId: string, targetPropId: string) => {
      const oldState = { mode: prop.mode, value: prop.value };
      const newVal = `${targetNodeId}:${targetPropId}`;
      
      if (targetNodeId && targetPropId) {
          setLinkTargetNode(targetNodeId);
          setLinkTargetProp(targetPropId);
          onUpdate(nodeId, propKey, { value: newVal });
          
          onCommit(Commands.set(
            { nodes } as any,
            nodeId,
            propKey,
            { mode: 'link', value: newVal },
            oldState,
            `Link ${prop.name}`
          ));
      }
  };

  useEffect(() => {
    let isCycle = false;
    if (prop.mode === 'link' && linkTargetNode && linkTargetProp) {
        if (detectLinkCycle(nodes, nodeId, propKey, linkTargetNode, linkTargetProp)) {
            isCycle = true;
        }
    } else if (prop.mode === 'code') {
        const regex = /ctx\.get\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
        let match;
        regex.lastIndex = 0; 
        while ((match = regex.exec(localExpression)) !== null) {
            if (detectLinkCycle(nodes, nodeId, propKey, match[1], match[2])) {
                isCycle = true;
                break;
            }
        }
    }
    setCycleDetected(isCycle);
  }, [linkTargetNode, linkTargetProp, prop.mode, nodeId, propKey, nodes, localExpression]);

  useEffect(() => {
    if (autoFocusTrigger) {
        if (prop.mode === 'code' && textareaRef.current) {
            textareaRef.current.focus();
        } else if (prop.mode === 'static' && inputRef.current) {
            inputRef.current.focus();
        }
    }
  }, [autoFocusTrigger, prop.mode]);

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center group">
        <label className="text-xs text-zinc-400 font-medium group-hover:text-zinc-200 transition-colors select-none">
          {prop.name}
        </label>
        <div className="flex bg-zinc-800 rounded p-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
          <button onClick={() => handleModeChange('static')} className={`p-1 rounded ${prop.mode === 'static' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Static Value"><Hash size={12} /></button>
          <button onClick={() => handleModeChange('keyframe')} className={`p-1 rounded ${prop.mode === 'keyframe' ? 'bg-yellow-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Keyframes"><Key size={12} /></button>
          <button onClick={() => handleModeChange('link')} className={`p-1 rounded ${prop.mode === 'link' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Link"><LinkIcon size={12} /></button>
          <button onClick={() => handleModeChange('code')} className={`p-1 rounded ${prop.mode === 'code' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Code"><Code size={12} /></button>
        </div>
      </div>

      {prop.mode === 'static' && (
        <div className="mt-1">
          {prop.type === 'number' && (
            <input 
              ref={inputRef}
              type="text" 
              data-undoable="true"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              value={localValue}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleInputKeyDown}
            />
          )}
          {prop.type === 'color' && (
             <div className="flex gap-2">
                <div className="relative w-8 h-8 rounded overflow-hidden cursor-pointer border border-zinc-700 shrink-0">
                    <input 
                        type="color" 
                        data-undoable="true"
                        className="absolute -top-2 -left-2 w-16 h-16 p-0 border-0 cursor-pointer"
                        value={String(prop.value)}
                        onChange={handleChange}
                        onClick={captureSnapshot} 
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onKeyDown={handleInputKeyDown}
                    />
                </div>
                <input 
                    ref={inputRef}
                    type="text" 
                    data-undoable="true"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white font-mono"
                    value={localValue}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleInputKeyDown}
                />
             </div>
          )}
          {prop.type === 'string' && (
               <input 
               ref={inputRef}
               type="text" 
               data-undoable="true"
               className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
               value={localValue}
               onChange={handleChange}
               onFocus={handleFocus}
               onBlur={handleBlur}
               onKeyDown={handleInputKeyDown}
             />
          )}
        </div>
      )}

      {prop.mode === 'keyframe' && (
        <div className="p-2 bg-yellow-900/20 border border-yellow-900/30 rounded text-xs text-yellow-500 text-center">
          Timeline Driven
        </div>
      )}

      {prop.mode === 'link' && (
          <div className={`space-y-2 p-2 border rounded ${cycleDetected ? 'bg-red-900/10 border-red-900/50' : 'bg-indigo-900/10 border-indigo-900/30'}`}>
              <select 
                data-undoable="true"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                value={linkTargetNode}
                onChange={(e) => {
                     setLinkTargetNode(e.target.value);
                     setLinkTargetProp(""); 
                }}
              >
                  <option value="">Select Node...</option>
                  {Object.values(nodes).map((n: Node) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
              </select>
              <select 
                data-undoable="true"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none disabled:opacity-50"
                value={linkTargetProp}
                onChange={(e) => handleLinkChange(linkTargetNode, e.target.value)}
                disabled={!linkTargetNode}
              >
                  <option value="">Select Property...</option>
                  {linkTargetNode && nodes[linkTargetNode] && Object.entries(nodes[linkTargetNode].properties).map(([key, rawP]) => {
                      const p = rawP as Property;
                      return <option key={p.id} value={key}>{p.name}</option>;
                  })}
              </select>
              {cycleDetected && <div className="text-red-400 text-[10px] text-center font-bold">Cycle Detected</div>}
          </div>
      )}

      {prop.mode === 'code' && (
        <div className="mt-1 relative space-y-1">
          <textarea 
            ref={textareaRef}
            data-undoable="true"
            className={`w-full h-24 bg-zinc-950 border rounded p-2 text-xs font-mono focus:outline-none resize-none leading-relaxed ${cycleDetected ? 'border-red-900/50 text-red-200' : 'border-blue-900/50 text-blue-200 focus:border-blue-500'}`}
            spellCheck={false}
            value={localExpression}
            onChange={handleCodeChange}
            onFocus={() => { consoleService.startEditing(nodeId, propKey); handleFocus(); }}
            onBlur={handleCodeBlur}
            onKeyDown={handleInputKeyDown}
          />
          <div className="flex justify-between text-[10px] text-zinc-500 px-1">
             <span>vars: t, val, ctx</span>
             <span className="text-blue-500 flex items-center gap-1">Live</span>
          </div>
        </div>
      )}
    </div>
  );
};
