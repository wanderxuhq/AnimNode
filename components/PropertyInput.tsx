import React, { useState, useEffect, useRef } from 'react';
import { Property, Node, Command, PropertyType, Keyframe } from '../types';
import { Code, Hash, Link as LinkIcon, Braces, List, FunctionSquare, Lock, Diamond } from 'lucide-react';
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

export const PropertyInput: React.FC<PropertyInputProps> = ({ prop, propKey, nodeId, nodes, currentTime, onUpdate, onCommit, autoFocusTrigger, onToggleKeyframe }) => {
  // Determine if we are in a visual editing mode based on type
  const isExpression = prop.type === 'expression';
  const isRef = prop.type === 'ref';
  const isStatic = !isExpression && !isRef;
  const nodeType = nodes[nodeId]?.type;
  
  // Special Read-Only Logic for derived paths on Shapes
  const isDerivedPath = propKey === 'path' && (nodeType === 'rect' || nodeType === 'circle');

  // Initialize local state
  const getInitialValue = () => {
      if (isStatic) {
          const v = prop.value;
          if (prop.type === 'object' || prop.type === 'array') {
              try { return JSON.stringify(v, null, 2); } catch { return String(v); }
          }
          if (prop.type === 'function') {
              return v ? v.toString() : '() => {}';
          }
          return String(v);
      }
      return '0';
  };

  const [localValue, setLocalValue] = useState<string>(getInitialValue());
  const [localExpression, setLocalExpression] = useState<string>(isExpression ? String(prop.value) : '');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const isEditingRef = useRef(false);
  const snapshotRef = useRef<Partial<Property> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestState = useRef({ localValue, localExpression, prop, nodeId, propKey, nodes });

  const [linkTargetNode, setLinkTargetNode] = useState<string>("");
  const [linkTargetProp, setLinkTargetProp] = useState<string>("");
  const [cycleDetected, setCycleDetected] = useState<boolean>(false);

  useEffect(() => {
      latestState.current = { localValue, localExpression, prop, nodeId, propKey, nodes };
  }, [localValue, localExpression, prop, nodeId, propKey, nodes]);

  // Sync props to state when not editing
  useEffect(() => {
    if (!isEditingRef.current) {
        if (isDerivedPath) {
             const ctx: any = {
                 project: { nodes }, // minimal project mock
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
             if (isStatic) {
                // If we have keyframes, evaluate the interpolated value for display
                let effectiveValue = prop.value;
                if (prop.keyframes && prop.keyframes.length > 0) {
                     effectiveValue = evaluateProperty(prop, currentTime);
                }
                
                const v = effectiveValue;

                if (prop.type === 'object' || prop.type === 'array') {
                    try { setLocalValue(JSON.stringify(v, null, 2)); } 
                    catch (e) { setLocalValue(String(v)); }
                } else if (prop.type === 'function') {
                    setLocalValue(v ? v.toString() : '() => {}');
                } else {
                    if (typeof v === 'number') setLocalValue(Math.abs(v) < 0.0001 && v !== 0 ? '0' : parseFloat(v.toFixed(3)).toString());
                    else setLocalValue(String(v));
                }
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
  }, [prop, isStatic, isExpression, isRef, nodes, isDerivedPath, currentTime]); 

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
      
      // Handle Commits based on current Type in State
      const currentType = state.prop.type;

      if (currentType === 'expression') {
          newState = { type: 'expression', value: state.localExpression };
          hasChanged = state.localExpression !== oldState.value || oldState.type !== 'expression';

      } else if (currentType === 'ref') {
          newState = { type: 'ref', value: state.prop.value };
          hasChanged = state.prop.value !== oldState.value || oldState.type !== 'ref';
      
      } else {
          // Static Value
          let val: any = state.localValue;
          
          if (currentType === 'number') {
              const parsed = parseFloat(val);
              val = isNaN(parsed) ? (oldState.value ?? 0) : parsed;
          } else if (currentType === 'object' || currentType === 'array') {
              try {
                  val = JSON.parse(state.localValue);
                  setJsonError(null);
              } catch (e) {
                  setJsonError("Invalid JSON");
                  return; // Abort commit
              }
          } else if (currentType === 'boolean') {
              val = (state.localValue === 'true'); // Simple hack, usually updated via buttons
          }
          
          const hasKeyframes = state.prop.keyframes && state.prop.keyframes.length > 0;
          
          if (hasKeyframes) {
              // IMPORTANT: Use keyframes from current state (updated live via auto-key)
              // Do NOT use onToggleKeyframe as that uses current global time which may have shifted
              newState = { 
                  type: currentType, 
                  value: val,
                  keyframes: state.prop.keyframes 
              }; 
              hasChanged = true; 
          } else {
              newState = { type: currentType, value: val };
              const valChanged = JSON.stringify(val) !== JSON.stringify(oldState.value);
              hasChanged = valChanged || oldState.type !== currentType;
          }
      }

      if (hasChanged) {
          consoleService.log('info', [`Commit ${state.propKey}`], { nodeId: state.nodeId, propKey: state.propKey });
          const label = formatLabel(state.propKey);
          
          const command = Commands.set(
              { nodes: state.nodes } as any, 
              state.nodeId,
              state.propKey,
              newState, 
              oldState, 
              `Set ${label}`
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
      
      let content: any = val;
      if (prop.type === 'number') {
          const num = parseFloat(val);
          if (!isNaN(num)) content = num;
      }
      
      if (prop.type !== 'object' && prop.type !== 'array') {
          onUpdate(nodeId, propKey, { type: prop.type, value: content });
      }
      
      if (prop.type === 'object' || prop.type === 'array') {
          try {
             JSON.parse(val);
             setJsonError(null);
          } catch(e) {
             setJsonError("Invalid JSON");
          }
      }
  };

  const handleBlur = () => {
      performCommit();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (isDerivedPath) return; 

      captureSnapshot();
      const val = e.target.value;
      setLocalExpression(val);
      onUpdate(nodeId, propKey, { type: 'expression', value: val });
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
      if (e.key === 'Enter' && !e.shiftKey) {
           if (prop.type !== 'object' && prop.type !== 'array' && prop.type !== 'expression' && prop.type !== 'function') {
               (e.target as HTMLElement).blur();
               return;
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
    } else if (prop.type !== 'ref') {
        newMeta.lastValue = prop.value;
        newMeta.lastType = prop.type;
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
        if (newMeta.lastValue !== undefined && newMeta.lastType === targetType) {
            newVal = newMeta.lastValue;
        } else {
            if (prop.type === 'expression') {
                 if (targetType === 'number') newVal = 0;
                 else if (targetType === 'string' || targetType === 'color') newVal = "";
                 else if (targetType === 'boolean') newVal = false;
                 else if (targetType === 'object' || targetType === 'array') newVal = targetType === 'array' ? [] : {};
            } else {
                 if (targetType === 'number') newVal = Number(prop.value) || 0;
                 else if (targetType === 'string') newVal = String(prop.value);
                 else if (targetType === 'boolean') newVal = Boolean(prop.value);
                 else newVal = prop.value; 
            }
        }
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

  useEffect(() => {
    if (autoFocusTrigger) {
        if ((prop.type === 'expression' || prop.type === 'object' || prop.type === 'array') && textareaRef.current && !isDerivedPath) {
            textareaRef.current.focus();
        } else if (isStatic && inputRef.current && !isDerivedPath) {
            inputRef.current.focus();
        }
    }
  }, [autoFocusTrigger, prop.type, isStatic, isDerivedPath]);

  const getTypeIcon = () => {
      switch(prop.type) {
          case 'object': return <Braces size={12} />;
          case 'array': return <List size={12} />;
          case 'function': return <FunctionSquare size={12} />;
          case 'string': return <span className="font-serif font-bold text-[10px]">Tx</span>;
          case 'boolean': return <span className="font-mono font-bold text-[10px]">T/F</span>;
          default: return <Hash size={12} />;
      }
  };
  
  const getStaticTargetType = (): PropertyType => {
      if (['fill', 'stroke'].includes(propKey)) return 'color';
      if (['path'].includes(propKey)) return 'string';
      return 'number';
  };

  const label = formatLabel(propKey);
  const hasKeyframes = prop.keyframes && prop.keyframes.length > 0;
  
  // Check if we are ON a keyframe at the current time
  const onKeyframe = hasKeyframes && prop.keyframes?.some(k => Math.abs(k.time - currentTime) < 0.05);

  const handleToggleKeyframe = (e: React.MouseEvent) => {
      e.stopPropagation();
      
      // If currently an expression, we must convert to static FIRST
      if (prop.type === 'expression') {
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
            {/* Keyframe Toggle - Now available for all non-derived static props */}
            {!isDerivedPath && (
                <button 
                    onClick={handleToggleKeyframe}
                    className={`p-1 rounded transition-all flex items-center justify-center hover:bg-zinc-800 ${hasKeyframes ? 'text-blue-400' : 'text-zinc-600 hover:text-zinc-300'}`}
                    title={hasKeyframes ? "Add/Remove Keyframe at Current Time" : "Enable Animation (Convert to Keyframes)"}
                >
                    <Diamond size={10} fill={onKeyframe ? "currentColor" : "none"} strokeWidth={2} />
                </button>
            )}
          
          <span className="truncate">{label}</span>
          
          {isDerivedPath ? <Lock size={10} className="text-zinc-600" /> : <span className="text-zinc-600" title={prop.type}>{getTypeIcon()}</span>}
        </label>
        
        {!isDerivedPath && (
            <div className="flex bg-zinc-800 rounded p-0.5 opacity-40 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => handleTypeSwitch(getStaticTargetType())} className={`p-1 rounded ${isStatic ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Static Value"><Hash size={12} /></button>
                <button onClick={() => handleTypeSwitch('ref')} className={`p-1 rounded ${prop.type === 'ref' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Link"><LinkIcon size={12} /></button>
                <button onClick={() => handleTypeSwitch('expression')} className={`p-1 rounded ${prop.type === 'expression' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} title="Code"><Code size={12} /></button>
            </div>
        )}
      </div>

      {/* Render Text Area for Derived Paths (Read Only) */}
      {isDerivedPath && (
          <div className="mt-1">
             <textarea 
                readOnly
                className="w-full bg-zinc-950/50 border border-zinc-800/50 rounded p-2 text-[10px] text-zinc-500 font-mono focus:outline-none resize-none leading-relaxed h-16 cursor-not-allowed"
                value={localValue}
             />
          </div>
      )}

      {/* Standard Static Input */}
      {isStatic && !isDerivedPath && (
        <div className="mt-1 relative">
          {(prop.type === 'number' || prop.type === 'string') && (
            <input 
              ref={inputRef}
              type="text" 
              data-undoable={!isDerivedPath}
              disabled={isDerivedPath}
              className={`w-full bg-zinc-950 border ${onKeyframe ? 'border-blue-500 text-blue-200' : hasKeyframes ? 'border-blue-900/50 text-blue-200' : 'border-zinc-800 text-white'} rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 font-mono ${isDerivedPath ? 'opacity-50 cursor-not-allowed' : ''}`}
              value={localValue}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleInputKeyDown}
            />
          )}
           {prop.type === 'boolean' && (
               <div className="flex gap-2">
                   <button 
                    onClick={() => { captureSnapshot(); onUpdate(nodeId, propKey, {type: 'boolean', value: true}); isEditingRef.current=true; performCommit(); }}
                    className={`flex-1 py-1 text-xs rounded border ${prop.value ? 'bg-indigo-900 border-indigo-700 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-500'} ${hasKeyframes ? 'border-blue-900/50' : ''}`}
                   >
                       TRUE
                   </button>
                   <button 
                    onClick={() => { captureSnapshot(); onUpdate(nodeId, propKey, {type: 'boolean', value: false}); isEditingRef.current=true; performCommit(); }}
                    className={`flex-1 py-1 text-xs rounded border ${!prop.value ? 'bg-indigo-900 border-indigo-700 text-white' : 'bg-zinc-950 border-zinc-800 text-zinc-500'} ${hasKeyframes ? 'border-blue-900/50' : ''}`}
                   >
                       FALSE
                   </button>
               </div>
          )}
          {prop.type === 'color' && (
             <div className="flex gap-2">
                <div className="relative w-8 h-8 rounded overflow-hidden cursor-pointer border border-zinc-700 shrink-0">
                    <input 
                        type="color" 
                        data-undoable="true"
                        className="absolute -top-2 -left-2 w-16 h-16 p-0 border-0 cursor-pointer"
                        value={String(prop.value || '#000000')}
                        onChange={handleChange}
                        onClick={captureSnapshot} 
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                    />
                </div>
                <input 
                    ref={inputRef}
                    type="text" 
                    data-undoable="true"
                    className={`flex-1 bg-zinc-950 border ${hasKeyframes ? 'border-blue-900/50 text-blue-200' : 'border-zinc-800 text-white'} rounded px-2 py-1 text-xs font-mono`}
                    value={localValue}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleInputKeyDown}
                />
             </div>
          )}
          {(prop.type === 'object' || prop.type === 'array') && (
              <div className="relative">
                <textarea 
                    ref={textareaRef}
                    data-undoable="true"
                    className={`w-full bg-zinc-950 border rounded p-2 text-xs font-mono focus:outline-none resize-none leading-relaxed h-24 ${jsonError ? 'border-red-500 focus:border-red-500' : 'border-zinc-800 focus:border-blue-500'}`}
                    value={localValue}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleInputKeyDown}
                    spellCheck={false}
                />
                {jsonError && <div className="absolute top-1 right-2 text-[10px] text-red-500 font-bold">{jsonError}</div>}
              </div>
          )}
        </div>
      )}

      {prop.type === 'ref' && (
          <div className={`space-y-2 p-2 border rounded ${cycleDetected ? 'bg-red-900/10 border-red-900/50' : 'bg-indigo-900/10 border-indigo-900/30'}`}>
              <select 
                data-undoable="true"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                value={linkTargetNode}
                onChange={(e) => { setLinkTargetNode(e.target.value); setLinkTargetProp(""); }}
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
            data-undoable={!isDerivedPath}
            disabled={isDerivedPath}
            className={`w-full h-24 bg-zinc-950 border rounded p-2 text-xs font-mono focus:outline-none resize-none leading-relaxed ${cycleDetected ? 'border-red-900/50 text-red-200' : 'border-blue-900/50 text-blue-200 focus:border-blue-500'} ${isDerivedPath ? 'opacity-60 cursor-not-allowed text-zinc-400' : ''}`}
            spellCheck={false}
            value={localExpression}
            onChange={handleCodeChange}
            onFocus={() => { if(!isDerivedPath) { consoleService.startEditing(nodeId, propKey); handleFocus(); }}}
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