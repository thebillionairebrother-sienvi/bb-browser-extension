import React, { useState } from 'react';

export interface TestOnPagePayload {
  id: string;
  text: string;
  newText?: string;
  targetHint: 'headline' | 'subhead' | 'cta' | 'auto';
  originalHint?: string;
}

export interface MarkdownViewProps {
  content: string;
  role?: 'user' | 'derek' | string;
  onTestOnPage?: (payload: TestOnPagePayload) => void;
  onRevertPage?: (id: string) => void;
  activeSwappedIds?: Record<string, boolean>;
}

// ── Code Block with Copy & Test-on-Page Buttons ──────────────────
function CodeBlock({
  code,
  lang,
  blockId,
  onTestOnPage,
  onRevertPage,
  isSwapped,
}: {
  code: string;
  lang?: string;
  blockId: string;
  onTestOnPage?: (payload: TestOnPagePayload) => void;
  onRevertPage?: (id: string) => void;
  isSwapped?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cleanLang = (lang || '').toLowerCase().trim();
  const isExplicitCopyLang = ['copy', 'headline', 'cta', 'h1', 'h2', 'button', 'subhead', 'subheadline', 'hero'].includes(cleanLang);
  const trimmed = code.trim();
  const isCodeLike = /[{};]|(?:import|export|const|let|var|function|class|return|<[a-z]+)\b/i.test(trimmed);
  const isImplicitCopy = (!cleanLang || cleanLang === 'text') && trimmed.length > 2 && trimmed.length < 320 && !isCodeLike;

  // Never treat pure markdown symbols (like "**") or empty strings as copy targets
  const isValidCopyText = trimmed.length >= 2 && /[a-zA-Z0-9]/.test(trimmed) && !/^[*_~`#\-+]+$/.test(trimmed);
  const isCopyTarget = isValidCopyText && (isExplicitCopyLang || isImplicitCopy);

  let targetHint: 'headline' | 'subhead' | 'cta' | 'auto' = 'auto';
  if (['headline', 'h1', 'hero'].includes(cleanLang)) {
    targetHint = 'headline';
  } else if (['subhead', 'subheadline', 'h2'].includes(cleanLang)) {
    targetHint = 'subhead';
  } else if (['cta', 'button'].includes(cleanLang)) {
    targetHint = 'cta';
  } else {
    const ctaKeywords = ['buy', 'get', 'start', 'sign', 'try', 'join', 'claim', 'order', 'subscribe', 'book', 'schedule', 'contact', 'download', 'request'];
    const words = trimmed.toLowerCase().split(/\s+/);
    if (words.length <= 6 && ctaKeywords.some(k => trimmed.toLowerCase().includes(k))) {
      targetHint = 'cta';
    } else {
      targetHint = 'headline';
    }
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || 'copy'}</span>
        <div className="md-code-actions">
          {isCopyTarget && onTestOnPage && (
            <button
              type="button"
              className={`md-code-test-btn ${isSwapped ? 'swapped' : ''}`}
              onClick={() => {
                if (isSwapped) {
                  onRevertPage?.(blockId);
                } else {
                  onTestOnPage({
                    id: blockId,
                    text: trimmed,
                    newText: trimmed,
                    targetHint,
                  });
                }
              }}
              title={isSwapped ? 'Revert live copy on webpage' : 'Test this copy live on your active page'}
            >
              {isSwapped ? '↺ Revert' : '⚡ Test on Page'}
            </button>
          )}
          <button
            type="button"
            className={`md-code-copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Inline Tokenizer ─────────────────────────────────────────────
// Safely converts inline markdown (bold, italic, code, links) to React nodes
function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  // Regex pattern matching inline tokens
  // 1: code `...`
  // 2: bold+italic ***...*** or ___...___
  // 3: bold **...** or __...__
  // 4: italic *...* or _..._
  // 5: strikethrough ~~...~~
  // 6: link [text](url)
  // 7: newline \n
  const inlineRegex = /(`[^`\n]+`)|(\*\*\*[^*]+\*\*\*|___[^_]+___)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)\s]+)\))|(\n)/;

  while (remaining.length > 0) {
    const match = remaining.match(inlineRegex);
    if (!match || match.index === undefined) {
      nodes.push(remaining);
      break;
    }

    // Add preceding text before the match
    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }

    const matchedStr = match[0];

    if (match[1]) {
      // Inline code
      const code = matchedStr.slice(1, -1);
      nodes.push(
        <code key={`code-${keyIndex++}`} className="md-inline-code">
          {code}
        </code>
      );
    } else if (match[2]) {
      // Bold + Italic
      const inner = matchedStr.slice(3, -3);
      nodes.push(
        <strong key={`bi-${keyIndex++}`}>
          <em>{parseInline(inner)}</em>
        </strong>
      );
    } else if (match[3]) {
      // Bold
      const inner = matchedStr.slice(2, -2);
      nodes.push(
        <strong key={`b-${keyIndex++}`}>
          {parseInline(inner)}
        </strong>
      );
    } else if (match[4]) {
      // Italic
      const inner = matchedStr.slice(1, -1);
      nodes.push(
        <em key={`i-${keyIndex++}`}>
          {parseInline(inner)}
        </em>
      );
    } else if (match[5]) {
      // Strikethrough
      const inner = matchedStr.slice(2, -2);
      nodes.push(
        <del key={`del-${keyIndex++}`}>
          {parseInline(inner)}
        </del>
      );
    } else if (match[6]) {
      // Link
      const linkText = match[7];
      const linkUrl = match[8];
      const isSafe = /^https?:\/\//i.test(linkUrl) || /^mailto:/i.test(linkUrl);

      if (isSafe) {
        nodes.push(
          <a
            key={`a-${keyIndex++}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="md-link"
          >
            {parseInline(linkText)}
          </a>
        );
      } else {
        nodes.push(linkText);
      }
    } else if (match[9]) {
      // Newline inside a block
      nodes.push(<br key={`br-${keyIndex++}`} />);
    }

    remaining = remaining.slice(match.index + matchedStr.length);
  }

  return nodes;
}

