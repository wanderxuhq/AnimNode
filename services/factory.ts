import { Node, Property } from '../types';

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

export const createProp = (name: string, type: any, value: any): Property => {
    let expression = `return ${JSON.stringify(value)};`;
    
    // Handle types that JSON.stringify breaks on or needs special handling
    if (type === 'string') {
        expression = `return "${value}";`;
    } else if (type === 'function') {
        expression = `return ${value.toString()};`;
    } else if (type === 'object' || type === 'array') {
        try {
            expression = `return ${JSON.stringify(value, null, 2)};`;
        } catch (e) {
            expression = `return {}; // Error stringifying initial value`;
        }
    }

    return {
        id: uuid(),
        name,
        type,
        mode: 'static',
        value,
        keyframes: [],
        expression
    };
};

export const createNode = (type: 'rect' | 'circle' | 'vector' | 'value', id?: string): Node => {
  const nodeId = id || uuid();
  
  // Default to screen center (400, 300) so new nodes are visible
  const baseProps = {
      x: { ...createProp('X Position', 'number', 400), mode: 'static' as const, expression: 'return 400;' },
      y: { ...createProp('Y Position', 'number', 300), mode: 'static' as const, expression: 'return 300;' },
      rotation: { ...createProp('Rotation', 'number', 0), mode: 'static' as const, expression: 'return 0;' },
      scale: { ...createProp('Scale', 'number', 1), mode: 'static' as const, expression: 'return 1;' },
      opacity: { ...createProp('Opacity', 'number', 1), mode: 'static' as const, expression: 'return 1;' },
  };

  if (type === 'value') {
    return {
      id: nodeId,
      type,
      parentId: null,
      properties: {
        value: { ...createProp('Value', 'number', 0), mode: 'static' as const, expression: 'return 0;' }
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
        width: { ...createProp('Width', 'number', 100), mode: 'static' as const, expression: 'return 100;' },
        height: { ...createProp('Height', 'number', 100), mode: 'static' as const, expression: 'return 100;' },
        fill: { ...createProp('Fill Color', 'color', '#3b82f6'), mode: 'static' as const, expression: 'return "#3b82f6";' },
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
        radius: { ...createProp('Radius', 'number', 50), mode: 'static' as const, expression: 'return 50;' },
        fill: { ...createProp('Fill Color', 'color', '#ec4899'), mode: 'static' as const, expression: 'return "#ec4899";' },
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
        // Start with empty path instead of star
        d: { ...createProp('Path Data', 'string', ''), mode: 'static' as const, expression: 'return "";' },
        fill: { ...createProp('Fill Color', 'color', 'transparent'), mode: 'static' as const, expression: 'return "transparent";' },
        stroke: { ...createProp('Stroke Color', 'color', '#10b981'), mode: 'static' as const, expression: 'return "#10b981";' },
        strokeWidth: { ...createProp('Stroke Width', 'number', 2), mode: 'static' as const, expression: 'return 2;' },
      }
    };
  }

  // Fallback
  return createNode('rect', nodeId);
};