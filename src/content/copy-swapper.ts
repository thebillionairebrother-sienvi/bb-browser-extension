// Live In-Place Copy Swapper ("Try Rewrite on Page")
// Swaps live DOM text while preserving nested child elements (SVGs, icons, badges)
// and displays a screenshot-friendly floating HUD.

export interface SwapRequest {
  id: string;
  newText?: string;
  text?: string;
  targetHint?: 'headline' | 'subhead' | 'cta' | 'auto';
  originalHint?: string;
}

export interface SwapResult {
  success: boolean;
  id: string;
  supersededIds?: string[];
  matchedTagName?: string;
  originalText?: string;
  elementSummary?: string;
  error?: string;
}

export interface ActiveSwapInfo {
  id: string;
  tagName: string;
  originalText: string;
  currentText: string;
  targetHint: string;
}

interface SwapRecord {
  id: string;
  element: HTMLElement;
  originalHtml: string;
  originalText: string;
  currentText: string;
  targetHint: 'headline' | 'subhead' | 'cta' | 'auto';
}

function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
  if (element.closest('#bb-copy-swapper-hud-host')) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity || '1') > 0 &&
    element.getClientRects().length > 0
  );
}

function isNotInNavOrFooter(element: HTMLElement): boolean {
  return !element.closest('nav, footer, [role="navigation"], #bb-copy-swapper-hud-host');
}

export class CopySwapperManager {
  private activeSwaps = new Map<string, SwapRecord>();
  // Element -> baseline original HTML & text (to preserve baseline across multi-option hot-swapping)
  private elementBaselines = new WeakMap<HTMLElement, { originalHtml: string; text: string }>();
  private hudHost: HTMLElement | null = null;
  private hudShadow: ShadowRoot | null = null;
  private screenshotTimeoutId: number | null = null;

  // ── 1. Target Element Resolution ────────────────────────────────
  public findTargetElement(hint: 'headline' | 'subhead' | 'cta' | 'auto', originalHint?: string): HTMLElement | null {
    // A. Match by original hint if provided (only for headline/auto, or if hint matches tag)
    if (originalHint && originalHint.trim().length > 2 && (hint === 'headline' || hint === 'auto')) {
      const match = this.findByOriginalText(originalHint.trim());
      if (match) return match;
    }

    // B. Headline targeting
    if (hint === 'headline') {
      const candidates = [
        'main h1',
        '[class*="hero"] h1',
        'header h1',
        'section:first-of-type h1',
        'h1',
        '[class*="hero"] [class*="title"]',
        '[class*="hero"] h2',
        'main h2',
        'h2',
      ];
      for (const sel of candidates) {
        try {
          const els = Array.from(document.querySelectorAll<HTMLElement>(sel))
            .filter(isElementVisible)
            .filter(isNotInNavOrFooter);
          if (els.length > 0) return els[0];
        } catch {}
      }
    }

    // C. Subhead targeting (prefer paragraph or h2 immediately following the hero H1, skipping tiny eyebrow badges above H1)
    if (hint === 'subhead') {
      const primaryH1 = Array.from(document.querySelectorAll<HTMLElement>('h1'))
        .filter(isElementVisible)
        .filter(isNotInNavOrFooter)[0];

      if (primaryH1) {
        const heroScope = (primaryH1.closest('section, header, main, [class*="hero"]') as HTMLElement) || document.body;
        const followingCandidates = Array.from(
          heroScope.querySelectorAll<HTMLElement>('p, h2, [class*="subtitle"], [class*="subhead"], [class*="description"], [class*="lead"]')
        )
          .filter(isElementVisible)
          .filter(isNotInNavOrFooter)
          .filter(el => {
            if (el === primaryH1 || primaryH1.contains(el) || el.contains(primaryH1)) return false;
            const isAfterH1 = Boolean(primaryH1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
            const textLen = (el.textContent || '').trim().length;
            return isAfterH1 && textLen >= 15;
          });

        if (followingCandidates.length > 0) {
          return followingCandidates[0];
        }
      }

      const candidates = [
        'h1 + p',
        '[class*="hero"] [class*="subtitle"]',
        '[class*="hero"] [class*="subhead"]',
        '[class*="hero"] [class*="description"]',
        '[class*="hero"] p',
        'section:first-of-type p',
        'main p',
        '[class*="hero"] h2',
        'h2',
      ];
      for (const sel of candidates) {
        try {
          const els = Array.from(document.querySelectorAll<HTMLElement>(sel))
            .filter(isElementVisible)
            .filter(isNotInNavOrFooter)
            .filter(el => (el.textContent || '').trim().length >= 12);
          if (els.length > 0) return els[0];
        } catch {}
      }
    }

    // D. CTA targeting (exclude top navbar/footer links first so we target the Hero CTA button)
    if (hint === 'cta') {
      const ctaKeywords = ['buy', 'sign', 'get', 'start', 'try', 'subscribe', 'join', 'book', 'order', 'download', 'claim', 'request', 'schedule', 'contact', 'review', 'analyze', 'audit', 'launch', 'explore'];
      const allInteractive = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, a[role="button"], a.btn, [class*="btn"], [class*="button"], [class*="cta"], main a, section:first-of-type a, input[type="submit"]'
        )
      ).filter(isElementVisible);

      const heroInteractive = allInteractive.filter(isNotInNavOrFooter);
      const pool = heroInteractive.length > 0 ? heroInteractive : allInteractive;

      // 1. First priority: interactive element outside nav/footer with CTA action keyword
      for (const el of pool) {
        const text = (el.textContent || el.getAttribute('value') || '').trim().toLowerCase();
        if (text.length >= 2 && text.length <= 60 && ctaKeywords.some(k => text.includes(k))) {
          return el;
        }
      }

      // 2. Second priority: first visible button or CTA outside nav/footer
      if (pool.length > 0) return pool[0];
    }

