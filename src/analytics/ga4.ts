// GA4 Measurement Protocol client for Chrome Extension Manifest V3

export const GA_CONFIG = {
  measurementId: 'G-24NH6GWS8N',
  apiSecret: 'nEQtX9vZQjyE72WwIFL_Sw',
};

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Gets or creates a persistent client UUID for GA4.
 * Stored in chrome.storage.local to persist across extension reloads/sessions.
 */
async function getOrCreateClientId(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get('ga_client_id');
      if (stored.ga_client_id) {
        return stored.ga_client_id;
      }
      const newId = crypto.randomUUID();
      await chrome.storage.local.set({ ga_client_id: newId });
      return newId;
    }
  } catch (e) {
    console.debug('[GA4] Storage access failed, using ephemeral client id', e);
  }
  return crypto.randomUUID();
}

/**
 * Session tracking: GA4 uses a numeric session_id (timestamp).
 * If inactive for more than 30 minutes, a new session_id is generated.
 */
async function getOrCreateSessionId(): Promise<string> {
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['ga_session_id', 'ga_last_interaction']);
      if (
        stored.ga_session_id &&
        stored.ga_last_interaction &&
        now - Number(stored.ga_last_interaction) < SESSION_TIMEOUT_MS
      ) {
        await chrome.storage.local.set({ ga_last_interaction: now });
        return String(stored.ga_session_id);
      }

      const newSessionId = String(now);
      await chrome.storage.local.set({
        ga_session_id: newSessionId,
        ga_last_interaction: now,
      });
      return newSessionId;
    }
  } catch (e) {
    console.debug('[GA4] Session storage access failed', e);
  }
  return String(now);
}

export interface AnalyticsEventParams {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Dispatches an event to Google Analytics 4 via the Measurement Protocol.
 * Fails silently so user experience is never interrupted.
 */
export async function trackEvent(
  eventName: string,
  params: AnalyticsEventParams = {},
  userId?: string
): Promise<void> {
  try {
    const clientId = await getOrCreateClientId();
    const sessionId = await getOrCreateSessionId();

    // Clean undefined params
    const cleanParams: Record<string, string | number | boolean> = {
      session_id: sessionId,
      engagement_time_msec: 100, // Guarantees active user attribution in GA4
    };

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = value;
      }
    }

    const payload: {
      client_id: string;
      user_id?: string;
      events: Array<{ name: string; params: Record<string, string | number | boolean> }>;
    } = {
      client_id: clientId,
      events: [
        {
          name: eventName,
          params: cleanParams,
        },
      ],
    };

    if (userId) {
      payload.user_id = userId;
    }

    const url = `${GA_ENDPOINT}?measurement_id=${GA_CONFIG.measurementId}&api_secret=${GA_CONFIG.apiSecret}`;

    // 1. Dispatch to Google Analytics 4
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(err => {
      console.debug('[GA4] Error sending telemetry:', err);
    });

    // 2. Dispatch to Billionaire Brother admin telemetry for live internal tracking
    fetch('https://thebillionairebrother.com/api/extension/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        eventName,
        params: cleanParams,
        clientId,
      }),
    }).catch(err => {
      console.debug('[BB Telemetry] Error sending internal telemetry:', err);
    });
  } catch (err) {
    // Telemetry must fail silently in production
    console.debug('[Analytics] Error in trackEvent:', err);
  }
}
