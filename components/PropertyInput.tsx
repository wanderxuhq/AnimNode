
import React, { useState, useEffect, useRef } from 'react';
import { Property, Node, Command } from '../types';
import { Code, Key, Hash, Link as LinkIcon, AlertTriangle } from 'lucide-react';
import { detectLinkCycle } from '../services/engine';
import { consoleService } from '../services/console';

interface PropertyInputProps {
  prop: Property;
  propKey: string;
  nodeId: string;
  nodes: Record<string, Node>;
  onUpdate: (nid: string, pKey: string, u: Partial<Property>) => void;
  onCommit: (cmd: Command) => void;
  autoFocusTrigger?: number; // Timestamp passed to trigger focus
}

export const PropertyInput: React.FC<PropertyInputProps> = ({ prop, propKey, nodeId, nodes, onUpdate, onCommit, autoFocusTrigger }) => {
  // Local state for immediate feedback
  const [localValue, setLocalValue] = useState<string>(String(prop.value));
  const [localExpression, setLocalExpression] = useState<string>(prop.expression);

  // Transaction State Ref: Strictly tracks the start of an edit
  // We use this instead of simple refs because re-renders during editing (e.g. dragging color)
  // can cause us to lose track of the "true" start value if we aren't careful.
  const transactionState = useRef<{
    isActive: boolean;
    initialValue: any;
  }>({ isActive: false, initialValue: null });

  // Refs for auto-focus
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // For link mode
  const [linkTargetNode, setLinkTargetNode] = useState<string>("");
  const [linkTargetProp, setLinkTargetProp] = useState<string>("");
  const [cycleDetected, setCycleDetected] = useState<boolean>(false);

  // --- SYNC PROPS TO LOCAL STATE ---
  useEffect(() => {
    // Only sync if we are NOT in the middle of a transaction (typing/dragging)
    // This prevents cursor jumping and input fighting
    if (!transactionState.current.isActive) {
        setLocalValue(String(prop.value));
    }
    
    // Sync Link State
    if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.includes(':')) {
        const [nid, pid] = prop.value.split(':');
        if (nodes[nid]) {
            setLinkTargetNode(nid);
            setLinkTargetProp(pid);
        }
    }
  }, [prop.value, prop.mode, nodes]); 

  useEffect(() => {
     if (!transactionState.current.isActive) {
         setLocalExpression(prop.expression);
     }
  }, [prop.expression]);


  // --- TRANSACTION MANAGEMENT ---

  const startTransaction = () => {
      if (!transactionState.current.isActive) {
          transactionState.current = {
              isActive: true,
              initialValue: prop.mode === 'code' ? prop.expression : prop.value,
          };
      }
  };

  const endTransaction = (finalValue: any) => {
      if (transactionState.current.isActive) {
          const { initialValue } = transactionState.current;
          
          // Only commit if the value is different
          // We use loose equality for number/string mismatch ("10" == 10)
          if (initialValue != finalValue) {
               onCommit({
                  id: crypto.randomUUID(),
                  name: `Set ${prop.name}`,
                  timestamp: Date.now(),
                  undo: (s) => {
                      const n = s.nodes[nodeId];
                      if(!n) return s;
                      const newValProps = { ...n.properties[propKey], [prop.mode === 'code' ? 'expression' : 'value']: initialValue };
                      return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: newValProps } } } };
                  },
                  redo: (s) => {
                      const n = s.nodes[nodeId];
                      if(!n) return s;
                      const newValProps = { ...n.properties[propKey], [prop.mode === 'code' ? 'expression' : 'value']: finalValue };
                      return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: newValProps } } } };
                  }
              });
          }

          // Reset Transaction
          transactionState.current = { isActive: false, initialValue: null };
      }
  };


  // --- HANDLERS ---

  const handleModeChange = (mode: Property['mode']) => {
    const oldMode = prop.mode;
    if (oldMode === mode) return;

    onUpdate(nodeId, propKey, { mode });
    
    onCommit({
        id: crypto.randomUUID(),
        name: `Change ${prop.name} Mode`,
        timestamp: Date.now(),
        undo: (s) => {
            const n = s.nodes[nodeId];
            if(!n) return s;
             return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: { ...n.properties[propKey], mode: oldMode } } } } };
        },
        redo: (s) => {
            const n = s.nodes[nodeId];
            if(!n) return s;
             return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: { ...n.properties[propKey], mode: mode } } } } };
        }
    });
  };

  const handleFocus = () => {
      startTransaction();
  };

  const handleBlur = () => {
      // Determine strict final value based on type
      let finalVal: any = prop.value;
      
      if (prop.type === 'number') {
          const num = parseFloat(localValue);
          if (!isNaN(num)) {
              finalVal = num;
              // Ensure prop is updated to clean number in global state
              if (finalVal !== prop.value) onUpdate(nodeId, propKey, { value: finalVal });
              setLocalValue(String(finalVal));
          } else {
              // Invalid number, revert to start of transaction
              finalVal = transactionState.current.initialValue ?? prop.value;
              onUpdate(nodeId, propKey, { value: finalVal });
              setLocalValue(String(finalVal));
          }
      } else {
          finalVal = localValue; // String/Color
          if (finalVal !== prop.value) onUpdate(nodeId, propKey, { value: finalVal });
      }

      endTransaction(finalVal);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      startTransaction(); // Ensure started (handles color picker case where focus might be skipped)
      
      const val = e.target.value;
      setLocalValue(val);
      onUpdate(nodeId, propKey, { value: val });
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      startTransaction();
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
      endTransaction(localExpression);
  };

  // Link Handling
  const handleLinkChange = (targetNodeId: string, targetPropId: string) => {
      const oldVal = prop.value;
      const newVal = `${targetNodeId}:${targetPropId}`;
      
      if (targetNodeId && targetPropId) {
          setLinkTargetNode(targetNodeId);
          setLinkTargetProp(targetPropId);
          onUpdate(nodeId, propKey, { value: newVal });

            onCommit({
                id: crypto.randomUUID(),
                name: `Link ${prop.name}`,
                timestamp: Date.now(),
                undo: (s) => {
                    const n = s.nodes[nodeId];
                    if(!n) return s;
                    return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: { ...n.properties[propKey], value: oldVal } } } } };
                },
                redo: (s) => {
                    const n = s.nodes[nodeId];
                    if(!n) return s;
                    return { ...s, nodes: { ...s.nodes, [nodeId]: { ...n, properties: { ...n.properties, [propKey]: { ...n.properties[propKey], value: newVal } } } } };
                }
            });
      }
  };

  // Cycle Detection Logic
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

    // Handle Auto Focus request
    useEffect(() => {
        if (autoFocusTrigger) {
            if (prop.mode === 'code' && textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (prop.mode === 'static' && inputRef.current) {
                inputRef.current.focus();
                inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [autoFocusTrigger, prop.mode]);

  // Insert Ref Helper
  const insertReference = (targetNodeId: string, targetPropKey: string) => {
      startTransaction();
      const snippet = `ctx.get('${targetNodeId}', '${targetPropKey}')`;
      const newVal = localExpression.trimEnd() + (localExpression ? '\n' : '') + snippet;
      setLocalExpression(newVal);
      onUpdate(nodeId, propKey, { expression: newVal });
      if(textareaRef.current) textareaRef.current.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          (e.target as HTMLElement).blur();
      }
  };


  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center group">
        <label className="text-xs text-zinc-400 font-medium group-hover:text-zinc-200 transition-colors">
          {prop.name}
        </label>
        <div className="flex bg-zinc-800 rounded p-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => handleModeChange('static')}
            className={`p-1 rounded ${prop.mode === 'static' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} 
            title="Static Value"
          ><Hash size={12} /></button>
          <button 
             onClick={() => handleModeChange('keyframe')}
            className={`p-1 rounded ${prop.mode === 'keyframe' ? 'bg-yellow-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} 
            title="Keyframes"
          ><Key size={12} /></button>
          <button 
            onClick={() => handleModeChange('link')}
            className={`p-1 rounded ${prop.mode === 'link' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} 
            title="Link to Property"
          ><LinkIcon size={12} /></button>
          <button 
             onClick={() => handleModeChange('code')}
            className={`p-1 rounded ${prop.mode === 'code' ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`} 
            title="Expression/Code"
          ><Code size={12} /></button>
        </div>
      </div>

      {prop.mode === 'static' && (
        <div className="mt-1">
          {prop.type === 'number' && (
            <input 
              ref={inputRef}
              type="text" 
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              value={localValue}
              onChange={handleChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
            />
          )}
           {prop.type === 'color' && (
             <div className="flex gap-2">
                <div className="relative w-8 h-8 rounded overflow-hidden cursor-pointer border border-zinc-700">
                    <input 
                    type="color" 
                    className="absolute -top-2 -left-2 w-16 h-16 p-0 border-0 cursor-pointer"
                    value={String(prop.value)}
                    onChange={handleChange}
                    onClick={startTransaction} // IMPORTANT: Capture start value before picker fully opens
                    onBlur={handleBlur}
                    />
                </div>
                <input 
                ref={inputRef}
                type="text" 
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white font-mono"
                value={String(prop.value)}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                />
             </div>
          )}
          {prop.type === 'string' && (
               <input 
               ref={inputRef}
               type="text" 
               className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
               value={localValue}
               onChange={handleChange}
               onFocus={handleFocus}
               onBlur={handleBlur}
               onKeyDown={handleKeyDown}
             />
          )}
        </div>
      )}

      {prop.mode === 'keyframe' && (
        <div className="p-2 bg-yellow-900/20 border border-yellow-900/30 rounded text-xs text-yellow-500 text-center">
          Value driven by timeline keyframes.
        </div>
      )}

      {prop.mode === 'link' && (
          <div className={`space-y-2 p-2 border rounded ${cycleDetected ? 'bg-red-900/10 border-red-900/50' : 'bg-indigo-900/10 border-indigo-900/30'}`}>
              <select 
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                value={linkTargetNode}
                onChange={(e) => {
                     setLinkTargetNode(e.target.value);
                     setLinkTargetProp(""); 
                }}
              >
                  <option value="">Select Node...</option>
                  {Object.values(nodes).map((n: Node) => (
                      <option key={n.id} value={n.id}>{n.name} ({n.id})</option>
                  ))}
              </select>
              <select 
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none disabled:opacity-50"
                value={linkTargetProp}
                onChange={(e) => handleLinkChange(linkTargetNode, e.target.value)}
                disabled={!linkTargetNode}
              >
                  <option value="">Select Property...</option>
                  {linkTargetNode && nodes[linkTargetNode] && Object.entries(nodes[linkTargetNode].properties).map(([key, rawP]) => {
                      const p = rawP as Property;
                      return (
                      <option key={p.id} value={key}>
                          {p.name}
                      </option>
                  )})}
              </select>
              
              {cycleDetected ? (
                  <div className="flex items-center gap-2 text-red-400 text-[10px] font-bold justify-center pt-1 animate-pulse">
                      <AlertTriangle size={12} />
                      Circular Reference Detected!
                  </div>
              ) : (
                  <div className="text-[10px] text-indigo-400 text-center flex items-center justify-center gap-1">
                      <LinkIcon size={10} />
                      Linked
                  </div>
              )}
          </div>
      )}

      {prop.mode === 'code' && (
        <div className="mt-1 relative space-y-1">
          {cycleDetected && (
             <div className="flex items-center gap-2 p-2 rounded bg-red-900/20 border border-red-900/50 text-red-400 text-[10px] font-bold animate-pulse mb-2">
                 <AlertTriangle size={12} />
                 <span>Circular Reference Detected: Stack Overflow Risk</span>
             </div>
          )}

          <div className="flex gap-2">
             <select 
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-400 focus:outline-none hover:border-zinc-700 cursor-pointer"
                value=""
                onChange={(e) => {
                    const val = e.target.value;
                    if(val) {
                        const [n, p] = val.split(':');
                        insertReference(n, p);
                    }
                }}
             >
                <option value="">+ Insert Reference...</option>
                {Object.values(nodes).map((n: Node) => (
                    <optgroup key={n.id} label={n.name + ` (${n.id})`}>
                        {Object.entries(n.properties).map(([key, p]) => (
                             <option key={p.id} value={`${n.id}:${key}`}>{key}</option>
                        ))}
                    </optgroup>
                ))}
             </select>
          </div>

          <textarea 
            ref={textareaRef}
            className={`w-full h-24 bg-zinc-950 border rounded p-2 text-xs font-mono focus:outline-none resize-none leading-relaxed ${cycleDetected ? 'border-red-900/50 text-red-200' : 'border-blue-900/50 text-blue-200 focus:border-blue-500'}`}
            spellCheck={false}
            value={localExpression}
            onChange={handleCodeChange}
            onFocus={() => { consoleService.startEditing(nodeId, propKey); handleFocus(); }}
            onBlur={handleCodeBlur}
          />
          <div className="flex justify-between text-[10px] text-zinc-500 px-1">
             <span>vars: t, val, ctx</span>
             <span className="text-blue-500 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Live Active
             </span>
          </div>
        </div>
      )}
    </div>
  );
};
