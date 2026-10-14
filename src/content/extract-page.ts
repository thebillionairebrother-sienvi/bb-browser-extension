import { copySwapper } from './copy-swapper';

// Deterministic Page Extraction — produces a PageSnapshot matching the contract

export interface PageSnapshot {
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

export function extractPageSnapshot(): PageSnapshot {
  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };

  const normalizedText = (element: Element, maxLength = 500): string =>
    (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

  const getText = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .map(el => normalizedText(el))
      .filter(Boolean)
      .slice(0, 30);

  // Hero copy: first large text block inside a header/section/hero area
  const heroEl = document.querySelector(
    '[class*="hero"] h1, [class*="hero"] p, header h1, section:first-of-type h1'
  );
  const heroCopy = heroEl && isVisible(heroEl) ? normalizedText(heroEl) : '';

  // CTA text: buttons and links with action-oriented words
  const ctaKeywords = ['buy', 'sign', 'get', 'start', 'try', 'subscribe', 'join', 'book', 'order', 'download', 'claim', 'request', 'schedule', 'contact'];
  const allInteractive = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"]'));
  const ctaText = allInteractive
    .filter(isVisible)
    .map(el => (el.textContent || el.getAttribute('value') || '').trim())
    .filter(t => t.length > 0 && t.length < 100 && ctaKeywords.some(k => t.toLowerCase().includes(k)));

  // Visible button labels (all buttons, not just CTA-filtered)
  const visibleButtonLabels = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
    .filter(isVisible)
    .map(el => (el.textContent || el.getAttribute('value') || '').trim())
    .filter(t => t.length > 0 && t.length < 80);

  // Pricing blocks: look for elements with price-like patterns
  const priceRegex = /\$[\d,.]+|€[\d,.]+|£[\d,.]+|[\d,.]+ ?\/(mo|month|yr|year)/i;
  const pricingBlocks = Array.from(document.querySelectorAll('[class*="price"], [class*="pricing"], [class*="plan"], [class*="tier"]'))
    .filter(isVisible)
    .map(el => (el.textContent || '').trim().substring(0, 500))
    .filter(Boolean);
  // Fallback: scan all text nodes for prices
  if (pricingBlocks.length === 0) {
    const allParagraphs = Array.from(document.querySelectorAll('p, li, span, div'));
    allParagraphs.forEach(el => {
      if (!isVisible(el)) return;
      const text = (el.textContent || '').trim();
      if (priceRegex.test(text) && text.length < 300) {
        pricingBlocks.push(text);
      }
    });
  }

  // Testimonials: look for quote-like elements
  const testimonials = Array.from(
    document.querySelectorAll('blockquote, [class*="testimonial"], [class*="review"], [class*="quote"]')
  )
    .filter(isVisible)
    .map(el => (el.textContent || '').trim().substring(0, 500))
    .filter(Boolean)
    .slice(0, 10);

  // FAQs
  const faqs = Array.from(
    document.querySelectorAll('[class*="faq"] summary, [class*="faq"] h3, [class*="accordion"] button, details summary')
  )
    .filter(isVisible)
    .map(el => (el.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 20);

  // Form labels
  const formLabels = getText('label, fieldset legend');

  // Repeated phrases: find phrases that appear 3+ times
  const phraseCount: Record<string, number> = {};
  const textBlocks = getText('p, li, h2, h3, span');
  textBlocks.forEach(t => {
    const words = t.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    if (words.length > 10) {
      phraseCount[words] = (phraseCount[words] || 0) + 1;
    }
  });
  const repeatedPhrases = Object.entries(phraseCount)
    .filter(([, count]) => count >= 3)
    .map(([phrase]) => phrase);

  // Selected text (if user has selected something)
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';

  // Internal links (distinct URLs on same origin)
  const origin = window.location.origin;
  const currentUrl = window.location.href;
  const internalLinks = Array.from(new Set(
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter(isVisible)
      .map(a => a.href)
      .filter(href => {
        try {
          const u = new URL(href, origin);
          return u.origin === origin && u.href !== currentUrl && !u.hash && !u.pathname.match(/\.(png|jpg|jpeg|gif|svg|pdf|css|js)$/i);
        } catch {
          return false;
        }
      })
  )).slice(0, 30);

  // Promotional, hero, and seasonal images
  const promoKeywords = ['sale', 'promo', 'fall', 'autumn', 'halloween', 'summer', 'spring', 'winter', 'holiday', 'discount', 'deal', 'offer', 'event', 'save', 'special', 'banner', 'hero', 'collection'];
  const allImages = Array.from(document.querySelectorAll<HTMLImageElement>('img, [role="img"]'));
  const candidateImages: Array<{ src: string; alt: string; title?: string; base64?: string; area: number; top: number }> = [];

  allImages.forEach(img => {
    if (!isVisible(img)) return;
    const rawSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!rawSrc || rawSrc.startsWith('data:image/svg')) return;

    const alt = (img.getAttribute('alt') || '').trim();
    const title = (img.getAttribute('title') || img.getAttribute('aria-label') || '').trim();
    const className = (img.className || '').toString();
    const id = img.id || '';

    const rect = img.getBoundingClientRect();
    const area = (img.naturalWidth || rect.width) * (img.naturalHeight || rect.height);
    if (rect.width < 60 || rect.height < 40) return;

    const haystack = `${rawSrc} ${alt} ${title} ${className} ${id}`.toLowerCase();
    const isPromo = promoKeywords.some(k => haystack.includes(k));
    const isHeroOrBanner = rect.top < 1200 && (rect.width > 200 || rect.height > 120 || area > 40000);

    if (isPromo || isHeroOrBanner) {
      try {
        let fullSrc = rawSrc;
        if (rawSrc.startsWith('//')) {
          fullSrc = `${window.location.protocol}${rawSrc}`;
        } else if (!rawSrc.startsWith('http')) {
          fullSrc = new URL(rawSrc, window.location.href).href;
        }

        if (fullSrc && !candidateImages.some(p => p.src === fullSrc)) {
          // Attempt canvas snapshot if image is loaded
          let base64: string | undefined;
          try {
            if (img.complete && (img.naturalWidth || img.width) > 0) {
              const canvas = document.createElement('canvas');
              const naturalW = img.naturalWidth || img.width;
              const naturalH = img.naturalHeight || img.height;
              const maxDim = 1200;
              const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
              canvas.width = Math.round(naturalW * scale);
              canvas.height = Math.round(naturalH * scale);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                base64 = canvas.toDataURL('image/jpeg', 0.75);
              }
            }
          } catch {}

          candidateImages.push({
            src: fullSrc,
            alt: alt.slice(0, 200),
            title: title ? title.slice(0, 200) : undefined,
            base64,
            area,
            top: rect.top,
          });
        }
      } catch {}
    }
  });

