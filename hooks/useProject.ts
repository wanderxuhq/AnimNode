
import { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, Property, Node, ToolType } from '../types';
import { INITIAL_PROJECT } from '../constants';
import { createNode } from '../services/factory';
import { audioController } from '../services/audio';

export function useProject() {
  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT);
  const projectRef = useRef<ProjectState>(project);

  // Sync ref when state changes naturally
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Helper to force update specific metadata without side-effects
  const updateMeta = useCallback((updates: Partial<ProjectState['meta']>) => {
     setProject(p => {
        const next = { ...p, meta: { ...p.meta, ...updates } };
        projectRef.current = next;
        return next;
     });
  }, []);

  const updateProperty = useCallback((nodeId: string, propId: string, updates: Partial<Property>) => {
    const current = projectRef.current;
    const node = current.nodes[nodeId];
    if (!node) return;
    
    const prop = node.properties[propId];
    if (!prop) return;

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

  const addNode = useCallback((type: 'rect' | 'circle' | 'vector') => {
    const prev = projectRef.current;
    
    // Generate a friendly, unique ID (e.g., rect_0, rect_1)
    let index = 0;
    let newId = `${type}_${index}`;
    while (prev.nodes[newId]) {
        index++;
        newId = `${type}_${index}`;
    }

    const newNode = createNode(type, newId);
    
    // Create new state
    const next = {
        ...prev,
        nodes: { ...prev.nodes, [newNode.id]: newNode },
        rootNodeIds: [...prev.rootNodeIds, newNode.id],
        selection: newNode.id
    };

    // Update Ref synchronously so callers can use the new data immediately
    projectRef.current = next;
    
    // Trigger Render
    setProject(next);

    return newNode.id;
  }, []);

  const renameNode = useCallback((oldId: string, newId: string) => {
    if (oldId === newId) return;
    
    // Normalize newId to ensure no accidental spaces
    newId = newId.trim();
    if (!newId) return;

    const current = projectRef.current;
    if (current.nodes[newId]) {
        // ID Collision check
        return; 
    }

    const node = current.nodes[oldId];
    if (!node) return;

    // 1. Create new node with new ID
    const newNode = { ...node, id: newId };
    
    // 2. Rebuild nodes map with the renamed node
    const newNodes: Record<string, Node> = {};
    Object.keys(current.nodes).forEach(key => {
        if (key === oldId) {
            newNodes[newId] = newNode;
        } else {
            newNodes[key] = current.nodes[key];
        }
    });

    // 3. Update references in all other nodes (Links and Code)
    Object.values(newNodes).forEach((n: Node) => {
        // We need to check if properties were updated
        let propsUpdated = false;
        const newProps = { ...n.properties };

        Object.keys(n.properties).forEach(pKey => {
             const prop = n.properties[pKey];
             
             // Update Links: "oldId:prop" -> "newId:prop"
             if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.startsWith(oldId + ':')) {
                 const [, suffix] = prop.value.split(':');
                 newProps[pKey] = { ...prop, value: `${newId}:${suffix}` };
                 propsUpdated = true;
             }
             
             // Update Code: ctx.get('oldId', ...) -> ctx.get('newId', ...)
             if (prop.mode === 'code') {
                 // Regex looks for ctx.get('oldId' or ctx.get("oldId"
                 const regex = new RegExp(`ctx\\.get\\(['"]${oldId}['"]`, 'g');
                 if (regex.test(prop.expression)) {
                     const newExpr = prop.expression.replace(regex, `ctx.get('${newId}'`);
                     newProps[pKey] = { ...prop, expression: newExpr };
                     propsUpdated = true;
                 }
             }
        });

        if (propsUpdated) {
            newNodes[n.id] = { ...n, properties: newProps };
        }
    });

    // 4. Update rootNodeIds
    const newRoots = current.rootNodeIds.map(id => id === oldId ? newId : id);
    
    // 5. Update selection
    const newSelection = current.selection === oldId ? newId : current.selection;

    const nextProject = {
        ...current,
        nodes: newNodes,
        rootNodeIds: newRoots,
        selection: newSelection
    };
    
    projectRef.current = nextProject;
    setProject(nextProject);
  }, []);

  const selectNode = useCallback((id: string | null) => {
    setProject(p => {
        const next = { ...p, selection: id };
        projectRef.current = next;
        return next;
    });
  }, []);

  const moveNode = useCallback((fromIndex: number, toIndex: number) => {
    setProject(p => {
        if (fromIndex === toIndex) return p;
        if (fromIndex < 0 || fromIndex >= p.rootNodeIds.length || toIndex < 0 || toIndex >= p.rootNodeIds.length) return p;

        const newRoots = [...p.rootNodeIds];
        const [moved] = newRoots.splice(fromIndex, 1);
        newRoots.splice(toIndex, 0, moved);
        
        const next = { ...p, rootNodeIds: newRoots };
        projectRef.current = next;
        return next;
    });
  }, []);

  const togglePlay = useCallback(() => {
    setProject(p => {
        const isPlaying = !p.meta.isPlaying;
        
        // Audio Sync
        if (isPlaying) {
            audioController.play(p.meta.currentTime);
        } else {
            audioController.stop();
        }

        const next = { ...p, meta: { ...p.meta, isPlaying } };
        projectRef.current = next;
        return next;
    });
  }, []);

  const setTime = useCallback((time: number) => {
    audioController.stop(); // Stop audio when scrubbing
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
            // Loop audio if needed
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
    updateProperty,
    updateMeta,
    addNode,
    renameNode,
    selectNode,
    moveNode,
    togglePlay,
    setTime,
    setTool
  };
}
