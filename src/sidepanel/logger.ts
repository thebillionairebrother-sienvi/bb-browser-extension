// In-memory & persisted debug logger for Billionaire Brother Chrome Extension
// Accessible exclusively to authorized admin/developer accounts (spenceralmodiel@gmail.com)

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory = 'tab' | 'extract' | 'audit' | 'auth' | 'network' | 'system' | 'inspector' | 'swapper';

export interface LogEntry {
  id: string;
  timestamp: string; // HH:mm:ss.SSS
  isoTime: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: any;
}

const STORAGE_KEY = 'bb_debug_logs';
const MAX_LOGS = 200;

class DebugLogger {
  private logs: LogEntry[] = [];
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();
  private saveTimeout: any = null;
  private initialized = false;

  constructor() {
    this.initFromStorage();
    this.hookGlobalErrors();
  }

  private initFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(STORAGE_KEY, (res) => {
        if (res && Array.isArray(res[STORAGE_KEY])) {
          this.logs = res[STORAGE_KEY].slice(-MAX_LOGS);
          this.notify();
        }
        this.initialized = true;
      });
    } else {
      this.initialized = true;
    }
  }

  private hookGlobalErrors() {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      this.error('system', `Uncaught exception: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack || event.error?.message,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('system', `Unhandled promise rejection: ${event.reason?.message || event.reason}`, {
        reason: event.reason?.stack || event.reason,
      });
    });
  }

  private persistLogs() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const toSave = this.logs.slice(-100).map(l => ({
          ...l,
          // Guard against non-serializable objects in details
          details: this.sanitizeDetails(l.details),
        }));
        chrome.storage.local.set({ [STORAGE_KEY]: toSave });
      } catch (err) {
        console.warn('Failed to persist logs:', err);
      }
    }, 400);
  }

  private sanitizeDetails(details: any): any {
    if (details === undefined || details === null) return undefined;
    if (typeof details === 'string' || typeof details === 'number' || typeof details === 'boolean') {
      return details;
    }
    if (details instanceof Error) {
      return { message: details.message, stack: details.stack, name: details.name };
    }
    try {
      return JSON.parse(JSON.stringify(details));
    } catch {
      return String(details);
    }
  }

  private formatTime(date: Date = new Date()): string {
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  private notify() {
    const copy = [...this.logs];
    this.listeners.forEach(fn => fn(copy));
  }

  public log(level: LogLevel, category: LogCategory, message: string, details?: any) {
    const now = new Date();
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatTime(now),
      isoTime: now.toISOString(),
      level,
      category,
      message,
      details: this.sanitizeDetails(details),
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(-MAX_LOGS);
    }

    // Mirror to standard browser console with category tag
    const prefix = `[BB-Ext:${category.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, message, details ?? '');
    else if (level === 'warn') console.warn(prefix, message, details ?? '');
    else if (level === 'debug') console.debug(prefix, message, details ?? '');
    else console.log(prefix, message, details ?? '');

    this.notify();
    this.persistLogs();
  }

  public info(category: LogCategory, message: string, details?: any) {
    this.log('info', category, message, details);
  }

  public warn(category: LogCategory, message: string, details?: any) {
    this.log('warn', category, message, details);
  }

  public error(category: LogCategory, message: string, details?: any) {
    this.log('error', category, message, details);
  }

  public debug(category: LogCategory, message: string, details?: any) {
    this.log('debug', category, message, details);
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove(STORAGE_KEY);
    }
    this.notify();
  }

  public subscribe(fn: (logs: LogEntry[]) => void): () => void {
    this.listeners.add(fn);
    fn([...this.logs]);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public async generateDiagnosticReport(meta: Record<string, any> = {}): Promise<string> {
    let permissionsReport = 'unknown';
    if (typeof chrome !== 'undefined' && chrome.permissions?.getAll) {
      try {
        const perms = await chrome.permissions.getAll();
        permissionsReport = JSON.stringify(perms, null, 2);
      } catch (e: any) {
        permissionsReport = `Error reading permissions: ${e?.message}`;
      }
    }

    const lines: string[] = [
      '# Billionaire Brother Chrome Extension - Diagnostic Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## System & Session Environment',
      '```json',
      JSON.stringify(
        {
          extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.0.17',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          ...meta,
        },
        null,
        2
      ),
      '```',
      '',
      '## Chrome Permissions Held',
      '```json',
      permissionsReport,
      '```',
      '',
      `## Recent Logs (${this.logs.length} entries)`,
      '```text',
    ];

    for (const log of this.logs) {
      let line = `[${log.timestamp}] [${log.level.toUpperCase().padEnd(5)}] [${log.category}] ${log.message}`;
      if (log.details !== undefined) {
        try {
          line += `\n  Details: ${JSON.stringify(log.details)}`;
        } catch {
          line += `\n  Details: ${String(log.details)}`;
        }
      }
      lines.push(line);
    }

    lines.push('```');
    return lines.join('\n');
  }
}

export const logger = new DebugLogger();