    // E. Auto detection: deduce from text characteristics
    const h1 = Array.from(document.querySelectorAll<HTMLElement>('h1')).find(el => isElementVisible(el) && isNotInNavOrFooter(el));
    if (h1) return h1;

    const firstBtn = Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"], a.btn')).find(
      el => isElementVisible(el) && isNotInNavOrFooter(el)
    );
    if (firstBtn) return firstBtn;

    return null;
  }

  private findByOriginalText(rawTarget: string): HTMLElement | null {
    const cleanTarget = rawTarget.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!cleanTarget) return null;

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, button, a, [role="button"], [class*="hero"] p, p'
      )
    )
      .filter(isElementVisible)
      .filter(isNotInNavOrFooter);

    // Exact match (ignoring whitespace differences)
    const exact = candidates.find(
      el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === cleanTarget
    );
    if (exact) return exact;

    // Substring match: prefer heading/button over inner span so multi-span H1 is replaced as a whole
    const containing = candidates
      .filter(el => (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanTarget))
      .sort((a, b) => (a.textContent?.length || 9999) - (b.textContent?.length || 9999));

    return containing.length > 0 ? containing[0] : null;
  }

  // ── 2. Child-Preserving Text Replacement ────────────────────────
  // Replaces all text nodes inside element (so multi-span H1s don't leave old text behind)
  // while preserving nested SVGs, icons, and gradient spans.
  private applyTextPreservingIcons(element: HTMLElement, newText: string): void {
    if (element instanceof HTMLInputElement) {
      element.value = newText;
      return;
    }

    const textNodes: Text[] = [];
    const collectTextNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.nodeValue || '').trim().length > 0) {
          textNodes.push(node as Text);
        }
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase();
        if (['svg', 'script', 'style', 'noscript'].includes(tag)) return;
        for (const child of Array.from(node.childNodes)) {
          collectTextNodes(child);
        }
      }
    };

    collectTextNodes(element);

    const hasInlineSvg = Boolean(element.querySelector('svg'));

    if (textNodes.length >= 2 && /^h[1-3]$/i.test(element.tagName)) {
      // If a heading has 2 distinct styled parts (e.g. main line + gradient span) and newText has 2 sentences,
      // split at the first sentence boundary so the gradient span keeps its highlight effect!
      const sentenceSplit = newText.match(/^([^.!?]+[.!?])\s+([\s\S]+)$/);
      if (sentenceSplit) {
        textNodes[0].nodeValue = sentenceSplit[1].trim() + ' ';
        textNodes[1].nodeValue = sentenceSplit[2].trim();
        for (let i = 2; i < textNodes.length; i++) {
          textNodes[i].nodeValue = '';
        }
        return;
      }
    }

    if (textNodes.length > 0) {
      textNodes[0].nodeValue = hasInlineSvg ? `${newText} ` : newText;
      for (let i = 1; i < textNodes.length; i++) {
        textNodes[i].nodeValue = '';
      }
      // Hide any line breaks inside multi-line headings when placing single-part text
      element.querySelectorAll<HTMLElement>('br').forEach(br => {
        br.style.display = 'none';
      });
    } else {
      element.textContent = newText;
    }
  }

  // ── 3. Swap Copy on Page ────────────────────────────────────────
  public swap(req: SwapRequest): SwapResult {
    const copyText = (req?.newText || req?.text || '').trim();

    // Guard against empty or markdown punctuation-only copy requests
    if (!copyText || !/[a-zA-Z0-9]/.test(copyText) || /^[*_~`#\-+]+$/.test(copyText)) {
      return {
        success: false,
        id: req?.id || 'unknown',
        error: 'Invalid copy text: must contain alphanumeric content.',
      };
    }

    const targetElement = this.findTargetElement(req.targetHint || 'auto', req.originalHint);
    if (!targetElement) {
      return {
        success: false,
        id: req.id,
        error: `Could not locate target ${req.targetHint || 'element'} on page.`,
      };
    }

    // Check if element already has baseline original HTML/text from a prior swap (for multi-option hot-swapping)
    let baseline = this.elementBaselines.get(targetElement);
    const supersededIds: string[] = [];

    if (baseline) {
      // Restore original DOM structure first before applying the new option
      targetElement.innerHTML = baseline.originalHtml;
      for (const [existingId, record] of this.activeSwaps.entries()) {
        if (record.element === targetElement && existingId !== req.id) {
          supersededIds.push(existingId);
          this.activeSwaps.delete(existingId);
        }
      }
    } else {
      const originalText = (targetElement.innerText || targetElement.textContent || '').replace(/\s+/g, ' ').trim();
      baseline = {
        originalHtml: targetElement.innerHTML,
        text: originalText,
      };
      this.elementBaselines.set(targetElement, baseline);
    }

    // Apply the new text while preserving SVGs/icons and styled spans
    this.applyTextPreservingIcons(targetElement, copyText);

    // Record swap
    this.activeSwaps.set(req.id, {
      id: req.id,
      element: targetElement,
      originalHtml: baseline.originalHtml,
      originalText: baseline.text,
      currentText: copyText,
      targetHint: req.targetHint || 'auto',
    });

    // Mark element with data attribute
    targetElement.setAttribute('data-bb-swapped', 'true');
    targetElement.setAttribute('data-bb-swap-id', req.id);

    // Apply transient screenshot-friendly pulse glow (fades out completely in 1.8s)
    this.applyTransientGlow(targetElement);

    // Update floating HUD
    this.renderFloatingHud();

    // Smooth scroll into viewport center
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return {
      success: true,
      id: req.id,
      supersededIds,
      matchedTagName: targetElement.tagName.toLowerCase(),
      originalText: baseline.text,
      elementSummary: `<${targetElement.tagName.toLowerCase()}> ${(baseline.text || '').trim().slice(0, 60)}...`,
    };
  }

  // ── 4. Revert Single Swap ───────────────────────────────────────
  public revert(id: string): boolean {
    const record = this.activeSwaps.get(id);
    if (!record) return false;

    if (record.element) {
      record.element.innerHTML = record.originalHtml;
      record.element.removeAttribute('data-bb-swapped');
      record.element.removeAttribute('data-bb-swap-id');
      this.elementBaselines.delete(record.element);
    }

    this.activeSwaps.delete(id);
    this.renderFloatingHud();
    return true;
  }

  // ── 5. Revert All Swaps ─────────────────────────────────────────
  public revertAll(): void {
    const ids = Array.from(this.activeSwaps.keys());
    for (const id of ids) {
      this.revert(id);
    }
  }

  // ── 6. Get Active Swaps Status ──────────────────────────────────
  public getActiveSwaps(): ActiveSwapInfo[] {
    return Array.from(this.activeSwaps.values()).map(r => ({
      id: r.id,
      tagName: r.element.tagName.toLowerCase(),
      originalText: r.originalText,
      currentText: r.currentText,
      targetHint: r.targetHint,
    }));
  }

  // ── 7. Transient Screenshot-Friendly Glow Animation ─────────────
  private applyTransientGlow(element: HTMLElement): void {
    const styleId = 'bb-copy-swapper-animation-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        @keyframes bb-copy-swap-flash {
          0% {
            outline: 3px solid rgba(234, 179, 8, 0.95);
            box-shadow: 0 0 24px rgba(234, 179, 8, 0.55);
            border-radius: 4px;
          }
          70% {
            outline: 3px solid rgba(234, 179, 8, 0.35);
            box-shadow: 0 0 12px rgba(234, 179, 8, 0.2);
          }
          100% {
            outline: 3px solid transparent;
            box-shadow: none;
          }
        }
        .bb-copy-swap-animating {
          animation: bb-copy-swap-flash 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
        }
      `;
      document.head.appendChild(styleEl);
    }

    element.classList.remove('bb-copy-swap-animating');
    // Trigger reflow to restart animation if hot-swapped
    void element.offsetWidth;
    element.classList.add('bb-copy-swap-animating');

    setTimeout(() => {
      element.classList.remove('bb-copy-swap-animating');
    }, 1900);
  }

  // ── 8. Isolated Shadow DOM Floating HUD ─────────────────────────
  private ensureHudHost(): ShadowRoot {
    if (this.hudHost && this.hudShadow) {
      return this.hudShadow;
    }

    let existing = document.getElementById('bb-copy-swapper-hud-host');
    if (existing) existing.remove();

    this.hudHost = document.createElement('div');
    this.hudHost.id = 'bb-copy-swapper-hud-host';
    this.hudHost.style.position = 'fixed';
    this.hudHost.style.bottom = '24px';
    this.hudHost.style.right = '24px';
    this.hudHost.style.zIndex = '2147483647';
    this.hudHost.style.pointerEvents = 'auto';

    document.documentElement.appendChild(this.hudHost);
    this.hudShadow = this.hudHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }

      .bb-hud-pill {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(13, 14, 18, 0.94);
        border: 1px solid rgba(234, 179, 8, 0.45);
        border-radius: 9999px;
        padding: 8px 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 15px rgba(234, 179, 8, 0.2);
        backdrop-filter: blur(12px);
        color: #f4f4f5;
        font-size: 12px;
        font-weight: 500;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }

      .bb-hud-pill.hidden-for-screenshot {
        opacity: 0;
        pointer-events: none;
        transform: translateY(12px);
      }

      .bb-hud-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        background: #eab308;
        color: #000;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 800;
      }

      .bb-hud-title {
        color: #fef08a;
        font-weight: 600;
      }

      .bb-hud-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
      }

      .bb-hud-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #e4e4e7;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 9999px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .bb-hud-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }

      .bb-hud-btn-revert {
        background: rgba(234, 179, 8, 0.18);
        border-color: rgba(234, 179, 8, 0.45);
        color: #fef08a;
      }

      .bb-hud-btn-revert:hover {
        background: rgba(234, 179, 8, 0.35);
        color: #ffffff;
      }

      .bb-hud-close {
        background: transparent;
        border: none;
        color: #71717a;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        line-height: 1;
        transition: color 0.15s ease;
      }

      .bb-hud-close:hover {
        color: #d4d4d8;
      }
    `;
    this.hudShadow.appendChild(styleEl);

    return this.hudShadow;
  }

  private renderFloatingHud(): void {
    if (this.activeSwaps.size === 0) {
      if (this.hudHost) {
        this.hudHost.remove();
        this.hudHost = null;
        this.hudShadow = null;
      }
      return;
    }

    const shadow = this.ensureHudHost();
    let container = shadow.querySelector('.bb-hud-pill') as HTMLElement | null;

    if (!container) {
      container = document.createElement('div');
      container.className = 'bb-hud-pill';
      shadow.appendChild(container);
    }

    const count = this.activeSwaps.size;
    const latestSwap = Array.from(this.activeSwaps.values())[this.activeSwaps.size - 1];
    const tagLabel = latestSwap ? `<${latestSwap.element.tagName.toLowerCase()}>` : 'element';

    container.innerHTML = `
      <div class="bb-hud-icon">⚡</div>
      <div>
        <span class="bb-hud-title">Live Copy Swapped</span>
        <span style="color:#a1a1aa; margin-left:4px;">(${tagLabel}${count > 1 ? ` +${count - 1}` : ''})</span>
      </div>
      <div class="bb-hud-actions">
        <button type="button" class="bb-hud-btn bb-hud-btn-revert" id="bb-hud-revert">↺ Revert</button>
        <button type="button" class="bb-hud-btn" id="bb-hud-hide" title="Temporarily hide HUD for screenshot">📷 Hide</button>
        <button type="button" class="bb-hud-close" id="bb-hud-close" title="Dismiss HUD">✕</button>
      </div>
    `;

    // Bind HUD events
    const revertBtn = container.querySelector('#bb-hud-revert');
    revertBtn?.addEventListener('click', () => {
      this.revertAll();
      // Notify extension runtime so sidepanel buttons update in sync
      try {
        chrome.runtime.sendMessage({ action: 'COPY_REVERTED_FROM_HUD' });
      } catch {}
    });

    const hideBtn = container.querySelector('#bb-hud-hide');
    hideBtn?.addEventListener('click', () => {
      container?.classList.add('hidden-for-screenshot');
      if (this.screenshotTimeoutId) clearTimeout(this.screenshotTimeoutId);
      // Auto restore after 12 seconds
      this.screenshotTimeoutId = window.setTimeout(() => {
        container?.classList.remove('hidden-for-screenshot');
      }, 12000);
    });

    const closeBtn = container.querySelector('#bb-hud-close');
    closeBtn?.addEventListener('click', () => {
      if (this.hudHost) {
        this.hudHost.remove();
        this.hudHost = null;
        this.hudShadow = null;
      }
    });
  }
}

export const copySwapper = new CopySwapperManager();
