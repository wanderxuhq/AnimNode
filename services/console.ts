
import { LogEntry, LogLevel } from '../types';

type Listener = (logs: LogEntry[]) => void;

class ConsoleService {
  private logs: LogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private maxLogs = 1000;
  
  // Track which properties are currently being edited to suppress their runtime errors
  private editingTargets = new Set<string>();
  
  // Track the last log entry per source to enable "Group by Source" deduplication
  // This allows interleaved logs (A, B, A, B) to still group as A(x2), B(x2)
  private lastLogMap = new Map<string, LogEntry>();

  // Generate a simple ID
  private uuid() {
    return Math.random().toString(36).substring(2, 9);
  }

  getLogs() {
    return this.logs;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    // Notify listeners with a copy of logs
    const logsCopy = [...this.logs];
    this.listeners.forEach(l => l(logsCopy));
  }

  clear() {
    this.logs = [];
    this.lastLogMap.clear();
    this.notify();
  }

  // Called when user focuses the code editor
  startEditing(nodeId: string, propKey: string) {
    this.editingTargets.add(`${nodeId}:${propKey}`);
  }

  // Called when user blurs the code editor
  stopEditing(nodeId: string, propKey: string) {
    this.editingTargets.delete(`${nodeId}:${propKey}`);
  }

  // Called by engine when evaluation succeeds
  clearError(nodeId: string, propKey: string) {
    // With the lastLogMap logic, we don't need to explicitly remove errors here.
    // If the error persists, it increments. If a new error occurs, it adds a new line.
    // If no error occurs (successful run), nothing is logged, which is correct.
  }

  log(level: LogLevel, message: any[], meta?: { nodeId: string; propKey: string }) {
    const text = message.map(m => {
        if (typeof m === 'object') {
            try { return JSON.stringify(m); } catch(e) { return String(m); }
        }
        return String(m);
    }).join(' ');

    if (meta) {
        const key = `${meta.nodeId}:${meta.propKey}`;
        
        // 1. If user is typing in this field, don't log runtime errors
        if (level === 'error' && this.editingTargets.has(key)) {
            return;
        }

        // 2. Intelligent Grouping
        // Check if the last log FROM THIS SOURCE matches the current message.
        // This handles the 60fps loop where Node A and Node B might interleave logs.
        const lastLog = this.lastLogMap.get(key);
        
        // Check if the log is still in the main array (hasn't been garbage collected by maxLogs)
        if (lastLog && this.logs.includes(lastLog)) {
             if (lastLog.message === text && lastLog.level === level) {
                 lastLog.count++;
                 lastLog.timestamp = Date.now();
                 this.notify();
                 return;
             }
        }
    }

    // Fallback: Check strictly the very last log in the console (for non-node logs or mixed sources if map fails)
    const absoluteLastLog = this.logs[this.logs.length - 1];
    if (absoluteLastLog && absoluteLastLog.message === text && absoluteLastLog.level === level && absoluteLastLog.nodeId === meta?.nodeId && absoluteLastLog.propKey === meta?.propKey) {
         absoluteLastLog.count++;
         absoluteLastLog.timestamp = Date.now();
         this.notify();
         return;
    }

    const entry: LogEntry = {
      id: this.uuid(),
      timestamp: Date.now(),
      level,
      message: text,
      nodeId: meta?.nodeId,
      propKey: meta?.propKey,
      count: 1
    };

    this.logs.push(entry);
    
    // Update map
    if (meta) {
        this.lastLogMap.set(`${meta.nodeId}:${meta.propKey}`, entry);
    }

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.notify();
  }
}

export const consoleService = new ConsoleService();
