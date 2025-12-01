
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
  expression: `return ${JSON.stringify(value)};`
});

export const createNode = (type: 'rect' | 'circle', id?: string): Node => {
  const nodeId = id || uuid();
  const isRect = type === 'rect';

  return {
    id: nodeId,
    name: isRect ? 'New Rectangle' : 'New Circle',
    type,
    parentId: null,
    properties: {
      x: { ...createProp('X Position', 'number', 0), mode: 'static', expression: 'return 0;' },
      y: { ...createProp('Y Position', 'number', 0), mode: 'static', expression: 'return 0;' },
      rotation: { ...createProp('Rotation', 'number', 0), mode: 'static', expression: 'return 0;' },
      scale: { ...createProp('Scale', 'number', 1), mode: 'static', expression: 'return 1;' },
      fill: { ...createProp('Fill Color', 'color', '#3b82f6'), mode: 'static', expression: 'return "#3b82f6";' },
      ...(isRect ? {
         width: { ...createProp('Width', 'number', 100), mode: 'static', expression: 'return 100;' },
         height: { ...createProp('Height', 'number', 100), mode: 'static', expression: 'return 100;' },
      } : {
         radius: { ...createProp('Radius', 'number', 50), mode: 'static', expression: 'return 50;' },
      })
    }
  };
};