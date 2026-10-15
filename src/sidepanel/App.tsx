import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { exportPdfReport, copyTextReport } from './reportExporter';
import { trackEvent } from '../analytics/ga4';
import MarkdownView from './MarkdownView';
import { logger } from './logger';
import LogsView from './LogsView';

// ── Configuration ──────────────────────────────────────────────
export const PRODUCTION_API_BASE = 'https://thebillionairebrother.com';
export const LOCAL_API_BASE = 'http://localhost:3000';
export const DEFAULT_API_BASE = PRODUCTION_API_BASE;

// ── Types ──────────────────────────────────────────────────────
interface ExtensionSession {
  userId: string;
  email?: string;
  tier?: 'free' | 'brother' | 'team';
  isAdmin?: boolean;
  hasRequiredPlan?: boolean;
}

interface PageSnapshot {
  url: string;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  h3: string[];
  heroCopy: string;
  ctaText: string[];
  pricingBlocks: string[];
  testimonials: string[];
  faqs: string[];
  formLabels: string[];
  repeatedPhrases: string[];
  selectedText: string;
  visibleButtonLabels: string[];
  internalLinks?: string[];
  subPages?: any[];
  screenshot?: string;
  promoImages?: Array<{ src: string; alt: string; title?: string }>;
}

interface LegalTechnicalities {
  summary: string;
  dos: string[];
  donts: string[];
  complianceRisk: 'low' | 'medium' | 'high' | string;
}

interface SeasonalRelevance {
  applicable: boolean;
  currentSeason?: string;
  misalignment?: string[];
  suggestedSeasonalMoves?: string[];
}

interface AuditResult {
  whatThisPageSells: string;
  whoItIsFor: string;
  whatIsStrong: string[];
  whatIsWeak: string[];
  topConversionLeaks: string[];
  bestNextMove: string;
  legalTechnicalities?: LegalTechnicalities;
  seasonalRelevance?: SeasonalRelevance;
}

interface ChatMessage {
  role: 'user' | 'derek';
  content: string;
  reaction?: string;
  gifUrl?: string;
  createdAt?: string;
}

interface HistoryItem {
  id: string;
  createdAt: string;
  status: string;
  url: string;
  title: string;
  auditScope: AuditScope;
  complianceRisk?: string | null;
  whatThisPageSells?: string | null;
  bestNextMove?: string | null;
  hasResult: boolean;
  messageCount: number;
}

interface RunStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result: AuditResult | null;
  error_message: string | null;
  snapshot?: PageSnapshot | null;
  auditScope?: AuditScope;
  messages?: ChatMessage[];
  created_at?: string;
}

type AppState = 'loading' | 'unauthenticated' | 'ready' | 'extracting' | 'auditing' | 'polling' | 'done' | 'error';
type AuditScope = 'page' | 'domain' | 'subpath';
type NavTab = 'audit' | 'history' | 'logs';

function snapshotForStorage(snapshot: PageSnapshot | null) {
  if (!snapshot) return null;
  return {
    url: snapshot.url,
    title: snapshot.title,
    subPages: snapshot.subPages?.map(page => ({ url: page.url, title: page.title })) || [],
  };
}

export function formatFriendlyError(err: any, context: 'extraction' | 'audit' | 'polling'): string {
  const rawInput = (err?.message || (typeof err === 'string' ? err : 'Unknown error')).toString();
  let extractedMsg = rawInput;
  try {
    const jsonStart = rawInput.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(rawInput.slice(jsonStart));
      if (parsed?.error?.message) {
        extractedMsg = `${parsed.error.code || ''} ${parsed.error.status || ''}: ${parsed.error.message}`.trim();
      } else if (parsed?.error && typeof parsed.error === 'string') {
        extractedMsg = parsed.error;
      } else if (parsed?.message) {
        extractedMsg = parsed.message;
      }
    }
  } catch {}

  const combined = `${rawInput} ${extractedMsg}`.toLowerCase();
  const lower = extractedMsg.toLowerCase();

  // 1. AI Model High Demand / 503 Service Unavailable (highest priority so it is never masked)
  if (
    combined.includes('503') ||
    combined.includes('high demand') ||
    combined.includes('unavailable') ||
    combined.includes('overloaded') ||
    combined.includes('model is currently experiencing')
  ) {
    return 'AI Model High Demand (Error 503): The Gemini AI model is currently experiencing high demand. Spikes in demand are temporary — please retry the audit in a few moments.';
  }

  // 2. AI Model Rate Limit / Quota / 429 Resource Exhausted
  if (
    combined.includes('429') ||
    combined.includes('resource_exhausted') ||
    combined.includes('quota') ||
    combined.includes('rate limit')
  ) {
    return 'AI Model Rate Limit (Error 429): The AI audit engine reached a temporary rate or quota limit. Please wait a moment and retry the audit.';
  }

  // 3. Upstream AI API / Project Access Error (403 PERMISSION_DENIED from Gemini API, NOT browser tab permissions)
  if (
    combined.includes('permission_denied') ||
    combined.includes('denied access') ||
    combined.includes('api_key') ||
    combined.includes('api key')
  ) {
    return 'Upstream AI Service Error (403): The AI model provider rejected the request due to an upstream API configuration or access issue. Please try again shortly.';
  }

  // 4. System or restricted browser pages (check before generic extraction errors)
  if (
    combined.includes('browser system pages') ||
    combined.includes('restricted pages') ||
    combined.includes('extensions gallery cannot be scripted') ||
    combined.includes('chromewebstore') ||
    combined.includes('chrome://') ||
    combined.includes('about:') ||
    combined.includes('chrome-extension://') ||
    combined.includes('edge://') ||
    combined.includes('cannot access a chrome')
  ) {
    return 'Cannot audit browser system or web store pages. Please navigate to a standard public website or landing page.';
  }

  // 5. Timeout / Aborted / Deadline Exceeded (differentiated between DOM extraction vs AI server/polling)
  if (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('time out') ||
    lower.includes('err_connection_timed_out') ||
    lower.includes('err_timed_out') ||
    lower.includes('etimedout') ||
    lower.includes('aborted') ||
    lower.includes('signal is aborted') ||
    lower.includes('the operation was aborted') ||
    lower.includes('deadline_exceeded')
  ) {
    if (context === 'extraction') {
      return 'The webpage took too long to respond during DOM extraction. Please verify that the page is fully loaded in your browser and try again.';
    }
    if (context === 'polling') {
      return 'The AI model is taking longer than expected (often caused by temporary Error 503 high demand on Gemini). Your webpage was scanned properly — please retry the audit in a moment.';
    }
    return 'The audit request timed out while waiting for the AI server. The model may be experiencing high demand — please retry the audit in a moment.';
  }

  // 6. Chrome error page or unreachable host
  if (
    lower.includes('chrome-error://') ||
    lower.includes('chromewebdata') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection_refused') ||
    lower.includes('err_connection_reset') ||
    lower.includes('err_internet_disconnected')
  ) {
    return 'This webpage failed to load or is unreachable in your browser. Please ensure the website loads properly, then try auditing again.';
  }

  // 7. Webpage Content Script / Tab Connection issues (during DOM extraction)
  if (
    lower.includes('could not establish connection') ||
    lower.includes('receiving end does not exist') ||
    lower.includes('the message port closed before a response was received') ||
    (context === 'extraction' &&
      (lower.includes('cannot access contents of url') ||
        lower.includes('content script did not return')))
  ) {
    return 'Could not connect to the webpage tab. Please refresh the webpage tab once so the extension can link with the page, then try again.';
  }

  // 8. No active tab or URL detection issues
  if (lower.includes('no active') || lower.includes('no tab')) {
    return 'No active webpage tab was detected. Please ensure your target webpage is open beside this panel, then try again.';
  }
  if (lower.includes('could not read the active tab') || lower.includes('unable to read the active tab') || lower.includes('has no url')) {
    return 'Unable to read the active webpage URL. Please ensure your target webpage is finished loading, then try again.';
  }

  // 9. Network fetch failure
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Unable to reach the Billionaire Brother server. Please check your internet connection or try again shortly.';
  }

  return extractedMsg.replace(/^Error:\s*/i, '');
}

