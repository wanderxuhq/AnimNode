import { Command, ProjectState, Node, Property } from '../types';
import { createNode } from './factory';

// Helper to extract function body
const extractBody = (fn: Function | string): string => {
    let str = fn.toString().trim();
    
    // Robust arrow function detection
    // Matches: (a,b) => ... or arg => ... or () => ...
    const arrowRegex = /^(\([^\)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
    const match = arrowRegex.exec(str);
    
    if (match) {
        // The body starts after the arrow
        const bodyStart = match.index + match[0].length;
        let body = str.substring(bodyStart).trim();
        
        // Remove wrapping braces if present { return ... } -> return ...
        if (body.startsWith('{') && body.endsWith('}')) {
            return body.substring(1, body.length - 1).trim();
        }
        return `return ${body};`;
    }

    // Handle standard functions function() { ... }
    const start = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (start > -1 && last > -1) {
        return str.substring(start + 1, last).trim();
    }
    
    // Fallback for simple return strings or direct expressions
    return str; 
};

/**
 * Commands Factory
 * Encapsulates all logic for modifying the project state in an Undo/Redo compatible way.
 */
export const Commands = {
  
  /**
   * Add a new node to the project
   */
  addNode: (type: 'rect' | 'circle' | 'vector' | 'value', project: ProjectState): { command: Command, nodeId: string } => {
    // Calculate new ID
    let index = 0;
    let newId = `${type}_${index}`;
    while (project.nodes[newId]) {
        index++;
        newId = `${type}_${index}`;
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

    return { command, nodeId: newId };
  },

  /**
   * Remove a node from the project
   */
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
        // Insert back at original index to preserve order
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

  /**
   * Rename a node and update all references to it
   */
  renameNode: (oldId: string, newId: string, project: ProjectState): Command | null => {
    const fromId = oldId.trim();
    const toId = newId.trim();

    if (!fromId || !toId) return null;
    if (fromId === toId) return null;
    if (project.nodes[toId]) return null; // ID collision
    
    // Safety: check if node exists
    if (!project.nodes[fromId] && !project.rootNodeIds.includes(fromId)) return null;

    const performRename = (state: ProjectState, fId: string, tId: string) => {
        const node = state.nodes[fId];
        if (!node) return state;

        // Create new node with new ID
        const newNode = { ...node, id: tId };
        
        // 1. Rebuild nodes map
        const newNodes: Record<string, Node> = {};
        Object.keys(state.nodes).forEach(key => {
            if (key === fId) newNodes[tId] = newNode;
            else newNodes[key] = state.nodes[key];
        });

        // 2. Update references in other nodes (links/code)
        Object.values(newNodes).forEach((n: Node) => {
            let propsUpdated = false;
            const newProps = { ...n.properties };
            
            Object.keys(n.properties).forEach(pKey => {
                const prop = n.properties[pKey];
                
                // Fix Link References
                if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.startsWith(fId + ':')) {
                    const [, suffix] = prop.value.split(':');
                    newProps[pKey] = { ...prop, value: `${tId}:${suffix}` };
                    propsUpdated = true;
                }
                
                // Fix Code References (Regex replace)
                if (prop.mode === 'code') {
                    // Look for ctx.get('OLD_ID', ...)
                    const regex = new RegExp(`ctx\\.get\\(['"]${fId}['"]`, 'g');
                    if (regex.test(prop.expression)) {
                        newProps[pKey] = { ...prop, expression: prop.expression.replace(regex, `ctx.get('${tId}'`) };
                        propsUpdated = true;
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
        name: `Rename ${fromId} -> ${toId}`,
        timestamp: Date.now(),
        undo: (s) => performRename(s, toId, fromId), // Inverse
        redo: (s) => performRename(s, fromId, toId)
    };
  },

  /**
   * Reorder a node in the list
   */
  reorderNode: (fromIndex: number, toIndex: number): Command => {
    const reorder = (s: ProjectState, from: number, to: number) => {
        const newRoots = [...s.rootNodeIds];
        const [moved] = newRoots.splice(from, 1);
        newRoots.splice(to, 0, moved);
        return { ...s, rootNodeIds: newRoots };
    };

    return {
        id: crypto.randomUUID(),
        name: `Reorder Node`,
        timestamp: Date.now(),
        undo: (s) => reorder(s, toIndex, fromIndex),
        redo: (s) => reorder(s, fromIndex, toIndex)
    };
  },

  /**
   * Update Node Metadata
   */
  updateNodeMeta: (nodeId: string, meta: Partial<Node>, project: ProjectState): Command => {
    const node = project.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} not found`);
    
    const oldMeta: Partial<Node> = {};
    (Object.keys(meta) as Array<keyof Node>).forEach(key => {
        // @ts-ignore
        oldMeta[key] = node[key];
    });

    const apply = (s: ProjectState, updates: Partial<Node>) => {
        const n = s.nodes[nodeId];
        if (!n) return s;
        return {
            ...s,
            nodes: {
                ...s.nodes,
                [nodeId]: { ...n, ...updates }
            }
        };
    };

    return {
        id: crypto.randomUUID(),
        name: `Update ${nodeId}`,
        timestamp: Date.now(),
        undo: (s) => apply(s, oldMeta),
        redo: (s) => apply(s, meta)
    };
  },

  /**
   * Unified Property Setter.
   * Handles static values, expressions (functions), and partial updates.
   * Automatically switches modes based on input type unless explicit partial is provided.
   */
  set: (
      project: ProjectState,
      nodeId: string, 
      propKey: string, 
      input: any, 
      prevInput?: any, 
      description?: string
  ): Command => {
      // Validate existence in the CURRENT project state passed in
      const node = project.nodes[nodeId];
      if (!node) throw new Error(`Node ${nodeId} not found in current state`);
      const prop = node.properties[propKey];
      if (!prop) throw new Error(`Property ${propKey} not found on node ${nodeId}`);

      // --- Helper to resolve a raw input to a Property Partial ---
      const resolveState = (val: any): Partial<Property> => {
          if (typeof val === 'function') {
              return { mode: 'code', expression: extractBody(val) };
          }
          if (val && typeof val === 'object' && 'mode' in val) {
              return val;
          }
          return { mode: 'static', value: val };
      };

      const newState = resolveState(input);
      
      let oldState: Partial<Property>;
      if (prevInput !== undefined) {
          oldState = resolveState(prevInput);
      } else {
          oldState = {
            mode: prop.mode,
            value: prop.value,
            expression: prop.expression
          };
      }
      
      // Auto-sync expression for static values
      if (newState.mode === 'static' && newState.value !== undefined) {
          const serialized = typeof newState.value === 'string' ? `"${newState.value}"` : JSON.stringify(newState.value);
          newState.expression = `return ${serialized};`;
      }
      
      // Type Coercion for numbers
      if (newState.mode === 'static' && prop.type === 'number' && newState.value !== undefined) {
          const num = parseFloat(String(newState.value));
          if (!isNaN(num)) newState.value = num;
      }

      const cmdName = description || `Set ${prop.name}`;

      const apply = (s: ProjectState, updates: Partial<Property>) => {
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
                          [propKey]: { ...n.properties[propKey], ...updates }
                      }
                  }
              }
          };
      };

      return {
          id: crypto.randomUUID(),
          name: cmdName,
          timestamp: Date.now(),
          undo: (s) => apply(s, oldState),
          redo: (s) => apply(s, newState)
      };
  },

  /**
   * Move a node (Transform X/Y)
   */
  moveNode: (
      nodeId: string,
      oldPos: { x: number, y: number },
      newPos: { x: number, y: number }
  ): Command => {
      const applyPos = (s: ProjectState, x: number, y: number) => {
          const n = s.nodes[nodeId];
          if(!n) return s;
          return {
              ...s,
              nodes: {
                  ...s.nodes,
                  [nodeId]: {
                      ...n,
                      properties: {
                          ...n.properties,
                          x: { ...n.properties.x, value: x, mode: 'static' as const, expression: `return ${x};` },
                          y: { ...n.properties.y, value: y, mode: 'static' as const, expression: `return ${y};` },
                      }
                  }
              }
          };
      };

      return {
          id: crypto.randomUUID(),
          name: "Move Node",
          timestamp: Date.now(),
          undo: (s) => applyPos(s, oldPos.x, oldPos.y),
          redo: (s) => applyPos(s, newPos.x, newPos.y)
      };
  },

  /**
   * Batch multiple commands into one
   */
  batch: (commands: Command[], name: string): Command => {
    return {
        id: crypto.randomUUID(),
        name,
        timestamp: Date.now(),
        undo: (state) => {
            let s = state;
            for (let i = commands.length - 1; i >= 0; i--) {
                s = commands[i].undo(s);
            }
            return s;
        },
        redo: (state) => {
            let s = state;
            for (const cmd of commands) {
                s = cmd.redo(s);
            }
            return s;
        }
    };
  },

  /**
   * Clear entire project
   */
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