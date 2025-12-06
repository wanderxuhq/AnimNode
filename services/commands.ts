
import { Command, ProjectState, Node, Property } from '../types';
import { createNode } from './factory';

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

    const performRename = (state: ProjectState, fromId: string, toId: string) => {
        const node = state.nodes[fromId];
        if (!node) return state;

        const newNode = { ...node, id: toId };
        
        // 1. Rebuild nodes map
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

    return {
        id: crypto.randomUUID(),
        name: `Rename ${oldId} -> ${newId}`,
        timestamp: Date.now(),
        undo: (s) => performRename(s, newId, oldId), // Inverse
        redo: (s) => performRename(s, oldId, newId)
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
   * Update a single property
   */
  updateProperty: (
      nodeId: string, 
      propKey: string, 
      oldState: Partial<Property>, 
      newState: Partial<Property>, 
      description?: string
  ): Command => {
      
      const applyUpdate = (s: ProjectState, updates: Partial<Property>) => {
          const node = s.nodes[nodeId];
          if (!node) return s;
          return {
              ...s,
              nodes: {
                  ...s.nodes,
                  [nodeId]: {
                      ...node,
                      properties: {
                          ...node.properties,
                          [propKey]: { ...node.properties[propKey], ...updates }
                      }
                  }
              }
          };
      };

      return {
          id: crypto.randomUUID(),
          name: description || `Update ${propKey}`,
          timestamp: Date.now(),
          undo: (s) => applyUpdate(s, oldState),
          redo: (s) => applyUpdate(s, newState)
      };
  },

  /**
   * Move a node (Transform X/Y)
   * This is a specialized helper for creating a bulk update command for position
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
                          x: { ...n.properties.x, value: x },
                          y: { ...n.properties.y, value: y },
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
  }
};
