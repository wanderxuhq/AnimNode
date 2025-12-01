import { Node, ProjectState, Property } from '../types';
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

      // C. Block everything else (window, document, fetch, eval, etc.)
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
 * Interpolates between keyframes
 */
function interpolate(prop: Property, time: number): any {
  if (!prop.keyframes || !Array.isArray(prop.keyframes)) return prop.value;

  const kfs = [...prop.keyframes].sort((a, b) => a.time - b.time);
  
  if (kfs.length === 0) return prop.value;
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  let startKf = kfs[0];
  let endKf = kfs[1];
  
  for (let i = 0; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time < kfs[i + 1].time) {
      startKf = kfs[i];
      endKf = kfs[i + 1];
      break;
    }
  }

  const duration = endKf.time - startKf.time;
  if (duration === 0) return startKf.value;

  const progress = (time - startKf.time) / duration;

  if (typeof startKf.value === 'number') {
    return startKf.value + (endKf.value - startKf.value) * progress;
  }
  
  return startKf.value;
}

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

  while (queue.length > 0) {
    const { n, p } = queue.shift()!;
    const key = `${n}:${p}`;

    // If we reach the source property, we found a cycle involving the source
    if (key === sourceKey) return true;

    // Prevent infinite loops in the search itself (e.g. searching a separate closed loop)
    if (visited.has(key)) continue;
    visited.add(key);

    const node = nodes[n];
    if (!node) continue;
    const prop = node.properties[p];
    if (!prop) continue;

    if (prop.mode === 'link' && typeof prop.value === 'string' && prop.value.includes(':')) {
      const [nextN, nextP] = prop.value.split(':');
      queue.push({ n: nextN, p: nextP });
    } else if (prop.mode === 'code') {
      // Analyze code for dependencies
      let match;
      // Reset regex state for each property analysis
      codeRegex.lastIndex = 0;
      while ((match = codeRegex.exec(prop.expression)) !== null) {
          queue.push({ n: match[1], p: match[2] });
      }
    }
  }

  return false;
}

