import { ProjectState, Command, Property, PropertyType } from '../types';
import { Commands } from './commands';
import { evaluateProperty } from './engine';

// Helper to extract function body for expressions
const extractBody = (fn: Function | string): string => {
    let str = fn.toString().trim();
    const arrowRegex = /^(\([^\)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
    const match = arrowRegex.exec(str);
    if (match) {
        const bodyStart = match.index + match[0].length;
        let body = str.substring(bodyStart).trim();
        if (body.startsWith('{') && body.endsWith('}')) {
            return body.substring(1, body.length - 1).trim();
        }
        return `return ${body};`;
    }
    const start = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (start > -1 && last > -1) {
        return str.substring(start + 1, last).trim();
    }
    return str; 
};

/**
 * Transforms user script to inject metadata.
 */
const transformScript = (code: string): string => {
    const regex = /(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*createVariable\s*\(/g;
    return code.replace(regex, (match, keyword, name) => {
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
    const PROXY_ID_SYMBOL = Symbol('AnimNode.ProxyID');

    const getProxy = (initialId: string) => {
        if (proxyCache.has(initialId)) return proxyCache.get(initialId);
        
        let currentRefId = initialId;
        let currentCacheKey = initialId;
        const proxyTarget = function() {};

        const proxy = new Proxy(proxyTarget, {
            get: (target, prop: string | symbol) => {
                if (prop === PROXY_ID_SYMBOL) return currentRefId;

                const project = projectGetter();
                const node = project.nodes[currentRefId];
                
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
                
                if (typeof prop === 'string' && prop in node.properties) {
                    const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                    return evaluateProperty(node.properties[prop], project.meta.currentTime, ctx);
                }
                
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
                    log('error', [`Cannot set '${prop}' of undefined node '${currentRefId}'.`]);
                    return false;
                }

                if (prop === 'id') {
                    const newId = String(value).trim();
                    if (newId === currentRefId) return true;
                    if (!newId || project.nodes[newId]) {
                         log('warn', [`Cannot rename '${currentRefId}' to '${newId}'. ID might be taken or invalid.`]);
                         return false;
                    }

                    const cmd = Commands.renameNode(currentRefId, newId, project);
                    if (cmd) {
                        commit(cmd);
                        proxyCache.delete(currentCacheKey);
                        proxyCache.set(newId, proxy);
                        currentCacheKey = newId;
                        currentRefId = newId; 
                        return true;
                    }
                    return false;
                }

                if (!node.properties[prop]) {
                    log('warn', [`Property '${prop}' does not exist on node '${currentRefId}'`]);
                    return false;
                }

                let propUpdate: Partial<Property> = {};
                let isVariableProxy = false;
                let proxyId = '';

                if (value && (typeof value === 'object' || typeof value === 'function')) {
                    try {
                        const id = (value as any)[PROXY_ID_SYMBOL];
                        if (id) {
                            isVariableProxy = true;
                            proxyId = id;
                        }
                    } catch(e) { }
                }

                if (isVariableProxy) {
                    const sourceNode = projectGetter().nodes[proxyId];
                    if (sourceNode && sourceNode.type === 'value') {
                        // Check type of the source variable's content
                        const sourceProp = sourceNode.properties.value;
                        const sourceType = sourceProp.type;
                        
                        if (sourceType === 'function') {
                             propUpdate = {
                                 type: 'expression',
                                 value: `return ${proxyId};` 
                             };
                        } else {
                             const ctx: any = { project: projectGetter(), get: (nid: string, pid: string) => evaluateProperty(projectGetter().nodes[nid]?.properties[pid], projectGetter().meta.currentTime, ctx) };
                             const snapshotValue = evaluateProperty(sourceNode.properties.value, projectGetter().meta.currentTime, ctx);
                             
                             // We don't strictly know the type here if it's dynamic, 
                             // but we can infer from the snapshot value type.
                             let inferredType: PropertyType = 'number';
                             if (typeof snapshotValue === 'string') inferredType = 'string';
                             else if (typeof snapshotValue === 'boolean') inferredType = 'boolean';
                             else if (Array.isArray(snapshotValue)) inferredType = 'array';
                             else if (typeof snapshotValue === 'object') inferredType = 'object';

                             propUpdate = {
                                 type: inferredType,
                                 value: snapshotValue
                             };
                        }
                    } else {
                         propUpdate = { type: 'number', value: 0 };
                    }
                } 
                else if (typeof value === 'function') {
                    propUpdate = {
                        type: 'expression',
                        value: extractBody(value),
                    };
                    // Special case: setting a variable node to a function value
                    if (node.type === 'value' && prop === 'value') {
                         propUpdate.type = 'expression';
                    }
                } 
                else {
                    let finalValue = value;
                    const targetProp = node.properties[prop];
                    let targetType = targetProp.type;
                    
                    if (node.type === 'value' && prop === 'value') {
                         if (Array.isArray(finalValue)) targetType = 'array';
                         else if (typeof finalValue === 'boolean') targetType = 'boolean';
                         else if (typeof finalValue === 'string') targetType = (finalValue.startsWith('#')||finalValue.startsWith('rgb')) ? 'color' : 'string';
                         else if (typeof finalValue === 'number') targetType = 'number';
                         else if (typeof finalValue === 'object') targetType = 'object';
                    }

                    if (targetType === 'number') {
                        const n = Number(value);
                        if (!isNaN(n)) finalValue = n;
                    } else if (targetType === 'string' || targetType === 'color') {
                        finalValue = String(value);
                    } else if (targetType === 'boolean') {
                        finalValue = Boolean(value);
                    } else if (targetType === 'expression' || targetType === 'ref') {
                        if (typeof finalValue === 'number') targetType = 'number';
                        else if (typeof finalValue === 'string') targetType = 'string';
                        else if (typeof finalValue === 'boolean') targetType = 'boolean';
                    }

                    propUpdate = {
                        type: targetType as PropertyType,
                        value: finalValue
                    };
                }

                try {
                    // Pass current project state (workingState) to Commands.set
                    const cmd = Commands.set(project, currentRefId, prop, propUpdate, undefined, `Script: Set ${prop}`);
                    commit(cmd);
                    return true;
                } catch (e: any) {
                    log('error', [`Error setting ${currentRefId}.${prop}: ${e.message}`]);
                    return false;
                }
            },
            apply: (target, thisArg, argumentsList) => {
                const project = projectGetter();
                const node = project.nodes[currentRefId];
                if (node && node.type === 'value' && node.properties.value) {
                     const ctx: any = { project, get: (nid: string, pid: string) => evaluateProperty(project.nodes[nid]?.properties[pid], project.meta.currentTime, ctx) };
                     const val = evaluateProperty(node.properties.value, project.meta.currentTime, ctx);
                     if (typeof val === 'function') {
                         return val.apply(thisArg, argumentsList);
                     }
                }
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
    
    // Register existing nodes
    currentProject.rootNodeIds.forEach(id => {
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
            context[id] = getProxy(id);
        }
    });

    context.log = (...args: any[]) => log('info', args);
    context.warn = (...args: any[]) => log('warn', args);
    context.error = (...args: any[]) => log('error', args);
    context.Math = Math;
    context.Date = Date;
    context.t = 0;
    context.ctx = {}; 
    
    context.addNode = (type: 'rect'|'circle'|'vector') => {
        const { command, nodeId } = Commands.addNode(type, projectGetter());
        commit(command);
        return getProxy(nodeId);
    };

    const handleAddVariable = (arg1: any, arg2?: any) => {
        let name: string | undefined;
        let value: any;

        if (arg2 !== undefined) {
            name = String(arg1);
            value = arg2;
        } else {
            value = arg1;
        }

        const { command, nodeId } = Commands.addNode('value', projectGetter());
        commit(command);
        
        if (name && name !== nodeId) {
             const renameCmd = Commands.renameNode(nodeId, name, projectGetter());
             if (renameCmd) commit(renameCmd);
        }
        
        const finalId = (name && projectGetter().nodes[name]) ? name : nodeId;

        if (value !== undefined) {
             let propUpdate: any = {};
             if (typeof value === 'function') {
                 propUpdate = {
                     type: 'expression',
                     value: extractBody(value)
                 };
             } else if (Array.isArray(value)) {
                 propUpdate = { type: 'array', value: value };
             } else if (value !== null && typeof value === 'object') {
                 propUpdate = { type: 'object', value: value };
             } else if (typeof value === 'boolean') {
                 propUpdate = { type: 'boolean', value: value };
             } else if (typeof value === 'string') {
                 const type = (value.startsWith('#') || value.startsWith('rgb')) ? 'color' : 'string';
                 propUpdate = { type, value: value };
             } else {
                 propUpdate = { type: 'number', value: value };
             }

             const setCmd = Commands.set(projectGetter(), finalId, 'value', propUpdate, undefined, 'Set Initial Value');
             commit(setCmd);
        }
        
        return getProxy(finalId);
    };

    context.addVariable = handleAddVariable;
    context.createVariable = handleAddVariable; 

    context.removeNode = (id: string) => {
        const cmd = Commands.removeNode(id, projectGetter());
        commit(cmd);
        uncacheProxy(id);
    };

    context.moveUp = (nodeOrId: any) => {
        const id = (typeof nodeOrId === 'string') ? nodeOrId : (nodeOrId as any)[PROXY_ID_SYMBOL];
        if (id) {
             const cmd = Commands.moveNodeUp(id, projectGetter());
             if (cmd) commit(cmd);
        }
    };

    context.moveDown = (nodeOrId: any) => {
        const id = (typeof nodeOrId === 'string') ? nodeOrId : (nodeOrId as any)[PROXY_ID_SYMBOL];
        if (id) {
             const cmd = Commands.moveNodeDown(id, projectGetter());
             if (cmd) commit(cmd);
        }
    };

    context.clear = () => {
        const cmd = Commands.clearProject(projectGetter());
        commit(cmd);
        proxyCache.clear();
    };

    return context;
};

/**
 * Executes a script in a transactional way.
 * 
 * To ensure atomicity (all or nothing) and consistency (script sees its own updates),
 * we use a temporary 'workingState'.
 * 
 * 1. 'workingState' starts as a copy of the current project state.
 * 2. Commands executed by the script (addNode, set, etc.) are applied immediately to 'workingState'.
 *    This allows subsequent lines in the script to see these changes (e.g. adding a node then renaming it).
 * 3. These commands are also collected in 'pendingCommands'.
 * 4. If script execution succeeds, we bundle 'pendingCommands' into a single Batch Command
 *    and commit it to the real project history.
 */
export const executeScript = (
    code: string, 
    projectGetter: () => ProjectState, 
    commit: (cmd: Command) => void,
    logger: { log: (l: 'info'|'warn'|'error', m: any[]) => void }
) => {
    const transformedCode = transformScript(code);
    
    // 1. Create a working copy of the state
    // We must use this workingState for all reads during script execution.
    let workingState = projectGetter();
    const pendingCommands: Command[] = [];

    // 2. Define a local commit function that updates working state & collects commands
    const localCommit = (cmd: Command) => {
        pendingCommands.push(cmd);
        // Apply command to local state immediately so script can see the effect
        workingState = cmd.redo(workingState);
    };

    // 3. Define a local getter that returns the working state
    const localGetter = () => workingState;

    // 4. Create context using local state handling
    // IMPORTANT: We pass localGetter, not projectGetter
    const context = createScriptContext(localGetter, localCommit, (l, m) => logger.log(l, m));
    
    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);
    
    try {
        const fn = new Function(...paramNames, `"use strict";\n${transformedCode}`);
        fn(...paramValues);
        
        // 5. If successful, batch all commands into one "Run Script" transaction
        if (pendingCommands.length > 0) {
            commit(Commands.batch(pendingCommands, "Run Script"));
        }
        return true;
    } catch (e: any) {
        logger.log('error', [e.message]);
        return false;
    }
};