import { ProjectState, Command } from '../types';
import { Commands } from './commands';

/**
 * Creates a sandbox context for user scripts.
 * Allows syntax like:
 * rect_0.x = 100;
 * rect_0.y = () => t * 10;
 * addNode('circle');
 */
export const createScriptContext = (
    projectGetter: () => ProjectState,
    commit: (cmd: Command) => void,
    log: (level: 'info' | 'warn' | 'error', msg: any[]) => void
) => {
    // Cache map: InitialID -> Proxy
    // We strictly map from the ID at creation time to the proxy instance.
    const proxyCache = new Map<string, any>();

    const getProxy = (initialId: string) => {
        // Since we are creating a context, we can scope variables to manage ID reuse.
        // However, the proxy needs to track if its underlying node ID changed.
        
        // Check cache with current valid ID
        // Note: The caller (createScriptContext body) handles variable assignment.
        // But if 'sun' is created, 'sun' variable holds the proxy.
        if (proxyCache.has(initialId)) return proxyCache.get(initialId);
        
        // Mutable reference ID
        let currentRefId = initialId;
        
        // Track the key this proxy is currently stored under in the cache
        let currentCacheKey = initialId;

        const proxy = new Proxy({}, {
            get: (target, prop: string) => {
                const project = projectGetter();
                const node = project.nodes[currentRefId];
                
                // If node is gone (deleted), return undefined
                // But log a warning if accessed? No, let standard JS undefined behavior handle it unless strictly needed.
                if (!node) {
                     // Optionally log: log('warn', [`Accessing deleted node ${currentRefId}`]);
                     return undefined;
                }
                
                // Allow direct reading of current values
                if (prop in node.properties) {
                    return node.properties[prop].value;
                }
                
                // Metadata access
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

                // 1. Handle ID Change (Rename)
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
                            
                            // CRITICAL FIX: Update Cache Mapping
                            // 1. Remove the old key so it can be reused by new nodes
                            proxyCache.delete(currentCacheKey);
                            
                            // 2. Add the new key pointing to this same proxy
                            proxyCache.set(newId, proxy);
                            
                            // 3. Update internal state
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

                // 2. Handle Property Set
                if (!node.properties[prop]) {
                    log('warn', [`Property '${prop}' does not exist on node '${currentRefId}' (${node.type})`]);
                    return false;
                }

                try {
                    // Generate a Set Command
                    // Commands.set handles static values vs functions automatically
                    const cmd = Commands.set(project, currentRefId, prop, value, undefined, `Script: Set ${prop}`);
                    commit(cmd);
                    // log('info', [`Set ${currentRefId}.${prop}`]); 
                    return true;
                } catch (e: any) {
                    log('error', [`Error setting ${currentRefId}.${prop}: ${e.message}`]);
                    return false;
                }
            }
        });
        
        proxyCache.set(initialId, proxy);
        return proxy;
    };
    
    // Provide a way to clear cache if needed, though 'clear()' command rebuilds state usually.
    // Ideally clear() in script should wipe this cache too, but since createScriptContext is called PER execution,
    // the cache is local to the run.
    
    // However, if we run a script that clears the project, the proxies in the cache are now pointing to deleted nodes.
    // If the script adds new nodes with same IDs, we must ensure we get fresh proxies?
    // Actually, 'addNode' implementation below handles this by calling getProxy.
    // If 'circle_0' was deleted, and added again, 'getProxy' will return the OLD proxy if we don't clear it.
    
    const uncacheProxy = (id: string) => {
        proxyCache.delete(id);
    };

    // Build the Global Context Object
    const context: any = {};
    const currentProject = projectGetter();
    
    // 1. Inject Existing Nodes as variables
    currentProject.rootNodeIds.forEach(id => {
        // Only valid JS identifiers can be global variables
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
            context[id] = getProxy(id);
        }
    });

    // 2. Inject Helper Functions & Globals
    context.log = (...args: any[]) => log('info', args);
    context.warn = (...args: any[]) => log('warn', args);
    context.error = (...args: any[]) => log('error', args);
    context.Math = Math;
    // Inject 't', 'val', 'ctx' as undefined to prevent ReferenceErrors during parsing 
    // of arrow functions if the browser is strict about closure scope, 
    // although they will be bound correctly during engine evaluation.
    context.t = 0;
    context.ctx = {}; 
    
    context.addNode = (type: 'rect'|'circle'|'vector') => {
        // Must fetch fresh state to avoid ID collisions
        const { command, nodeId } = Commands.addNode(type, projectGetter());
        commit(command);
        log('info', [`Created node: ${nodeId}`]);
        return getProxy(nodeId);
    };

    context.removeNode = (id: string) => {
        const cmd = Commands.removeNode(id, projectGetter());
        commit(cmd);
        uncacheProxy(id);
    };

    context.clear = () => {
        const cmd = Commands.clearProject(projectGetter());
        commit(cmd);
        proxyCache.clear(); // Reset proxy cache entirely
        log('info', ['Project cleared']);
    };

    return context;
};

/**
 * Executes a string of code within the project context.
 * IMPORTANT: projectGetter must return the MUTABLE temporary state during script execution
 * so that sequential commands see the effects of previous commands (e.g. addNode then setProp).
 */
export const executeScript = (
    code: string, 
    projectGetter: () => ProjectState, 
    commit: (cmd: Command) => void,
    logger: { log: (l: 'info'|'warn'|'error', m: any[]) => void }
) => {
    // Pass the getter down
    // Use an arrow function to preserve the 'this' context of logger.log
    const context = createScriptContext(projectGetter, commit, (l, m) => logger.log(l, m));
    
    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);
    
    try {
        // Run code inside a function with the context variables as arguments
        // 'use strict' is implicit in modules but explicit here helps
        const fn = new Function(...paramNames, `"use strict"; ${code}`);
        fn(...paramValues);
        return true;
    } catch (e: any) {
        logger.log('error', [e.message]);
        return false;
    }
};