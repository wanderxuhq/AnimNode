import { Node, ProjectState, Property, Keyframe } from '../types';
import { consoleService } from './console';
import React from 'react';

// --- SANDBOX CONFIGURATION ---

// Safe global objects that expressions are allowed to use
const ALLOWED_GLOBALS = new Set([
  'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'JSON', 
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console', 'Infinity', 'NaN', 'undefined'
]);

/**
 * Creates a proxied sandbox environment.
 * The 'has' trap returns true for everything to force the 'with' statement
 * to look at the proxy for every variable lookup, preventing global scope leakage.
 */
function createSandbox(context: Record<string, any>) {
  return new Proxy(context, {
    // 1. Intercept all variable lookups ("is this variable in scope?")
    has(target, key: string | symbol) {
      return true; 
    },

    // 2. Control read access ("can I read this variable?")
    get(target, key: string | symbol) {
      // Prevent access to Symbol.unscopables to ensure 'with' behaves consistently
      if (key === Symbol.unscopables) return undefined;

      // A. Allow access to specific context variables (t, val, ctx, etc.)
      if (key in target) {
        return target[key as string];
      }

      // B. Allow access to whitelisted globals (Math, Date, etc.)
      if (typeof key === 'string' && ALLOWED_GLOBALS.has(key)) {
        return (window as any)[key];
      }

      // C. Inject Global Variables from Project Nodes
      // If we have a project reference in context, check if the key matches a 'value' node
      if (typeof key === 'string' && target.ctx && target.ctx.project) {
        const node = target.ctx.project.nodes[key];
        if (node && node.type === 'value') {
            // Evaluate the variable's 'value' property.
            // We use ctx.get to handle evaluation, caching, and recursion protection.
            // This enables "const R = 100; node.x = R;" syntax.
            return target.ctx.get(key, 'value');
        }
      }

      // D. Block everything else (window, document, fetch, eval, etc.)
      // Effectively "hiding" the global environment
      return undefined;
    },

    // 3. Block write access ("can I change this variable?") -> NO SIDE EFFECTS
    // AE Expressions cannot modify the environment, they can only return a value.
    set(target, key, value) {
      // Return false to indicate failure (throws TypeError in strict mode)
      // or true to silently swallow the assignment.
      // We'll swallow it to prevent crashing, but effectively make the environment immutable.
      return true; 
    },

    // 4. Block defining new properties
    defineProperty(target, key, descriptor) {
      return false;
    },

    // 5. Block deleting properties
    deleteProperty(target, key) {
      return false;
    }
  });
}

// -----------------------------

/**
 * Helper to detect circular references
 * Returns true if linking source->target would create a cycle
 */
export function detectLinkCycle(
  nodes: Record<string, Node>, 
  sourceNodeId: string, 
  sourcePropKey: string,
  targetNodeId: string,
  targetPropKey: string
): boolean {
  // We want to see if `target` eventually leads back to `source`
  const visited = new Set<string>();
  const sourceKey = `${sourceNodeId}:${sourcePropKey}`;
  
  // BFS Queue
  const queue = [{ n: targetNodeId, p: targetPropKey }];

  // Robust regex to find ctx.get('id', 'prop') calls with flexible spacing/quotes
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
      // 1. Check for ctx.get calls
      let match;
      codeRegex.lastIndex = 0;
      while ((match = codeRegex.exec(expression)) !== null) {
          queue.push({ n: match[1], p: match[2] });
      }

      // 2. Check for implicit variable usage
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

// Cache to suppress duplicate logs/errors when inputs haven't changed (e.g. paused)
const logCache = new Map<string, { time: number, expression: string }>();

// --- INTERPOLATION HELPERS ---

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
    // Fallback for types that can't interpolate smoothly (string, boolean, etc.)
    return t < 0.5 ? valA : valB;
}

/**
 * Evaluates the value of a property at a specific time
 * Supports recursion for linked properties
 */
