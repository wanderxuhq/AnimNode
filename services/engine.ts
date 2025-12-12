
import { Node, ProjectState, Property, Keyframe } from '../types';
import { consoleService } from './console';
import { PathBuilder } from './path';
import React from 'react';

// --- SANDBOX CONFIGURATION ---

const ALLOWED_GLOBALS = new Set([
  'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'JSON', 
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console', 'Infinity', 'NaN', 'undefined',
  'Path' // Allow Path in globals
]);

function createSandbox(context: Record<string, any>) {
  return new Proxy(context, {
    has(target, key: string | symbol) {
      return true; 
    },
    get(target, key: string | symbol) {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) {
        return target[key as string];
      }
      if (typeof key === 'string' && ALLOWED_GLOBALS.has(key)) {
        return (window as any)[key];
      }
      if (typeof key === 'string' && target.ctx && target.ctx.project) {
        const node = target.ctx.project.nodes[key];
        if (node && node.type === 'value') {
            return target.ctx.get(key, 'value');
        }
      }
      return undefined;
    },
    set(target, key, value) {
      return true; 
    },
    defineProperty(target, key, descriptor) {
      return false;
    },
    deleteProperty(target, key) {
      return false;
    }
  });
}

export function detectLinkCycle(
  nodes: Record<string, Node>, 
  sourceNodeId: string, 
  sourcePropKey: string,
  targetNodeId: string,
  targetPropKey: string
): boolean {
  const visited = new Set<string>();
  const sourceKey = `${sourceNodeId}:${sourcePropKey}`;
  const queue = [{ n: targetNodeId, p: targetPropKey }];
  const codeRegex = /ctx\.get\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  const variableNodes = Object.values(nodes).filter(n => n.type === 'value').map(n => n.id);

  while (queue.length > 0) {
    const { n, p } = queue.shift()!;
    const key = `${n}:${p}`;
    if (key === sourceKey) return true;
    if (visited.has(key)) continue;
    visited.add(key);

    const node = nodes[n];
    if (!node) continue;
    const prop = node.properties[p];
    if (!prop) continue;

    if (prop.type === 'ref') {
      const [nextN, nextP] = String(prop.value).split(':');
      queue.push({ n: nextN, p: nextP });
    } else if (prop.type === 'expression') {
      const expression = String(prop.value);
      let match;
      codeRegex.lastIndex = 0;
      while ((match = codeRegex.exec(expression)) !== null) {
          queue.push({ n: match[1], p: match[2] });
      }
      for (const varId of variableNodes) {
          const varRegex = new RegExp(`\\b${varId}\\b`);
          if (varRegex.test(expression)) {
              queue.push({ n: varId, p: 'value' });
          }
      }
    }
  }
  return false;
}

const logCache = new Map<string, { time: number, expression: string }>();

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [0, 0, 0];
}

function rgbToHex(r: number, g: number, b: number): string {
    return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}

function interpolateValue(valA: any, valB: any, t: number, type: string): any {
    if (type === 'number') {
        return lerp(Number(valA), Number(valB), t);
    }
    if (type === 'color') {
        const [r1, g1, b1] = hexToRgb(String(valA));
        const [r2, g2, b2] = hexToRgb(String(valB));
        const r = lerp(r1, r2, t);
        const g = lerp(g1, g2, t);
        const b = lerp(b1, b2, t);
        return rgbToHex(r, g, b);
    }
    return t < 0.5 ? valA : valB;
}