// ── Intelligent Markdown Formatter ──────────────────────────────
// Normalizes raw or poorly-formatted AI output into clean, readable GitHub Flavored Markdown
export function formatDerekMarkdown(raw: string): string {
  if (!raw) return '';
  let formatted = raw.replace(/\r\n/g, '\n');

  // Stash any code blocks so subsequent regex formatting rules never touch or corrupt them
  const stashedBlocks: string[] = [];
  const stashCodeBlock = (lang: string, code: string): string => {
    const placeholder = `@@@BB_CODE_BLOCK_${stashedBlocks.length}@@@`;
    stashedBlocks.push(`\`\`\`${lang}\n${code}\n\`\`\``);
    return `\n\n${placeholder}\n\n`;
  };

  // 0a. Pre-stash existing multi-line fenced code blocks (even if indented inside a list)
  formatted = formatted.replace(/[ \t]*```(\w*)[ \t]*\n([\s\S]*?)```/g, (_m, lang, code) => {
    return stashCodeBlock(lang, code.trim());
  });

  // 0b. Pre-stash single-line triple-backtick blocks (e.g. ```headline Stop Leaking 40% of Your Revenue```)
  formatted = formatted.replace(
    /[ \t]*```(headline|subhead|subheadline|cta|copy|h1|h2|hero|button)[ \t]+([^`\n]+?)```/gi,
    (_m, lang, code) => {
      const cleanCode = code.replace(/^['"“‘*_\s]+|['"”’*_\s]+$/g, '').trim();
      return stashCodeBlock(lang.toLowerCase(), cleanCode);
    }
  );

  // 0c. Pre-stash single-backtick inline copy blocks when prefixed with a copy tag
  // (e.g. `headline Stop Guessing. Execute the Exact Next Correction.` or `cta Start Free`)
  formatted = formatted.replace(
    /(?<!`)`(headline|subhead|subheadline|cta|h1|h2)[ \t]+([^`\n]{3,260})`(?!`)/gi,
    (_m, lang, code) => {
      const cleanCode = code.replace(/^['"“‘*_\s]+|['"”’*_\s]+$/g, '').trim();
      let normLang = lang.toLowerCase();
      if (normLang === 'h1') normLang = 'headline';
      if (normLang === 'h2' || normLang === 'subheadline') normLang = 'subhead';
      return stashCodeBlock(normLang, cleanCode);
    }
  );

  // 1. Identify common section headers (even when unformatted or preceded by punctuation/space)
  // e.g. "REAL YET HARD TRUTHS:", "ACTIONABLE STEPS:", "EXECUTION PLAN:"
  const knownHeaders = [
    'REAL YET HARD TRUTHS',
    'HARD TRUTHS',
    'THE BRUTAL TRUTH',
    'ACTIONABLE STEPS',
    'ACTION PLAN',
    'EXECUTION PLAN',
    'EXECUTION STEPS',
    'RECOMMENDED ACTIONS',
    'RECOMMENDED MOVES',
    'TOP CONVERSION LEAKS',
    'TOP REVENUE LEAKS',
    'CONVERSION LEAKS',
    'REVENUE LEAKS',
    'HERO COPY REWRITE',
    'HERO COPY REWRITES',
    'HEADLINE REWRITE',
    'HEADLINE REWRITES',
    'VALUE PROPOSITION',
    'DRAFT DISCLAIMER',
    'LEGAL & COMPLIANCE',
    'SEASONAL STRATEGY',
    '24H SPRINT PLAN',
    'BEST NEXT MOVE',
    'KEY TAKEAWAY',
    'KEY TAKEAWAYS',
    'QUICK WINS',
    'THE FIX',
    'STEP-BY-STEP',
    'PROBABILITY ANALYSIS',
  ];

  // Match headers with optional colon when on their own line or preceded by sentence break
  const headerPattern = new RegExp(
    `(?:^|\\n|(?:[.\\!?]\\s+))(${knownHeaders.join('|')})\\s*:?\\s*(?=\\n|$)`,
    'gi'
  );

  formatted = formatted.replace(headerPattern, (_match, title) => {
    return `\n\n### ${title.trim().toUpperCase()}\n\n`;
  });

  // 2. Break inline numbered steps onto new lines
  // e.g. "ACTIONABLE STEPS\n\n1. First step... 2. Second step..."
  // Match " 1. ", " 2. " when preceded by sentence end or space
  formatted = formatted.replace(/(?:^|\s+)(\d+)\.\s+/g, (_match, num) => {
    return `\n\n${num}. `;
  });

  // 3. Bold the lead title of numbered list items if not already bolded
  // e.g. "1. Rebuild the Hero Grid into a 2-Column Split Desktop Layout. Put your hook..."
  // -> "1. **Rebuild the Hero Grid into a 2-Column Split Desktop Layout:** Put your hook..."
  formatted = formatted.replace(
    /^(\d+\.\s+)(?!\*\*)([^.:\n]{4,110})([.:])\s+/gm,
    (_match, prefix, leadTitle) => {
      return `${prefix}**${leadTitle.trim()}:** `;
    }
  );

  // 4a. Extract standalone multiline copy blocks like:
  // "headline\nSpot Every Deduction...\n\nsubheadline\n...\n\ncta\nAnalyze..."
  // Stops cleanly at a blank line or next tag/header/list.
  const multilineCopyPattern = /(?:^|\n)[^\S\r\n]*(?:[*+-][^\S\r\n]*)?(?:\*\*)?(headline|new headline|hero headline|h1|h1 rewrite|subheadline|sub-headline|subhead|hero subheadline|value proposition|value prop|cta|primary cta|cta button|button copy|call to action)(?:\*\*)?[^\S\r\n]*:?[^\S\r\n]*\n+((?:[^\n`#]+\n?)+?)(?=(?:\n[^\S\r\n]*\n|\n[^\S\r\n]*(?:headline|new headline|hero headline|h1|subheadline|sub-headline|subhead|value prop|cta|primary cta|button copy|call to action|option|\d+\.|\*|#{1,6}|@@@BB_CODE_BLOCK_)|$))/gi;
  formatted = formatted.replace(multilineCopyPattern, (_match, rawTag, rawBody) => {
    const tag = rawTag.toLowerCase().trim();
    const body = rawBody.replace(/^['"“‘*_\s]+|['"”’*_\s]+$/g, '').trim();
    // Guard: body must contain at least 2 alphanumeric chars and not be pure symbols or placeholders
    if (!body || body.length < 2 || body.includes('@@@BB_CODE_BLOCK_') || !/[a-zA-Z0-9]/.test(body) || /^[*_~`#\-+]+$/.test(body)) {
      return _match;
    }

    let cleanTag = 'headline';
    if (tag.includes('cta') || tag.includes('button') || tag.includes('call to action')) {
      cleanTag = 'cta';
    } else if (tag.includes('subhead') || tag.includes('sub-head') || tag.includes('value prop')) {
      cleanTag = 'subhead';
    }

    const placeholder = stashCodeBlock(cleanTag, body);
    return `\n\n* **${rawTag.toUpperCase()}:**${placeholder}`;
  });

  // 4b. Extract inline copy recommendations on the SAME line like "Headline: '...'" or "* **CTA:** Try Free"
  // Horizontal whitespace only ([^\S\r\n]) prevents jumping across newlines to subsequent lines/blocks.
  formatted = formatted.replace(
    /(?:^|\n)[^\S\r\n]*(?:[*+-][^\S\r\n]*)?(?:\*\*)?(Headline|New Headline|Proposed H1|H1 Rewrite|Hero Headline|Subhead|Subheadline|Sub-headline|Hero Subheadline|Value Proposition|Value Prop|CTA|Primary CTA|CTA Button|Button Copy|Call to Action|Option \d+(?:\s*\([^)]+\))?)(?:\*\*)?[^\S\r\n]*:[^\S\r\n]*(?:\*\*)?[^\S\r\n]*(['"“][^'"”\r\n]+['"”]|`[^`\r\n]+`|[^\r\n`]+)/gi,
    (_match, label, rawVal) => {
      if (rawVal.includes('@@@BB_CODE_BLOCK_')) return _match;
      const cleanLabel = label.trim();
      const lower = cleanLabel.toLowerCase();
      // Strip enclosing quotes, backticks, asterisks, underscores, and extra spaces
      const cleanVal = rawVal.replace(/^['"“‘`*_+\s]+|['"”’`*_+\s]+$/g, '').trim();

      // Guard: must contain alphanumeric content, at least 2 characters, and not be pure symbols
      if (!cleanVal || cleanVal.length < 2 || !/[a-zA-Z0-9]/.test(cleanVal) || /^[*_~`#\-+]+$/.test(cleanVal)) {
        return _match;
      }

      // If value is too long (e.g. whole explanatory paragraph), don't convert to copy block
      if (cleanVal.length > 260) {
        return _match;
      }

      let lang = 'headline';
      if (lower.includes('cta') || lower.includes('button') || lower.includes('call to action')) {
        lang = 'cta';
      } else if (lower.includes('subhead') || lower.includes('sub-head') || lower.includes('value prop')) {
        lang = 'subhead';
      }

      const placeholder = stashCodeBlock(lang, cleanVal);
      return `\n\n* **${cleanLabel}:**${placeholder}`;
    }
  );

  // 5. Technical tokens: hex colors and key=val params
  formatted = formatted.replace(/(?<!`)(#[0-9A-Fa-f]{6}\b)(?!`)/g, '`$1`');
  formatted = formatted.replace(/(?<!`)\b([a-zA-Z_]{3,}=\d+)\b(?!`)/g, '`$1`');

  // Restore stashed code blocks
  formatted = formatted.replace(/@@@BB_CODE_BLOCK_(\d+)@@@/g, (_m, idx) => {
    return stashedBlocks[parseInt(idx, 10)] || _m;
  });

  // Clean up extra blank lines
  formatted = formatted.replace(/\n{3,}/g, '\n\n').trim();

  return formatted;
}

// ── Types for Block Tokens ───────────────────────────────────────
type ListItem = {
  text: string;
  subItems?: ListItem[];
};

type BlockToken =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ordered-list'; start: number; items: ListItem[] }
  | { type: 'unordered-list'; items: ListItem[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

// ── Block-level Parser ───────────────────────────────────────────
function parseMarkdownBlocks(rawMarkdown: string): BlockToken[] {
  const lines = rawMarkdown.replace(/\r\n/g, '\n').split('\n');
  const tokens: BlockToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Blank line
    if (!trimmedLine) {
      i++;
      continue;
    }

    // 1a. Single-line Fenced Code Block (e.g. ```headline Stop Leaking Revenue```)
    const singleLineFence = trimmedLine.match(/^```(\w*)\s+(.+?)```\s*$/);
    if (singleLineFence) {
      const lang = singleLineFence[1] || '';
      const code = singleLineFence[2].trim();
      if (code.length > 0 && /[a-zA-Z0-9]/.test(code) && !/^[*_~`#\-+]+$/.test(code)) {
        tokens.push({ type: 'code', lang, code });
      }
      i++;
      continue;
    }

    // 1b. Multi-line Fenced Code Block
    const codeFenceMatch = trimmedLine.match(/^```(\w*)\s*(.*)$/);
    if (codeFenceMatch) {
      const lang = codeFenceMatch[1] || '';
      const codeLines: string[] = [];
      if (codeFenceMatch[2] && codeFenceMatch[2].trim()) {
        codeLines.push(codeFenceMatch[2].trim());
      }
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing fence
      }
      const code = codeLines.join('\n').trim();
      // Guard: Discard phantom/corrupted code blocks containing only symbols, asterisks, or empty whitespace
      if (code.length > 0 && /[a-zA-Z0-9]/.test(code) && !/^[*_~`#\-+]+$/.test(code)) {
        tokens.push({
          type: 'code',
          lang,
          code,
        });
      }
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (/^(?:---|\*\*\*|___)\s*$/.test(trimmedLine)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // 3. Headings (#, ##, ###, ####, #####, ######)
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Blockquote (> ...)
    if (trimmedLine.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      tokens.push({
        type: 'blockquote',
        lines: quoteLines,
      });
      continue;
    }

    // 5. Table (| Header 1 | Header 2 |)
    if (
      trimmedLine.startsWith('|') &&
      trimmedLine.endsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*[-:]+[-| :]*\s*\|?\s*$/.test(lines[i + 1])
    ) {
      const parseRow = (rowStr: string) =>
        rowStr
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseRow(lines[i]);
      i += 2; // skip header and delimiter row
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      tokens.push({
        type: 'table',
        headers,
        rows,
      });
      continue;
    }

    // 6. Lists (Ordered: "1. ", Unordered: "* ", "- ", "+ ")
    const firstOrdMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const isOrdered = Boolean(firstOrdMatch);
    const isUnordered = /^\s*[*+-]\s+(.*)$/.test(line);

    if (isOrdered || isUnordered) {
      const startNum = firstOrdMatch ? parseInt(firstOrdMatch[1], 10) || 1 : 1;
      const items: ListItem[] = [];

      while (i < lines.length) {
        const curLine = lines[i];
        const curTrimmed = curLine.trim();

        // Never swallow fenced code blocks or headings into list items
        if (curTrimmed.startsWith('```') || /^#{1,6}\s+/.test(curTrimmed)) {
          break;
        }

        if (!curTrimmed) {
          // Peek next line to see if list of the SAME type continues directly
          if (
            i + 1 < lines.length &&
            !lines[i + 1].trim().startsWith('```') &&
            (isOrdered
              ? /^\s*\d+\.\s+/.test(lines[i + 1])
              : /^\s*[*+-]\s+/.test(lines[i + 1]))
          ) {
            i++;
            continue;
          }
          break;
        }

        const ordMatch = curLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
        const unordMatch = curLine.match(/^(\s*)([*+-])\s+(.*)$/);

        if (!ordMatch && !unordMatch) {
          // Continuation line of previous list item if indented
          if (/^\s{2,}/.test(curLine) && items.length > 0) {
            const lastItem = items[items.length - 1];
            if (lastItem.subItems && lastItem.subItems.length > 0) {
              const lastSub = lastItem.subItems[lastItem.subItems.length - 1];
              lastSub.text += ' ' + curTrimmed;
            } else {
              lastItem.text += ' ' + curTrimmed;
            }
            i++;
            continue;
          }
          break;
        }

        const indent = (ordMatch ? ordMatch[1] : unordMatch![1]).length;
        const itemText = (ordMatch ? ordMatch[3] : unordMatch![3]).trim();

        // If indented (2+ spaces), it's a sub-item of the last top-level item
        if (indent >= 2 && items.length > 0) {
          const parentItem = items[items.length - 1];
          if (!parentItem.subItems) parentItem.subItems = [];
          parentItem.subItems.push({ text: itemText });
        } else if ((isOrdered && ordMatch) || (!isOrdered && unordMatch)) {
          // Top-level item of same list type
          items.push({ text: itemText });
        } else if (items.length > 0) {
          // Mixed list marker right under a list item -> treat as sub-item so it doesn't break parent item
          const parentItem = items[items.length - 1];
          if (!parentItem.subItems) parentItem.subItems = [];
          parentItem.subItems.push({ text: itemText });
        } else {
          break;
        }

        i++;
      }

      if (isOrdered) {
        tokens.push({
          type: 'ordered-list',
          start: startNum,
          items,
        });
      } else {
        tokens.push({
          type: 'unordered-list',
          items,
        });
      }
      continue;
    }

    // 7. Regular Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !/^(?:---|\*\*\*|___)\s*$/.test(lines[i].trim()) &&
      !/^\s*(\d+\.|[*+-])\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      tokens.push({
        type: 'paragraph',
        text: paraLines.join('\n'),
      });
    }
  }

  return tokens;
}

// ── MarkdownView Component ───────────────────────────────────────
export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  role = 'derek',
  onTestOnPage,
  onRevertPage,
  activeSwappedIds,
}) => {
  if (!content) return null;

  const formattedContent = role === 'derek' ? formatDerekMarkdown(content) : content;
  const blocks = parseMarkdownBlocks(formattedContent);

  return (
    <div className={`markdown-view role-${role}`}>
      {blocks.map((token, idx) => {
        switch (token.type) {
          case 'heading': {
            const HeadingTag = `h${Math.min(token.level, 4)}` as keyof JSX.IntrinsicElements;
            return (
              <HeadingTag key={idx} className={`md-heading md-h${token.level}`}>
                {parseInline(token.text)}
              </HeadingTag>
            );
          }

          case 'code': {
            const blockId = `swap_${Math.abs(token.code.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)).toString(36)}`;
            return (
              <CodeBlock
                key={idx}
                code={token.code}
                lang={token.lang}
                blockId={blockId}
                onTestOnPage={onTestOnPage}
                onRevertPage={onRevertPage}
                isSwapped={Boolean(activeSwappedIds?.[blockId])}
              />
            );
          }

          case 'blockquote':
            return (
              <blockquote key={idx} className="md-blockquote">
                {token.lines.map((line, lIdx) => (
                  <p key={lIdx}>{parseInline(line)}</p>
                ))}
              </blockquote>
            );

          case 'ordered-list':
            return (
              <ol key={idx} start={token.start} className="md-list md-ordered">
                {token.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="md-list-item">
                    <div className="md-item-content">{parseInline(item.text)}</div>
                    {item.subItems && item.subItems.length > 0 && (
                      <ul className="md-list md-sub-list md-unordered">
                        {item.subItems.map((sub, subIdx) => (
                          <li key={subIdx} className="md-list-item md-sub-item">
                            <div className="md-item-content">{parseInline(sub.text)}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            );

          case 'unordered-list':
            return (
              <ul key={idx} className="md-list md-unordered">
                {token.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="md-list-item">
                    <div className="md-item-content">{parseInline(item.text)}</div>
                    {item.subItems && item.subItems.length > 0 && (
                      <ul className="md-list md-sub-list md-unordered">
                        {item.subItems.map((sub, subIdx) => (
                          <li key={subIdx} className="md-list-item md-sub-item">
                            <div className="md-item-content">{parseInline(sub.text)}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            );

          case 'table':
            return (
              <div key={idx} className="md-table-wrapper">
                <table className="md-table">
                  <thead>
                    <tr>
                      {token.headers.map((h, hIdx) => (
                        <th key={hIdx}>{parseInline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {token.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>{parseInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'hr':
            return <hr key={idx} className="md-hr" />;

          case 'paragraph':
            return (
              <p key={idx} className="md-paragraph">
                {parseInline(token.text)}
              </p>
            );

          default:
            return null;
        }
      })}
    </div>
  );
};

export default MarkdownView;