export function evaluateProperty(
    prop: Property | undefined, 
    time: number, 
    context: any = {}, 
    depth = 0,
    debugInfo?: { nodeId: string; propKey: string }
): any {
  if (!prop) return undefined;
  
  // Prevent infinite recursion (Runtime safeguard)
  if (depth > 20) {
      return (prop.type === 'number' || prop.type === 'string' || prop.type === 'color') ? prop.value : 0;
  }

  // --- 1. HANDLE SPECIAL TYPES (Expression, Ref) ---

  if (prop.type === 'expression') {
    const expression = String(prop.value || '');
    
    // Determine if we should allow logging for this frame
    let shouldLog = true;
    if (debugInfo) {
        const cacheKey = `${debugInfo.nodeId}:${debugInfo.propKey}`;
        const lastEntry = logCache.get(cacheKey);
        
        if (lastEntry && lastEntry.time === time && lastEntry.expression === expression) {
            shouldLog = false;
        } else {
            // Update cache
            logCache.set(cacheKey, { time, expression });
        }
    }

    try {
      // 1. Prepare Safe Context
      const safeContextBase = {
          t: time,
          // val: usually 0 in expression mode, unless we had a mechanism to store a "static base" within expression type
          val: 0, 
          ctx: {
             ...context,
             audio: context.audio || { bass: 0, mid: 0, high: 0, treble: 0, fft: [] },
          },
          // prop('key'): Helper to get sibling properties of the current node
          prop: (key: string) => {
             if (debugInfo && context.get) {
                 return context.get(debugInfo.nodeId, key, depth + 1);
             }
             return 0;
          },
          // Create a proxied console object
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
      return result;

    } catch (e: any) {
      if (debugInfo && shouldLog) {
          consoleService.log('error', [e instanceof Error ? e.message : String(e)], debugInfo);
      }
      return 0; // Fallback
    }
  }

  if (prop.type === 'ref') {
    // Value format: "nodeId:propKey"
    const link = String(prop.value);
    if (link && link.includes(':')) {
       const [targetNodeId, targetPropKey] = link.split(':');
       // Use the context helper to fetch and evaluate the target
       if (context.get) {
          return context.get(targetNodeId, targetPropKey, depth + 1);
       }
    }
    return 0; // Fallback
  }

  // --- 2. HANDLE KEYFRAME INTERPOLATION ---
  if (prop.keyframes && prop.keyframes.length > 0) {
      const kfs = prop.keyframes;
      
      // If only one keyframe
      if (kfs.length === 1) return kfs[0].value;
      
      // Before first keyframe
      if (time <= kfs[0].time) return kfs[0].value;
      // After last keyframe
      if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

      // Find the pair of keyframes surrounding 'time'
      // Simple linear scan (optimization: binary search)
      for (let i = 0; i < kfs.length - 1; i++) {
          const k1 = kfs[i];
          const k2 = kfs[i+1];
          if (time >= k1.time && time < k2.time) {
              if (k1.easing === 'step') return k1.value;
              
              const t = (time - k1.time) / (k2.time - k1.time);
              return interpolateValue(k1.value, k2.value, t, prop.type);
          }
      }
      // Should effectively be caught by "After last keyframe", but fallback:
      return kfs[kfs.length - 1].value;
  }

  // --- 3. HANDLE STATIC TYPES ---
  
  if (prop.type === 'number') {
      const val = Number(prop.value);
      return isNaN(val) ? 0 : val;
  }
  
  // Pass through for other types (string, boolean, object, array, color, etc.)
  return prop.value;
}

/**
 * Lightweight Lexer to find referenced variables in code
 */
function getReferencedVariables(code: string, variables: Set<string>): Set<string> {
    const refs = new Set<string>();
    if (!code) return refs;
    let i = 0;
    const len = code.length;
  
    while (i < len) {
      const char = code[i];
  
      // Skip Comments //
      if (char === '/' && code[i + 1] === '/') {
        i += 2;
        while (i < len && code[i] !== '\n') i++;
        continue;
      }
      // Skip Comments /* */
      if (char === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
  
      // Skip Strings " ' `
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
  
      // Identifiers
      if (/[a-zA-Z_$]/.test(char)) {
        let start = i;
        while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
        const word = code.slice(start, i);
  
        // Check for property access (dot before)
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

/**
 * Static Analysis: Find unused variables
 */
export function findUnusedVariables(nodes: Record<string, Node>): Set<string> {
    const variables = new Set<string>();
    const unused = new Set<string>();
    
    // 1. Collect all variables
    Object.values(nodes).forEach(n => {
        if (n.type === 'value') {
            variables.add(n.id);
            unused.add(n.id);
        }
    });
    
    // 2. Scan all properties
    Object.values(nodes).forEach(node => {
        Object.values(node.properties).forEach(prop => {
            if (prop.type === 'expression') {
                const expr = String(prop.value);
                const refs = getReferencedVariables(expr, variables);
                refs.forEach(r => unused.delete(r));
                
                // Explicit check for ctx.get calls
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

/**
 * Renders the project to an SVG (React Node tree)
 */
export function renderSVG(project: ProjectState, audioData?: any) {
  const { width, height, currentTime } = project.meta;
  
  const evalContext: any = { 
      audio: audioData || {},
      project: project, // Inject project for global variable lookup
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey });
      }
  };

  // REVERSE order for Painter's Algorithm.
  // We want rootNodeIds[0] (Top) to be drawn LAST.
  // We want rootNodeIds[N] (Bottom) to be drawn FIRST.
  const renderOrder = [...project.rootNodeIds].reverse();

  const children = renderOrder.map(nodeId => {
    const node = project.nodes[nodeId];
    if (!node) return null;
    if (node.type === 'value') return null; // Do not render variables visually in SVG

    const evalProp = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    const x = evalProp('x');
    const y = evalProp('y');
    const rotation = evalProp('rotation');
    const scale = evalProp('scale', 1);
    const opacity = evalProp('opacity', 1);
    const fill = evalProp('fill', 'transparent');
    const stroke = evalProp('stroke', 'transparent');
    const strokeWidth = evalProp('strokeWidth', 0);

    const transform = `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;

    if (node.type === 'rect') {
      const w = evalProp('width', 100);
      const h = evalProp('height', 100);
      // Top-left alignment: x=0, y=0
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
      // Top-left alignment: Circle centered at (r, r)
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
      style: { background: '#18181b' }
    },
    // No transform grouping implies 0,0 is top-left
    children
  );
}