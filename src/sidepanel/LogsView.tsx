import React, { useState, useEffect, useMemo } from 'react';
import { logger, LogEntry, LogLevel, LogCategory } from './logger';

interface LogsViewProps {
  sessionEmail?: string;
  activeTabInfo: {
    id?: number;
    url?: string;
    hostname?: string;
    isSystemPage?: boolean;
    hasPermission?: boolean;
    title?: string;
    windowId?: number;
  };
  apiBase: string;
  onRefreshActiveTab: () => Promise<void>;
  onTestExtract: () => Promise<void>;
}

export default function LogsView({
  sessionEmail,
  activeTabInfo,
  apiBase,
  onRefreshActiveTab,
  onTestExtract,
}: LogsViewProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LogCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    const unsubscribe = logger.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return unsubscribe;
  }, []);

  const counts = useMemo(() => {
    return {
      all: logs.length,
      error: logs.filter((l) => l.level === 'error').length,
      warn: logs.filter((l) => l.level === 'warn').length,
      info: logs.filter((l) => l.level === 'info').length,
      debug: logs.filter((l) => l.level === 'debug').length,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs
      .filter((l) => {
        if (levelFilter !== 'all' && l.level !== levelFilter) return false;
        if (categoryFilter !== 'all' && l.category !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchMsg = l.message.toLowerCase().includes(q);
          const matchCat = l.category.toLowerCase().includes(q);
          const matchDetails = l.details ? JSON.stringify(l.details).toLowerCase().includes(q) : false;
          if (!matchMsg && !matchCat && !matchDetails) return false;
        }
        return true;
      })
      .reverse(); // Newest first
  }, [logs, levelFilter, categoryFilter, searchQuery]);

  const handleCopyReport = async () => {
    try {
      const report = await logger.generateDiagnosticReport({
        sessionEmail,
        apiBase,
        activeTab: activeTabInfo,
      });
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err: any) {
      logger.error('system', `Failed to copy diagnostic report: ${err?.message}`);
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagnosing(true);
    logger.info('tab', '--- Running Manual Tab & Window Diagnostic ---');
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const lastFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        logger.info('tab', `[Diagnostic] lastFocusedWindow tabs (${lastFocused.length}):`, lastFocused);

        const currentWin = await chrome.tabs.query({ active: true, currentWindow: true });
        logger.info('tab', `[Diagnostic] currentWindow tabs (${currentWin.length}):`, currentWin);

        const allActive = await chrome.tabs.query({ active: true });
        logger.info('tab', `[Diagnostic] All windows active tabs (${allActive.length}):`, allActive);
      } else {
        logger.warn('tab', '[Diagnostic] chrome.tabs API not accessible');
      }

      if (typeof chrome !== 'undefined' && chrome.permissions?.getAll) {
        const perms = await chrome.permissions.getAll();
        logger.info('system', '[Diagnostic] Chrome permissions held:', perms);
      }

      await onRefreshActiveTab();
    } catch (e: any) {
      logger.error('tab', `Diagnostic query error: ${e?.message}`, { stack: e?.stack });
    } finally {
      setDiagnosing(false);
    }
  };

  const handleRunExtractTest = async () => {
    setExtracting(true);
    try {
      await onTestExtract();
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="logs-view-container">
      {/* Admin Header Notice */}
      <div className="logs-admin-banner">
        <div className="logs-admin-left">
          <span className="logs-lock-icon">👑</span>
          <div>
            <div className="logs-admin-title">Developer Diagnostic Console</div>
            <div className="logs-admin-subtitle">
              Exclusive to <strong>{sessionEmail || 'spenceralmodiel@gmail.com'}</strong>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-gold btn-sm"
          onClick={handleCopyReport}
          title="Copy markdown diagnostic report for sharing"
        >
          {copied ? '✓ Report Copied!' : '📋 Copy Report'}
        </button>
      </div>

      {/* Active Tab Diagnostic Card */}
      <div className="logs-card">
        <div className="logs-card-header">
          <span className="logs-card-title">Current Tab Status</span>
          <button
            type="button"
            className="logs-mini-btn"
            onClick={handleRunDiagnostics}
            disabled={diagnosing}
          >
            {diagnosing ? '⏳ Diagnosing...' : '🔍 Run Tab Diagnostic'}
          </button>
        </div>
        <div className="logs-tab-grid">
          <div className="logs-tab-item">
            <span className="label">Tab ID:</span>
            <span className="val">{activeTabInfo.id ?? 'None'}</span>
          </div>
          <div className="logs-tab-item">
            <span className="label">Window ID:</span>
            <span className="val">{activeTabInfo.windowId ?? 'N/A'}</span>
          </div>
          <div className="logs-tab-item">
            <span className="label">Site Access:</span>
            <span className={`val ${activeTabInfo.hasPermission ? 'text-green' : 'text-amber'}`}>
              {activeTabInfo.hasPermission ? '✓ Granted' : 'Pending / Not Required'}
            </span>
          </div>
          <div className="logs-tab-item">
            <span className="label">System Page:</span>
            <span className={`val ${activeTabInfo.isSystemPage ? 'text-red' : 'text-green'}`}>
              {activeTabInfo.isSystemPage ? '⚠️ Yes (Restricted)' : 'No (Auditable)'}
            </span>
          </div>
          <div className="logs-tab-item full-width">
            <span className="label">Target URL:</span>
            <span className="val url" title={activeTabInfo.url}>
              {activeTabInfo.url || '(No active tab URL detected)'}
            </span>
          </div>
        </div>

        <div className="logs-quick-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRunExtractTest}
            disabled={extracting}
          >
            {extracting ? '⏳ Testing DOM Extraction...' : '⚡ Test Page Signal Extraction'}
          </button>
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={() => logger.clear()}
          >
            🗑️ Clear Logs
          </button>
        </div>
      </div>

      {/* Log Filters */}
      <div className="logs-controls">
        <div className="logs-level-pills">
          <button
            type="button"
            className={`log-pill ${levelFilter === 'all' ? 'active' : ''}`}
            onClick={() => setLevelFilter('all')}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            className={`log-pill pill-error ${levelFilter === 'error' ? 'active' : ''}`}
            onClick={() => setLevelFilter('error')}
          >
            Errors ({counts.error})
          </button>
          <button
            type="button"
            className={`log-pill pill-warn ${levelFilter === 'warn' ? 'active' : ''}`}
            onClick={() => setLevelFilter('warn')}
          >
            Warns ({counts.warn})
          </button>
          <button
            type="button"
            className={`log-pill pill-info ${levelFilter === 'info' ? 'active' : ''}`}
            onClick={() => setLevelFilter('info')}
          >
            Info ({counts.info})
          </button>
        </div>

        <div className="logs-filter-row">
          <input
            type="text"
            className="logs-search-input"
            placeholder="Search logs (regex or keyword)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="logs-category-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
          >
            <option value="all">All Categories</option>
            <option value="tab">Tab Detection</option>
            <option value="extract">Page Extraction</option>
            <option value="audit">Audit Process</option>
            <option value="network">Network/API</option>
            <option value="auth">Auth & Session</option>
            <option value="system">System / Global</option>
          </select>
        </div>
      </div>

      {/* Log Entries Stream */}
      <div className="logs-stream">
        {filteredLogs.length === 0 ? (
          <div className="logs-empty">
            <p>No matching logs recorded.</p>
            <span className="hint">Interact with the extension or click "Run Tab Diagnostic" above.</span>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            return (
              <div
                key={log.id}
                className={`log-row log-${log.level}`}
                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
              >
                <div className="log-row-main">
                  <span className="log-time">{log.timestamp}</span>
                  <span className={`log-badge badge-${log.level}`}>{log.level}</span>
                  <span className={`log-category cat-${log.category}`}>{log.category}</span>
                  <span className="log-msg">{log.message}</span>
                  {log.details !== undefined && (
                    <span className="log-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  )}
                </div>

                {isExpanded && log.details !== undefined && (
                  <div className="log-details-block" onClick={(e) => e.stopPropagation()}>
                    <pre>
                      {typeof log.details === 'object'
                        ? JSON.stringify(log.details, null, 2)
                        : String(log.details)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