  // Also check background images on banner/hero sections
  try {
    const bgElements = Array.from(document.querySelectorAll<HTMLElement>('[class*="hero"], [class*="banner"], [class*="slider"], [class*="slide"], header, section:first-of-type, div:first-of-type'));
    bgElements.forEach(el => {
      if (!isVisible(el)) return;
      try {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg.includes('url(')) {
          const match = bg.match(/url\(['"]?([^'")]+)['"]?\)/);
          if (match && match[1]) {
            let fullSrc = match[1];
            if (fullSrc.startsWith('//')) fullSrc = `${window.location.protocol}${fullSrc}`;
            else if (!fullSrc.startsWith('http')) fullSrc = new URL(fullSrc, window.location.href).href;

            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (fullSrc && !candidateImages.some(p => p.src === fullSrc) && area > 30000 && rect.top < 1200) {
              candidateImages.push({
                src: fullSrc,
                alt: (el.getAttribute('aria-label') || el.className || 'Hero background banner').slice(0, 200),
                area,
                top: rect.top,
              });
            }
          }
        }
      } catch {}
    });
  } catch {}

  // Sort by visual prominence: top of page and largest area first (hero banners)
  candidateImages.sort((a, b) => {
    // If one is in the upper hero zone (< 600px) and the other isn't, prioritize top
    if (a.top < 600 && b.top >= 600) return -1;
    if (b.top < 600 && a.top >= 600) return 1;
    return b.area - a.area;
  });

  const promoImages = candidateImages.slice(0, 6).map(({ src, alt, title, base64 }) => ({
    src,
    alt,
    title,
    base64,
  }));

  return {
    url: window.location.href,
    title: document.title,
    metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    h1: getText('h1'),
    h2: getText('h2'),
    h3: getText('h3'),
    heroCopy,
    ctaText,
    pricingBlocks: pricingBlocks.slice(0, 10),
    testimonials,
    faqs,
    formLabels,
    repeatedPhrases,
    selectedText,
    visibleButtonLabels,
    internalLinks,
    promoImages: promoImages.slice(0, 8),
  };
}

