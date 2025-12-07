import { Command, ProjectState, Node, Property } from '../types';
import { createNode } from './factory';

// Helper to extract function body
const extractBody = (fn: Function | string): string => {
    let str = fn.toString().trim();
    const arrowRegex = /^(\([^\)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
    const match = arrowRegex.exec(str);
    if (match) {
        const bodyStart = match.index + match[0].length;
        let body = str.substring(bodyStart).trim();
        if (body.startsWith('{') && body.endsWith('}')) {
            return body.substring(1, body.length - 1).trim();
        }
        return `return ${body};`;
    }
    const start = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (start > -1 && last > -1) {
        return str.substring(start + 1, last).trim();
    }
    return str; 
};

/**
 * Commands Factory
 */
export const Commands = {
  addNode: (type: 'rect' | 'circle' | 'vector' | 'value', project: ProjectState): { command: Command, nodeId: string } => {
    let index = 0;
    let prefix: string = type;
    if (type === 'value') prefix = 'var';
    let newId = `${prefix}_${index}`;
    while (project.nodes[newId]) {
        index++;
        newId = `${prefix}_${index}`;
    }
    const newNode = createNode(type, newId);
    const applyAdd = (p: ProjectState) => ({
        ...p,
        nodes: { ...p.nodes, [newNode.id]: newNode },
        rootNodeIds: [newNode.id, ...p.rootNodeIds],
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
    
    const command: Command = {
        id: crypto.randomUUID(),
        name: `New ${newNode.id}`,
        timestamp: Date.now(),
        undo: applyRemove,
        redo: applyAdd
    };

    return { command, nodeId: newNode.id };
  },
  removeNode: (nodeId: string, project: ProjectState): Command => {
    const node = project.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const originalIndex = project.rootNodeIds.indexOf(nodeId);
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
    return {
        id: crypto.randomUUID(),
        name: `Delete ${nodeId}`,
        timestamp: Date.now(),
        undo: performRestore,
        redo: performRemove
    };
  },
  renameNode: (oldId: string, newId: string, project: ProjectState): Command | null => {
    const fromId = oldId.trim();
    const toId = newId.trim();
    
    if (!fromId || !toId) return null;
    if (fromId === toId) return null;
    if (project.nodes[toId]) return null; // Target collision
    if (!project.nodes[fromId]) return null; // Source missing

    const performRename = (state: ProjectState, fId: string, tId: string) => {
        const node = state.nodes[fId];
        if (!node) return state; // Safety check

        const newNode = { ...node, id: tId };
        const newNodes: Record<string, Node> = {};
        
        // Rebuild nodes map with new ID
        Object.keys(state.nodes).forEach(key => {
            if (key === fId) newNodes[tId] = newNode;
            else newNodes[key] = state.nodes[key];
        });

        // Update references in ALL nodes
        Object.values(newNodes).forEach((n: Node) => {
            let propsUpdated = false;
            const newProps = { ...n.properties };
            
            Object.keys(n.properties).forEach(pKey => {
                const prop = n.properties[pKey];
                
                // Update Links
                if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.startsWith(fId + ':')) {
                    const [, suffix] = prop.value.split(':');
                    newProps[pKey] = { ...prop, value: `${tId}:${suffix}` };
                    propsUpdated = true;
                }
                
                // Update Code References (ctx.get)
                if (prop.mode === 'code') {
                    const regex = new RegExp(`ctx\\.get\\(['"]${fId}['"]`, 'g');
                    let newExpr = prop.expression;
                    
                    if (regex.test(newExpr)) {
                        newExpr = newExpr.replace(regex, `ctx.get('${tId}'`);
                        propsUpdated = true;
                    }
                    
                    // Update Variable References (e.g. "return MY_VAR")
                    // Use word boundaries to avoid replacing partial matches
                    const varRegex = new RegExp(`\\b${fId}\\b`, 'g');
                    if (varRegex.test(newExpr)) {
                         newExpr = newExpr.replace(varRegex, tId);
                         propsUpdated = true;
                    }

                    if (propsUpdated) {
                        newProps[pKey] = { ...prop, expression: newExpr };
                    }
                }
            });

            if (propsUpdated) {
                newNodes[n.id] = { ...n, properties: newProps };
            }
        });

        const newRoots = state.rootNodeIds.map(id => id === fId ? tId : id);
        const newSelection = state.selection === fId ? tId : state.selection;

        return {
            ...state,
            nodes: newNodes,
            rootNodeIds: newRoots,
            selection: newSelection
        };
    };

    return {
        id: crypto.randomUUID(),
        name: `Rename ${oldId} -> ${newId}`,
        timestamp: Date.now(),
        undo: (s) => performRename(s, toId, fromId),
        redo: (s) => performRename(s, fromId, toId)
    };
  },
  moveNode: (nodeId: string, fromPos: {x:number, y:number}, toPos: {x:number, y:number}): Command => {
      const applyMove = (s: ProjectState, pos: {x:number, y:number}) => {
          const node = s.nodes[nodeId];
          if (!node) return s;
          const nextNodes = {
              ...s.nodes,
              [nodeId]: {
                  ...node,
                  properties: {
                      ...node.properties,
                      x: { ...node.properties.x, value: pos.x },
                      y: { ...node.properties.y, value: pos.y }
                  }
              }
          };
          return { ...s, nodes: nextNodes };
      };
      return {
          id: crypto.randomUUID(),
          name: `Move ${nodeId}`,
          timestamp: Date.now(),
          undo: (s) => applyMove(s, fromPos),
          redo: (s) => applyMove(s, toPos)
      };
  },
  reorderNode: (fromIndex: number, toIndex: number): Command => {
      const applyReorder = (s: ProjectState, f: number, t: number) => {
          const newRoots = [...s.rootNodeIds];
          const [removed] = newRoots.splice(f, 1);
          newRoots.splice(t, 0, removed);
          return { ...s, rootNodeIds: newRoots };
      };
      return {
          id: crypto.randomUUID(),
          name: `Reorder Node`,
          timestamp: Date.now(),
          undo: (s) => applyReorder(s, toIndex, fromIndex),
          redo: (s) => applyReorder(s, fromIndex, toIndex)
      };
  },
  // Unified Property Set Command (Handles all modes)
  set: (
    project: ProjectState, 
    nodeId: string, 
    propKey: string, 
    newValue: Partial<Property>, 
    oldValue?: Partial<Property>,
    label?: string
  ): Command => {
      const node = project.nodes[nodeId];
      if (!node || !node.properties[propKey]) throw new Error("Property not found");
      const currentProp = node.properties[propKey];
      
      const prev = oldValue || { 
          mode: currentProp.mode, 
          value: currentProp.value, 
          expression: currentProp.expression,
          keyframes: currentProp.keyframes
      };

      // Safeguard against functions being passed directly to logic that expects serializable data
      // (Though redo/undo function closures handle refs fine in memory)
      const next = { ...prev, ...newValue };
      
      const apply = (s: ProjectState, val: Partial<Property>) => {
          const n = s.nodes[nodeId];
          if (!n) return s;
          return {
              ...s,
              nodes: {
                  ...s.nodes,
                  [nodeId]: {
                      ...n,
                      properties: {
                          ...n.properties,
                          [propKey]: { ...n.properties[propKey], ...val }
                      }
                  }
              }
          };
      };

      return {
          id: crypto.randomUUID(),
          name: label || `Set ${propKey}`,
          timestamp: Date.now(),
          undo: (s) => apply(s, prev),
          redo: (s) => apply(s, next)
      };
  },
  batch: (commands: Command[], label: string): Command => {
      return {
          id: crypto.randomUUID(),
          name: label,
          timestamp: Date.now(),
          undo: (s) => {
              // Undo in reverse order
              let state = s;
              for (let i = commands.length - 1; i >= 0; i--) {
                  state = commands[i].undo(state);
              }
              return state;
          },
          redo: (s) => {
              let state = s;
              for (const cmd of commands) {
                  state = cmd.redo(state);
              }
              return state;
          }
      };
  },
  clearProject: (project: ProjectState): Command => {
      const oldNodes = project.nodes;
      const oldRoots = project.rootNodeIds;
      const oldSelection = project.selection;
      
      return {
          id: crypto.randomUUID(),
          name: 'Clear Project',
          timestamp: Date.now(),
          undo: (s) => ({
              ...s,
              nodes: oldNodes,
              rootNodeIds: oldRoots,
              selection: oldSelection
          }),
          redo: (s) => ({
              ...s,
              nodes: {},
              rootNodeIds: [],
              selection: null
          })
      };
  }
};