// Cache to suppress duplicate logs/errors when inputs haven't changed (e.g. paused)
const logCache = new Map<string, { time: number, expression: string }>();

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
      return prop.mode === 'static' ? prop.value : 0;
  }

  if (prop.mode === 'static') {
    if (prop.type === 'number') {
        const val = Number(prop.value);
        return isNaN(val) ? 0 : val;
    }
    return prop.value;
  }

  if (prop.mode === 'keyframe') {
    return interpolate(prop, time);
  }

  if (prop.mode === 'link') {
    // Value format: "nodeId:propKey"
    if (typeof prop.value === 'string' && prop.value.includes(':')) {
       const [targetNodeId, targetPropKey] = prop.value.split(':');
       // Use the context helper to fetch and evaluate the target
       if (context.get) {
          // Recursively call evaluate via context.get, increasing depth
          // Note: context.get handles passing the correct debugInfo for the *target*
          return context.get(targetNodeId, targetPropKey, depth + 1);
       }
    }
    return 0; // Fallback
  }

  if (prop.mode === 'code') {
    // Determine if we should allow logging for this frame
    let shouldLog = true;
    if (debugInfo) {
        const cacheKey = `${debugInfo.nodeId}:${debugInfo.propKey}`;
        const lastEntry = logCache.get(cacheKey);
        
        // If exact same inputs (time and code) as last run, suppress logs
        // This prevents spamming when paused or during multiple render passes for the same frame
        if (lastEntry && lastEntry.time === time && lastEntry.expression === prop.expression) {
            shouldLog = false;
        } else {
            // Update cache
            logCache.set(cacheKey, { time, expression: prop.expression });
        }
    }

    try {
      // 1. Prepare Safe Context
      const safeContextBase = {
          t: time,
          val: prop.value,
          ctx: {
             ...context,
             audio: context.audio || { bass: 0, mid: 0, high: 0, treble: 0, fft: [] },
             // get is already in context
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

      // 2. Wrap in Sandbox Proxy
      // This ensures 'with' block lookups hit our proxy first
      const sandbox = createSandbox(safeContextBase);

      // 3. Execution (Sandboxed)
      // "with(sandbox)" forces all variable lookups to go through the proxy "has" trap.
      // Since "has" returns true, it tries to get it from the proxy.
      // The proxy "get" trap then decides whether to allow it (whitelisted) or block it (undefined).
      const func = new Function('sandbox', `with(sandbox) { ${prop.expression} }`);
      const result = func(sandbox);

      // Success! Clear any persistent errors for this property
      if (debugInfo) {
          consoleService.clearError(debugInfo.nodeId, debugInfo.propKey);
      }
      return result;

    } catch (e: any) {
      // Capture runtime errors
      // IMPORTANT: Suppress SyntaxError here because this runs 60fps while the user is typing.
      // Explicit syntax validation happens on blur in PropertyInput.
      if (e instanceof SyntaxError) {
        // We still clear runtime errors if it becomes a syntax error (which is handled by UI)
        if (debugInfo) consoleService.clearError(debugInfo.nodeId, debugInfo.propKey);
        return prop.value;
      }

      if (debugInfo && shouldLog) {
          consoleService.log('error', [e instanceof Error ? e.message : String(e)], debugInfo);
      }
      return prop.value;
    }
  }
  
  return prop.value;
}

/**
 * Renders the project to a Canvas context
 */
export function renderCanvas(ctx: CanvasRenderingContext2D, project: ProjectState, audioData?: any) {
  const { width, height } = ctx.canvas;
  const { currentTime } = project.meta;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);

  // Define evaluation context with getter for links
  const evalContext: any = { 
      audio: audioData || {},
      // The get function allows expressions and links to access other nodes
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          // Important: Pass debugInfo for the target property so logs in linked properties are attributed correctly
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey: propKey });
      }
  };

  const renderNode = (nodeId: string) => {
    const node = project.nodes[nodeId];
    if (!node) return;

    ctx.save();

    // Helper to evaluate property with debug info
    const evalProp = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    const x = evalProp('x');
    const y = evalProp('y');
    const rotation = evalProp('rotation');
    const scale = evalProp('scale', 1);

    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    
    const fill = evalProp('fill', '#ffffff');
    ctx.fillStyle = fill;

    if (node.type === 'rect') {
      const w = evalProp('width', 100);
      const h = evalProp('height', 100);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    } else if (node.type === 'circle') {
      const r = evalProp('radius', 50);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  project.rootNodeIds.forEach(renderNode);
  ctx.restore();
}

/**
 * Renders the project to an SVG (React Node tree)
 */
export function renderSVG(project: ProjectState, audioData?: any) {
  const { width, height, currentTime } = project.meta;
  
  const evalContext: any = { 
      audio: audioData || {},
      get: (nodeId: string, propKey: string, depth: number = 0) => {
          const node = project.nodes[nodeId];
          if (!node) return 0;
          const prop = node.properties[propKey];
          return evaluateProperty(prop, currentTime, evalContext, depth, { nodeId, propKey });
      }
  };

  const children = project.rootNodeIds.map(nodeId => {
    const node = project.nodes[nodeId];
    if (!node) return null;

    const evalProp = (key: string, def: any = 0) => 
        evaluateProperty(node.properties[key], currentTime, evalContext, 0, { nodeId, propKey: key }) ?? def;

    const x = evalProp('x');
    const y = evalProp('y');
    const rotation = evalProp('rotation');
    const scale = evalProp('scale', 1);
    const fill = evalProp('fill', '#ffffff');

    const transform = `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;

    if (node.type === 'rect') {
      const w = evalProp('width', 100);
      const h = evalProp('height', 100);
      return React.createElement('rect', {
        key: nodeId,
        x: -w/2, 
        y: -h/2, 
        width: w, 
        height: h, 
        fill: fill,
        transform: transform
      });
    } else if (node.type === 'circle') {
      const r = evalProp('radius', 50);
      return React.createElement('circle', {
        key: nodeId,
        cx: 0, 
        cy: 0, 
        r: r, 
        fill: fill,
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
    React.createElement('g', {
      transform: `translate(${width / 2}, ${height / 2})`
    }, children)
  );
}