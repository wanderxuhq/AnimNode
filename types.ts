

// This defines the "File Format" structure

// Expanded types to include logic and structural types
export type PropertyType = 
  | 'number' 
  | 'color' 
  | 'vector2' 
  | 'boolean' 
  | 'string' 
  | 'object' 
  | 'array' 
  | 'function' 
  | 'expression' 
  | 'ref'; // Formerly 'link'

export type EasingType = 'linear' | 'step';

export interface Keyframe {
  id: string;
  time: number;
  value: any;
  easing: EasingType;
}

// The core concept: A flattened property structure
export interface Property {
  type: PropertyType;
  value: any; 
  // For 'expression', value is the code string
  // For 'ref', value is "nodeId:propKey"
  // For 'number', value is number, etc.
  
  // Animation Data
  keyframes?: Keyframe[];

  // Stash for preserving values between mode switches
  meta?: {
    lastExpression?: string;
    lastValue?: any;
    lastType?: PropertyType;
  };
}

export interface Node {
  id: string;
  type: 'rect' | 'circle' | 'text' | 'group' | 'vector' | 'value';
  parentId: string | null;
  properties: Record<string, Property>;
  ui: { x: number; y: number };
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