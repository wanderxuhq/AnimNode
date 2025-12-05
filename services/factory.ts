

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

export const createProp = (name: string, type: any, value: any): Property => ({
  id: uuid(),
  name,
  type,
  mode: 'static',
  value,
  keyframes: [],
  expression: type === 'string' ? `return "${value}";` : `return ${JSON.stringify(value)};`
});

export const createNode = (type: 'rect' | 'circle' | 'vector', id?: string): Node => {
  const nodeId = id || uuid();
  
  const baseProps = {
      x: { ...createProp('X Position', 'number', 0), mode: 'static' as const, expression: 'return 0;' },
      y: { ...createProp('Y Position', 'number', 0), mode: 'static' as const, expression: 'return 0;' },
      rotation: { ...createProp('Rotation', 'number', 0), mode: 'static' as const, expression: 'return 0;' },
      scale: { ...createProp('Scale', 'number', 1), mode: 'static' as const, expression: 'return 1;' },
      opacity: { ...createProp('Opacity', 'number', 1), mode: 'static' as const, expression: 'return 1;' },
  };

  if (type === 'rect') {
    return {
      id: nodeId,
      name: 'New Rectangle',
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
      name: 'New Circle',
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
      name: 'New Path',
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