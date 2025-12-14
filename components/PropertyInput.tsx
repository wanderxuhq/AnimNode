import React, { useState, useEffect, useRef } from 'react';
import { Property, Node, Command, PropertyType, Keyframe } from '../types';
import { Code, Hash, Link as LinkIcon, Braces, List, FunctionSquare, Lock, Diamond, Type as TypeIcon, ToggleLeft } from 'lucide-react';
import { detectLinkCycle, evaluateProperty } from '../services/engine';
import { consoleService } from '../services/console';
import { Commands } from '../services/commands';

interface PropertyInputProps {
  prop: Property;
  propKey: string;
  nodeId: string;
  nodes: Record<string, Node>;
  currentTime: number;
  onUpdate: (nid: string, pKey: string, u: Partial<Property>) => void;
  onCommit: (cmd: Command) => void;
  autoFocusTrigger?: number;
  onToggleKeyframe: (nid: string, pKey: string, val: any) => void;
}

const formatLabel = (key: string) => {
  const map: Record<string, string> = {
    x: 'X Position',
    y: 'Y Position',
    rotation: 'Rotation',
    scale: 'Scale',
    opacity: 'Opacity',
    width: 'Width',
    height: 'Height',
    radius: 'Radius',
    fill: 'Fill',
    stroke: 'Stroke',
    strokeWidth: 'Stroke Width',
    d: 'Path Data',
    path: 'Path',
    value: 'Value'
  };
  if (map[key]) return map[key];
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
};

const detectSmartType = (input: string, nodes: Record<string, Node>): { type: PropertyType, value: any } => {
    const trimmed = input.trim();
    
    // 1. Variable Reference
    // Checks if input matches a NodeID exactly AND that node is a 'value' type
    if (nodes[trimmed] && nodes[trimmed].type === 'value') {
        return { type: 'ref', value: `${trimmed}:value` };
    }

    // 2. Booleans
    if (trimmed === 'true') return { type: 'boolean', value: true };
    if (trimmed === 'false') return { type: 'boolean', value: false };

    // 3. Numbers (Strict check, ignore empty string)
    if (trimmed !== '' && !isNaN(Number(trimmed))) {
        return { type: 'number', value: Number(trimmed) };
    }

    // 4. Arrays (Start with [ and End with ])
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const arr = JSON.parse(trimmed);
            if (Array.isArray(arr)) return { type: 'array', value: arr };
        } catch (e) {}
    }

    // 5. Objects (Start with { and End with })
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const obj = JSON.parse(trimmed);
            if (typeof obj === 'object') return { type: 'object', value: obj };
        } catch (e) {}
    }

    // 6. Quoted Strings
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return { type: 'string', value: trimmed.slice(1, -1) };
    }

    // Default: Fallback to string (unquoted)
    return { type: 'string', value: trimmed };
};

const formatValueForDisplay = (v: any, type: PropertyType): string => {
    if (type === 'function') return v ? v.toString() : '() => {}';
    if (v === undefined) return '';

    try {
        // Preserve syntax for Objects, Arrays, Booleans, and Strings (add quotes)
        if (type === 'object' || type === 'array' || type === 'boolean' || type === 'string') {
             // JSON.stringify adds quotes to strings, which is what we want for "syntax preservation"
             // It also handles objects/arrays formatting
             return JSON.stringify(v, null, 2);
        }
        
        if (type === 'number') {
            if (isNaN(v)) return 'NaN';
            if (!isFinite(v)) return 'Infinity';
            // JSON stringify is safe for numbers
            return JSON.stringify(v);
        }
    } catch (e) {}
    
    return String(v);
};

