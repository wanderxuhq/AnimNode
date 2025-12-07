import { ProjectState, Command, Property } from '../types';
import { Commands } from './commands';
import { evaluateProperty } from './engine';

// Helper to extract function body for expressions
const extractBody = (fn: Function | string): string => {
    let str = fn.toString().trim();
    
    // Handle "method" shorthand in objects { run() { ... } } -> "run() { ... }"
    // We want to convert this to an expression body if possible, but usually expressions are arrow functions.
    
    // Match arrow functions: () => ... or arg => ...
    // Note: This regex covers basic cases.
    const arrowRegex = /^(\([^\)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
    const match = arrowRegex.exec(str);
    if (match) {
        const bodyStart = match.index + match[0].length;
        let body = str.substring(bodyStart).trim();
        // If block body { return ... }, extract content
        if (body.startsWith('{') && body.endsWith('}')) {
            return body.substring(1, body.length - 1).trim();
        }
        // Implicit return
        return `return ${body};`;
    }
    
    // Match standard functions: function() { ... }
    const start = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (start > -1 && last > -1) {
        return str.substring(start + 1, last).trim();
    }
    
    // Fallback for simple strings or expressions
    return str; 
};

/**
 * Transforms user script to inject metadata.
 * Main feature: auto-injects variable name into createVariable calls.
 * const MY_VAR = createVariable(100) -> const MY_VAR = createVariable('MY_VAR', 100)
 */
const transformScript = (code: string): string => {
    // Regex breakdown:
    // (const|let|var)  -> Capture declaration keyword
    // \s+
    // ([a-zA-Z_$][a-zA-Z0-9_$]*) -> Capture variable name
    // \s*=\s*
    // createVariable\s*\(  -> Match function call start
    const regex = /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*createVariable\s*\(/g;
    
    return code.replace(regex, (match, keyword, name) => {
        // Inject the name as the first argument string
        return `${keyword} ${name} = createVariable('${name}', `;
    });
};

/**
 * Creates a sandbox context for user scripts.
 */
export const createScriptContext = (
    projectGetter: () => ProjectState,
    commit: (cmd: Command) => void,
    log: (level: 'info' | 'warn' | 'error', msg: any[]) => void
) => {
    const proxyCache = new Map<string, any>();
    // Symbol to safely identify Proxies and retrieve their Node ID without colliding with user properties
    const PROXY_ID_SYMBOL = Symbol('AnimNode.ProxyID');

    const getProxy = (initialId: string) => {
        if (proxyCache.has(initialId)) return proxyCache.get(initialId);
        
        let currentRefId = initialId;
        let currentCacheKey = initialId;
        const proxyTarget = function() {};

        const proxy = new Proxy(proxyTarget, {
            get: (target, prop: string | symbol) => {
                // Internal: Allow retrieval of the Node ID from the proxy
                if (prop === PROXY_ID_SYMBOL) return currentRefId;

                const project = projectGetter();
                const node = project.nodes[currentRefId];
                
                // Allow primitive conversion to support static assignment: node.x = VAR_NODE
                // Also allows math in script: const A = createVariable('A', 10); const B = A + 5;
                if (prop === Symbol.toPrimitive || prop === 'valueOf') {
                     return (hint: string) => {
                         if (node && 'value' in node.properties) {
                             const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                             return evaluateProperty(node.properties.value, project.meta.currentTime, ctx);
                         }
                         return NaN;
                     };
                }
                if (prop === 'toString') {
                     return () => {
                         if (node && 'value' in node.properties) {
                             const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                             const val = evaluateProperty(node.properties.value, project.meta.currentTime, ctx);
                             if (typeof val === 'object') return JSON.stringify(val);
                             return String(val);
                         }
                         return `[Node: ${currentRefId}]`;
                     };
                }
                
                if (!node) return undefined;
                
                // Access Property Value
                if (typeof prop === 'string' && prop in node.properties) {
                    const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                    return evaluateProperty(node.properties[prop], project.meta.currentTime, ctx);
                }
                
                // For Variable Nodes (Object/Array types), allow accessing internal properties directly
                // e.g. const CONFIG = createVariable('C', {speed: 10}); node.x = CONFIG.speed;
                if (node.type === 'value' && node.properties.value) {
                     const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                     const innerValue = evaluateProperty(node.properties.value, project.meta.currentTime, ctx);
                     
                     if (innerValue && (typeof innerValue === 'object' || typeof innerValue === 'function')) {
                         if (prop in innerValue) {
                             const val = (innerValue as any)[prop];
                             if (typeof val === 'function') return val.bind(innerValue);
                             return val;
                         }
                     }
                }

                if (prop === 'id') return node.id;
                if (prop === 'type') return node.type;
                
                return undefined;
            },
            set: (target, prop: string, value: any) => {
                const project = projectGetter();
                const node = project.nodes[currentRefId];
                
                if (!node) {
                    log('error', [`Cannot set '${prop}' of undefined node (ID: ${currentRefId}). Node might have been deleted.`]);
                    return false;
                }

                if (prop === 'id') {
                    const newId = String(value).trim();
                    if (newId === currentRefId) return true;
                    if (!newId) return false;
                    
                    if (project.nodes[newId]) {
                         log('warn', [`Cannot rename '${currentRefId}' to '${newId}': ID already exists.`]);
                         return false;
                    }

                    try {
                        const cmd = Commands.renameNode(currentRefId, newId, project);
                        if (cmd) {
                            commit(cmd);
                            log('info', [`Renamed ${currentRefId} to ID: ${newId}`]);
                            proxyCache.delete(currentCacheKey);
                            proxyCache.set(newId, proxy);
                            currentCacheKey = newId;
                            currentRefId = newId; 
                            return true;
                        } else {
                            log('warn', [`Failed to rename ${currentRefId} to ${newId}`]);
                            return false;
                        }
                    } catch (e: any) {
                        log('error', [`Rename Error: ${e.message}`]);
                        return false;
                    }
                }

                if (!node.properties[prop]) {
                    log('warn', [`Property '${prop}' does not exist on node '${currentRefId}' (${node.type})`]);
                    return false;
                }

                // Construct the Property Update Object
                let propUpdate: Partial<Property> = {};

                // 1. VARIABLE NODE ASSIGNMENT (Proxy)
                // Check if we are assigning a Variable Node (e.g. node.x = MY_VAR)
                // Priority: Check Proxy Symbol first to avoid it being caught as generic function/object
                let isVariableProxy = false;
                let proxyId = '';

                if (value && (typeof value === 'object' || typeof value === 'function')) {
                    try {
                        // Access the ID symbol from the value if it's a proxy
                        const id = (value as any)[PROXY_ID_SYMBOL];
                        if (id) {
                            isVariableProxy = true;
                            proxyId = id;
                        }
                    } catch(e) { /* Ignore */ }
                }

                if (isVariableProxy) {
                    const sourceNode = projectGetter().nodes[proxyId];
                    if (sourceNode && sourceNode.type === 'value') {
                        const sourceType = sourceNode.properties.value.type;
                        
                        // CASE A: Function Variable -> Dynamic Link (Expression)
                        // User Request: "If function type, it is expression."
                        if (sourceType === 'function') {
                             propUpdate = {
                                 mode: 'code',
                                 expression: `return ${proxyId};` // Correctly add 'return'
                             };
                        } 
                        // CASE B: Normal Value (Number/String/Obj) -> Static Snapshot
                        // User Request: "If ordinary value, it is static."
                        else {
                             // Evaluate the variable's current value to snapshot it
                             const ctx: any = { project: projectGetter(), get: (nid: string, pid: string) => evaluateProperty(projectGetter().nodes[nid]?.properties[pid], projectGetter().meta.currentTime, ctx) };
                             const snapshotValue = evaluateProperty(sourceNode.properties.value, projectGetter().meta.currentTime, ctx);
                             
                             propUpdate = {
                                 mode: 'static',
                                 value: snapshotValue
                             };
                        }
                    } else {
                        // Fallback if source not found or not a value node
                         propUpdate = { mode: 'static', value: 0 };
                    }
                } 
                // 2. ARROW FUNCTION ASSIGNMENT (Code Mode)
                else if (typeof value === 'function') {
                    // User assigned an arrow function explicitly: node.x = () => ...
                    const expressionBody = extractBody(value);
                    
                    propUpdate = {
                        mode: 'code',
                        expression: expressionBody,
                        // If it's a value node being assigned a function, verify it supports it
                        ...(node.type === 'value' && prop === 'value' ? { type: 'function', value: value } : {})
                    };
                } 
                // 3. STATIC VALUE ASSIGNMENT
                else {
                    let finalValue = value;
                    const targetType = node.properties[prop].type;

                    if (typeof value === 'object' && value !== null) {
                         // Type Coercion for Primitive Properties
                        if (targetType === 'number') {
                            const n = Number(value); // Triggers valueOf()
                            if (!isNaN(n)) finalValue = n;
                        } else if (targetType === 'string' || targetType === 'color') {
                            finalValue = String(value); // Triggers toString()
                        } else if (targetType === 'boolean') {
                            finalValue = Boolean(value);
                        }
                    }

                    propUpdate = {
                        mode: 'static',
                        value: finalValue
                    };

                    // Special handling for Value Nodes to update 'type' metadata
                    if (node.type === 'value' && prop === 'value') {
                         if (Array.isArray(finalValue)) {
                             propUpdate.type = 'array';
                             try { propUpdate.expression = `return ${JSON.stringify(finalValue)};`; } catch(e) { propUpdate.expression = 'return [];'; }
                         } else if (finalValue !== null && typeof finalValue === 'object') {
                             propUpdate.type = 'object';
                             try { propUpdate.expression = `return ${JSON.stringify(finalValue)};`; } catch(e) { propUpdate.expression = 'return {};'; }
                         } else if (typeof finalValue === 'boolean') {
                             propUpdate.type = 'boolean';
                         } else if (typeof finalValue === 'string') {
                             propUpdate.type = (finalValue.startsWith('#') || finalValue.startsWith('rgb')) ? 'color' : 'string';
                         } else if (typeof finalValue === 'number') {
                             propUpdate.type = 'number';
                         }
                    }
                }

                try {
                    const cmd = Commands.set(project, currentRefId, prop, propUpdate, undefined, `Script: Set ${prop}`);
                    commit(cmd);
                    return true;
                } catch (e: any) {
                    log('error', [`Error setting ${currentRefId}.${prop}: ${e.message}`]);
                    return false;
                }
            },
            apply: (target, thisArg, argumentsList) => {
                // Support calling a variable if it holds a function
                // e.g. const myFunc = createVariable('F', () => {}); myFunc();
                const project = projectGetter();
                const node = project.nodes[currentRefId];
                if (node && node.type === 'value' && node.properties.value) {
                     const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                     const val = evaluateProperty(node.properties.value, project.meta.currentTime, ctx);
                     if (typeof val === 'function') {
                         return val.apply(thisArg, argumentsList);
                     }
                }
                log('error', [`${currentRefId} is not a function`]);
                return undefined;
            }
        });
        
        proxyCache.set(initialId, proxy);
        return proxy;
    };
    
    const uncacheProxy = (id: string) => {
        proxyCache.delete(id);
    };

    const context: any = {};
    const currentProject = projectGetter();
    
    // Inject existing nodes as globals
    currentProject.rootNodeIds.forEach(id => {
        // Ensure ID is a valid JS identifier to avoid syntax errors if injected as global
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
            context[id] = getProxy(id);
        }
    });

    context.log = (...args: any[]) => log('info', args);
    context.warn = (...args: any[]) => log('warn', args);
    context.error = (...args: any[]) => log('error', args);
    context.Math = Math;
    context.t = 0;
    context.ctx = {}; 
    
    context.addNode = (type: 'rect'|'circle'|'vector') => {
        const { command, nodeId } = Commands.addNode(type, projectGetter());
        commit(command);
        log('info', [`Created node: ${nodeId}`]);
        return getProxy(nodeId);
    };

    /**
     * Handles creating variables.
     * Supports two signatures due to script transformation:
     * 1. (arg1: value) -> Untransformed. Name is auto-generated.
     * 2. (arg1: name, arg2: value) -> Transformed. Name is explicit.
     */
    const handleAddVariable = (arg1: any, arg2?: any) => {
        let name: string | undefined;
        let value: any;

        if (arg2 !== undefined) {
            // Transformed case: createVariable('NAME', value)
            name = String(arg1);
            value = arg2;
        } else {
            // Untransformed case: createVariable(value)
            // Or user explicitly called createVariable('name') with no value? Unlikely in this flow.
            // We treat the single argument as the Value.
            value = arg1;
        }

        const { command, nodeId } = Commands.addNode('value', projectGetter());
        commit(command);
        
        // Attempt to rename if name provided
        if (name && name !== nodeId) {
             const renameCmd = Commands.renameNode(nodeId, name, projectGetter());
             if (renameCmd) commit(renameCmd);
             else log('warn', [`Could not name variable '${name}' (likely exists). Using ID '${nodeId}'.`]);
        }
        
        const finalId = (name && projectGetter().nodes[name]) ? name : nodeId;

        if (value !== undefined) {
             let propUpdate: any = {};

             if (typeof value === 'function') {
                 propUpdate = {
                     mode: 'code',
                     type: 'function',
                     expression: extractBody(value),
                     value: value 
                 };
             } else if (Array.isArray(value)) {
                 propUpdate = {
                     mode: 'static',
                     type: 'array',
                     value: value,
                     expression: `return ${JSON.stringify(value)};`
                 };
             } else if (value !== null && typeof value === 'object') {
                 propUpdate = {
                     mode: 'static',
                     type: 'object',
                     value: value,
                     expression: `return ${JSON.stringify(value)};`
                 };
             } else if (typeof value === 'boolean') {
                 propUpdate = { mode: 'static', type: 'boolean', value };
             } else if (typeof value === 'string') {
                 if (value.startsWith('#') || value.startsWith('rgb')) propUpdate = { mode: 'static', type: 'color', value };
                 else propUpdate = { mode: 'static', type: 'string', value };
             } else {
                 propUpdate = { mode: 'static', type: 'number', value };
             }

             const setCmd = Commands.set(projectGetter(), finalId, 'value', propUpdate, undefined, 'Set Initial Value');
             commit(setCmd);
        }
        
        log('info', [`Created variable: ${finalId}`]);
        return getProxy(finalId);
    };

    context.addVariable = handleAddVariable;
    context.createVariable = handleAddVariable; // Alias

    context.removeNode = (id: string) => {
        const cmd = Commands.removeNode(id, projectGetter());
        commit(cmd);
        uncacheProxy(id);
    };

    context.clear = () => {
        const cmd = Commands.clearProject(projectGetter());
        commit(cmd);
        proxyCache.clear();
        log('info', ['Project cleared']);
    };

    return context;
};

/**
 * Executes a string of code within the project context.
 * Standard JS execution with preprocessing.
 */
export const executeScript = (
    code: string, 
    projectGetter: () => ProjectState, 
    commit: (cmd: Command) => void,
    logger: { log: (l: 'info'|'warn'|'error', m: any[]) => void }
) => {
    // 1. Preprocess: Inject variable names from const/let declarations
    const transformedCode = transformScript(code);

    // 2. Create the context with proxies and API
    const context = createScriptContext(projectGetter, commit, (l, m) => logger.log(l, m));
    
    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);
    
    try {
        // Execute raw code with Strict Mode
        const fn = new Function(...paramNames, `"use strict";\n${transformedCode}`);
        fn(...paramValues);
        return true;
    } catch (e: any) {
        logger.log('error', [e.message]);
        return false;
    }
};