export function evaluateProperty(
    prop: Property | undefined, 
    time: number, 
    context: any = {}, 
    depth = 0,
    debugInfo?: { nodeId: string; propKey: string }
): any {
  if (!prop) return undefined;
  if (depth > 20) {
      return (prop.type === 'number' || prop.type === 'string' || prop.type === 'color') ? prop.value : 0;
  }

  if (prop.type === 'expression') {
    const expression = String(prop.value || '');
    let shouldLog = true;
    if (debugInfo) {
        const cacheKey = `${debugInfo.nodeId}:${debugInfo.propKey}`;
        const lastEntry = logCache.get(cacheKey);
        if (lastEntry && lastEntry.time === time && lastEntry.expression === expression) {
            shouldLog = false;
        } else {
            logCache.set(cacheKey, { time, expression });
        }
    }

    try {
      const safeContextBase = {
          t: time,
          val: 0, 
          ctx: {
             ...context,
             audio: context.audio || { bass: 0, mid: 0, high: 0, treble: 0, fft: [] },
          },
          Path: PathBuilder, // Inject Path class
          prop: (key: string) => {
             if (debugInfo && context.get) {
                 return context.get(debugInfo.nodeId, key, depth + 1);
             }
             return 0;
          },
          console: {
            log: (...args: any[]) => {
                if (debugInfo && shouldLog) consoleService.log('info', args, debugInfo);
            },
            warn: (...args: any[]) => {
                if (debugInfo && shouldLog) consoleService.log('warn', args, debugInfo);
            },
            error: (...args: any[]) => {
                if (debugInfo && shouldLog) consoleService.log('error', args, debugInfo);
            }
          }
      };

      const sandbox = createSandbox(safeContextBase);
      const func = new Function('sandbox', `with(sandbox) { \n${expression}\n }`);
      const result = func(sandbox);

      if (debugInfo) {
          consoleService.clearError(debugInfo.nodeId, debugInfo.propKey);
      }
      
      // Auto-convert PathBuilder to string for renderer
      if (result instanceof PathBuilder) {
          return result.toString();
      }

      return result;

    } catch (e: any) {
      if (debugInfo && shouldLog) {
          consoleService.log('error', [e instanceof Error ? e.message : String(e)], debugInfo);
      }
      return 0; 
    }
  }

  if (prop.type === 'ref') {
    const link = String(prop.value);
    if (link && link.includes(':')) {
       const [targetNodeId, targetPropKey] = link.split(':');
       if (context.get) {
          return context.get(targetNodeId, targetPropKey, depth + 1);
       }
    }
    return 0; 
  }

  if (prop.keyframes && prop.keyframes.length > 0) {
      const kfs = prop.keyframes;
      if (kfs.length === 1) return kfs[0].value;
      if (time <= kfs[0].time) return kfs[0].value;
      if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

      for (let i = 0; i < kfs.length - 1; i++) {
          const k1 = kfs[i];
          const k2 = kfs[i+1];
          if (time >= k1.time && time < k2.time) {
              if (k1.easing === 'step') return k1.value;
              const t = (time - k1.time) / (k2.time - k1.time);
              return interpolateValue(k1.value, k2.value, t, prop.type);
          }
      }
      return kfs[kfs.length - 1].value;
  }
  
  if (prop.type === 'number') {
      const val = Number(prop.value);
      return isNaN(val) ? 0 : val;
  }
  return prop.value;
}

function getReferencedVariables(code: string, variables: Set<string>): Set<string> {
    const refs = new Set<string>();
    if (!code) return refs;
    let i = 0;
    const len = code.length;
  
    while (i < len) {
      const char = code[i];
      if (char === '/' && code[i + 1] === '/') {
        i += 2;
        while (i < len && code[i] !== '\n') i++;
        continue;
      }
      if (char === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        const quote = char;
        i++;
        while (i < len) {
          if (code[i] === '\\') {
            i += 2;
          } else if (code[i] === quote) {
            i++;
            break;
          } else {
            i++;
          }
        }
        continue;
      }
      if (/[a-zA-Z_$]/.test(char)) {
        let start = i;
        while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
        const word = code.slice(start, i);
        let j = start - 1;
        while(j >= 0 && /\s/.test(code[j])) j--;
        const isPropAccess = j >= 0 && code[j] === '.';
        if (!isPropAccess && variables.has(word)) {
          refs.add(word);
        }
        continue;
      }
      i++;
    }
    return refs;
}

