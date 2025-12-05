
import { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, Property, Node, ToolType, Command } from '../types';
import { INITIAL_PROJECT } from '../constants';
import { createNode } from '../services/factory';
import { audioController } from '../services/audio';

export function useProject() {
  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT);
  const projectRef = useRef<ProjectState>(project);

  // --- HISTORY STATE ---
  const [history, setHistory] = useState<{ past: Command[], future: Command[] }>({ past: [], future: [] });
  const historyRef = useRef(history);

  // Sync ref when state changes naturally
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // --- HISTORY ACTIONS ---

  const commit = useCallback((command: Command) => {
      setHistory(prev => {
          // Limit history size to 50 steps
          const newPast = [...prev.past, command];
          if (newPast.length > 50) newPast.shift();
          return {
              past: newPast,
              future: [] // Clear redo stack on new action
          };
      });
  }, []);

  const undo = useCallback(() => {
      const { past, future } = historyRef.current;
      if (past.length === 0) return;

      const command = past[past.length - 1];
      const newPast = past.slice(0, -1);
      const newFuture = [command, ...future];

      setHistory({ past: newPast, future: newFuture });

      // Apply Undo Logic
      setProject(current => {
          const next = command.undo(current);
          projectRef.current = next;
          return next;
      });
  }, []);

  const redo = useCallback(() => {
      const { past, future } = historyRef.current;
      if (future.length === 0) return;

      const command = future[0];
      const newFuture = future.slice(1);
      const newPast = [...past, command];

      setHistory({ past: newPast, future: newFuture });

      // Apply Redo Logic
      setProject(current => {
          const next = command.redo(current);
          projectRef.current = next;
          return next;
      });
  }, []);

  const jumpToHistory = useCallback((index: number) => {
     // Jump to specific state in the past
     const { past } = historyRef.current;
     if (index < 0 || index >= past.length) return;
     
     const stepsToUndo = past.length - 1 - index;
     if (stepsToUndo <= 0) return;

     let tempState = projectRef.current;
     const newFuture = [...historyRef.current.future];
     const newPast = [...past];

     for(let i=0; i<stepsToUndo; i++) {
         const cmd = newPast.pop();
         if (cmd) {
             tempState = cmd.undo(tempState);
             newFuture.unshift(cmd);
         }
     }
     
     setHistory({ past: newPast, future: newFuture });
     setProject(tempState);
     projectRef.current = tempState;
  }, []);

  // --- PROJECT MUTATIONS ---

  // Helper to force update specific metadata without side-effects (No History)
  const updateMeta = useCallback((updates: Partial<ProjectState['meta']>) => {
     setProject(p => {
        const next = { ...p, meta: { ...p.meta, ...updates } };
        projectRef.current = next;
        return next;
     });
  }, []);

  // Real-time update (No History Commit - interactions usually commit on end)
  const updateProperty = useCallback((nodeId: string, propId: string, updates: Partial<Property>) => {
    const current = projectRef.current;
    const node = current.nodes[nodeId];
    if (!node) return;
    
    const prop = node.properties[propId];
    if (!prop) return;

    // Removed optimization check to ensure controlled components receive all updates
    // The previous check blocked redundant updates which are sometimes needed for input masking/resetting

    const nextNodes = {
      ...current.nodes,
      [nodeId]: {
        ...node,
        properties: {
          ...node.properties,
          [propId]: { ...prop, ...updates }
        }
      }
    };

    const nextProject = { ...current, nodes: nextNodes };
    projectRef.current = nextProject;
    setProject(nextProject);
  }, []);

  // Atomic Action: Add Node
  const addNode = useCallback((type: 'rect' | 'circle' | 'vector') => {
    const prev = projectRef.current;
    
    let index = 0;
    let newId = `${type}_${index}`;
    while (prev.nodes[newId]) {
        index++;
        newId = `${type}_${index}`;
    }

    const newNode = createNode(type, newId);
    
    const applyAdd = (p: ProjectState) => ({
        ...p,
        nodes: { ...p.nodes, [newNode.id]: newNode },
        rootNodeIds: [...p.rootNodeIds, newNode.id],
        selection: newNode.id
    });
    
    const applyRemove = (p: ProjectState) => {
        const { [newNode.id]: _, ...remainingNodes } = p.nodes;
        return {
            ...p,
            nodes: remainingNodes,
            rootNodeIds: p.rootNodeIds.filter(id => id !== newNode.id),
            selection: p.selection === newNode.id ? null : p.selection
        };
    };

    commit({
        id: crypto.randomUUID(),
        name: `New ${newNode.name}`,
        timestamp: Date.now(),
        undo: applyRemove,
        redo: applyAdd
    });

    const next = applyAdd(prev);
    projectRef.current = next;
    setProject(next);

    return newNode.id;
  }, [commit]);

  // Atomic Action: Remove Node
  const removeNode = useCallback((nodeId: string) => {
    const prev = projectRef.current;
    const node = prev.nodes[nodeId];
    if (!node) return;

    const originalIndex = prev.rootNodeIds.indexOf(nodeId);

    const performRemove = (s: ProjectState) => {
       const { [nodeId]: _, ...remainingNodes } = s.nodes;
       const newRoots = s.rootNodeIds.filter(id => id !== nodeId);
       return {
           ...s,
           nodes: remainingNodes,
           rootNodeIds: newRoots,
           selection: s.selection === nodeId ? null : s.selection
       };
    };

    const performRestore = (s: ProjectState) => {
        const newRoots = [...s.rootNodeIds];
        // Insert back at original index
        if (originalIndex >= 0 && originalIndex <= newRoots.length) {
            newRoots.splice(originalIndex, 0, nodeId);
        } else {
            newRoots.push(nodeId);
        }

        return {
            ...s,
            nodes: { ...s.nodes, [nodeId]: node },
            rootNodeIds: newRoots,
            selection: nodeId 
        };
    };

    commit({
        id: crypto.randomUUID(),
        name: `Delete ${node.name}`,
        timestamp: Date.now(),
        undo: performRestore,
        redo: performRemove
    });

    const next = performRemove(prev);
    projectRef.current = next;
    setProject(next);
  }, [commit]);

  // Atomic Action: Rename Node
  const renameNode = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    newId = newId.trim();
    if (!newId) return;
    if (projectRef.current.nodes[newId]) return;

    const performRename = (state: ProjectState, fromId: string, toId: string) => {
        const node = state.nodes[fromId];
        if (!node) return state;

        const newNode = { ...node, id: toId };
        
        // 1. Rebuild nodes
        const newNodes: Record<string, Node> = {};
        Object.keys(state.nodes).forEach(key => {
            if (key === fromId) newNodes[toId] = newNode;
            else newNodes[key] = state.nodes[key];
        });

        // 2. Update references in other nodes (links/code)
        Object.values(newNodes).forEach((n: Node) => {
            let propsUpdated = false;
            const newProps = { ...n.properties };
            Object.keys(n.properties).forEach(pKey => {
                const prop = n.properties[pKey];
                // Link
                if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.startsWith(fromId + ':')) {
                    const [, suffix] = prop.value.split(':');
                    newProps[pKey] = { ...prop, value: `${toId}:${suffix}` };
                    propsUpdated = true;
                }
                // Code
                if (prop.mode === 'code') {
                    const regex = new RegExp(`ctx\\.get\\(['"]${fromId}['"]`, 'g');
                    if (regex.test(prop.expression)) {
                        newProps[pKey] = { ...prop, expression: prop.expression.replace(regex, `ctx.get('${toId}'`) };
                        propsUpdated = true;
                    }
                }
            });
            if (propsUpdated) newNodes[n.id] = { ...n, properties: newProps };
        });

        const newRoots = state.rootNodeIds.map(id => id === fromId ? toId : id);
        const newSelection = state.selection === fromId ? toId : state.selection;

        return {
            ...state,
            nodes: newNodes,
            rootNodeIds: newRoots,
            selection: newSelection
        };
    };

    commit({
        id: crypto.randomUUID(),
        name: `Rename ${oldId} -> ${newId}`,
        timestamp: Date.now(),
        undo: (s) => performRename(s, newId, oldId),
        redo: (s) => performRename(s, oldId, newId)
    });

    const next = performRename(projectRef.current, oldId, newId);
    projectRef.current = next;
    setProject(next);
  }, [commit]);

  // Atomic Action: Move Node (Reorder)
  const moveNode = useCallback((fromIndex: number, toIndex: number) => {
    const prev = projectRef.current;
    if (fromIndex === toIndex) return;
    
    // Logic: Remove 'from', then insert at 'to'
    const reorder = (s: ProjectState, from: number, to: number) => {
        const newRoots = [...s.rootNodeIds];
        const [moved] = newRoots.splice(from, 1);
        newRoots.splice(to, 0, moved);
        return { ...s, rootNodeIds: newRoots };
    };

    commit({
        id: crypto.randomUUID(),
        name: `Reorder Node`,
        timestamp: Date.now(),
        undo: (s) => reorder(s, toIndex, fromIndex), // Reverse op is valid if we track final position
        redo: (s) => reorder(s, fromIndex, toIndex)
    });

    const next = reorder(prev, fromIndex, toIndex);
    projectRef.current = next;
    setProject(next);
  }, [commit]);

  const selectNode = useCallback((id: string | null) => {
    setProject(p => {
        const next = { ...p, selection: id };
        projectRef.current = next;
        return next;
    });
  }, []);

  const togglePlay = useCallback(() => {
    setProject(p => {
        const isPlaying = !p.meta.isPlaying;
        if (isPlaying) audioController.play(p.meta.currentTime);
        else audioController.stop();
        const next = { ...p, meta: { ...p.meta, isPlaying } };
        projectRef.current = next;
        return next;
    });
  }, []);

  const setTime = useCallback((time: number) => {
    audioController.stop(); 
    setProject(p => {
        const next = { ...p, meta: { ...p.meta, currentTime: time, isPlaying: false } };
        projectRef.current = next;
        return next;
    });
  }, []);
  
  const setTool = useCallback((tool: ToolType) => {
      setProject(p => {
          const next = { ...p, meta: { ...p.meta, activeTool: tool } };
          projectRef.current = next;
          return next;
      });
  }, []);

  // Animation Loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameId = 0;

    const loop = () => {
      const current = projectRef.current;
      
      if (current.meta.isPlaying) {
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;

        let nextTime = current.meta.currentTime + delta;
        if (nextTime > current.meta.duration) {
            nextTime = 0;
            audioController.play(0);
        }

        const nextProject = {
          ...current,
          meta: { ...current.meta, currentTime: nextTime }
        };

        projectRef.current = nextProject;
        setProject(nextProject);
      } else {
        lastTime = performance.now();
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return {
    project,
    projectRef,
    history,
    commit,
    undo,
    redo,
    jumpToHistory,
    updateProperty,
    updateMeta,
    addNode,
    removeNode,
    renameNode,
    selectNode,
    moveNode,
    togglePlay,
    setTime,
    setTool
  };
}
