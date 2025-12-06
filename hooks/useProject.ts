
import { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, Property, ToolType, Command } from '../types';
import { INITIAL_PROJECT } from '../constants';
import { audioController } from '../services/audio';
import { Commands } from '../services/commands';
import { executeScript } from '../services/scripting';
import { consoleService } from '../services/console';

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
    const { command, nodeId } = Commands.addNode(type, projectRef.current);
    
    commit(command);

    setProject(p => {
        const next = command.redo(p);
        projectRef.current = next;
        return next;
    });

    return nodeId;
  }, [commit]);

  // Atomic Action: Remove Node
  const removeNode = useCallback((nodeId: string) => {
    // Only attempt remove if node exists
    if (!projectRef.current.nodes[nodeId]) return;

    const command = Commands.removeNode(nodeId, projectRef.current);
    
    commit(command);

    setProject(p => {
        const next = command.redo(p);
        projectRef.current = next;
        return next;
    });
  }, [commit]);

  // Atomic Action: Rename Node
  const renameNode = useCallback((oldId: string, newId: string) => {
    const command = Commands.renameNode(oldId, newId, projectRef.current);
    if (!command) return; // Fail validation

    commit(command);

    setProject(p => {
        const next = command.redo(p);
        projectRef.current = next;
        return next;
    });
  }, [commit]);

  // Atomic Action: Move Node (Reorder)
  const moveNode = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    const command = Commands.reorderNode(fromIndex, toIndex);
    
    commit(command);

    setProject(p => {
        const next = command.redo(p);
        projectRef.current = next;
        return next;
    });
  }, [commit]);

  // --- SCRIPT EXECUTION ---
  
  const runScript = useCallback((code: string) => {
    // Batch Collector
    const batch: Command[] = [];
    
    // Mutable reference to state during script execution (avoiding re-renders)
    let tempState = projectRef.current;
    
    // Interceptor to capture commands generated by the script
    const scriptCommit = (cmd: Command) => {
        batch.push(cmd);
        // Apply the command immediately to the temp state so the next line in the script sees the update
        tempState = cmd.redo(tempState);
        // Important: Update the ref so 'projectGetter' inside the script sees the latest state
        projectRef.current = tempState; 
    };

    // Provide a getter that always returns the latest tempState
    const projectGetter = () => tempState;

    try {
        consoleService.log('info', [`> Running Script...`]);
        executeScript(code, projectGetter, scriptCommit, consoleService);
        
        // If commands were generated, commit them as a single batch
        if (batch.length > 0) {
            const batchCmd = Commands.batch(batch, 'Run Script');
            
            // 1. Update Real React State (One Render)
            setProject(tempState);
            
            // 2. Commit to History
            commit(batchCmd);
            
            consoleService.log('info', [`Script executed. ${batch.length} operations committed.`]);
        } else {
            consoleService.log('info', [`Script executed (No changes made).`]);
        }
    } catch(e: any) {
        consoleService.log('error', [`Script Execution Failed: ${e.message}`]);
        // Revert ref if failed (React state is still safe)
        projectRef.current = project; 
    }
  }, [commit, project]);

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
    setTool,
    runScript
  };
}
