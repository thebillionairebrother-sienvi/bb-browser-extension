// Deterministic Page Extraction — produces a PageSnapshot matching the contract

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
}

function extractPageSnapshot(): PageSnapshot {
  const getText = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean);

  // Hero copy: first large text block inside a header/section/hero area
  const heroEl = document.querySelector(
    '[class*="hero"] h1, [class*="hero"] p, header h1, section:first-of-type h1'
  );
  const heroCopy = (heroEl?.textContent || '').trim();

  // CTA text: buttons and links with action-oriented words
  const ctaKeywords = ['buy', 'sign', 'get', 'start', 'try', 'subscribe', 'join', 'book', 'order', 'download', 'claim', 'request', 'schedule', 'contact'];
  const allInteractive = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"]'));
  const ctaText = allInteractive
    .map(el => (el.textContent || el.getAttribute('value') || '').trim())
    .filter(t => t.length > 0 && t.length < 100 && ctaKeywords.some(k => t.toLowerCase().includes(k)));

  // Visible button labels (all buttons, not just CTA-filtered)
  const visibleButtonLabels = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
    .map(el => (el.textContent || el.getAttribute('value') || '').trim())
    .filter(t => t.length > 0 && t.length < 80);

  // Pricing blocks: look for elements with price-like patterns
  const priceRegex = /\$[\d,.]+|€[\d,.]+|£[\d,.]+|[\d,.]+ ?\/(mo|month|yr|year)/i;
  const pricingBlocks = Array.from(document.querySelectorAll('[class*="price"], [class*="pricing"], [class*="plan"], [class*="tier"]'))
    .map(el => (el.textContent || '').trim().substring(0, 500))
    .filter(Boolean);
  // Fallback: scan all text nodes for prices
  if (pricingBlocks.length === 0) {
    const allParagraphs = Array.from(document.querySelectorAll('p, li, span, div'));
    allParagraphs.forEach(el => {
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
    .map(el => (el.textContent || '').trim().substring(0, 500))
    .filter(Boolean)
    .slice(0, 10);

  // FAQs
  const faqs = Array.from(
    document.querySelectorAll('[class*="faq"] summary, [class*="faq"] h3, [class*="accordion"] button, details summary')
  )
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
  };
}

// Listen for extraction requests from service worker / side panel
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXTRACT_PAGE') {
    sendResponse({ snapshot: extractPageSnapshot() });
  }
  return true; // keep message channel open for async response
});
