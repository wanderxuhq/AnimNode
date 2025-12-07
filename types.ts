

// This defines the "File Format" structure

export type ValueType = 'number' | 'color' | 'vector2' | 'boolean' | 'string';

export interface Keyframe {
  time: number; // in seconds
  value: any;
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

// The core concept: A property can be static, keyframed, procedural (code), or linked
export interface Property {
  id: string;
  name: string;
  type: ValueType;
  mode: 'static' | 'keyframe' | 'code' | 'link';
  value: any; // Static value OR "nodeId:propKey" string for link
  keyframes: Keyframe[];
  expression: string; // The JS code body: (t, index, ctx) => result
}

export interface Node {
  id: string;
  type: 'rect' | 'circle' | 'text' | 'group' | 'vector' | 'value';
  parentId: string | null;
  properties: Record<string, Property>;
}

export interface AudioState {
  hasAudio: boolean;
  fileName: string | null;
  buffer: AudioBuffer | null;
  waveform: number[]; // Pre-computed waveform for timeline
}

export type ToolType = 'select' | 'pen';

export interface ProjectState {
  meta: {
    duration: number; // seconds
    fps: number;
    width: number;
    height: number;
    currentTime: number;
    isPlaying: boolean;
    renderer: 'svg' | 'webgpu';
    viewMode: 'list' | 'graph';
    activeTool: ToolType; // Added tool state
  };
  audio: AudioState;
  nodes: Record<string, Node>;
  selection: string | null; // Selected Node ID
  rootNodeIds: string[];
}

export interface Command {
  id: string;
  name: string;
  timestamp: number;
  undo: (state: ProjectState) => ProjectState;
  redo: (state: ProjectState) => ProjectState;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  nodeId?: string;
  propKey?: string;
  count: number; // For grouping identical logs
}

export const INITIAL_EXPRESSION_TEMPLATE = `// Available variables: 
// t (time in seconds)
// val (current static/keyframe value)
// ctx.audio.bass (0-1)
// ctx.get('nodeId', 'propId') -> get value from another node
// console.log('msg') -> print to console panel
// Math (standard math lib)

// Example: Follow another node's X position
// return ctx.get('rect_0', 'x') + 50;

return Math.sin(t) * 100;`;