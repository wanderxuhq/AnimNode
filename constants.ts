import { ProjectState, Node, PropertyType } from './types';

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

// Safe UUID generator that works in non-secure contexts
const uuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const createProp = (type: PropertyType, value: any): any => ({
  type,
  value
});

const createExpr = (expression: string): any => ({
    type: 'expression',
    value: expression
});

// Use friendly IDs for better UX
const demoRectId = 'rect_0';
const demoCircleId = 'circle_0';

export const INITIAL_PROJECT: ProjectState = {
  meta: {
    duration: 10,
    fps: 60,
    width: 800,
    height: 600,
    currentTime: 0,
    isPlaying: false,
    renderer: 'webgpu', // Default to WebGPU
    viewMode: 'list',
    activeTool: 'select'
  },
  audio: {
    hasAudio: false,
    fileName: null,
    buffer: null,
    waveform: []
  },
  selection: demoRectId,
  rootNodeIds: [demoRectId, demoCircleId],
  nodes: {
    [demoRectId]: {
      id: demoRectId,
      type: 'rect',
      parentId: null,
      ui: { x: 100, y: 150 },
      properties: {
        x: createExpr('return 400 + Math.sin(t * 2) * 200;'),
        y: createProp('number', 300),
        width: createProp('number', 100),
        height: createExpr('// Scales with Bass\nreturn 100 + (ctx.audio.bass || 0) * 100;'),
        rotation: createExpr('return t * 45;'),
        scale: createProp('number', 1),
        fill: createProp('color', '#3b82f6'),
        // Center Anchor Path: -w/2 to w/2
        path: createExpr('const w = prop("width"); const h = prop("height"); return `M ${-w/2} ${-h/2} L ${w/2} ${-h/2} L ${w/2} ${h/2} L ${-w/2} ${h/2} Z`;')
      }
    },
    [demoCircleId]: {
      id: demoCircleId,
      type: 'circle',
      parentId: null,
      ui: { x: 450, y: 150 },
      properties: {
        x: createExpr('return 400 + Math.cos(t * 3) * 150;'),
        y: createExpr('return 300 + Math.sin(t * 3) * 150;'),
        rotation: createProp('number', 0),
        scale: createProp('number', 1),
        radius: createExpr('return 20 + Math.abs(Math.sin(t)) * 30;'),
        fill: createProp('color', '#ec4899'),
        // Center Anchor Circle: Centered at 0,0
        path: createExpr('const r = prop("radius"); return `M ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 Z`;')
      }
    }
  }
};