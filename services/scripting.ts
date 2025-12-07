import { ProjectState, Command, Property } from '../types';
import { Commands } from './commands';
import { evaluateProperty } from './engine';

/**
 * Creates a sandbox context for user scripts.
 */
export const createScriptContext = (
    projectGetter: () => ProjectState,
    commit: (cmd: Command) => void,
    log: (level: 'info' | 'warn' | 'error', msg: any[]) => void
) => {
    const proxyCache = new Map<string, any>();

    const getProxy = (initialId: string) => {
        if (proxyCache.has(initialId)) return proxyCache.get(initialId);
        
        let currentRefId = initialId;
        let currentCacheKey = initialId;
        const proxyTarget = function() {};

        const proxy = new Proxy(proxyTarget, {
            get: (target, prop: string | symbol) => {
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
                // Commands.set expects Partial<Property>, not just the raw value
                let propUpdate: Partial<Property> = {};

                if (typeof value === 'function') {
                    // CODE MODE: User assigned an arrow function
                    propUpdate = {
                        mode: 'code',
                        expression: `return ${value.toString()};`,
                        // If it's a value node, update type metadata
                        ...(node.type === 'value' && prop === 'value' ? { type: 'function', value: value } : {})
                    };
                } else {
                    // STATIC MODE: User assigned a primitive or object
                    // IMPORTANT: Handle Proxy objects assigned to primitive properties (e.g. node.x = VAR_NODE)
                    // If 'value' is an object but the target prop is primitive, we should coerce it
                    // to trigger valueOf/toString if applicable.
                    
                    let finalValue = value;
                    const targetType = node.properties[prop].type;

                    if (typeof value === 'object' && value !== null) {
                        if (targetType === 'number') {
                            const n = Number(value);
                            if (!isNaN(n)) finalValue = n;
                        } else if (targetType === 'string' || targetType === 'color') {
                            finalValue = String(value);
                        } else if (targetType === 'boolean') {
                            finalValue = Boolean(value);
                        }
                    }

                    propUpdate = {
                        mode: 'static',
                        value: finalValue
                    };

                    // Special handling for Value Nodes (Variables) to update their 'type' metadata
                    if (node.type === 'value' && prop === 'value') {
                         if (Array.isArray(value)) {
                             propUpdate.type = 'array';
                             try { propUpdate.expression = `return ${JSON.stringify(value)};`; } catch(e) { propUpdate.expression = 'return [];'; }
                         } else if (value !== null && typeof value === 'object') {
                             // Check if it's a proxy node? No, treat as object
                             propUpdate.type = 'object';
                             try { propUpdate.expression = `return ${JSON.stringify(value)};`; } catch(e) { propUpdate.expression = 'return {};'; }
                         } else if (typeof value === 'boolean') {
                             propUpdate.type = 'boolean';
                         } else if (typeof value === 'string') {
                             propUpdate.type = (value.startsWith('#') || value.startsWith('rgb')) ? 'color' : 'string';
                         } else if (typeof value === 'number') {
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
    
    currentProject.rootNodeIds.forEach(id => {
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

    context.addVariable = (name: string, value: any) => {
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
                     mode: 'code',
                     type: 'function',
                     expression: `return ${value.toString()};`,
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

// --- TRANSFORMER HELPERS ---

function getBalanceChange(code: string): number {
    let balance = 0;
    let inString: string | null = null;
    let i = 0;
    const len = code.length;
    
    while(i < len) {
        const char = code[i];
        
        if (inString) {
             if (char === '\\') { i+=2; continue; }
             if (char === inString) { inString = null; }
             i++;
             continue;
        }
        
        // Escape sequence outside string (e.g. regex literal or unicode escape)
        if (char === '\\') {
            i += 2;
            continue;
        }
        
        // Check comments
        if (char === '/' && code[i+1] === '/') {
            break; // Rest of line is comment
        }
        if (char === '/' && code[i+1] === '*') {
            i+=2;
            while(i < len && !(code[i] === '*' && code[i+1] === '/')) i++;
            i+=2;
            continue;
        }

        // Check strings
        if (char === '"' || char === "'" || char === '`') {
            inString = char;
            i++;
            continue;
        }
        
        // Brackets
        if (char === '{' || char === '(' || char === '[') balance++;
        if (char === '}' || char === ')' || char === ']') balance--;
        
        i++;
    }
    return balance;
}

function splitValueAndComment(code: string): { valueExpr: string, comment: string } {
    let inString: string | null = null;
    let i = 0;
    const len = code.length;
    let bracketDepth = 0;
    let parenDepth = 0;
    
    while(i < len) {
        const char = code[i];
        
        if (inString) {
            if (char === '\\') { i += 2; continue; }
            if (char === inString) { inString = null; }
        } else {
            if (char === '"' || char === "'" || char === '`') {
                inString = char;
            } else if (char === '{' || char === '[') {
                bracketDepth++;
            } else if (char === '}' || char === ']') {
                bracketDepth--;
            } else if (char === '(') {
                parenDepth++;
            } else if (char === ')') {
                parenDepth--;
            } else if (char === '/' && code[i+1] === '/' && bracketDepth === 0 && parenDepth === 0) {
                return {
                    valueExpr: code.substring(0, i).trim(),
                    comment: code.substring(i)
                };
            }
        }
        i++;
    }
    
    return { valueExpr: code.trim(), comment: '' };
}

// Check if a line ends with an operator that implies continuation
function isIncompleteExpression(code: string): boolean {
    const trimmed = code.trim();
    // Check for arrow function starter
    if (trimmed.endsWith('=>')) return true;
    // Check for common operators that imply more code coming
    if (/[\+\-\*\/\%\,\(\[\{\?\:\&\|\^=]$/.test(trimmed)) return true;
    return false;
}

/**
 * Executes a string of code within the project context.
 * Transforms top-level declarations (const x = ...) into addVariable calls.
 */
export const executeScript = (
    code: string, 
    projectGetter: () => ProjectState, 
    commit: (cmd: Command) => void,
    logger: { log: (l: 'info'|'warn'|'error', m: any[]) => void }
) => {
    // Robust Transformer: Handles multi-line declarations by tracking brace balance
    const lines = code.split('\n');
    let transformedCode = '';
    let buffer = '';
    
    interface DeclState { indent: string, type: string, name: string, balance: number }
    let declState: DeclState | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (declState) {
            buffer += '\n' + line;
            declState.balance += getBalanceChange(line);
            
            // Check if declaration ended (balance returned to 0 or less AND not incomplete)
            if (declState.balance <= 0 && !isIncompleteExpression(buffer)) {
                 let content = buffer.trim();
                 let suffix = '';
                 
                 // Handle explicit semicolon at end of block
                 if (content.endsWith(';')) {
                     content = content.slice(0, -1);
                     suffix = ';';
                 }
                 
                 // Wrap the full multi-line content
                 transformedCode += `${declState.indent}const ${declState.name} = addVariable('${declState.name}', ${content})${suffix}\n`;
                 declState = null;
                 buffer = '';
            }
        } else {
            // Scan for new declaration
            // Matches: const/let/var NAME = ...
            const match = line.match(/^(\s*)(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/);
            
            if (match) {
                const indent = match[1];
                const type = match[2];
                const name = match[3];
                const remainder = match[4];
                
                // EXCLUSION: Do not transform calls to built-in APIs
                // This prevents `const r = addNode(...)` from being wrapped in `addVariable`
                if (/^(addNode|removeNode|clear|log|warn|error|addVariable)\s*\(/.test(remainder.trim())) {
                    transformedCode += line + '\n';
                    continue;
                }

                const balance = getBalanceChange(remainder);
                // If it looks like a multi-line start (positive balance OR ends with operator)
                if (balance > 0 || isIncompleteExpression(remainder)) {
                    // Start of multi-line declaration
                    declState = { indent, type, name, balance };
                    buffer = remainder;
                } else {
                    // Single line declaration
                    let { valueExpr, comment } = splitValueAndComment(remainder);
                    let semi = '';
                    if (valueExpr.endsWith(';')) {
                        valueExpr = valueExpr.slice(0, -1);
                        semi = ';';
                    }
                    transformedCode += `${indent}const ${name} = addVariable('${name}', ${valueExpr})${semi} ${comment}\n`;
                }
            } else {
                // Normal line
                transformedCode += line + '\n';
            }
        }
    }
    
    // Fallback if EOF reached while still in declaration (e.g. missing closing brace)
    if (declState) {
        transformedCode += `${declState.indent}const ${declState.name} = addVariable('${declState.name}', ${buffer});\n`;
    }

    const context = createScriptContext(projectGetter, commit, (l, m) => logger.log(l, m));
    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);
    
    try {
        const fn = new Function(...paramNames, `"use strict"; ${transformedCode}`);
        fn(...paramValues);
        return true;
    } catch (e: any) {
        logger.log('error', [e.message]);
        return false;
    }
};