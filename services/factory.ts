import { Node, Property, PropertyType } from '../types';

// Safe UUID generator
const uuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const createProp = (type: PropertyType, value: any): Property => {
    return {
        type,
        value
    };
};

const createExpr = (expression: string): Property => ({
    type: 'expression',
    value: expression
});

export const createNode = (type: 'rect' | 'circle' | 'vector' | 'value', id?: string): Node => {
  const nodeId = id || uuid();
  
  // Default to screen center (400, 300) so new nodes are visible
  const baseProps = {
      x: createProp('number', 400),
      y: createProp('number', 300),
      rotation: createProp('number', 0),
      scale: createProp('number', 1),
      opacity: createProp('number', 1),
  };

  if (type === 'value') {
    return {
      id: nodeId,
      type,
      parentId: null,
      properties: {
        value: createProp('number', 0)
      }
    };
  }

  if (type === 'rect') {
    return {
      id: nodeId,
      type,
      parentId: null,
      properties: {
        ...baseProps,
        width: createProp('number', 100),
        height: createProp('number', 100),
        fill: createProp('color', '#3b82f6'),
        stroke: createProp('color', 'transparent'),
        strokeWidth: createProp('number', 0),
        // Path starts at 0,0 (Top-Left)
        path: createExpr('const w = prop("width"); const h = prop("height"); return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;')
      }
    };
  }

  if (type === 'circle') {
    return {
      id: nodeId,
      type,
      parentId: null,
      properties: {
        ...baseProps,
        radius: createProp('number', 50),
        fill: createProp('color', '#ec4899'),
        stroke: createProp('color', 'transparent'),
        strokeWidth: createProp('number', 0),
        // Circle center is at (r, r), fitting inside the bounding box starting at 0,0
        path: createExpr('const r = prop("radius"); return `M 0 ${r} A ${r} ${r} 0 1 1 ${2*r} ${r} A ${r} ${r} 0 1 1 0 ${r} Z`;')
      }
    };
  }

  if (type === 'vector') {
    return {
      id: nodeId,
      type,
      parentId: null,
      properties: {
        ...baseProps,
        path: createProp('string', ''),
        fill: createProp('color', 'transparent'),
        stroke: createProp('color', '#10b981'),
        strokeWidth: createProp('number', 2),
      }
    };
  }

  // Fallback
  return createNode('rect', nodeId);
};