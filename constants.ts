
import { ProjectState, Node } from './types';

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

const createProp = (name: string, type: any, value: any): any => ({
  id: uuid(),
  name,
  type,
  mode: 'static',
  value,
  keyframes: [],
  expression: `return ${JSON.stringify(value)};`
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
    renderer: 'canvas',
    viewMode: 'list'
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
      name: 'Audio Reactive Cube',
      type: 'rect',
      parentId: null,
      properties: {
        x: { ...createProp('X Position', 'number', 0), mode: 'code', expression: 'return Math.sin(t * 2) * 200;' },
        y: { ...createProp('Y Position', 'number', 0), mode: 'static', expression: 'return 0;' },
        width: createProp('Width', 'number', 100),
        height: { ...createProp('Height', 'number', 100), mode: 'code', expression: '// Scales with Bass\nreturn 100 + (ctx.audio.bass || 0) * 100;' },
        rotation: { ...createProp('Rotation', 'number', 0), mode: 'code', expression: 'return t * 45;' },
        scale: createProp('Scale', 'number', 1),
        fill: createProp('Fill Color', 'color', '#3b82f6'),
      }
    },
    [demoCircleId]: {
      id: demoCircleId,
      name: 'Orbiting Circle',
      type: 'circle',
      parentId: null,
      properties: {
        x: { ...createProp('X Position', 'number', 200), mode: 'code', expression: 'return Math.cos(t * 3) * 150;' },
        y: { ...createProp('Y Position', 'number', 0), mode: 'code', expression: 'return Math.sin(t * 3) * 150;' },
        rotation: createProp('Rotation', 'number', 0),
        scale: createProp('Scale', 'number', 1),
        radius: { ...createProp('Radius', 'number', 20), mode: 'keyframe', keyframes: [
            { time: 0, value: 20 },
            { time: 2, value: 50 },
            { time: 4, value: 20 }
        ]},
        fill: createProp('Fill Color', 'color', '#ec4899'),
      }
    }
  }
};