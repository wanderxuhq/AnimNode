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
  
  // Default positions (Center of canvas is usually good, random offset to see new items)
  const uiPos = {
      x: 100 + Math.random() * 100,
      y: 100 + Math.random() * 100
  };

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
      ui: uiPos,
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
      ui: uiPos,
      properties: {
        ...baseProps,
        width: createProp('number', 100),
        height: createProp('number', 100),
        fill: createProp('color', '#3b82f6'),
        stroke: createProp('color', 'transparent'),
        strokeWidth: createProp('number', 0),
        // Path CENTERED: -w/2 to w/2
        path: createExpr('const w = prop("width"); const h = prop("height"); return `M ${-w/2} ${-h/2} L ${w/2} ${-h/2} L ${w/2} ${h/2} L ${-w/2} ${h/2} Z`;')
      }
    };
  }

  if (type === 'circle') {
    return {
      id: nodeId,
      type,
      parentId: null,
      ui: uiPos,
      properties: {
        ...baseProps,
        radius: createProp('number', 50),
        fill: createProp('color', '#ec4899'),
        stroke: createProp('color', 'transparent'),
        strokeWidth: createProp('number', 0),
        // Circle CENTERED at 0,0
        path: createExpr('const r = prop("radius"); return `M ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 Z`;')
      }
    };
  }

  if (type === 'vector') {
    return {
      id: nodeId,
      type,
      parentId: null,
      ui: uiPos,
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