export function classifyErrorUI(error: string | null): {
  title: string;
  tip: string | null;
  needsTabRefresh: boolean;
} {
  const lower = (error || '').toLowerCase();

  if (
    lower.includes('503') ||
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('taking longer than expected')
  ) {
    return {
      title: 'AI Model High Demand (503)',
      tip: 'Gemini is experiencing a temporary spike in traffic (Error 503). This is not a website permission issue — your webpage is ready and you can retry the audit directly below.',
      needsTabRefresh: false,
    };
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return {
      title: 'AI Rate Limit / Quota Reached',
      tip: 'The AI engine hit a temporary rate or usage limit. Wait a few seconds and click Retry Audit below.',
      needsTabRefresh: false,
    };
  }

  if (lower.includes('upstream ai service') || lower.includes('permission_denied') || lower.includes('403')) {
    return {
      title: 'Upstream AI Service Error',
      tip: 'The AI provider returned an upstream service error. Wait a moment and retry the audit below.',
      needsTabRefresh: false,
    };
  }

  if (lower.includes('cannot audit browser system') || lower.includes('restricted')) {
    return {
      title: 'Restricted Browser Page',
      tip: 'Switch to a standard public http:// or https:// website tab and run the audit again.',
      needsTabRefresh: false,
    };
  }

  if (
    lower.includes('webpage took too long') ||
    lower.includes('could not connect to the webpage') ||
    lower.includes('failed to load or is unreachable') ||
    lower.includes('unable to read the active webpage')
  ) {
    return {
      title: lower.includes('webpage took too long') ? 'Webpage Extraction Timeout' : 'Webpage Connection Needed',
      tip: 'Ensure the webpage is completely loaded in your browser tab, or refresh the tab once so the extension can link with the page.',
      needsTabRefresh: true,
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return {
      title: 'AI Audit Request Timed Out',
      tip: 'The server or AI model took too long to respond. Click Retry Audit below to run it again without reloading your tab.',
      needsTabRefresh: false,
    };
  }

  return {
    title: 'Audit Error',
    tip: null,
    needsTabRefresh: false,
  };
}


async function checkSiteAccess(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    // Manifest host_permissions already includes "https://*/*" and "http://*/*",
    // granting host access to all standard web pages without needing runtime prompts.
    return true;
  } catch {
    return false;
  }
}

async function requestSiteAccess(_url: string): Promise<boolean> {
  return true;
}

async function fetchSubPageSnapshot(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    if (new URL(res.url).origin !== new URL(url).origin) return null;
    if (!(res.headers.get('content-type') || '').toLowerCase().includes('text/html')) return null;
    const htmlText = await res.text();
    if (htmlText.length > 2_000_000) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const getText = (selector: string): string[] =>
      Array.from(doc.querySelectorAll(selector))
        .filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 30);

    const heroEl = doc.querySelector('[class*="hero"] h1, [class*="hero"] p, header h1, section:first-of-type h1');
    const heroCopy = (heroEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);

    const ctaKeywords = ['buy', 'sign', 'get', 'start', 'try', 'subscribe', 'join', 'book', 'order', 'download', 'claim', 'request', 'schedule', 'contact'];
    const allInteractive = Array.from(doc.querySelectorAll('a, button, [role="button"], input[type="submit"]'));
    const ctaText = allInteractive
      .map(el => (el.textContent || el.getAttribute('value') || '').trim())
      .filter(t => t.length > 0 && t.length < 100 && ctaKeywords.some(k => t.toLowerCase().includes(k)));

    const priceRegex = /\$[\d,.]+|€[\d,.]+|£[\d,.]+|[\d,.]+ ?\/(mo|month|yr|year)/i;
    const pricingBlocks = Array.from(doc.querySelectorAll('[class*="price"], [class*="pricing"], [class*="plan"], [class*="tier"]'))
      .map(el => (el.textContent || '').trim().substring(0, 500))
      .filter(Boolean);

    return {
      url,
      title: doc.title || '',
      metaDescription: doc.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      h1: getText('h1'),
      h2: getText('h2'),
      h3: getText('h3'),
      heroCopy,
      ctaText: ctaText.slice(0, 10),
      pricingBlocks: pricingBlocks.slice(0, 5),
    };
  } catch {
    return null;
  }
}