export const PropertyInput: React.FC<PropertyInputProps> = ({ prop, propKey, nodeId, nodes, currentTime, onUpdate, onCommit, autoFocusTrigger, onToggleKeyframe }) => {
  const isExpression = prop.type === 'expression';
  const isRef = prop.type === 'ref';
  // "Smart Mode" handles static types (number, string, bool, array, object) via the main input
  const isSmartMode = !isExpression && !isRef; 
  const nodeType = nodes[nodeId]?.type;
  
  // Derived paths (read-only calculation visualization)
  const isDerivedPath = propKey === 'path' && (nodeType === 'rect' || nodeType === 'circle');

  const getInitialValue = () => {
      if (isSmartMode) {
          const v = prop.value;
          return formatValueForDisplay(v, prop.type);
      }
      return '';
  };

  const [localValue, setLocalValue] = useState<string>(getInitialValue());
  const [localExpression, setLocalExpression] = useState<string>(isExpression ? String(prop.value) : '');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const isEditingRef = useRef(false);
  const snapshotRef = useRef<Partial<Property> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const smartInputRef = useRef<HTMLTextAreaElement>(null);
  const latestState = useRef({ localValue, localExpression, prop, nodeId, propKey, nodes });

  const [linkTargetNode, setLinkTargetNode] = useState<string>("");
  const [linkTargetProp, setLinkTargetProp] = useState<string>("");
  const [cycleDetected, setCycleDetected] = useState<boolean>(false);

  useEffect(() => {
      latestState.current = { localValue, localExpression, prop, nodeId, propKey, nodes };
  }, [localValue, localExpression, prop, nodeId, propKey, nodes]);

  // Adjust height of smart input
  useEffect(() => {
      if (smartInputRef.current) {
          smartInputRef.current.style.height = 'auto';
          smartInputRef.current.style.height = (smartInputRef.current.scrollHeight + 2) + 'px';
      }
  }, [localValue, isSmartMode]);

  // Sync props to state when not editing
  useEffect(() => {
    if (!isEditingRef.current) {
        if (isDerivedPath) {
             const ctx: any = {
                 project: { nodes }, 
                 get: (nid: string, pid: string) => {
                     const node = nodes[nid];
                     const p = node?.properties[pid];
                     if (p) return evaluateProperty(p, currentTime, ctx, 1);
                     return 0;
                 }
             };
             const val = evaluateProperty(prop, currentTime, ctx, 0, { nodeId, propKey });
             setLocalValue(String(val));
        } else {
             if (isSmartMode) {
                // If we have keyframes, show current interpolated value
                let effectiveValue = prop.value;
                if (prop.keyframes && prop.keyframes.length > 0) {
                     effectiveValue = evaluateProperty(prop, currentTime);
                }
                
                setLocalValue(formatValueForDisplay(effectiveValue, prop.type));
                setJsonError(null);
            }
            
            if (isExpression) {
                setLocalExpression(String(prop.value));
            }
        }

        if (isRef && String(prop.value).includes(':')) {
             const [nid, pid] = String(prop.value).split(':');
             if (nodes[nid]) {
                setLinkTargetNode(nid);
                setLinkTargetProp(pid);
             }
        }
    }
  }, [prop, isSmartMode, isExpression, isRef, nodes, isDerivedPath, currentTime]); 

  const captureSnapshot = () => {
      if (!isEditingRef.current) {
          isEditingRef.current = true;
          if (snapshotRef.current === null) {
              snapshotRef.current = {
                  type: prop.type,
                  value: prop.value,
                  keyframes: prop.keyframes
              };
          }
      }
  };

  const performCommit = () => {
      const state = latestState.current;
      if (!isEditingRef.current) return;

      const oldState = snapshotRef.current ?? { type: state.prop.type, value: state.prop.value, keyframes: state.prop.keyframes };
      
      let newState: Partial<Property> = {};
      let hasChanged = false;
      let label = `Set ${formatLabel(state.propKey)}`;

      const currentType = state.prop.type;

      if (currentType === 'expression') {
          newState = { type: 'expression', value: state.localExpression };
          hasChanged = state.localExpression !== oldState.value || oldState.type !== 'expression';

      } else if (currentType === 'ref') {
          newState = { type: 'ref', value: state.prop.value };
          hasChanged = state.prop.value !== oldState.value || oldState.type !== 'ref';
      
      } else {
          // SMART MODE COMMIT
          // We analyze the text in localValue to determine type and value
          const detected = detectSmartType(state.localValue, state.nodes);
          
          const hasKeyframes = state.prop.keyframes && state.prop.keyframes.length > 0;
          
          if (hasKeyframes) {
              if (detected.type === 'ref') {
                   // Variable link overrides animation
                   newState = { type: 'ref', value: detected.value, keyframes: [] };
                   label = `Link to ${detected.value}`;
                   hasChanged = true;
              } else {
                   // Ensure type compatibility or cast?
                   // For now, assume number->number. 
                   newState = { type: state.prop.type, value: detected.value, keyframes: state.prop.keyframes };
                   hasChanged = true;
              }
          } else {
              // Static mode: Apply detected type and value
              newState = { type: detected.type, value: detected.value };
              hasChanged = JSON.stringify(detected.value) !== JSON.stringify(oldState.value) || detected.type !== oldState.type;
              
              if (detected.type === 'ref') label = `Link to ${detected.value}`;
          }
      }

      if (hasChanged) {
          const command = Commands.set(
              { nodes: state.nodes } as any, 
              state.nodeId,
              state.propKey,
              newState, 
              oldState, 
              label
          );
          onCommit(command);
      }

      isEditingRef.current = false;
      snapshotRef.current = null;
  };

  useEffect(() => {
      return () => {
          if (isEditingRef.current) {
              performCommit();
          }
      };
  }, []);

  const handleFocus = () => captureSnapshot();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (isDerivedPath) return; 
      
      captureSnapshot();
      const val = e.target.value;
      setLocalValue(val);
  };

  const handleBlur = () => {
      performCommit();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (isDerivedPath) return; 
      captureSnapshot();
      const val = e.target.value;
      setLocalExpression(val);
      // For code, we stream updates to allow live preview
      onUpdate(nodeId, propKey, { type: 'expression', value: val });
  };

  const handleCodeBlur = () => {
      consoleService.stopEditing(nodeId, propKey);
      performCommit();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
           const val = localValue.trim();
           // Allow multiline for objects and arrays or if Shift is pressed
           const isComplex = val.startsWith('{') || val.startsWith('[');
           
           if (!e.shiftKey && !isComplex) {
               e.preventDefault();
               (e.target as HTMLElement).blur(); // Triggers Commit
           }
      }
  };

  const handleTypeSwitch = (targetType: PropertyType) => {
    if (prop.type === targetType) return;
    if (isDerivedPath) return;
    
    const oldState = { type: prop.type, value: prop.value, meta: prop.meta };
    const newMeta = { ...(prop.meta || {}) };

    if (prop.type === 'expression') {
        newMeta.lastExpression = String(prop.value);
    }

    let newVal: any = prop.value;

    if (targetType === 'expression') {
        if (newMeta.lastExpression !== undefined) {
            newVal = newMeta.lastExpression;
        } else {
            const valToWrap = (prop.type !== 'ref' && prop.type !== 'expression') ? prop.value : 0;
            newVal = `return ${JSON.stringify(valToWrap)};`;
        }
    } else if (targetType === 'ref') {
        newVal = ""; 
    } else {
        // Switching to a static type manually
        if (targetType === 'number') newVal = Number(prop.value) || 0;
        else if (targetType === 'string') newVal = String(prop.value);
        else if (targetType === 'boolean') newVal = Boolean(prop.value);
        else newVal = prop.value;
    }
    
    const update = { type: targetType, value: newVal, meta: newMeta };
    onUpdate(nodeId, propKey, update);
    const label = formatLabel(propKey);
    onCommit(Commands.set({ nodes } as any, nodeId, propKey, update, oldState, `Change ${label} Type`));
  };

  const handleLinkChange = (targetNodeId: string, targetPropId: string) => {
      const oldState = { type: prop.type, value: prop.value };
      const newLink = `${targetNodeId}:${targetPropId}`;
      if (targetNodeId && targetPropId) {
          setLinkTargetNode(targetNodeId);
          setLinkTargetProp(targetPropId);
          onUpdate(nodeId, propKey, { type: 'ref', value: newLink });
          const label = formatLabel(propKey);
          onCommit(Commands.set({ nodes } as any, nodeId, propKey, { type: 'ref', value: newLink }, oldState, `Link ${label}`));
      }
  };

  useEffect(() => {
    let isCycle = false;
    if (prop.type === 'ref' && linkTargetNode && linkTargetProp) {
        if (detectLinkCycle(nodes, nodeId, propKey, linkTargetNode, linkTargetProp)) isCycle = true;
    } else if (prop.type === 'expression' && localExpression) {
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
  }, [linkTargetNode, linkTargetProp, prop.type, nodeId, propKey, nodes, localExpression]);

  const getTypeIcon = () => {
      switch(prop.type) {
          case 'object': return <Braces size={12} />;
          case 'array': return <List size={12} />;
          case 'function': return <FunctionSquare size={12} />;
          case 'string': return <TypeIcon size={12} />;
          case 'boolean': return <ToggleLeft size={12} />;
          case 'ref': return <LinkIcon size={12} />;
          case 'expression': return <Code size={12} />;
          default: return <Hash size={12} />;
      }
  };
  
  const hasKeyframes = prop.keyframes && prop.keyframes.length > 0;
  const onKeyframe = hasKeyframes && prop.keyframes?.some(k => Math.abs(k.time - currentTime) < 0.05);

  const handleToggleKeyframe = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (prop.type === 'expression' || prop.type === 'ref') {
         // Convert to static value first
         const ctx: any = {
             project: { nodes },
             get: (nid: string, pid: string) => {
                 const node = nodes[nid];
                 const p = node?.properties[pid];
                 if (p) return evaluateProperty(p, currentTime, ctx, 1);
                 return 0;
             }
         };
         let val = evaluateProperty(prop, currentTime, ctx);
         
         let newType: PropertyType = 'number';
         if (typeof val === 'string') newType = (val.startsWith('#') || val.startsWith('rgb')) ? 'color' : 'string';
         else if (typeof val === 'boolean') newType = 'boolean';
         
         onUpdate(nodeId, propKey, { type: newType, value: val });
         if (onToggleKeyframe) onToggleKeyframe(nodeId, propKey, val);
         return;
      }
      
      if (onToggleKeyframe) onToggleKeyframe(nodeId, propKey, prop.value);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center group">
        <label className="text-xs text-zinc-400 font-medium group-hover:text-zinc-200 transition-colors select-none flex items-center gap-1.5 cursor-default flex-1 truncate mr-2">
            {!isDerivedPath && (
                <button 
                    onClick={handleToggleKeyframe}
                    className={`p-1 rounded transition-all flex items-center justify-center hover:bg-zinc-800 ${hasKeyframes ? 'text-blue-400' : 'text-zinc-600 hover:text-zinc-300'}`}
                    title={hasKeyframes ? "Add/Remove Keyframe" : "Enable Animation"}
                >
                    <Diamond size={10} fill={onKeyframe ? "currentColor" : "none"} strokeWidth={2} />
                </button>
            )}
          
          <span className="truncate">{formatLabel(propKey)}</span>
          
          {/* Detected Type Icon */}
          {!isDerivedPath && <span className="text-zinc-600 ml-1" title={`Current Type: ${prop.type}`}>{getTypeIcon()}</span>}
        </label>
        
        {!isDerivedPath && (
            <div className="flex bg-zinc-800 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {/* Manual Override Buttons if detection isn't enough */}
                <button onClick={() => handleTypeSwitch('number')} className={`p-1 rounded ${isSmartMode ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Smart Input"><Hash size={12} /></button>
                <button onClick={() => handleTypeSwitch('ref')} className={`p-1 rounded ${prop.type === 'ref' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Link"><LinkIcon size={12} /></button>
                <button onClick={() => handleTypeSwitch('expression')} className={`p-1 rounded ${prop.type === 'expression' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Expression"><Code size={12} /></button>
            </div>
        )}
      </div>

      {isDerivedPath && (
          <div className="mt-1">
             <textarea 
                readOnly
                className="w-full bg-zinc-950/50 border border-zinc-800/50 rounded p-2 text-[10px] text-zinc-500 font-mono focus:outline-none resize-none leading-relaxed h-16 cursor-not-allowed"
                value={localValue}
             />
          </div>
      )}

      {/* SMART INPUT for all static types (Multi-line supported) */}
      {isSmartMode && !isDerivedPath && (
        <div className="mt-1 relative">
            <textarea
              ref={smartInputRef}
              data-undoable="true"
              className={`w-full bg-zinc-950 border ${onKeyframe ? 'border-blue-500 text-blue-200' : hasKeyframes ? 'border-blue-900/50 text-blue-200' : 'border-zinc-800 text-white'} rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 font-mono resize-y min-h-[28px] overflow-hidden leading-relaxed`}
              value={localValue}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleInputKeyDown}
              placeholder="Value, Array, Object, or Variable Name..."
              rows={1}
            />
            {prop.type === 'color' && (
                <div className="absolute right-1 top-2 w-4 h-4 rounded border border-zinc-700 cursor-pointer overflow-hidden">
                    <input 
                        type="color" 
                        className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer opacity-0"
                        value={String(prop.value).startsWith('#') ? String(prop.value) : '#000000'}
                        onChange={(e) => {
                            captureSnapshot();
                            onUpdate(nodeId, propKey, { type: 'color', value: e.target.value });
                            isEditingRef.current = true;
                            performCommit();
                        }}
                    />
                    <div className="w-full h-full" style={{ backgroundColor: String(prop.value) }} />
                </div>
            )}
        </div>
      )}

      {/* Manual Reference UI (Fallback if they manually switch to Link mode or want dropdowns) */}
      {prop.type === 'ref' && (
          <div className={`space-y-2 p-2 border rounded ${cycleDetected ? 'bg-red-900/10 border-red-900/50' : 'bg-indigo-900/10 border-indigo-900/30'}`}>
              <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase">Linked</span>
                  {/* Allow switching back to smart input easily */}
                  <button onClick={() => handleTypeSwitch('number')} className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300 underline">Unlink</button>
              </div>
              <select 
                data-undoable="true"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                value={linkTargetNode}
                onChange={(e) => { 
                    const val = e.target.value;
                    setLinkTargetNode(val);
                    // Auto-link variable value if a Variable node is selected
                    if (nodes[val] && nodes[val].type === 'value') {
                        setLinkTargetProp("value");
                        handleLinkChange(val, "value");
                    } else {
                        setLinkTargetProp(""); 
                    }
                }}
              >
                  <option value="">Select Node...</option>
                  {Object.values(nodes).map((n: Node) => <option key={n.id} value={n.id}>{n.id}</option>)}
              </select>
              <select 
                data-undoable="true"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none disabled:opacity-50"
                value={linkTargetProp}
                onChange={(e) => handleLinkChange(linkTargetNode, e.target.value)}
                disabled={!linkTargetNode}
              >
                  <option value="">Select Property...</option>
                  {linkTargetNode && nodes[linkTargetNode] && Object.entries(nodes[linkTargetNode].properties).map(([key, p]) => (
                      <option key={key} value={key}>{formatLabel(key)}</option>
                  ))}
              </select>
              {cycleDetected && <div className="text-red-400 text-[10px] text-center font-bold">Cycle Detected</div>}
          </div>
      )}

      {prop.type === 'expression' && !isDerivedPath && (
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
             <span>vars: t, val, ctx, [variables]</span>
             <span className="text-blue-500 flex items-center gap-1">Live</span>
          </div>
        </div>
      )}
    </div>
  );
};