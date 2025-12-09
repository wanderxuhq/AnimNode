import { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, Property, ToolType, Command, Keyframe } from '../types';
import { INITIAL_PROJECT } from '../constants';
import { audioController } from '../services/audio';
import { Commands } from '../services/commands';
import { executeScript } from '../services/scripting';
import { consoleService } from '../services/console';

export function useProject() {
  const [project, setProject] = useState<ProjectState>(INITIAL_PROJECT);
  const projectRef = useRef<ProjectState>(project);

  // --- TIME ANCHOR ---
  // Stores the reference point for absolute time calculation
  // startWallTime: The performance.now() timestamp when playback started
  // startProjectTime: The project.meta.currentTime when playback started
  const timeAnchorRef = useRef<{ startWallTime: number, startProjectTime: number }>({ startWallTime: 0, startProjectTime: 0 });

  // --- HISTORY STATE ---
  const [history, setHistory] = useState<{ past: Command[], future: Command[] }>({ past: [], future: [] });
  const historyRef = useRef(history);

  // Sync ref when state changes naturally via React render cycle
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  
  useEffect(() => {
      historyRef.current = history;
  }, [history]);

  // --- PLAYBACK LOOP ---
  useEffect(() => {
      let rAF: number;
      
      const loop = (timestamp: number) => {
          if (projectRef.current.meta.isPlaying) {
              const { startWallTime, startProjectTime } = timeAnchorRef.current;
              // Calculate delta in seconds
              const deltaSeconds = (timestamp - startWallTime) / 1000;
              let newTime = startProjectTime + deltaSeconds;
              
              if (newTime >= projectRef.current.meta.duration) {
                  newTime = 0;
                  // Loop
                  timeAnchorRef.current = { startWallTime: timestamp, startProjectTime: 0 };
              }
              
              setProject(prev => ({
                  ...prev,
                  meta: { ...prev.meta, currentTime: newTime }
              }));
          }
          rAF = requestAnimationFrame(loop);
      };
      rAF = requestAnimationFrame(loop);
      
      return () => cancelAnimationFrame(rAF);
  }, []);

  const setTime = useCallback((t: number) => {
      // Clamp time
      const time = Math.max(0, Math.min(t, projectRef.current.meta.duration));
      
      setProject(prev => {
          // If playing, we need to reset the anchor so playback continues smoothly from the NEW time
          if (prev.meta.isPlaying) {
             timeAnchorRef.current = { startWallTime: performance.now(), startProjectTime: time };
          }
          return {
            ...prev,
            meta: { ...prev.meta, currentTime: time }
          };
      });
  }, []);

  const togglePlay = useCallback(() => {
      setProject(prev => {
          const willPlay = !prev.meta.isPlaying;
          if (willPlay) {
              // Starting playback
              timeAnchorRef.current = { startWallTime: performance.now(), startProjectTime: prev.meta.currentTime };
              if (prev.audio.hasAudio) {
                  audioController.play(prev.meta.currentTime);
              }
          } else {
              // Stopping playback
              if (prev.audio.hasAudio) {
                  audioController.stop();
              }
          }
          return {
              ...prev,
              meta: { ...prev.meta, isPlaying: willPlay }
          };
      });
  }, []);

  // --- HISTORY MANAGEMENT ---

  const commit = useCallback((cmd: Command) => {
      // 1. Calculate new state immediately using the Ref (Source of Truth for sync ops)
      const nextState = cmd.redo(projectRef.current);
      
      // 2. Synchronously update Ref so subsequent commands in the same tick (scripts) see the update
      projectRef.current = nextState;

      // 3. Update History Ref synchronously
      const prevHist = historyRef.current;
      const newPast = [...prevHist.past, cmd];
      if (newPast.length > 50) newPast.shift();
      const nextHistory = { past: newPast, future: [] };
      historyRef.current = nextHistory;

      // 4. Trigger React Updates (Async)
      setHistory(nextHistory);
      setProject(nextState);
  }, []);

  const undo = useCallback(() => {
      const { past, future } = historyRef.current;
      if (past.length === 0) return;
      
      const cmd = past[past.length - 1];
      const newPast = past.slice(0, -1);
      const newFuture = [cmd, ...future];
      const nextHistory = { past: newPast, future: newFuture };
      
      const nextState = cmd.undo(projectRef.current);
      
      // Sync Refs
      projectRef.current = nextState;
      historyRef.current = nextHistory;
      
      setHistory(nextHistory);
      setProject(nextState);
  }, []);

  const redo = useCallback(() => {
      const { past, future } = historyRef.current;
      if (future.length === 0) return;
      
      const cmd = future[0];
      const newFuture = future.slice(1);
      const newPast = [...past, cmd];
      const nextHistory = { past: newPast, future: newFuture };
      
      const nextState = cmd.redo(projectRef.current);
      
      // Sync Refs
      projectRef.current = nextState;
      historyRef.current = nextHistory;

      setHistory(nextHistory);
      setProject(nextState);
  }, []);

  const jumpToHistory = useCallback((index: number) => {
      const { past, future } = historyRef.current;
      
      let currentPast = [...past];
      let currentFuture = [...future];
      let currentState = projectRef.current;

      const currentIndex = currentPast.length - 1;

      if (index === currentIndex) return;

      if (index < currentIndex) {
          // Undo backwards
          const count = currentIndex - index;
          for(let i=0; i<count; i++) {
              const cmd = currentPast.pop();
              if (cmd) {
                  currentFuture.unshift(cmd);
                  currentState = cmd.undo(currentState);
              }
          }
      } else {
          // Future jump logic (if supported later)
      }

      const nextHistory = { past: currentPast, future: currentFuture };

      // Sync Refs
      projectRef.current = currentState;
      historyRef.current = nextHistory;

      setHistory(nextHistory);
      setProject(currentState);
  }, []);

  // --- PROJECT ACTIONS ---

  const updateProperty = useCallback((nodeId: string, propKey: string, updates: Partial<Property>) => {
      setProject(prev => {
          const node = prev.nodes[nodeId];
          if (!node) return prev;
          const prop = node.properties[propKey];
          
          let newProp = { ...prop, ...updates };
          
          if (prop.keyframes && prop.keyframes.length > 0 && 'value' in updates) {
              const t = prev.meta.currentTime;
              const EPSILON = 0.05;
              const kfIndex = prop.keyframes.findIndex(k => Math.abs(k.time - t) < EPSILON);
              
              let newKeyframes = [...prop.keyframes];
              if (kfIndex >= 0) {
                  newKeyframes[kfIndex] = { ...newKeyframes[kfIndex], value: updates.value };
              }
              newProp.keyframes = newKeyframes;
          }

          return {
              ...prev,
              nodes: {
                  ...prev.nodes,
                  [nodeId]: {
                      ...node,
                      properties: {
                          ...node.properties,
                          [propKey]: newProp
                      }
                  }
              }
          };
      });
  }, []);

  const addKeyframe = useCallback((nodeId: string, propKey: string, value: any) => {
      const state = projectRef.current;
      const node = state.nodes[nodeId];
      if (!node) return;
      const prop = node.properties[propKey];
      const t = state.meta.currentTime;
      
      const newKeyframe: Keyframe = {
          id: crypto.randomUUID(),
          time: t,
          value: value,
          easing: 'linear'
      };

      const oldKeyframes = prop.keyframes || [];
      const existingIndex = oldKeyframes.findIndex(k => Math.abs(k.time - t) < 0.01);
      
      let newKeyframes = [...oldKeyframes];
      let label = "Add Keyframe";

      if (existingIndex >= 0) {
          newKeyframes[existingIndex] = { ...newKeyframes[existingIndex], value: value };
          label = "Update Keyframe";
      } else {
          newKeyframes.push(newKeyframe);
          newKeyframes.sort((a, b) => a.time - b.time);
      }

      const update = { keyframes: newKeyframes, value: value };
      commit(Commands.set(state, nodeId, propKey, update, undefined, label));
  }, [commit]);

  const addKeyframeToNode = useCallback((nodeId: string) => {
      const state = projectRef.current;
      const node = state.nodes[nodeId];
      if (!node) return;
      
      const t = state.meta.currentTime;
      const propsToKey = ['x', 'y', 'rotation', 'scale', 'opacity'];
      
      const cmds: Command[] = [];

      propsToKey.forEach(key => {
          const prop = node.properties[key];
          if (!prop) return;

          if (prop.type !== 'number' && prop.type !== 'color') return;

          const val = prop.value;
          const newKeyframe: Keyframe = {
              id: crypto.randomUUID(),
              time: t,
              value: val,
              easing: 'linear'
          };

          const oldKeyframes = prop.keyframes || [];
          const existingIndex = oldKeyframes.findIndex(k => Math.abs(k.time - t) < 0.01);
          let newKeyframes = [...oldKeyframes];
          
          if (existingIndex >= 0) {
             newKeyframes[existingIndex] = { ...newKeyframes[existingIndex], value: val };
          } else {
             newKeyframes.push(newKeyframe);
             newKeyframes.sort((a, b) => a.time - b.time);
          }
          
          const update = { keyframes: newKeyframes, value: val };
          cmds.push(Commands.set(state, nodeId, key, update, undefined, `Key ${key}`));
      });
      
      if (cmds.length > 0) {
          commit(Commands.batch(cmds, `Add Keyframe ${nodeId}`));
      }
  }, [commit]);

  const updateMeta = useCallback((updates: Partial<ProjectState['meta']>) => {
      setProject(prev => ({
          ...prev,
          meta: { ...prev.meta, ...updates }
      }));
  }, []);

  const addNode = useCallback((type: 'rect' | 'circle' | 'vector' | 'value') => {
      const { command, nodeId } = Commands.addNode(type, projectRef.current);
      commit(command);
      return nodeId;
  }, [commit]);

  const removeNode = useCallback((id: string) => {
      const cmd = Commands.removeNode(id, projectRef.current);
      commit(cmd);
  }, [commit]);

  const renameNode = useCallback((oldId: string, newId: string) => {
      const cmd = Commands.renameNode(oldId, newId, projectRef.current);
      if (cmd) commit(cmd);
  }, [commit]);

  const selectNode = useCallback((id: string | null) => {
      setProject(prev => ({ ...prev, selection: id }));
  }, []);

  const moveNode = useCallback((fromIndex: number, toIndex: number) => {
      commit(Commands.reorderNode(fromIndex, toIndex));
  }, [commit]);

  const setTool = useCallback((tool: ToolType) => {
      setProject(prev => ({ ...prev, meta: { ...prev.meta, activeTool: tool } }));
  }, []);

  const runScript = useCallback((code: string) => {
      executeScript(code, () => projectRef.current, commit, consoleService);
  }, [commit]);

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
    runScript,
    addKeyframe,
    addKeyframeToNode
  };
}