// Helper to check element visibility
function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity || '1') > 0 &&
    element.getClientRects().length > 0
  );
}

// ── Multi-Tier Leak Target Element Finder ───────────────────────
function findTargetElement(
  leakText: string,
  hints?: { selectorHint?: string; textHint?: string }
): HTMLElement | null {
  if (!leakText) return null;

  // 1. Explicit selector hint if provided
  if (hints?.selectorHint) {
    try {
      const el = document.querySelector<HTMLElement>(hints.selectorHint);
      if (el && isElementVisible(el)) return el;
    } catch {}
  }

  // 2. Explicit text hint if provided
  if (hints?.textHint && hints.textHint.length >= 2) {
    const textTarget = hints.textHint.toLowerCase();
    const candidateNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], h1, h2, h3, h4, p, span, strong, b, label, input[type="submit"]'
      )
    ).filter(isElementVisible);

    const match = candidateNodes
      .filter(el => (el.textContent || '').toLowerCase().includes(textTarget))
      .sort((a, b) => (a.textContent?.length || 9999) - (b.textContent?.length || 9999))[0];
    if (match) return match;
  }

  // 3. Extract quoted phrases from Derek's diagnosis (e.g. "Buy Now", 'Get Started', "Pricing")
  const quoteMatches = leakText.match(/["'“‘]([^"'“”‘’]{2,60})["'”’]/g);
  if (quoteMatches) {
    for (const rawQuote of quoteMatches) {
      const phrase = rawQuote.slice(1, -1).trim().toLowerCase();
      if (phrase.length < 2) continue;

      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, a, [role="button"], h1, h2, h3, h4, p, span, strong, b, label, li, input[type="submit"]'
        )
      ).filter(isElementVisible);

      const matched = candidates
        .filter(el => (el.textContent || '').toLowerCase().includes(phrase))
        .sort((a, b) => (a.textContent?.length || 9999) - (b.textContent?.length || 9999));

      if (matched.length > 0) {
        return matched[0];
      }
    }
  }

  // 4. Semantic element targeting based on conversion keywords
  const lower = leakText.toLowerCase();

  // A. Call to Action / Buttons
  if (
    lower.includes('cta') ||
    lower.includes('button') ||
    lower.includes('call to action') ||
    lower.includes('sign up') ||
    lower.includes('get started') ||
    lower.includes('buy now') ||
    lower.includes('order now') ||
    lower.includes('subscribe') ||
    lower.includes('download') ||
    lower.includes('join')
  ) {
    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[role="button"], a.btn, [class*="btn"], [class*="button"], [class*="cta"], input[type="submit"], a'
      )
    ).filter(isElementVisible);

    if (interactive.length > 0) {
      // Find one that shares any words with the leak
      const words = lower.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
      const scored = interactive.map(el => {
        const text = (el.textContent || el.getAttribute('value') || '').toLowerCase();
        const score = words.reduce((acc, w) => (text.includes(w) ? acc + 2 : acc), 0);
        return { el, score };
      });
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) return scored[0].el;
      // Default to first prominent CTA button
      return interactive[0];
    }
  }

  // B. Pricing / Tier / Plans / Guarantee
  if (
    lower.includes('pricing') ||
    lower.includes('price') ||
    lower.includes('tier') ||
    lower.includes('plan') ||
    lower.includes('guarantee') ||
    lower.includes('refund') ||
    lower.includes('package') ||
    lower.includes('cost')
  ) {
    const pricingElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[class*="price"], [class*="pricing"], [class*="tier"], [class*="plan"], [class*="package"]'
      )
    ).filter(isElementVisible);

    if (pricingElements.length > 0) return pricingElements[0];

    // Fallback: search for dollar/euro/pound signs
    const priceNodes = Array.from(
      document.querySelectorAll<HTMLElement>('div, section, p, span')
    ).filter(el => isElementVisible(el) && /\$[\d,.]+|€[\d,.]+|£[\d,.]+/.test(el.textContent || ''));
    if (priceNodes.length > 0) return priceNodes[0];
  }

  // C. Hero Copy / Headline / H1 / Above the Fold
  if (
    lower.includes('hero') ||
    lower.includes('headline') ||
    lower.includes('h1') ||
    lower.includes('above the fold') ||
    lower.includes('value prop') ||
    lower.includes('hook')
  ) {
    const hero = document.querySelector<HTMLElement>(
      'h1, [class*="hero"] h1, [class*="hero"] p, header h1, section:first-of-type h1, [class*="hero"]'
    );
    if (hero && isElementVisible(hero)) return hero;
  }

  // D. Promotional Banners / Seasonal / Images
  if (
    lower.includes('banner') ||
    lower.includes('promo') ||
    lower.includes('seasonal') ||
    lower.includes('image') ||
    lower.includes('slider') ||
    lower.includes('visual')
  ) {
    const banner = document.querySelector<HTMLElement>(
      '[class*="banner"], [class*="promo"], [class*="hero"] img, [class*="slider"], [class*="carousel"], header img'
    );
    if (banner && isElementVisible(banner)) return banner;
  }

  // E. Testimonials / Reviews / Social Proof
  if (
    lower.includes('testimonial') ||
    lower.includes('review') ||
    lower.includes('social proof') ||
    lower.includes('rating') ||
    lower.includes('stars')
  ) {
    const review = document.querySelector<HTMLElement>(
      'blockquote, [class*="testimonial"], [class*="review"], [class*="rating"], [class*="feedback"]'
    );
    if (review && isElementVisible(review)) return review;
  }

  // F. Forms / Inputs / Captures
  if (
    lower.includes('form') ||
    lower.includes('input') ||
    lower.includes('email') ||
    lower.includes('field') ||
    lower.includes('submit')
  ) {
    const formEl = document.querySelector<HTMLElement>(
      'form, input[type="email"], input[type="text"], [class*="form"]'
    );
    if (formEl && isElementVisible(formEl)) return formEl;
  }

  // G. FAQ / Accordion
  if (lower.includes('faq') || lower.includes('question') || lower.includes('accordion')) {
    const faq = document.querySelector<HTMLElement>('[class*="faq"], details, summary, [class*="accordion"]');
    if (faq && isElementVisible(faq)) return faq;
  }

  // H. Footer / Legal / Disclaimer
  if (
    lower.includes('footer') ||
    lower.includes('disclaimer') ||
    lower.includes('privacy') ||
    lower.includes('terms') ||
    lower.includes('compliance')
  ) {
    const footer = document.querySelector<HTMLElement>('footer, [class*="footer"], [class*="disclaimer"]');
    if (footer && isElementVisible(footer)) return footer;
  }

  // 5. Token frequency overlap fallback
  const stopWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'with', 'that', 'this',
    'it', 'from', 'as', 'are', 'was', 'be', 'or', 'by', 'not', 'what', 'who', 'how', 'lacks', 'lost',
    'below', 'above', 'too', 'very', 'page', 'site', 'website', 'does', 'doesn\'t'
  ]);
  const queryTokens = lower
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3 && !stopWords.has(t));

  if (queryTokens.length > 0) {
    const candidateBlocks = Array.from(
      document.querySelectorAll<HTMLElement>('section, article, div, p, h1, h2, h3, button, a')
    ).filter(el => isElementVisible(el) && (el.textContent || '').trim().length > 10);

    let bestMatch: HTMLElement | null = null;
    let highestScore = 0;

    for (const block of candidateBlocks) {
      const text = (block.textContent || '').toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) matchCount++;
      }
      if (matchCount > highestScore) {
        highestScore = matchCount;
        bestMatch = block;
      }
    }

    if (bestMatch && highestScore >= 2) {
      return bestMatch;
    }
  }

  return null;
}