export function findUnusedVariables(nodes: Record<string, Node>): Set<string> {
    const variables = new Set<string>();
    const unused = new Set<string>();
    Object.values(nodes).forEach(n => {
        if (n.type === 'value') {
            variables.add(n.id);
            unused.add(n.id);
        }
    });
    Object.values(nodes).forEach(node => {
        Object.values(node.properties).forEach(prop => {
            if (prop.type === 'expression') {
                const expr = String(prop.value);
                const refs = getReferencedVariables(expr, variables);
                refs.forEach(r => unused.delete(r));
                const getRegex = /ctx\.get\(\s*['"]([^'"]+)['"]/g;
                let match;
                while ((match = getRegex.exec(expr)) !== null) {
                    unused.delete(match[1]);
                }
            } else if (prop.type === 'ref') {
                 const link = String(prop.value);
                 if (link.includes(':')) {
                     const [targetId] = link.split(':');
                     unused.delete(targetId);
                 }
            }
        });
    });
    return unused;
}

// --- GRADIENT PARSER ---

export interface GradientDef {
    id: string;
    type: 'linearGradient' | 'radialGradient';
    attrs: Record<string, string>;
    stops: { offset: string, color: string }[];
}

export function parseCssGradient(str: string, id: string): GradientDef | null {
    const isLinear = str.startsWith('linear-gradient');
    const isRadial = str.startsWith('radial-gradient');
    
    if (!isLinear && !isRadial) return null;

    // Extract inside parentheses
    const startParen = str.indexOf('(');
    const endParen = str.lastIndexOf(')');
    if (startParen === -1 || endParen === -1) return null;
    
    const content = str.substring(startParen + 1, endParen);
    
    // Split by comma BUT ignore commas inside nested parentheses (like rgb(0,0,0))
    const parts = content.split(/,(?![^(]*\))/).map(s => s.trim());
    
    let stops: {offset: string, color: string}[] = [];
    let attrs: any = {};
    
    // Check first part for configuration
    let startIndex = 0;
    const first = parts[0];
    
    if (isLinear) {
        // Defaults: Top to Bottom
        attrs = { x1: "0%", y1: "0%", x2: "0%", y2: "100%" };
        
        if (first.includes('to right')) { attrs = { x1: "0%", y1: "0%", x2: "100%", y2: "0%" }; startIndex = 1; }
        else if (first.includes('to bottom right')) { attrs = { x1: "0%", y1: "0%", x2: "100%", y2: "100%" }; startIndex = 1; }
        else if (first.includes('to bottom')) { startIndex = 1; } // default
        else if (first.match(/deg/)) { startIndex = 1; } // Ignore degrees for simple parser
    } else {
        // Defaults: Center
        attrs = { cx: "50%", cy: "50%", r: "50%", fx: "50%", fy: "50%" };
        if (first.includes('circle')) startIndex = 1;
        // else assume stops start immediately
    }

    // Process Stops
    for (let i = startIndex; i < parts.length; i++) {
        const p = parts[i];
        // Split last space to separate color and offset
        const spaceIdx = p.lastIndexOf(' ');
        let color = p;
        let offset = '';
        
        if (spaceIdx > -1) {
            // Check if it's actually a color like "rgb(0, 0, 0)" which has spaces
            // Heuristic: If part 2 starts with %, it's an offset
            const part2 = p.substring(spaceIdx + 1);
            if (part2.includes('%')) {
                color = p.substring(0, spaceIdx);
                offset = part2;
            }
        }
        
        // Auto-assign offsets if missing
        if (!offset) {
            if (i === startIndex) offset = '0%';
            else if (i === parts.length - 1) offset = '100%';
            else {
                // Distribute evenly? Simplified: just guess for middle
                offset = '50%';
            }
        }
        stops.push({ color, offset });
    }
    
    return {
        id,
        type: isLinear ? 'linearGradient' : 'radialGradient',
        attrs,
        stops
    };
}

export function renderSVG(project: ProjectState, audioData?: any, hybridMode: boolean = false) {
  const { width, height, currentTime } = project.meta;
  
  const evalContext: any = { 
      audio: audioData || {},
      project: project, 
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey });
      }
  };

  // REVERSE order for Painter's Algorithm.
  // rootNodeIds[0] is TOP (Foreground).
  const renderOrder = [...project.rootNodeIds].reverse();
  const gradients: GradientDef[] = [];

  const children = renderOrder.map(nodeId => {
    const node = project.nodes[nodeId];
    if (!node) return null;
    if (node.type === 'value') return null; 
    
    const evalProp = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    let fill = evalProp('fill', 'transparent');
    let stroke = evalProp('stroke', 'transparent');
    
    // Gradient Handling
    if (typeof fill === 'string' && (fill.startsWith('linear-gradient') || fill.startsWith('radial-gradient'))) {
        const gradId = `grad_fill_${nodeId}`;
        const def = parseCssGradient(fill, gradId);
        if (def) {
            gradients.push(def);
            fill = `url(#${gradId})`;
        }
    }
    if (typeof stroke === 'string' && (stroke.startsWith('linear-gradient') || stroke.startsWith('radial-gradient'))) {
        const gradId = `grad_stroke_${nodeId}`;
        const def = parseCssGradient(stroke, gradId);
        if (def) {
            gradients.push(def);
            stroke = `url(#${gradId})`;
        }
    }
    
    // In Hybrid mode (WebGPU active), we only use SVG overlay for:
    // 1. Vectors
    // 2. Complex Fills/Strokes (Gradients/URLs)
    if (hybridMode) {
        const isVector = node.type === 'vector';
        const isComplexFill = typeof fill === 'string' && fill.includes('url(#');
        const isComplexStroke = typeof stroke === 'string' && stroke.includes('url(#');
        
        if (!isVector && !isComplexFill && !isComplexStroke) {
            return null; // Skip, let WebGPU handle
        }
    }

    const x = evalProp('x');
    const y = evalProp('y');
    const rotation = evalProp('rotation');
    const scale = evalProp('scale', 1);
    const opacity = evalProp('opacity', 1);
    const strokeWidth = evalProp('strokeWidth', 0);

    const transform = `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;

    if (node.type === 'rect') {
      const w = evalProp('width', 100);
      const h = evalProp('height', 100);
      return React.createElement('rect', {
        key: nodeId,
        x: 0, 
        y: 0, 
        width: w, 
        height: h, 
        fill: fill,
        stroke: stroke,
        strokeWidth: strokeWidth,
        opacity: opacity,
        transform: transform
      });
    } else if (node.type === 'circle') {
      const r = evalProp('radius', 50);
      return React.createElement('circle', {
        key: nodeId,
        cx: r, 
        cy: r, 
        r: r, 
        fill: fill,
        stroke: stroke,
        strokeWidth: strokeWidth,
        opacity: opacity,
        transform: transform
      });
    } else if (node.type === 'vector') {
        const path = evalProp('path', '');
        return React.createElement('path', {
            key: nodeId,
            d: path,
            fill: fill,
            stroke: stroke,
            strokeWidth: strokeWidth,
            opacity: opacity,
            transform: transform
        });
    }
    return null;
  });

  return React.createElement('svg', {
      width: "100%", 
      height: "100%", 
      viewBox: `0 0 ${width} ${height}`,
      xmlns: "http://www.w3.org/2000/svg",
      style: { background: 'transparent' } 
    },
    [
        gradients.length > 0 && React.createElement('defs', { key: 'defs' }, 
            gradients.map(g => 
                React.createElement(g.type, { key: g.id, id: g.id, ...g.attrs },
                    g.stops.map((s, i) => React.createElement('stop', { key: i, offset: s.offset, stopColor: s.color }))
                )
            )
        ),
        ...children
    ]
  );
}
