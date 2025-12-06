
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
  addNode: (type: 'rect' | 'circle' | 'vector', project: ProjectState): { command: Command, nodeId: string } => {
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
        rootNodeIds: [...p.rootNodeIds, newNode.id], // Add to end (top)
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
        name: `New ${newNode.name}`,
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
        name: `Delete ${node.name}`,
        timestamp: Date.now(),
        undo: performRestore,
        redo: performRemove
    };
  },

  /**
   * Rename a node and update all references to it
   */
  renameNode: (oldId: string, newId: string, project: ProjectState): Command | null => {
    if (oldId === newId) return null;
    if (!newId.trim()) return null;
    if (project.nodes[newId]) return null; // ID collision
    if (!project.nodes[oldId]) return null; // Old node missing

    const performRename = (state: ProjectState, fromId: string, toId: string) => {
        const node = state.nodes[fromId];
        if (!node) return state;

        // Create new node with new ID and CLONED properties map to ensure separation
        const newNode = { ...node, id: toId, properties: { ...node.properties } };
        
        // 1. Rebuild nodes map
        const newNodes: Record<string, Node> = {};
        Object.keys(state.nodes).forEach(key => {
            if (key === fromId) newNodes[toId] = newNode;
            else newNodes[key] = state.nodes[key];
        });

        // 2. Update references in other nodes (links/code)
        // We iterate Object.values(newNodes) which includes our newly created node.
        Object.values(newNodes).forEach((n: Node) => {
            let propsUpdated = false;
            const newProps = { ...n.properties };
            
            Object.keys(n.properties).forEach(pKey => {
                const prop = n.properties[pKey];
                
                // Fix Link References
                if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.startsWith(fromId + ':')) {
                    const [, suffix] = prop.value.split(':');
                    newProps[pKey] = { ...prop, value: `${toId}:${suffix}` };
                    propsUpdated = true;
                }
                
                // Fix Code References (Regex replace)
                if (prop.mode === 'code') {
                    // Look for ctx.get('OLD_ID', ...)
                    const regex = new RegExp(`ctx\\.get\\(['"]${fromId}['"]`, 'g');
                    if (regex.test(prop.expression)) {
                        newProps[pKey] = { ...prop, expression: prop.expression.replace(regex, `ctx.get('${toId}'`) };
                        propsUpdated = true;
                    }
                }
            });
            
            if (propsUpdated) {
                newNodes[n.id] = { ...n, properties: newProps };
            }
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

    return {
        id: crypto.randomUUID(),
        name: `Rename ${oldId} -> ${newId}`,
        timestamp: Date.now(),
        undo: (s) => performRename(s, newId, oldId), // Inverse
        redo: (s) => performRename(s, oldId, newId)
    };
  },

  /**
   * Update Metadata (e.g. Name)
   */
  updateNodeMeta: (nodeId: string, updates: { name?: string }, description?: string): Command => {
    const apply = (s: ProjectState, newMeta: { name?: string }) => {
        const n = s.nodes[nodeId];
        if (!n) return s;
        return {
            ...s,
            nodes: {
                ...s.nodes,
                [nodeId]: { ...n, ...newMeta }
            }
        };
    };

    return {
        id: crypto.randomUUID(),
        name: description || `Update Node Meta`,
        timestamp: Date.now(),
        undo: (s) => {
             // Limited undo support for meta updates without passing prev state explicitly
             return s; 
        },
        redo: (s) => apply(s, updates)
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
   * Clear all nodes from the project
   */
  clearProject: (project: ProjectState): Command => {
    const oldNodes = { ...project.nodes };
    const oldRoots = [...project.rootNodeIds];
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
      const resolveState = (val: any, targetProp: Property): Partial<Property> => {
          if (typeof val === 'function') {
              return { mode: 'code', expression: extractBody(val) };
          }
          if (val && typeof val === 'object' && 'mode' in val) {
              return val;
          }
          
          // Handle Static Values
          // Coerce number strings to numbers if property type requires it
          let safeVal = val;
          if (targetProp.type === 'number' && typeof val === 'string') {
              const parsed = parseFloat(val);
              if (!isNaN(parsed)) safeVal = parsed;
          }

          // Ensure expression is synced for consistency
          const expr = typeof safeVal === 'string' 
            ? `return "${safeVal}";` 
            : `return ${JSON.stringify(safeVal)};`;

          return { mode: 'static', value: safeVal, expression: expr };
      };

      const newState = resolveState(input, prop);
      
      let oldState: Partial<Property>;
      if (prevInput !== undefined) {
          oldState = resolveState(prevInput, prop);
      } else {
          oldState = {
            mode: prop.mode,
            value: prop.value,
            expression: prop.expression
          };
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
   * Batch multiple commands into a single transaction
   */
  batch: (commands: Command[], name: string = 'Batch Action'): Command => {
      return {
          id: crypto.randomUUID(),
          name,
          timestamp: Date.now(),
          undo: (s) => {
              let state = s;
              // Reverse undo order
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
  }
};