// ── App Component ───────────────────────────────────────────────
export function App() {
  const [state, setState] = useState<AppState>('loading');
  const [currentTab, setCurrentTab] = useState<NavTab>('audit');
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditScope, setAuditScope] = useState<AuditScope>('page');
  const [statusHint, setStatusHint] = useState<string>('Scanning active webpage DOM...');
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [apiBase, setApiBase] = useState<string>(PRODUCTION_API_BASE);
  const [showDevServer, setShowDevServer] = useState<boolean>(false);
  const logoClicks = useRef<number>(0);

  const handleLogoClick = () => {
    logoClicks.current += 1;
    if (logoClicks.current >= 5) {
      setShowDevServer(prev => {
        const next = !prev;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ bb_dev_mode: next });
        }
        return next;
      });
      logoClicks.current = 0;
    }
  };

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatSending, setChatSending] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Copy Swapper state
  const [activeSwaps, setActiveSwaps] = useState<Record<string, { id: string; text: string; tagName?: string }>>({});
  const activeSwappedIds = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const id of Object.keys(activeSwaps)) {
      map[id] = true;
    }
    return map;
  }, [activeSwaps]);

  // History state
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Permission & active tab state
  const DEV_EMAIL = 'spenceralmodiel@gmail.com';
  const [cachedDevEmail, setCachedDevEmail] = useState<string>('');
  const [logErrorCount, setLogErrorCount] = useState<number>(0);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['bb_last_user_email'], (res) => {
        if (res?.bb_last_user_email) {
          setCachedDevEmail(res.bb_last_user_email);
        }
      });
    }
    const unsub = logger.subscribe((allLogs) => {
      setLogErrorCount(allLogs.filter(l => l.level === 'error').length);
    });
    return unsub;
  }, []);

  const isDevUser =
    session?.email?.toLowerCase().trim() === DEV_EMAIL ||
    cachedDevEmail.toLowerCase().trim() === DEV_EMAIL;

  const [showPermissionModal, setShowPermissionModal] = useState<boolean>(false);
  const [activeTabInfo, setActiveTabInfo] = useState<{
    id?: number;
    url?: string;
    hostname?: string;
    isSystemPage?: boolean;
    hasPermission: boolean;
    title?: string;
    windowId?: number;
  }>({ hasPermission: true });
  const [tabReloading, setTabReloading] = useState<boolean>(false);
  const [tabReloadedNotice, setTabReloadedNotice] = useState<string | null>(null);

  // Leak Inspector state
  const [activeHighlightedLeak, setActiveHighlightedLeak] = useState<string | null>(null);
  const [inspectorNotice, setInspectorNotice] = useState<{ message: string; type: 'success' | 'warn' } | null>(null);

  /**
   * Robustly resolve the currently active browser tab.
  /**
   * Proactively verifies that the content script (extract-page.js) is active and listening
   * on the target tab. If the script was detached or not yet injected, dynamically injects it.
   */
  const ensureContentScript = async (tabId: number): Promise<boolean> => {
    if (typeof chrome === 'undefined') return false;

    // 1. Check if content script is already listening via ping
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { action: 'GET_SWAP_STATUS' });
      if (ping !== undefined) return true;
    } catch {}

    // 2. Inject content script dynamically via scripting API
    if (chrome.scripting?.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/extract-page.js'],
        });
        // Loop up to 5 times (60ms interval) to verify message listener is live
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 60));
          try {
            const ping = await chrome.tabs.sendMessage(tabId, { action: 'GET_SWAP_STATUS' });
            if (ping !== undefined) return true;
          } catch {}
        }
        return true;
      } catch (err: any) {
        logger.warn('tab', `Failed to inject content script into tab ${tabId}: ${err?.message}`);
        return false;
      }
    }
    return false;
  };

  /**
   * Robustly resolve the currently active browser tab.
   * Handles side-panel focus, multi-window setups, detached panels,
   * pending navigation URLs, and scripting-based URL resolution fallbacks.
   */
  const getActiveTab = useCallback(async (): Promise<chrome.tabs.Tab | null> => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      logger.warn('tab', 'chrome.tabs.query API is not available in current context');
      return null;
    }

    const resolveUrl = async (t: chrome.tabs.Tab): Promise<chrome.tabs.Tab> => {
      if (!t) return t;
      if (!t.url && (t as any).pendingUrl) {
        t.url = (t as any).pendingUrl;
      }
      if (!t.url && t.id && typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: () => window.location.href,
          });
          if (results && results[0]?.result && typeof results[0].result === 'string') {
            t.url = results[0].result;
          }
        } catch (scriptErr: any) {
          logger.debug('tab', `executeScript fallback notice for tab ${t.id}: ${scriptErr?.message}`);
        }
      }
      return t;
    };

    const isUsable = (t?: chrome.tabs.Tab | null): boolean => {
      if (!t?.id) return false;
      const u = t.url || (t as any).pendingUrl;
      if (!u) return true;
      return (
        !u.startsWith('chrome://') &&
        !u.startsWith('chrome-extension://') &&
        !u.startsWith('devtools://') &&
        !u.startsWith('about:') &&
        !u.startsWith('edge://') &&
        !u.includes('chromewebstore.google.com')
      );
    };

    const isWebpage = (t?: chrome.tabs.Tab | null): boolean => {
      if (!isUsable(t)) return false;
      const u = t?.url || (t as any)?.pendingUrl;
      if (!u) return false;
      return u.startsWith('http://') || u.startsWith('https://');
    };

    try {
      // 1. Try currentWindow first: active tab if usable
      const current = await chrome.tabs.query({ active: true, currentWindow: true });
      logger.debug('tab', `currentWindow tabs count: ${current.length}`, current.map(t => ({ id: t.id, url: t.url, windowId: t.windowId })));
      const candidate = current.find(isUsable);
      if (candidate?.id) {
        const resolved = await resolveUrl(candidate);
        logger.info('tab', `Active tab via currentWindow: [${resolved.id}] ${resolved.url || '(no url)'}`);
        return resolved;
      }
    } catch (err: any) {
      logger.warn('tab', `currentWindow query error: ${err?.message}`);
    }

    try {
      // 2. In currentWindow: if active tab is chrome:// (e.g. extension reload), find any open webpage tab in current window
      const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
      const currentWebpage = currentWindowTabs.find(isWebpage);
      if (currentWebpage?.id) {
        const resolved = await resolveUrl(currentWebpage);
        logger.info('tab', `Webpage tab via currentWindow fallback: [${resolved.id}] ${resolved.url || '(no url)'}`);
        return resolved;
      }
    } catch (err: any) {
      logger.warn('tab', `currentWindow fallback query error: ${err?.message}`);
    }

    try {
      // 3. Try lastFocusedWindow next
      const lastFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      logger.debug('tab', `lastFocusedWindow tabs count: ${lastFocused.length}`, lastFocused.map(t => ({ id: t.id, url: t.url, windowId: t.windowId })));
      const candidate = lastFocused.find(isUsable);
      if (candidate?.id) {
        const resolved = await resolveUrl(candidate);
        logger.info('tab', `Active tab via lastFocusedWindow: [${resolved.id}] ${resolved.url || '(no url)'}`);
        return resolved;
      }
    } catch (err: any) {
      logger.warn('tab', `lastFocusedWindow query error: ${err?.message}`);
    }

    try {
      // 4. Across all windows: find any active normal webpage tab
      const all = await chrome.tabs.query({ active: true });
      logger.debug('tab', `all windows active tabs count: ${all.length}`, all.map(t => ({ id: t.id, url: t.url, windowId: t.windowId })));
      const normal = all.find(t => t.id && isWebpage(t));
      if (normal) {
        const resolved = await resolveUrl(normal);
        logger.info('tab', `Active tab via all-windows normal: [${resolved.id}] ${resolved.url}`);
        return resolved;
      }

      // 5. Across all windows: find any open webpage tab
      const allTabs = await chrome.tabs.query({});
      const anyWebpage = allTabs.find(t => t.id && isWebpage(t));
      if (anyWebpage?.id) {
        const resolved = await resolveUrl(anyWebpage);
        logger.info('tab', `Tab via all-windows any webpage: [${resolved.id}] ${resolved.url}`);
        return resolved;
      }
    } catch (err: any) {
      logger.warn('tab', `all-windows query error: ${err?.message}`);
    }

    logger.error('tab', 'Could not detect any active browser tab across all windows');
    return null;
  }, []);

  const updateActiveTabStatus = useCallback(async () => {
    try {
      const tab = await getActiveTab();
      if (!tab) {
        logger.debug('tab', 'updateActiveTabStatus: no tab resolved');
        return;
      }

      const targetUrl = tab.url || (tab as any).pendingUrl || '';
      const isSystemPage =
        targetUrl.startsWith('chrome://') ||
        targetUrl.startsWith('chrome-extension://') ||
        targetUrl.startsWith('about:') ||
        targetUrl.startsWith('edge://') ||
        targetUrl.includes('chromewebstore.google.com');
      let hasPerm = true;
      let hostname = '';

      if (!isSystemPage && targetUrl) {
        try {
          const u = new URL(targetUrl);
          hostname = u.hostname;
          hasPerm = await checkSiteAccess(targetUrl);
        } catch {}
      }

      setActiveTabInfo({
        id: tab.id,
        url: targetUrl,
        title: tab.title,
        windowId: tab.windowId,
        hostname,
        isSystemPage,
        hasPermission: hasPerm,
      });

      logger.debug('tab', `Active tab updated: [${tab.id}] ${hostname || targetUrl || '(empty)'}`);
    } catch (err: any) {
      logger.warn('tab', `updateActiveTabStatus error: ${err?.message}`);
    }
  }, [getActiveTab]);

  useEffect(() => {
    updateActiveTabStatus();
    const onTabActivated = () => updateActiveTabStatus();
    const onTabUpdated = (_tabId: number, changeInfo: any) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        updateActiveTabStatus();
      }
    };
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(onTabActivated);
      chrome.tabs.onUpdated?.addListener(onTabUpdated);
    }
    return () => {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(onTabActivated);
        chrome.tabs.onUpdated?.removeListener(onTabUpdated);
      }
    };
  }, [updateActiveTabStatus]);

  const handleRequestAccessNow = async () => {
    let targetUrl = activeTabInfo.url;
    if (!targetUrl) {
      try {
        const tab = await getActiveTab();
        targetUrl = tab?.url;
      } catch {}
    }
    if (!targetUrl) return;
    try {
      const granted = await requestSiteAccess(targetUrl);
      if (granted) {
        setActiveTabInfo(prev => ({ ...prev, hasPermission: true }));
        setShowPermissionModal(false);
      } else {
        setShowPermissionModal(true);
      }
    } catch {
      setShowPermissionModal(true);
    }
  };

  const handleReloadActiveTab = async () => {
    setTabReloading(true);
    try {
      const tab = await getActiveTab();
      if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.reload) {
        await chrome.tabs.reload(tab.id);
        setTabReloadedNotice('Webpage refreshed! Chrome is ready to prompt for permission.');
        setTimeout(() => setTabReloadedNotice(null), 4000);
        setTimeout(() => updateActiveTabStatus(), 1000);
      }
    } catch (err) {
      console.warn('Tab reload error:', err);
    } finally {
      setTabReloading(false);
    }
  };

  const handleRefreshActiveTabAndRetry = async () => {
    try {
      const tab = await getActiveTab();
      if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.reload) {
        await chrome.tabs.reload(tab.id);
      }
    } catch (e) {
      console.warn('Could not reload tab:', e);
    }
    setAuditScope('page');
    reset();
  };

  const handleCopyText = async () => {
    if (!auditResult) return;
    const success = await copyTextReport(auditResult, snapshot, auditScope);
    if (success) {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
      trackEvent('report_copy', { scope: auditScope }, session?.userId);
    }
  };

  const handleDownloadPdf = () => {
    if (!auditResult) return;
    exportPdfReport(auditResult, snapshot, auditScope);
    trackEvent('report_export_pdf', { scope: auditScope }, session?.userId);
  };

  // ── Leak Inspector Action ──────────────────────────────────────
  const handleHighlightLeak = async (leakText: string) => {
    if (!leakText) return;

    // Toggle off if currently active
    if (activeHighlightedLeak === leakText) {
      try {
        const tab = await getActiveTab();
        if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
          await ensureContentScript(tab.id);
          await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_HIGHLIGHT' });
        }
      } catch {}
      setActiveHighlightedLeak(null);
      setInspectorNotice(null);
      return;
    }

    try {
      const tab = await getActiveTab();
      if (!tab?.id || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        setInspectorNotice({ message: 'Active tab not reachable', type: 'warn' });
        setTimeout(() => setInspectorNotice(null), 3000);
        return;
      }

      await ensureContentScript(tab.id);

      logger.debug('inspector', `Requesting highlight for leak: "${leakText.slice(0, 50)}..." on tab ${tab.id}`);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'HIGHLIGHT_ELEMENT',
        leakText,
      });

      if (response?.success) {
        setActiveHighlightedLeak(leakText);
        const tag = response.matchedTagName ? `<${response.matchedTagName.toLowerCase()}>` : 'element';
        setInspectorNotice({
          message: `Inspecting ${tag} on page! Highlighted in gold.`,
          type: 'success',
        });
        setTimeout(() => setInspectorNotice(null), 4000);
        trackEvent('leak_inspector_highlight', { matchedTag: response.matchedTagName }, session?.userId);
      } else {
        setActiveHighlightedLeak(null);
        setInspectorNotice({
          message: 'Element could not be automatically located on the active page view.',
          type: 'warn',
        });
        setTimeout(() => setInspectorNotice(null), 4000);
      }
    } catch (err: any) {
      logger.warn('inspector', 'Could not send HIGHLIGHT_ELEMENT to tab', err);
      setInspectorNotice({
        message: 'Could not connect to active page. Ensure the tab is loaded.',
        type: 'warn',
      });
      setTimeout(() => setInspectorNotice(null), 4000);
    }
  };

  // ── Copy Swapper Listeners & Handlers ────────────────────────
  useEffect(() => {
    const onMsg = (msg: any) => {
      if (msg?.action === 'COPY_REVERTED_FROM_HUD') {
        setActiveSwaps({});
        setInspectorNotice({
          message: 'Reverted live copy back to original text.',
          type: 'success',
        });
        setTimeout(() => setInspectorNotice(null), 3000);
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onMsg);
      return () => chrome.runtime.onMessage.removeListener(onMsg);
    }
  }, []);

  const handleTestOnPage = async (payload: { id: string; text: string; targetHint: 'headline' | 'subhead' | 'cta' | 'auto'; originalHint?: string }) => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        setInspectorNotice({ message: 'Active tab not reachable', type: 'warn' });
        setTimeout(() => setInspectorNotice(null), 3000);
        return;
      }

      await ensureContentScript(tab.id);

      const enrichedPayload = {
        ...payload,
        newText: payload.text,
        originalHint:
          payload.originalHint ||
          ((payload.targetHint === 'headline' || payload.targetHint === 'auto') ? snapshot?.h1?.[0] : undefined),
      };

      logger.debug('swapper', `Testing rewrite on page: "${enrichedPayload.text.slice(0, 40)}..." [${enrichedPayload.targetHint}]`);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'SWAP_PAGE_COPY',
        payload: enrichedPayload,
      });

      if (response?.success) {
        logger.info('swapper', `Swapped <${response.matchedTagName || 'element'}> on page: "${payload.text.slice(0, 50)}..."`);
        setActiveSwaps(prev => {
          const next = { ...prev };
          if (Array.isArray(response.supersededIds)) {
            for (const oldId of response.supersededIds) {
              delete next[oldId];
            }
          }
          next[payload.id] = { id: payload.id, text: payload.text, tagName: response.matchedTagName };
          return next;
        });
        const tag = response.matchedTagName ? `<${response.matchedTagName.toLowerCase()}>` : 'copy';
        setInspectorNotice({
          message: `Swapped ${tag} on page! Ready to evaluate & screenshot.`,
          type: 'success',
        });
        setTimeout(() => setInspectorNotice(null), 4000);
        trackEvent('copy_swapper_test', { targetHint: payload.targetHint, tag: response.matchedTagName }, session?.userId);
      } else {
        logger.warn('swapper', `Swap did not match element: ${response?.error || 'no response'}`);
        setInspectorNotice({
          message: response?.error || 'Could not locate matching element on the active page view.',
          type: 'warn',
        });
        setTimeout(() => setInspectorNotice(null), 4000);
      }
    } catch (err: any) {
      logger.warn('swapper', 'Failed to swap copy on active page', err);
      setInspectorNotice({
        message: 'Could not connect to active page. Ensure the tab is loaded.',
        type: 'warn',
      });
      setTimeout(() => setInspectorNotice(null), 4000);
    }
  };

  const handleRevertOnPage = async (id: string) => {
    try {
      const tab = await getActiveTab();
      if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'REVERT_PAGE_COPY', id });
      }
      setActiveSwaps(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setInspectorNotice({
        message: 'Reverted copy back to original webpage text.',
        type: 'success',
      });
      setTimeout(() => setInspectorNotice(null), 3000);
    } catch (err) {
      logger.warn('swapper', 'Could not revert copy on tab', err);
    }
  };

  const handleRevertAllOnPage = async () => {
    try {
      const tab = await getActiveTab();
      if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'REVERT_ALL_COPY' });
      }
      setActiveSwaps({});
      setInspectorNotice({
        message: 'Reverted all live copy changes to original.',
        type: 'success',
      });
      setTimeout(() => setInspectorNotice(null), 3000);
    } catch (err) {
      logger.warn('swapper', 'Could not revert all on tab', err);
    }
  };

  // Scroll to bottom of chat when new messages appear
  useEffect(() => {
    if (chatMessages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatSending]);

  const lastSessionCheckRef = useRef<number>(0);
  const sessionRef = useRef<ExtensionSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const buildAuthHeaders = useCallback((extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = { ...(extra || {}) };
    const activeEmail = sessionRef.current?.email || cachedDevEmail;
    const activeUserId = sessionRef.current?.userId;
    if (activeEmail) headers['X-BB-Extension-Email'] = activeEmail;
    if (activeUserId) headers['X-BB-Extension-User-Id'] = activeUserId;
    return headers;
  }, [cachedDevEmail]);

  // ── Auth: check session callback ─────────────────────────────
  const checkSession = useCallback(async (silent = false, targetBase?: string) => {
    const now = Date.now();
    // Throttle background silent session checks to avoid hammering Supabase GoTrue
    if (silent && sessionRef.current && now - lastSessionCheckRef.current < 25000) {
      return true;
    }
    lastSessionCheckRef.current = now;

    const base = targetBase || apiBase;
    try {
      const res = await fetch(`${base}/api/extension/session`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
      });
      if (!res.ok) {
        // Never log out an authenticated user on 5xx / 504 / 522 gateway timeouts
        if (res.status >= 500 && sessionRef.current) {
          logger.warn('auth', `Transient server status ${res.status} during session check; preserving active session.`);
          return true;
        }
        if (!sessionRef.current) {
          setSession(null);
          setState('unauthenticated');
        }
        return false;
      }
      const data = await res.json();
      if (!data.userId || data.userId === 'placeholder-user-id') {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.remove(['bb_cached_session']);
        }
        setSession(null);
        setState('unauthenticated');
        return false;
      }
      const userTier = data.tier || 'free';
      const hasPlan = Boolean(data.hasRequiredPlan ?? (data.tier === 'brother' || data.tier === 'team' || !!data.isAdmin));
      const verifiedSession: ExtensionSession = {
        userId: data.userId,
        email: data.email,
        tier: userTier,
        isAdmin: !!data.isAdmin,
        hasRequiredPlan: hasPlan,
      };
      setSession(verifiedSession);
      sessionRef.current = verifiedSession;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({
          bb_cached_session: verifiedSession,
          ...(data.email ? { bb_last_user_email: data.email } : {}),
        });
      }
      if (data.email) {
        setCachedDevEmail(data.email);
      }
      logger.info('auth', `Session verified: ${data.email || data.userId} (${userTier} tier, plan: ${hasPlan})`);
      trackEvent('session_identified', { tier: userTier, has_plan: hasPlan }, data.userId);
      setState(prev => (prev === 'loading' || prev === 'unauthenticated' ? 'ready' : prev));
      return true;
    } catch (err: any) {
      if (!silent) logger.warn('auth', `Session check failed: ${err?.message}`);
      // Preserve existing session on transient network/timeout errors
      if (sessionRef.current) {
        return true;
      }
      setSession(null);
      setState('unauthenticated');
      return false;
    }
  }, [apiBase, buildAuthHeaders]);

  const handleSwitchApi = (newBase: string) => {
    setApiBase(newBase);
    lastSessionCheckRef.current = 0;
    setState('loading');
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ bb_api_base: newBase });
    }
    checkSession(false, newBase);
  };

  // 1. Load persisted preferences on mount (always start fresh on default audit screen)
  useEffect(() => {
    trackEvent('sidepanel_open');
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      // Clear any prior audit results and scope so reopening always starts fresh on Active Page
      chrome.storage.local.remove(['bb_audit_state', 'bb_audit_snapshot', 'bb_audit_result', 'bb_run_id', 'bb_audit_scope']);

      chrome.storage.local.get([
        'bb_api_base',
        'bb_dev_mode',
        'bb_cached_session',
        'bb_last_user_email',
      ], (res) => {
        if (res.bb_dev_mode || res.bb_api_base === LOCAL_API_BASE) {
          setShowDevServer(true);
        }
        if (res.bb_last_user_email) {
          setCachedDevEmail(res.bb_last_user_email);
        }
        if (res.bb_cached_session && res.bb_cached_session.userId) {
          setSession(res.bb_cached_session);
          sessionRef.current = res.bb_cached_session;
          setState('ready');
        }
        const savedBase = res.bb_api_base || PRODUCTION_API_BASE;
        setApiBase(savedBase);
        checkSession(true, savedBase);
      });
    } else {
      checkSession(true, PRODUCTION_API_BASE);
    }
  }, []);

  // 2. Save state to chrome storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      if (state === 'done' || state === 'ready' || state === 'error' || state === 'polling') {
        chrome.storage.local.set({
          bb_audit_state: state,
          bb_audit_snapshot: snapshotForStorage(snapshot),
          bb_audit_result: auditResult,
          bb_run_id: runId,
          bb_audit_scope: auditScope,
          bb_api_base: apiBase,
        });
      }
    }
  }, [state, snapshot, auditResult, runId, auditScope, apiBase]);

  // 4. Auto-sync on window focus, visibility change, and service worker events
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession(true);
      }
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    const handleMessage = (msg: any) => {
      if (msg?.type === 'AUTH_CHANGED') {
        lastSessionCheckRef.current = 0;
        checkSession(true);
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }

    return () => {
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleMessage);
      }
    };
  }, [checkSession]);

  // 5. Periodic polling while unauthenticated (gentle 10s interval to avoid GoTrue rate-limiting)
  useEffect(() => {
    if (state !== 'unauthenticated') return;
    const interval = setInterval(() => {
      lastSessionCheckRef.current = 0;
      checkSession(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [state, checkSession]);

  // ── History loading ───────────────────────────────────────────
  const loadHistory = useCallback(async (targetBase?: string) => {
    const base = targetBase || apiBase;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${base}/api/extension/history`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data.history || []);
      }
    } catch (e) {
      console.warn('Failed to load audit history:', e);
    } finally {
      setLoadingHistory(false);
    }
  }, [apiBase, buildAuthHeaders]);

  const selectHistoryItem = async (item: HistoryItem) => {
    setState('loading');
    setCurrentTab('audit');
    try {
      const res = await fetch(`${apiBase}/api/extension/runs/${item.id}`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error('Could not fetch audit details');
      const data: RunStatus = await res.json();

      if (data.result) {
        setRunId(item.id);
        setAuditResult(data.result);
        setSnapshot(data.snapshot || ({ url: item.url, title: item.title } as any));
        setAuditScope(data.auditScope || item.auditScope || 'page');
        setChatMessages(data.messages || []);
        setState('done');
      } else {
        throw new Error('Audit result not ready');
      }
    } catch (err: any) {
      setError(`Failed to load past audit: ${err.message}`);
      setState('error');
    }
  };

  // ── Extract page snapshot from active tab ─────────────────────
  const extractPage = useCallback(async () => {
    setState('extracting');
    setError(null);
    logger.info('extract', `Starting page extraction for scope: ${auditScope}...`);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        logger.error('extract', 'No active webpage tab detected', tab);
        throw new Error('No active webpage tab was detected. Please ensure a browser tab is open beside this panel and try again.');
      }

      const targetUrl = tab.url || (tab as any).pendingUrl;
      logger.info('extract', `Target tab detected: [${tab.id}] ${targetUrl || '(no URL)'}`);
      if (!targetUrl) {
        logger.error('extract', 'Target tab has no URL property', tab);
        throw new Error('Could not read the active tab URL. If you just navigated or opened a new tab, please refresh the page and try again.');
      }

      if (
        targetUrl.startsWith('chrome://') ||
        targetUrl.startsWith('chrome-extension://') ||
        targetUrl.startsWith('about:') ||
        targetUrl.startsWith('edge://') ||
        targetUrl.includes('chromewebstore.google.com')
      ) {
        logger.warn('extract', `Restricted browser system page: ${targetUrl}`);
        throw new Error('Cannot audit browser system or web store pages. Please navigate to a standard public website.');
      }

      // Proactively ensure content script is injected and listening
      await ensureContentScript(tab.id);

      // Add 12s timeout race to extraction message so unresponsive pages don't hang indefinitely
      logger.debug('extract', `Sending EXTRACT_PAGE to tab ${tab.id}...`);
      const extractionPromise = chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_PAGE' });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('The webpage took too long to respond and timed out.')), 12000)
      );
      const response: any = await Promise.race([extractionPromise, timeoutPromise]);
      if (!response?.snapshot) {
        logger.error('extract', 'Content script did not return a snapshot', response);
        throw new Error('Content script did not return a snapshot');
      }

      logger.info('extract', `Page snapshot extracted: ${response.snapshot.url}`, {
        title: response.snapshot.title,
        h1Count: response.snapshot.h1?.length,
        ctaCount: response.snapshot.ctaText?.length,
        promoImagesCount: response.snapshot.promoImages?.length,
      });

      setSnapshot(response.snapshot);
      return response.snapshot as PageSnapshot;
    } catch (err: any) {
      logger.error('extract', `Extraction failed: ${err?.message || err}`, {
        raw: String(err),
        stack: err?.stack,
      });
      const friendlyMsg = formatFriendlyError(err, 'extraction');
      setError(friendlyMsg);
      setState('error');
      return null;
    }
  }, [auditScope, getActiveTab]);

  // ── Manual test extraction for developer logs view ───────────
  const handleTestExtract = useCallback(async () => {
    logger.info('extract', '--- Manual Extraction Test Triggered ---');
    try {
      const snap = await extractPage();
      if (snap) {
        logger.info('extract', `Manual extraction test SUCCESS for ${snap.url}`, {
          title: snap.title,
          h1Count: snap.h1?.length || 0,
          h2Count: snap.h2?.length || 0,
          ctaCount: snap.ctaText?.length || 0,
          pricingBlocks: snap.pricingBlocks?.length || 0,
          promoImages: snap.promoImages?.length || 0,
          heroCopyPreview: snap.heroCopy?.slice(0, 100),
        });
      } else {
        logger.warn('extract', 'Manual extraction test returned null snapshot');
      }
    } catch (e: any) {
      logger.error('extract', `Manual extraction test error: ${e?.message}`, { stack: e?.stack });
    }
  }, [extractPage]);

  // ── Submit audit request ──────────────────────────────────────
  const runAudit = useCallback(async () => {
    logger.info('audit', `Initiating runAudit for scope: ${auditScope}`);
    if (session && !session.hasRequiredPlan) {
      logger.warn('audit', 'Audit rejected: required plan missing', session);
      setError('An active Brother or Team plan is required to run webpage audits.');
      setState('error');
      return;
    }

    setStatusHint('Scanning active webpage DOM...');
    const snap = await extractPage();
    if (!snap) return;

    // Multimodal screenshot capture: Capture visible viewport for Derek's visual evaluation
    setStatusHint('Capturing page visual layout & images...');
    try {
      const tab = await getActiveTab();
      let screenshot: string | undefined;
      const winId = tab?.windowId;
      if (typeof winId === 'number' && typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
        try {
          screenshot = await chrome.tabs.captureVisibleTab(winId, {
            format: 'jpeg',
            quality: 75,
          });
        } catch {
          screenshot = (await (chrome.tabs.captureVisibleTab as any)({
            format: 'jpeg',
            quality: 75,
          })) as string | undefined;
        }
      } else if (typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
        screenshot = (await (chrome.tabs.captureVisibleTab as any)({
          format: 'jpeg',
          quality: 75,
        })) as string | undefined;
      }
      if (screenshot) {
        snap.screenshot = screenshot;
        logger.info('audit', `Screenshot captured (${Math.round(screenshot.length / 1024)} KB)`);
      }
    } catch (err: any) {
      logger.info('audit', `Screenshot capture skipped: ${err?.message}`);
    }

    // Handle domain / subpath multi-page extraction
    if ((auditScope === 'domain' || auditScope === 'subpath') && snap.internalLinks && snap.internalLinks.length > 0) {
      setState('extracting');
      setStatusHint(`Discovering key ${auditScope === 'domain' ? 'website' : 'sub-path'} pages...`);

      const targetLinks = snap.internalLinks.filter(link => {
        if (auditScope === 'subpath') {
          const snapDir = snap.url.substring(0, snap.url.lastIndexOf('/') + 1);
          return link.startsWith(snapDir);
        }
        return true;
      });

      const priorityKeywords = ['pricing', 'plan', 'tier', 'about', 'feature', 'product', 'terms', 'privacy', 'legal', 'contact', 'demo'];
      const rankedLinks = [...targetLinks].sort((a, b) => {
        const aScore = priorityKeywords.reduce((acc, k) => acc + (a.toLowerCase().includes(k) ? 2 : 0), 0);
        const bScore = priorityKeywords.reduce((acc, k) => acc + (b.toLowerCase().includes(k) ? 2 : 0), 0);
        return bScore - aScore;
      }).slice(0, 4);

      if (rankedLinks.length > 0) {
        setStatusHint(`Extracting snapshot data from ${rankedLinks.length} key site pages...`);
        const subSnapshots = await Promise.all(rankedLinks.map(url => fetchSubPageSnapshot(url)));
        snap.subPages = subSnapshots.filter(Boolean);
      }
    }

    delete snap.internalLinks;

    let domain = '';
    try {
      domain = new URL(snap.url).hostname;
    } catch {}
    trackEvent('audit_start', { scope: auditScope, domain }, session?.userId);

    setState('auditing');
    setStatusHint('Submitting visual & DOM payload to Gemini 3.8 Flash...');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

      const res = await fetch(`${apiBase}/api/extension/audit`, {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snapshot: snap, auditScope }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        logger.error('network', `Audit API responded with error status ${res.status}`, errData);
        if (res.status === 401 && !sessionRef.current) {
          setSession(null);
          setState('unauthenticated');
          return;
        }
        throw new Error(errData.error || `API returned ${res.status}`);
      }

      const data = await res.json();
      logger.info('audit', `Audit job queued successfully: runId=${data.runId}`);
      setRunId(data.runId);
      setChatMessages([]);
      setState('polling');
    } catch (err: any) {
      logger.error('audit', `Audit request error: ${err?.message || err}`, { stack: err?.stack });
      trackEvent('audit_error', { reason: err.message || 'unknown' }, session?.userId);
      if (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')) && !sessionRef.current) {
        setSession(null);
        setState('unauthenticated');
        return;
      }
      const friendlyMsg = formatFriendlyError(err, 'audit');
      setError(friendlyMsg);
      setState('error');
    }
  }, [extractPage, session, auditScope, apiBase, getActiveTab, buildAuthHeaders]);

  // ── Poll for result ───────────────────────────────────────────
  useEffect(() => {
    if (state !== 'polling' || !runId) return;

    const startTime = Date.now();
    const MAX_POLL_TIME_MS = 90000; // 90s timeout for audit completion (allows fallback retries on 503)

    const pollInterval = setInterval(async () => {
      if (Date.now() - startTime > MAX_POLL_TIME_MS) {
        clearInterval(pollInterval);
        setError(formatFriendlyError(new Error('timeout'), 'polling'));
        setState('error');
        trackEvent('audit_failed', { reason: 'polling_timeout' }, session?.userId);
        return;
      }

      try {
        const res = await fetch(`${apiBase}/api/extension/runs/${runId}`, {
          credentials: 'include',
          headers: buildAuthHeaders(),
        });
        if (!res.ok) {
          logger.warn('audit', `Poll attempt HTTP error status ${res.status}`);
          return;
        }

        const data: RunStatus = await res.json();
        logger.debug('audit', `Poll run [${runId}]: status=${data.status}`);

        if (data.status === 'completed' && data.result) {
          logger.info('audit', `Audit run [${runId}] completed successfully!`);
          setAuditResult(data.result);
          if (data.messages && data.messages.length > 0) {
            setChatMessages(data.messages);
          }
          setState('done');
          clearInterval(pollInterval);
          trackEvent('audit_completed', {
            scope: auditScope,
            compliance_risk: data.result.legalTechnicalities?.complianceRisk || 'unknown',
          }, session?.userId);
        } else if (data.status === 'failed') {
          logger.error('audit', `Server audit run [${runId}] reported failure:`, data.error_message);
          const rawError = data.error_message || 'Audit failed on server';
          setError(formatFriendlyError(new Error(rawError), 'audit'));
          setState('error');
          clearInterval(pollInterval);
          trackEvent('audit_failed', { reason: data.error_message || 'failed' }, session?.userId);
        }
      } catch (pollErr: any) {
        logger.warn('audit', `Poll request failed: ${pollErr?.message || pollErr}`);
      }
    }, 2500);

    return () => {
      clearInterval(pollInterval);
    };
  }, [state, runId, auditScope, session?.userId, apiBase, buildAuthHeaders]);

  // ── Send Derek Follow-up Chat Message ─────────────────────────
  const sendChatMessage = async (overridePrompt?: string) => {
    const text = (overridePrompt || chatInput).trim();
    if (!text || chatSending) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setChatSending(true);

    try {
      const res = await fetch(`${apiBase}/api/extension/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          runId,
          message: text,
          chatHistory: newHistory,
          auditResult,
          snapshot: snapshotForStorage(snapshot),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      const derekMsg: ChatMessage = {
        role: 'derek',
        content: data.response,
        reaction: data.reaction,
        gifUrl: data.gifUrl || undefined,
        createdAt: new Date().toISOString(),
      };

      const updatedHistory = [...newHistory, derekMsg];
      setChatMessages(updatedHistory);

      if (runId && typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [`bb_chat_${runId}`]: updatedHistory });
      }
    } catch (err: any) {
      const friendlyChatError = formatFriendlyError(err, 'audit');
      const is503 = friendlyChatError.toLowerCase().includes('503') || friendlyChatError.toLowerCase().includes('high demand');
      const errMsg: ChatMessage = {
        role: 'derek',
        content: friendlyChatError,
        reaction: is503 ? 'AI High Demand (503)' : 'Service Issue',
        createdAt: new Date().toISOString(),
      };
      setChatMessages([...newHistory, errMsg]);
    } finally {
      setChatSending(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────
  const reset = () => {
    trackEvent('audit_reset', undefined, session?.userId);
    setState('ready');
    setCurrentTab('audit');
    setSnapshot(null);
    setAuditResult(null);
    setRunId(null);
    setError(null);
    setCopiedText(false);
    setChatMessages([]);
    setChatInput('');
    setActiveHighlightedLeak(null);
    setActiveSwaps({});
    setInspectorNotice(null);
    setAuditScope('page');
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      getActiveTab().then(tab => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_HIGHLIGHT' }).catch(() => {});
          chrome.tabs.sendMessage(tab.id, { action: 'REVERT_ALL_COPY' }).catch(() => {});
        }
      }).catch(() => {});
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove(['bb_audit_state', 'bb_audit_snapshot', 'bb_audit_result', 'bb_run_id', 'bb_audit_scope']);
    }
  };

  const renderTierBadge = (tier?: string, isAdmin?: boolean) => {
    const normalized = (tier || '').toLowerCase();
    if (normalized === 'team') {
      return <span className="badge badge-team">Team Plan</span>;
    }
    if (normalized === 'brother' || isAdmin) {
      return <span className="badge badge-brother">Brother Plan</span>;
    }
    return <span className="badge badge-free">Free Tier</span>;
  };

  const renderRiskBadge = (risk?: string) => {
    const r = (risk || 'medium').toLowerCase();
    let badgeClass = 'risk-badge risk-medium';
    let label = 'MEDIUM RISK';

    if (r.includes('low')) {
      badgeClass = 'risk-badge risk-low';
      label = 'LOW RISK';
    } else if (r.includes('high')) {
      badgeClass = 'risk-badge risk-high';
      label = 'HIGH RISK';
    }

    return <span className={badgeClass}>{label}</span>;
  };

  const renderScopeBadge = () => {
    if (auditScope === 'domain') {
      return <span className="scope-tag tag-domain">🌐 Entire Website</span>;
    }
    if (auditScope === 'subpath') {
      return <span className="scope-tag tag-subpath">📁 Sub-pages</span>;
    }
    return <span className="scope-tag tag-page">📄 Active Page</span>;
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <div className="header-top">
          <div className="brand flex-center">
            <div
              className="logo-icon"
              onClick={handleLogoClick}
              title="Billionaire Brother"
              style={{ cursor: 'pointer' }}
            >
              BB
            </div>
            <div className="brand-text">
              <h1>Billionaire Brother</h1>
              <span className="subtitle">Visual & Strategic Audit</span>
            </div>
          </div>
        </div>

        {/* Server Target Switcher (Active in Dev Mode) */}
        {showDevServer && (
          <div className="env-bar">
            <span className="env-label">Dev Server:</span>
            <div className="env-toggle-group">
              <button
                type="button"
                className={`env-btn ${apiBase === LOCAL_API_BASE ? 'active env-local' : ''}`}
                onClick={() => handleSwitchApi(LOCAL_API_BASE)}
                title="Connect to local dev server (http://localhost:3000)"
              >
                💻 Local (3000)
              </button>
              <button
                type="button"
                className={`env-btn ${apiBase === PRODUCTION_API_BASE ? 'active env-prod' : ''}`}
                onClick={() => handleSwitchApi(PRODUCTION_API_BASE)}
                title="Connect to production (thebillionairebrother.com)"
              >
                🌐 Production
              </button>
            </div>
          </div>
        )}

        {session && (
          <div className="account-card">
            <div className="account-info">
              <span className={`status-dot ${session.hasRequiredPlan ? 'active' : 'upgrade-needed'}`} />
              <span className="account-email" title={session.email}>
                {session.email || 'Authenticated User'}
              </span>
            </div>
            <div className="account-badge">
              {renderTierBadge(session.tier, session.isAdmin)}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="panel-nav">
          <button
            type="button"
            className={`nav-tab ${currentTab === 'audit' ? 'active' : ''}`}
            onClick={() => setCurrentTab('audit')}
          >
            ⚡ Audit Engine
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'history' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTab('history');
              loadHistory();
            }}
          >
            🕒 Past Audits & Chats
          </button>
          {isDevUser && (
            <button
              type="button"
              className={`nav-tab nav-tab-dev ${currentTab === 'logs' ? 'active' : ''}`}
              onClick={() => setCurrentTab('logs')}
              title="Developer Diagnostics Console (Spencer Almodiel only)"
            >
              🛠️ Logs
              {logErrorCount > 0 && (
                <span className="dev-error-badge">{logErrorCount}</span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* ── History Tab View ── */}
      {currentTab === 'history' && (
        <div className="history-container">
          <div className="history-header-row">
            <h2>Audit History</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadHistory()}
              disabled={loadingHistory}
            >
              🔄 Refresh
            </button>
          </div>

          {loadingHistory ? (
            <div className="state-msg">
              <div className="spinner" />
              <p>Fetching your past audits...</p>
            </div>
          ) : historyList.length === 0 ? (
            <div className="card-box empty-history-card">
              <div className="empty-icon">📁</div>
              <h3>No Audits Yet</h3>
              <p className="hint">
                Run audits on any webpage to save findings and chat history here.
              </p>
              <button
                type="button"
                className="btn btn-gold btn-full"
                onClick={() => setCurrentTab('audit')}
                style={{ marginTop: '12px' }}
              >
                Run a Webpage Audit
              </button>
            </div>
          ) : (
            <div className="history-list">
              {historyList.map(item => (
                <div
                  key={item.id}
                  className="history-card"
                  onClick={() => selectHistoryItem(item)}
                >
                  <div className="history-card-top">
                    <span className="history-card-title">{item.title || item.url}</span>
                    <span className="history-date">
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </div>

                  <p className="history-card-url" title={item.url}>{item.url}</p>

                  {item.whatThisPageSells && (
                    <p className="history-card-summary">{item.whatThisPageSells}</p>
                  )}

                  <div className="history-card-footer">
                    <span className={`scope-tag tag-${item.auditScope || 'page'}`}>
                      {item.auditScope === 'domain' ? '🌐 Domain' : item.auditScope === 'subpath' ? '📁 Sub-pages' : '📄 Page'}
                    </span>
                    {item.complianceRisk && renderRiskBadge(item.complianceRisk)}
                    {item.messageCount > 0 && (
                      <span className="chat-badge">💬 {item.messageCount} messages</span>
                    )}
                    <span className="history-view-btn">View Audit →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Main Audit Tab View ── */}
      {currentTab === 'audit' && (
        <>
          {state === 'loading' && (
            <div className="state-msg">
              <div className="spinner" />
              <p>Connecting to Billionaire Brother...</p>
            </div>
          )}

          {state === 'unauthenticated' && (
            <div className="card-box auth-card">
              <div className="auth-icon">🔒</div>
              <h2>Authentication Required</h2>
              <p className="hint">
                You must be logged into your Billionaire Brother account to execute live audits.
              </p>
              <a href={`${apiBase}/auth`} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-full" style={{ marginBottom: '8px' }}>
                Log In to Billionaire Brother
              </a>
              <button className="btn btn-secondary btn-full" onClick={() => checkSession(false)}>
                🔄 Check Login Status
              </button>
            </div>
          )}

          {state === 'ready' && (
            <div className="content-container">
              {!session?.hasRequiredPlan ? (
                <div className="card-box upgrade-card">
                  <div className="card-badge-header">
                    <span className="warning-icon">⚡</span>
                    <span className="card-title">Brother or Team Plan Required</span>
                  </div>
                  <p className="card-desc">
                    The BB Audit & Execution Engine requires a linked account with an active <strong>Brother Plan</strong> or <strong>Team Plan</strong>.{' '}
                    <a href={`${apiBase}/#pricing`} target="_blank" rel="noopener noreferrer">
                      See current plan pricing
                    </a>.
                  </p>
                  <div className="plan-perks">
                    <div className="perk-item">✓ Multimodal Visual & Seasonal Website Audits</div>
                    <div className="perk-item">✓ Derek's Legal & Compliance Research</div>
                    <div className="perk-item">✓ Interactive Follow-up Chat with Derek</div>
                  </div>
                  <a href={`${apiBase}/upgrade`} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-full">
                    Upgrade Account to Access
                  </a>
                </div>
              ) : (
                <div className="actions-card">
                  <div className="scope-selector">
                    <label className="scope-label">Select Audit Target:</label>
                    <div className="scope-tabs">
                      <button
                        type="button"
                        className={`scope-tab ${auditScope === 'page' ? 'active' : ''}`}
                        onClick={() => setAuditScope('page')}
                      >
                        📄 Active Page
                      </button>
                      <button
                        type="button"
                        className={`scope-tab ${auditScope === 'domain' ? 'active' : ''}`}
                        onClick={() => setAuditScope('domain')}
                      >
                        🌐 Whole Site
                      </button>
                      <button
                        type="button"
                        className={`scope-tab ${auditScope === 'subpath' ? 'active' : ''}`}
                        onClick={() => setAuditScope('subpath')}
                      >
                        📁 Sub-pages
                      </button>
                    </div>
                    <p className="scope-desc">
                      {auditScope === 'page' && 'Captures screenshot, DOM, seasonal graphics, conversion leaks, and legal cues.'}
                      {auditScope === 'domain' && 'Audits active page screenshot + key domain sub-pages (Pricing, About, Terms).'}
                      {auditScope === 'subpath' && 'Audits active page screenshot + child pages under current URL directory.'}
                    </p>
                    <p className="data-disclosure">
                      When you click Audit, the extension captures a visual screenshot and collects visible copy
                      (headings, CTAs, pricing, promotional banners) to send securely to Gemini 3.8 Flash for analysis.
                      Extracted data is not stored locally. See our{' '}
                      <a href={`${apiBase}/privacy`} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                    </p>
                  </div>

                  <button className="btn btn-gold btn-large btn-full" onClick={runAudit} style={{ marginTop: '12px' }}>
                    ⚡ Audit {auditScope === 'domain' ? 'Entire Website' : auditScope === 'subpath' ? 'Sub-pages' : 'Active Page'} Now
                  </button>
                </div>
              )}
            </div>
          )}

          {state === 'extracting' && (
            <div className="state-msg">
              <div className="spinner" />
              <p>{statusHint}</p>
              <p className="hint">Harvesting visual banners, hero copy, headings, pricing, and compliance cues.</p>
            </div>
          )}

          {state === 'auditing' && (
            <div className="state-msg">
              <div className="spinner" />
              <p>{statusHint}</p>
            </div>
          )}

          {state === 'polling' && (
            <div className="state-msg">
              <div className="spinner" />
              <p>Derek is auditing the {auditScope === 'domain' ? 'website' : 'page'} with Gemini 3.8 Flash...</p>
              <p className="hint">Analyzing visual layout, seasonal promotions, conversion leaks & legal technicalities. (8–12s)</p>
            </div>
          )}

          {state === 'error' && (() => {
            const errorUI = classifyErrorUI(error);
            return (
              <div className="card-box error-card">
                <div className="error-header">
                  <span className="error-icon">⚠️</span>
                  <p className="error-title">{errorUI.title}</p>
                </div>
                <p className="error-text">{error}</p>

                {errorUI.tip && (
                  <div className="error-tip-box">
                    <strong>💡 Tip:</strong> {errorUI.tip}
                  </div>
                )}

                <div className="error-actions">
                  {errorUI.needsTabRefresh ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-gold btn-full"
                        onClick={handleRefreshActiveTabAndRetry}
                      >
                        🔄 Refresh Webpage & Try Again
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-full"
                        onClick={runAudit}
                      >
                        ⚡ Retry Audit Without Refreshing
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-gold btn-full"
                        onClick={runAudit}
                      >
                        ⚡ Retry Audit Now
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-full"
                        onClick={handleRefreshActiveTabAndRetry}
                      >
                        🔄 Refresh Webpage & Reset
                      </button>
                    </>
                  )}
                  {isDevUser && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-full"
                      onClick={() => setCurrentTab('logs')}
                      style={{ borderColor: 'rgba(245, 158, 11, 0.5)', color: '#fef08a' }}
                    >
                      🛠️ View Diagnostic Logs
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-subtle btn-full"
                    onClick={reset}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })()}

          {state === 'done' && auditResult && (
            <div className="audit-result">
              <div className="result-header">
                <div className="header-meta">
                  <h2>Webpage Strategic Audit</h2>
                  {renderScopeBadge()}
                </div>
                {snapshot && <p className="source-url" title={snapshot.url}>{snapshot.url}</p>}
                {snapshot?.subPages && snapshot.subPages.length > 0 && (
                  <p className="analyzed-subpages">
                    ✓ Cross-analyzed {snapshot.subPages.length} additional key site pages
                  </p>
                )}
              </div>

              {inspectorNotice && (
                <div className={`inspector-notice ${inspectorNotice.type}`}>
                  <span className="inspector-notice-icon">
                    {inspectorNotice.type === 'success' ? '🎯' : '⚠️'}
                  </span>
                  <span className="inspector-notice-text">{inspectorNotice.message}</span>
                </div>
              )}

              <div className="result-section-group">
                <section className="info-card">
                  <h3>What This {auditScope === 'domain' ? 'Website' : 'Page'} Sells</h3>
                  <p>{auditResult.whatThisPageSells}</p>
                </section>

                <section className="info-card">
                  <h3>Target Audience</h3>
                  <p>{auditResult.whoItIsFor}</p>
                </section>

                <section className="info-card">
                  <h3>What's Working Strong</h3>
                  <ul className="bullet-list positive-list">
                    {auditResult.whatIsStrong.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>

                <section className="info-card">
                  <div className="section-title-row">
                    <h3>Conversion Bottlenecks & Weaknesses</h3>
                    <span className="section-hint-badge">Click leak to inspect</span>
                  </div>
                  <ul className="bullet-list negative-list leak-inspect-list">
                    {auditResult.whatIsWeak.map((s, i) => {
                      const isActive = activeHighlightedLeak === s;
                      return (
                        <li
                          key={i}
                          className={`leak-item ${isActive ? 'active-highlight' : ''}`}
                          onClick={() => handleHighlightLeak(s)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleHighlightLeak(s);
                            }
                          }}
                          title={isActive ? 'Click to dismiss highlight' : 'Click to inspect & highlight on webpage'}
                        >
                          <div className="leak-item-body">
                            <span className="leak-text">{s}</span>
                            <span className={`inspect-pill ${isActive ? 'active' : ''}`}>
                              {isActive ? '✓ Inspecting' : '🔍 Inspect'}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className="info-card">
                  <div className="section-title-row">
                    <h3>Top Revenue Leaks</h3>
                    <span className="section-hint-badge">Click leak to inspect</span>
                  </div>
                  <ol className="ordered-list leak-inspect-list">
                    {auditResult.topConversionLeaks.map((s, i) => {
                      const isActive = activeHighlightedLeak === s;
                      return (
                        <li
                          key={i}
                          className={`leak-item ${isActive ? 'active-highlight' : ''}`}
                          onClick={() => handleHighlightLeak(s)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleHighlightLeak(s);
                            }
                          }}
                          title={isActive ? 'Click to dismiss highlight' : 'Click to inspect & highlight on webpage'}
                        >
                          <div className="leak-item-body">
                            <span className="leak-text">{s}</span>
                            <span className={`inspect-pill ${isActive ? 'active' : ''}`}>
                              {isActive ? '✓ Inspecting' : '🔍 Inspect'}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                {auditResult.legalTechnicalities && (
                  <section className="info-card legal-card">
                    <div className="legal-header">
                      <h3>Derek's Legal & Technicalities Audit</h3>
                      {renderRiskBadge(auditResult.legalTechnicalities.complianceRisk)}
                    </div>

                    <p className="legal-summary">{auditResult.legalTechnicalities.summary}</p>

                    {auditResult.legalTechnicalities.dos && auditResult.legalTechnicalities.dos.length > 0 && (
                      <div className="legal-subgroup">
                        <span className="legal-subheading dos-label">✓ Legal DOs & Compliance Strengths</span>
                        <ul className="legal-list dos-list">
                          {auditResult.legalTechnicalities.dos.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {auditResult.legalTechnicalities.donts && auditResult.legalTechnicalities.donts.length > 0 && (
                      <div className="legal-subgroup">
                        <span className="legal-subheading donts-label">⚠ Legal DONTs & Technical Risks</span>
                        <ul className="legal-list donts-list">
                          {auditResult.legalTechnicalities.donts.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                {auditResult.seasonalRelevance?.applicable && (
                  <section className="info-card seasonal-card">
                    <h3>🍂 Seasonal Relevance & Visual Promos</h3>
                    {auditResult.seasonalRelevance.currentSeason && (
                      <p className="seasonal-current">Current retail season: {auditResult.seasonalRelevance.currentSeason}</p>
                    )}
                    {auditResult.seasonalRelevance.misalignment && auditResult.seasonalRelevance.misalignment.length > 0 && (
                      <div className="legal-subgroup">
                        <span className="legal-subheading donts-label">⚠ Seasonal Misalignment</span>
                        <ul className="bullet-list negative-list">
                          {auditResult.seasonalRelevance.misalignment.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {auditResult.seasonalRelevance.suggestedSeasonalMoves && auditResult.seasonalRelevance.suggestedSeasonalMoves.length > 0 && (
                      <div className="legal-subgroup">
                        <span className="legal-subheading dos-label">✓ Suggested Seasonal Moves</span>
                        <ul className="bullet-list positive-list">
                          {auditResult.seasonalRelevance.suggestedSeasonalMoves.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                <section className="info-card highlight-card">
                  <h3>Best Next Action</h3>
                  <p>{auditResult.bestNextMove}</p>
                </section>
              </div>

              {/* Action Buttons */}
              <div className="result-actions">
                <button className="btn btn-gold btn-full" onClick={handleDownloadPdf}>
                  📥 Download PDF Report
                </button>
                <button
                  className={`btn ${copiedText ? 'btn-success' : 'btn-secondary'} btn-full`}
                  onClick={handleCopyText}
                >
                  {copiedText ? '✓ Copied Text Report!' : '📋 Copy Text Report'}
                </button>
                <button className="btn btn-subtle btn-full" onClick={reset}>
                  🔄 Audit Another Page / Site
                </button>
              </div>

              {/* ── Derek Follow-Up Chat ── */}
              <section className="derek-chat-section">
                <div className="derek-chat-header">
                  <div className="derek-chat-avatar">D</div>
                  <div className="derek-chat-titles">
                    <h3>Talk to Derek</h3>
                    <span>Follow-up questions, copy rewrites & execution steps</span>
                  </div>
                </div>

                <div className="derek-chat-messages">
                  {chatMessages.length === 0 ? (
                    <div className="derek-msg-bubble derek-welcome">
                      <div className="derek-reaction-chip">⚡ Audit Delivered</div>
                      <p>
                        I gave you the strategic teardown above. What questions do you have regarding these leaks, rewriting your copy, or fixing legal technicalities?
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`chat-bubble ${msg.role === 'user' ? 'user-msg-bubble' : 'derek-msg-bubble'}`}
                      >
                        {msg.role === 'derek' && msg.reaction && (
                          <div className="derek-reaction-chip">⚡ {msg.reaction}</div>
                        )}
                        <div className="bubble-text">
                          <MarkdownView
                            content={msg.content}
                            role={msg.role}
                            onTestOnPage={handleTestOnPage}
                            onRevertPage={handleRevertOnPage}
                            activeSwappedIds={activeSwappedIds}
                          />
                        </div>
                        {msg.gifUrl && (
                          <div className="bubble-gif">
                            <img src={msg.gifUrl} alt="Reaction GIF" />
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {chatSending && (
                    <div className="derek-msg-bubble derek-thinking">
                      <div className="derek-reaction-chip">⚡ Thinking</div>
                      <div className="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {inspectorNotice && (
                  <div className={`inspector-notice ${inspectorNotice.type}`}>
                    <span className="inspector-notice-icon">
                      {inspectorNotice.type === 'success' ? '🎯' : '⚠️'}
                    </span>
                    <span className="inspector-notice-text">{inspectorNotice.message}</span>
                  </div>
                )}

                {/* Active Swaps Banner */}
                {Object.keys(activeSwaps).length > 0 && (
                  <div className="active-swaps-banner">
                    <div className="active-swaps-info">
                      <span className="swaps-pulse-dot"></span>
                      <span>
                        <strong>{Object.keys(activeSwaps).length} Live Copy {Object.keys(activeSwaps).length === 1 ? 'Swap' : 'Swaps'} Active</strong> on page
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-revert-all-swaps"
                      onClick={handleRevertAllOnPage}
                      title="Revert all live DOM changes back to original"
                    >
                      ↺ Revert All
                    </button>
                  </div>
                )}

                {/* Quick Prompts */}
                <div className="quick-prompts-container">
                  <span className="quick-prompts-label">Quick Actions:</span>
                  <div className="quick-prompts-row">
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => sendChatMessage('How do I fix the top conversion leak you identified?')}
                      disabled={chatSending}
                    >
                      Fix Leak #1
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => sendChatMessage('Rewrite my hero headline and value proposition for higher conversion.')}
                      disabled={chatSending}
                    >
                      Rewrite Hero Copy
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => sendChatMessage('Draft the exact text for my missing legal/compliance disclaimers.')}
                      disabled={chatSending}
                    >
                      Draft Disclaimer
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-chip"
                      onClick={() => sendChatMessage('Give me a 3-step 24-hour revenue action plan.')}
                      disabled={chatSending}
                    >
                      24h Sprint Plan
                    </button>
                  </div>
                </div>

                {/* Chat Input Bar */}
                <form
                  className="derek-chat-input-bar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendChatMessage();
                  }}
                >
                  <input
                    type="text"
                    className="derek-chat-input"
                    placeholder="Ask Derek about this audit, copy rewrites, leaks..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={chatSending}
                  />
                  <button
                    type="submit"
                    className="btn btn-gold btn-send"
                    disabled={chatSending || !chatInput.trim()}
                  >
                    {chatSending ? '...' : 'Send'}
                  </button>
                </form>
              </section>
            </div>
          )}
        </>
      )}

      {/* ── Developer Diagnostic Logs View (Spencer Almodiel only) ── */}
      {isDevUser && currentTab === 'logs' && (
        <LogsView
          sessionEmail={session?.email || cachedDevEmail}
          activeTabInfo={activeTabInfo}
          apiBase={apiBase}
          onRefreshActiveTab={updateActiveTabStatus}
          onTestExtract={handleTestExtract}
        />
      )}

      {/* ── Active Tab Permission Guidance Pop-up / Modal ── */}
      {showPermissionModal && (
        <div className="permission-modal-overlay" onClick={() => setShowPermissionModal(false)}>
          <div className="permission-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-warning-icon">⚠️</span>
                <h3>Multi-Page Crawl Permission Required</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowPermissionModal(false)}
                title="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-intro">
                The extension needs permission to crawl and inspect additional pages across{' '}
                <strong>{activeTabInfo.hostname || 'this website'}</strong> for Whole Site or Sub-pages analysis.
              </p>

              <div className="modal-refresh-callout">
                <div className="callout-header">
                  <span className="callout-icon">💡</span>
                  <strong>Crucial: Why the permission pop-up may not appear</strong>
                </div>
                <p className="callout-text">
                  If Chrome does not display the permission prompt, <strong>you must refresh the webpage tab you are on</strong>.
                  Chrome requires an active page reload before it allows the requesting access pop-up to trigger on existing tabs.
                </p>
              </div>

              <div className="step-guide-box">
                <div className="step-item">
                  <span className="step-badge">1</span>
                  <div className="step-content">
                    <strong>Refresh this webpage tab:</strong>
                    <span>Click the button below or press F5 / Ctrl+R to reload the target webpage.</span>
                  </div>
                </div>
                <div className="step-item">
                  <span className="step-badge">2</span>
                  <div className="step-content">
                    <strong>Click "Grant Permission":</strong>
                    <span>Chrome will display a permission dialog asking to access this website.</span>
                  </div>
                </div>
                <div className="step-item">
                  <span className="step-badge">3</span>
                  <div className="step-content">
                    <strong>Click "Allow":</strong>
                    <span>Once granted, return here to run your strategic audit.</span>
                  </div>
                </div>
              </div>

              {tabReloadedNotice && (
                <div className="tab-reloaded-notice">
                  ✓ {tabReloadedNotice}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-full"
                onClick={handleReloadActiveTab}
                disabled={tabReloading}
              >
                {tabReloading ? '🔄 Refreshing Tab...' : '🔄 Refresh Webpage Tab'}
              </button>
              <button
                type="button"
                className="btn btn-gold btn-full"
                onClick={handleRequestAccessNow}
              >
                🔑 Grant Permission Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