// ── Isolated Shadow DOM Leak Inspector Overlay ──────────────────
class LeakInspectorOverlayManager {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private frame: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private currentTarget: HTMLElement | null = null;
  private currentLeakText: string = '';
  private rafId: number | null = null;
  private isListening: boolean = false;

  private onScrollOrResize = () => {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      this.updatePositions();
    });
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.clear();
    }
  };

  private onDocumentClick = (e: MouseEvent) => {
    if (!this.currentTarget) return;
    const path = e.composedPath();
    if (this.host && path.includes(this.host)) return;
    if (path.includes(this.currentTarget)) return;
    this.clear();
  };

  private ensureHost(): { host: HTMLElement; shadow: ShadowRoot } {
    if (this.host && this.shadow) {
      return { host: this.host, shadow: this.shadow };
    }

    let existing = document.getElementById('bb-leak-inspector-host');
    if (existing) {
      existing.remove();
    }

    this.host = document.createElement('div');
    this.host.id = 'bb-leak-inspector-host';
    this.host.style.position = 'fixed';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '0';
    this.host.style.height = '0';
    this.host.style.zIndex = '2147483647';
    this.host.style.pointerEvents = 'none';

    document.documentElement.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Inject isolated styles
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .bb-highlight-frame {
        position: fixed;
        border: 2px solid #eab308;
        border-radius: 8px;
        background: rgba(234, 179, 8, 0.08);
        box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.35), 0 0 25px rgba(234, 179, 8, 0.5), inset 0 0 15px rgba(234, 179, 8, 0.12);
        pointer-events: none;
        transition: top 0.1s ease-out, left 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out;
        animation: bb-gold-pulse 2.2s infinite ease-in-out;
        z-index: 2147483646;
      }

      @keyframes bb-gold-pulse {
        0%, 100% {
          box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.35), 0 0 25px rgba(234, 179, 8, 0.5), inset 0 0 15px rgba(234, 179, 8, 0.12);
          border-color: #eab308;
        }
        50% {
          box-shadow: 0 0 0 5px rgba(234, 179, 8, 0.6), 0 0 35px rgba(234, 179, 8, 0.8), inset 0 0 25px rgba(234, 179, 8, 0.22);
          border-color: #facc15;
        }
      }

      .bb-corner {
        position: absolute;
        width: 8px;
        height: 8px;
      }
      .bb-corner-tl { top: -2px; left: -2px; border-top: 2px solid #fef08a; border-left: 2px solid #fef08a; border-top-left-radius: 6px; }
      .bb-corner-tr { top: -2px; right: -2px; border-top: 2px solid #fef08a; border-right: 2px solid #fef08a; border-top-right-radius: 6px; }
      .bb-corner-bl { bottom: -2px; left: -2px; border-bottom: 2px solid #fef08a; border-left: 2px solid #fef08a; border-bottom-left-radius: 6px; }
      .bb-corner-br { bottom: -2px; right: -2px; border-bottom: 2px solid #fef08a; border-right: 2px solid #fef08a; border-bottom-right-radius: 6px; }

      .bb-tooltip {
        position: fixed;
        width: max-content;
        max-width: 360px;
        background: #09090b;
        border: 1px solid #c9a227;
        border-radius: 10px;
        padding: 12px 14px;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.85), 0 0 20px rgba(201, 162, 39, 0.35);
        pointer-events: auto;
        z-index: 2147483647;
        animation: bb-tooltip-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: text;
      }

      @keyframes bb-tooltip-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .bb-tooltip-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid #27272a;
      }

      .bb-tooltip-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #eab308;
      }

      .bb-tooltip-badge-icon {
        width: 15px;
        height: 15px;
        border-radius: 3px;
        background: linear-gradient(135deg, #c9a227, #f3e5ab);
        color: #09090b;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 900;
      }

      .bb-tooltip-close {
        background: transparent;
        border: none;
        color: #a1a1aa;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        line-height: 1;
        transition: color 0.15s, background-color 0.15s;
      }
      .bb-tooltip-close:hover {
        color: #ffffff;
        background-color: #27272a;
      }

      .bb-tooltip-body {
        color: #f4f4f5;
        font-weight: 500;
        margin-bottom: 8px;
        word-break: break-word;
      }

      .bb-tooltip-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #71717a;
        border-top: 1px solid #18181b;
        padding-top: 6px;
      }
      .bb-tooltip-hint {
        color: #a1a1aa;
      }
    `;
    this.shadow.appendChild(styleEl);

    // Frame
    this.frame = document.createElement('div');
    this.frame.className = 'bb-highlight-frame';
    this.frame.innerHTML = `
      <div class="bb-corner bb-corner-tl"></div>
      <div class="bb-corner bb-corner-tr"></div>
      <div class="bb-corner bb-corner-bl"></div>
      <div class="bb-corner bb-corner-br"></div>
    `;
    this.shadow.appendChild(this.frame);

    // Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'bb-tooltip';
    this.shadow.appendChild(this.tooltip);

    return { host: this.host, shadow: this.shadow };
  }

  private updatePositions() {
    if (!this.currentTarget || !this.frame || !this.tooltip) return;
    if (!isElementVisible(this.currentTarget)) {
      this.clear();
      return;
    }

    const rect = this.currentTarget.getBoundingClientRect();
    const pad = 6;

    // Highlight Frame position
    this.frame.style.top = `${Math.max(0, rect.top - pad)}px`;
    this.frame.style.left = `${Math.max(0, rect.left - pad)}px`;
    this.frame.style.width = `${rect.width + pad * 2}px`;
    this.frame.style.height = `${rect.height + pad * 2}px`;

    // Tooltip placement: above or below
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const tooltipHeight = tooltipRect.height || 100;
    const tooltipWidth = tooltipRect.width || 300;

    let tooltipTop: number;
    if (rect.top > tooltipHeight + 20) {
      // Place above target
      tooltipTop = rect.top - tooltipHeight - 12;
    } else {
      // Place below target
      tooltipTop = rect.bottom + 12;
    }

    // Align left with target, clamped within viewport bounds
    let tooltipLeft = rect.left;
    if (tooltipLeft + tooltipWidth > window.innerWidth - 16) {
      tooltipLeft = window.innerWidth - tooltipWidth - 16;
    }
    tooltipLeft = Math.max(16, tooltipLeft);

    this.tooltip.style.top = `${tooltipTop}px`;
    this.tooltip.style.left = `${tooltipLeft}px`;
  }

  public highlight(element: HTMLElement, leakText: string): void {
    this.currentTarget = element;
    this.currentLeakText = leakText;

    const { shadow } = this.ensureHost();

    if (this.tooltip) {
      this.tooltip.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'bb-tooltip-header';

      const badge = document.createElement('div');
      badge.className = 'bb-tooltip-badge';
      const icon = document.createElement('span');
      icon.className = 'bb-tooltip-badge-icon';
      icon.textContent = 'BB';
      const badgeText = document.createTextNode("Derek's Leak Inspector");
      badge.appendChild(icon);
      badge.appendChild(badgeText);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'bb-tooltip-close';
      closeBtn.title = 'Dismiss highlight (Esc)';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clear();
      });

      header.appendChild(badge);
      header.appendChild(closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'bb-tooltip-body';
      body.textContent = leakText;

      // Footer
      const footer = document.createElement('div');
      footer.className = 'bb-tooltip-footer';
      const tagInfo = document.createElement('span');
      tagInfo.textContent = `<${element.tagName.toLowerCase()}>`;
      const escHint = document.createElement('span');
      escHint.className = 'bb-tooltip-hint';
      escHint.textContent = 'Press Esc or click away to close';
      footer.appendChild(tagInfo);
      footer.appendChild(escHint);

      this.tooltip.appendChild(header);
      this.tooltip.appendChild(body);
      this.tooltip.appendChild(footer);
    }

    // Smooth scroll into viewport center
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    // Initial position update and schedule another after scroll settling
    this.updatePositions();
    setTimeout(() => this.updatePositions(), 150);
    setTimeout(() => this.updatePositions(), 400);

    if (!this.isListening) {
      window.addEventListener('scroll', this.onScrollOrResize, { passive: true });
      window.addEventListener('resize', this.onScrollOrResize, { passive: true });
      document.addEventListener('keydown', this.onKeyDown, true);
      document.addEventListener('click', this.onDocumentClick, true);
      this.isListening = true;
    }
  }

  public clear(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.isListening) {
      window.removeEventListener('scroll', this.onScrollOrResize);
      window.removeEventListener('resize', this.onScrollOrResize);
      document.removeEventListener('keydown', this.onKeyDown, true);
      document.removeEventListener('click', this.onDocumentClick, true);
      this.isListening = false;
    }
    this.currentTarget = null;
    this.currentLeakText = '';
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.frame = null;
      this.tooltip = null;
    }
  }
}

const leakInspector = new LeakInspectorOverlayManager();

// Listen for messages from service worker / side panel
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXTRACT_PAGE') {
    sendResponse({ snapshot: extractPageSnapshot() });
    return true;
  }

  if (request.action === 'HIGHLIGHT_ELEMENT') {
    const { leakText, selectorHint, textHint } = request;
    const target = findTargetElement(leakText, { selectorHint, textHint });

    if (target) {
      leakInspector.highlight(target, leakText);
      sendResponse({
        success: true,
        matchedTagName: target.tagName,
        matchedTextPreview: (target.textContent || '').trim().slice(0, 100),
      });
    } else {
      sendResponse({
        success: false,
        reason: 'Element not found on active page view',
      });
    }
    return true;
  }

  if (request.action === 'CLEAR_HIGHLIGHT') {
    leakInspector.clear();
    sendResponse({ success: true });
    return true;
  }

  // ── Copy Swapper Actions ─────────────────────────────────────────
  if (request.action === 'SWAP_PAGE_COPY') {
    const result = copySwapper.swap(request.payload);
    sendResponse(result);
    return true;
  }

  if (request.action === 'REVERT_PAGE_COPY') {
    const success = copySwapper.revert(request.id);
    sendResponse({ success });
    return true;
  }

  if (request.action === 'REVERT_ALL_COPY') {
    copySwapper.revertAll();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GET_SWAP_STATUS') {
    sendResponse({ activeSwaps: copySwapper.getActiveSwaps() });
    return true;
  }

  return true; // keep message channel open for async response
});

