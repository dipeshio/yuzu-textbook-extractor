/**
 * injected.js — Functions injected into Yuzu frames
 *
 * These functions are serialized and injected into frames via
 * chrome.scripting.executeScript(). They run in the frame's
 * OWN context, so they have full access to that frame's DOM.
 * They CANNOT reference any variables outside of this file —
 * they must be fully self-contained.
 */

/**
 * Injected into the EPUB content frame.
 * Extracts the HTML body, styles, title, and base URI.
 * Returns a serializable object (no DOM nodes).
 */
function extractContentFromFrame(opts) {
  try {
    const doc = document;

    // Check if this frame actually has meaningful content
    if (!doc.body || doc.body.innerHTML.trim().length < 100) {
      return { error: 'Frame has no meaningful content.' };
    }

    // ── Collect styles ─────────────────────────────────────
    const styles = [];

    // Helper: sanitize CSS to remove Yuzu print-blocking rules
    function sanitizeCss(css) {
      // Remove @media print blocks
      css = css.replace(
        /@media\s+(?:only\s+)?print\s*\{(?:[^{}]*|\{[^{}]*\})*\}/gi,
        '/* [yuzu-extractor] print block removed */'
      );
      // Remove body > * { display: none !important; ... } rules
      css = css.replace(
        /body\s*>\s*\*\s*\{[^}]*display\s*:\s*none\s*!important[^}]*\}/gi,
        '/* [yuzu-extractor] print-block body>* rule removed */'
      );
      // Remove body::before / body:before with print warning content
      css = css.replace(
        /body\s*::?before\s*\{[^}]*content\s*:\s*["'][^"']*print[^"']*page[^"']*range[^"']*["'][^}]*\}/gi,
        '/* [yuzu-extractor] print-warning pseudo-element removed */'
      );
      return css;
    }

    // Inline <style> elements
    doc.querySelectorAll('style').forEach(s => {
      // Skip <style media="print"> — these are Yuzu's print-blocking styles
      const media = (s.getAttribute('media') || '').toLowerCase().trim();
      if (media === 'print') return;

      let css = s.textContent || '';

      // MathJax (and similar libraries) inject rules dynamically via
      // sheet.insertRule(), which means the CSSOM has more rules than
      // textContent.  Detect that and rebuild CSS from the CSSOM so we
      // capture @font-face declarations and character-glyph rules.
      try {
        const sheet = s.sheet;
        if (sheet && sheet.cssRules && sheet.cssRules.length > 0) {
          // Heuristic: if CSSOM has significantly more rules than
          // textContent suggests, rebuild from CSSOM.
          const textRuleEstimate = (css.match(/\}/g) || []).length;
          if (sheet.cssRules.length > textRuleEstimate + 5) {
            let cssom = '';
            for (const rule of sheet.cssRules) {
              cssom += rule.cssText + '\n';
            }
            css = cssom;
          }
        }
      } catch (_) { /* CSSOM not accessible — use textContent */ }

      if (opts.fixPrint) {
        css = sanitizeCss(css);
      }
      styles.push({ type: 'inline', css, base: doc.baseURI || '' });
    });

    // Linked stylesheets — try to read via CSSOM
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.href;
      if (!href) return;

      // Skip print-only linked stylesheets
      const media = (link.getAttribute('media') || '').toLowerCase().trim();
      if (media === 'print') return;

      try {
        for (const sheet of doc.styleSheets) {
          if (sheet.href === href || sheet.ownerNode === link) {
            // Also skip if the sheet's media is print
            if (sheet.media && sheet.media.mediaText &&
                sheet.media.mediaText.toLowerCase().trim() === 'print') {
              return;
            }
            let css = '';
            for (const rule of sheet.cssRules) {
              css += rule.cssText + '\n';
            }
            if (opts.fixPrint) {
              css = sanitizeCss(css);
            }
            styles.push({ type: 'inlined-link', href, css, base: href });
            return;
          }
        }
      } catch (e) {
        // Cross-origin stylesheet — keep the link reference
      }
      styles.push({ type: 'link', href });
    });

    // ── Clone body and clean ───────────────────────────────
    const bodyClone = doc.body.cloneNode(true);

    // Strip UI elements
    if (opts.stripUI) {
      const uiSelectors = [
        'nav', 'header:not(section header)', 'footer',
        '[class*="toolbar"]', '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="toast"]', '[class*="Toast"]',
        '[class*="modal"]', '[class*="Modal"]',
        '[class*="overlay"]', '[class*="Overlay"]',
        '[class*="floating"]', '[class*="Floating"]',
        '[role="navigation"]', '[role="banner"]',
        '[role="complementary"]', '[role="dialog"]',
        '[role="alertdialog"]',
        'pwa-extension-ng-components',
        '.widget', '#staticloader', '#vstui__portal_root',
        '[data-testid*="toolbar"]', '[data-testid*="sidebar"]',
        '[class*="annotation"]', '[class*="highlight-"]',
      ];
      uiSelectors.forEach(sel => {
        try { bodyClone.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
      });

      // Remove hidden elements
      bodyClone.querySelectorAll('[style]').forEach(el => {
        const s = el.style;
        if (s.display === 'none' || s.visibility === 'hidden') {
          if (!el.querySelector('img, table, figure, math, svg')) {
            el.remove();
          }
        }
      });

      // Remove scripts
      bodyClone.querySelectorAll('script').forEach(s => s.remove());
    }

    // Remove Yuzu print warning banner/message if present
    stripPrintWarning(bodyClone);

    // ── Fix image URLs (make absolute) ─────────────────────
    bodyClone.querySelectorAll('img').forEach(img => {
      if (img.src) img.setAttribute('src', img.src);
      const dataSrc = img.getAttribute('data-src');
      if (dataSrc && !img.src) {
        try { img.src = new URL(dataSrc, doc.baseURI).href; } catch (_) {}
      }
    });

    // Fix background-image URLs
    bodyClone.querySelectorAll('[style*="background"]').forEach(el => {
      const style = el.getAttribute('style');
      if (style && style.includes('url(')) {
        el.setAttribute('style', style.replace(
          /url\(['"]?(?!data:)(.*?)['"]?\)/g,
          (match, url) => {
            try { return `url('${new URL(url, doc.baseURI).href}')`; }
            catch (_) { return match; }
          }
        ));
      }
    });

    return {
      bodyHTML: bodyClone.innerHTML,
      styles,
      title: doc.title || 'Yuzu Section',
      baseURI: doc.baseURI || '',
      scrolled: false,
    };

  } catch (err) {
    return { error: `Extraction error: ${err.message}` };
  }

  function stripPrintWarning(root) {
    const printWarning = 'To print, please use the print page range feature within the application.';
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const toRemove = new Set();
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if ((node.nodeValue || '').includes(printWarning)) {
          let el = node.parentElement;
          while (el && el !== root) {
            if ((el.textContent || '').includes(printWarning)) {
              toRemove.add(el);
            }
            el = el.parentElement;
          }
        }
      }
      toRemove.forEach(el => el.remove());
    } catch (_) { /* ignore */ }
  }
}


/**
 * Injected into the wrapper frame when direct EPUB frame injection fails.
 * This function can access same-origin iframes within the wrapper,
 * including piercing the <mosaic-book> Shadow DOM.
 */
function extractContentFromWrapperFrame(opts) {
  try {
    const doc = document;

    // Strategy 1: <mosaic-book> → Shadow DOM → iframe.favre
    const mosaicBook = doc.querySelector('mosaic-book');
    if (mosaicBook && mosaicBook.shadowRoot) {
      const shadow = mosaicBook.shadowRoot;
      const favreIframe = shadow.querySelector('iframe.favre') || shadow.querySelector('iframe');
      if (favreIframe) {
        try {
          const innerDoc = favreIframe.contentDocument || favreIframe.contentWindow?.document;
          if (innerDoc && innerDoc.body && innerDoc.body.innerHTML.trim().length > 100) {
            // Re-use extraction logic but targeting innerDoc
            return extractFromDoc(innerDoc, opts);
          }
        } catch (_) { /* cross-origin even within wrapper */ }
      }
    }

    // Strategy 2: any iframe in the wrapper with substantial content
    const allIframes = doc.querySelectorAll('iframe');
    for (const f of allIframes) {
      try {
        const innerDoc = f.contentDocument || f.contentWindow?.document;
        if (innerDoc && innerDoc.body && innerDoc.body.innerHTML.trim().length > 500) {
          return extractFromDoc(innerDoc, opts);
        }
      } catch (_) { /* cross-origin, skip */ }
    }

    // Strategy 3: if the wrapper itself IS the content
    if (doc.body && doc.body.innerHTML.trim().length > 1000) {
      const hasContent = doc.querySelector('section, article, p.para, div.para');
      if (hasContent) {
        return extractFromDoc(doc, opts);
      }
    }

    return { error: 'No extractable content found in wrapper frame.' };

  } catch (err) {
    return { error: `Wrapper extraction error: ${err.message}` };
  }

  // ── helper (scoped inside the injected function) ─────────
  function extractFromDoc(doc, opts) {
    const styles = [];

    // Helper: sanitize CSS to remove Yuzu print-blocking rules
    function sanitizeCss(css) {
      css = css.replace(
        /@media\s+(?:only\s+)?print\s*\{(?:[^{}]*|\{[^{}]*\})*\}/gi,
        '/* [yuzu-extractor] print block removed */'
      );
      css = css.replace(
        /body\s*>\s*\*\s*\{[^}]*display\s*:\s*none\s*!important[^}]*\}/gi,
        '/* [yuzu-extractor] print-block body>* rule removed */'
      );
      css = css.replace(
        /body\s*::?before\s*\{[^}]*content\s*:\s*["'][^"']*print[^"']*page[^"']*range[^"']*["'][^}]*\}/gi,
        '/* [yuzu-extractor] print-warning pseudo-element removed */'
      );
      return css;
    }

    doc.querySelectorAll('style').forEach(s => {
      // Skip <style media="print"> — Yuzu's print-blocking styles
      const media = (s.getAttribute('media') || '').toLowerCase().trim();
      if (media === 'print') return;

      let css = s.textContent || '';

      // MathJax (and similar libraries) inject rules dynamically via
      // sheet.insertRule() — capture from CSSOM when that happens.
      try {
        const sheet = s.sheet;
        if (sheet && sheet.cssRules && sheet.cssRules.length > 0) {
          const textRuleEstimate = (css.match(/\}/g) || []).length;
          if (sheet.cssRules.length > textRuleEstimate + 5) {
            let cssom = '';
            for (const rule of sheet.cssRules) {
              cssom += rule.cssText + '\n';
            }
            css = cssom;
          }
        }
      } catch (_) { /* CSSOM not accessible — use textContent */ }

      if (opts.fixPrint) {
        css = sanitizeCss(css);
      }
      styles.push({ type: 'inline', css, base: doc.baseURI || '' });
    });

    doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.href;
      if (!href) return;

      const media = (link.getAttribute('media') || '').toLowerCase().trim();
      if (media === 'print') return;

      try {
        for (const sheet of doc.styleSheets) {
          if (sheet.href === href || sheet.ownerNode === link) {
            if (sheet.media && sheet.media.mediaText &&
                sheet.media.mediaText.toLowerCase().trim() === 'print') {
              return;
            }
            let css = '';
            for (const rule of sheet.cssRules) { css += rule.cssText + '\n'; }
            if (opts.fixPrint) {
              css = sanitizeCss(css);
            }
            styles.push({ type: 'inlined-link', href, css, base: href });
            return;
          }
        }
      } catch (_) {}
      styles.push({ type: 'link', href });
    });

    const bodyClone = doc.body.cloneNode(true);

    if (opts.stripUI) {
      const uiSelectors = [
        'nav', 'header:not(section header)', 'footer',
        '[class*="toolbar"]', '[class*="sidebar"]', '[class*="modal"]',
        '[class*="overlay"]', '[class*="floating"]',
        '[role="navigation"]', '[role="banner"]',
        '[role="complementary"]', '[role="dialog"]',
        'pwa-extension-ng-components', '.widget',
        '#staticloader', '#vstui__portal_root',
        '[class*="annotation"]', '[class*="highlight-"]',
      ];
      uiSelectors.forEach(sel => {
        try { bodyClone.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
      });
      bodyClone.querySelectorAll('script').forEach(s => s.remove());
    }

    // Remove Yuzu print warning banner/message if present
    stripPrintWarning(bodyClone);

    bodyClone.querySelectorAll('img').forEach(img => {
      if (img.src) img.setAttribute('src', img.src);
      const dataSrc = img.getAttribute('data-src');
      if (dataSrc && !img.src) {
        try { img.src = new URL(dataSrc, doc.baseURI).href; } catch (_) {}
      }
    });

    bodyClone.querySelectorAll('[style*="background"]').forEach(el => {
      const style = el.getAttribute('style');
      if (style && style.includes('url(')) {
        el.setAttribute('style', style.replace(
          /url\(['"]?(?!data:)(.*?)['"]?\)/g,
          (match, url) => {
            try { return `url('${new URL(url, doc.baseURI).href}')`; }
            catch (_) { return match; }
          }
        ));
      }
    });

    return {
      bodyHTML: bodyClone.innerHTML,
      styles,
      title: doc.title || 'Yuzu Section',
      baseURI: doc.baseURI || '',
      scrolled: false,
    };
  }

  function stripPrintWarning(root) {
    const printWarning = 'To print, please use the print page range feature within the application.';
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const toRemove = new Set();
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if ((node.nodeValue || '').includes(printWarning)) {
          let el = node.parentElement;
          while (el && el !== root) {
            if ((el.textContent || '').includes(printWarning)) {
              toRemove.add(el);
            }
            el = el.parentElement;
          }
        }
      }
      toRemove.forEach(el => el.remove());
    } catch (_) { /* ignore */ }
  }
}


/* ═══════════════════════════════════════════════════════════════
 *  MARKDOWN EXTRACTOR  (injected into EPUB frame)
 * ═══════════════════════════════════════════════════════════════
 *
 * Converts the EPUB content to clean Markdown suitable for LLMs.
 * MathJax's assistive MathML (<mjx-assistive-mml> → <math>) is
 * converted to LaTeX inline ($…$) or display ($$…$$) notation.
 * ═══════════════════════════════════════════════════════════════ */

async function extractMarkdownFromFrame(opts) {
  try {
    const doc = document;
    if (!doc.body || doc.body.innerHTML.trim().length < 100) {
      return { error: 'Frame has no meaningful content.' };
    }

    // Clone body and strip UI (same as HTML extraction)
    const bodyClone = doc.body.cloneNode(true);
    if (opts.stripUI) {
      const uiSelectors = [
        'nav', 'header:not(section header)', 'footer',
        '[class*="toolbar"]', '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="toast"]', '[class*="Toast"]',
        '[class*="modal"]', '[class*="Modal"]',
        '[class*="overlay"]', '[class*="Overlay"]',
        '[class*="floating"]', '[class*="Floating"]',
        '[role="navigation"]', '[role="banner"]',
        '[role="complementary"]', '[role="dialog"]',
        '[role="alertdialog"]',
        'pwa-extension-ng-components',
        '.widget', '#staticloader', '#vstui__portal_root',
        '[data-testid*="toolbar"]', '[data-testid*="sidebar"]',
        '[class*="annotation"]', '[class*="highlight-"]',
      ];
      uiSelectors.forEach(sel => {
        try { bodyClone.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
      });
      bodyClone.querySelectorAll('script, style').forEach(s => s.remove());
    }

    // ── MathML → LaTeX converter ───────────────────────────
    function mathmlToLatex(mathEl) {
      function walk(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          return (node.textContent || '').trim();
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase().replace(/^math:/, '');
        const children = () => Array.from(node.childNodes).map(walk).join('');

        switch (tag) {
          case 'math':
            return children();
          case 'mrow':
          case 'mstyle':
          case 'mpadded':
          case 'mphantom':
          case 'menclose':
          case 'merror':
            return children();
          case 'mi': {
            const t = (node.textContent || '').trim();
            if (t.length === 1 && /[a-zA-Z]/.test(t)) return t;
            // Greek / multi-letter → command
            const greekMap = {
              'α':'\\alpha','β':'\\beta','γ':'\\gamma','δ':'\\delta',
              'ε':'\\epsilon','ζ':'\\zeta','η':'\\eta','θ':'\\theta',
              'ι':'\\iota','κ':'\\kappa','λ':'\\lambda','μ':'\\mu',
              'ν':'\\nu','ξ':'\\xi','π':'\\pi','ρ':'\\rho',
              'σ':'\\sigma','τ':'\\tau','υ':'\\upsilon','φ':'\\phi',
              'χ':'\\chi','ψ':'\\psi','ω':'\\omega',
              'Γ':'\\Gamma','Δ':'\\Delta','Θ':'\\Theta','Λ':'\\Lambda',
              'Ξ':'\\Xi','Π':'\\Pi','Σ':'\\Sigma','Υ':'\\Upsilon',
              'Φ':'\\Phi','Ψ':'\\Psi','Ω':'\\Omega',
              '∞':'\\infty','∂':'\\partial',
            };
            if (greekMap[t]) return greekMap[t];
            if (t.length > 1) return '\\text{' + t + '}';
            return t;
          }
          case 'mn':
            return (node.textContent || '').trim();
          case 'mo': {
            const t = (node.textContent || '').trim();
            const opMap = {
              '·':'\\cdot','×':'\\times','÷':'\\div','±':'\\pm',
              '∓':'\\mp','≤':'\\leq','≥':'\\geq','≠':'\\neq',
              '≈':'\\approx','∼':'\\sim','≡':'\\equiv','∝':'\\propto',
              '→':'\\to','←':'\\leftarrow','⇒':'\\Rightarrow',
              '⇐':'\\Leftarrow','↔':'\\leftrightarrow',
              '∈':'\\in','∉':'\\notin','⊂':'\\subset','⊃':'\\supset',
              '⊆':'\\subseteq','⊇':'\\supseteq','∪':'\\cup','∩':'\\cap',
              '∧':'\\wedge','∨':'\\vee','¬':'\\neg',
              '∀':'\\forall','∃':'\\exists','∅':'\\emptyset',
              '∑':'\\sum','∏':'\\prod','∫':'\\int',
              '…':'\\ldots','⋯':'\\cdots','⋮':'\\vdots','⋱':'\\ddots',
              '|':'|', '‖':'\\|',
              '{':'\\{', '}':'\\}',
              '⟨':'\\langle','⟩':'\\rangle',
            };
            if (opMap[t]) return opMap[t];
            return t;
          }
          case 'msup': {
            const parts = Array.from(node.children).map(walk);
            const base = parts[0] || '';
            const sup  = parts[1] || '';
            return base + '^{' + sup + '}';
          }
          case 'msub': {
            const parts = Array.from(node.children).map(walk);
            const base = parts[0] || '';
            const sub  = parts[1] || '';
            return base + '_{' + sub + '}';
          }
          case 'msubsup': {
            const parts = Array.from(node.children).map(walk);
            return (parts[0]||'') + '_{' + (parts[1]||'') + '}^{' + (parts[2]||'') + '}';
          }
          case 'mfrac': {
            const parts = Array.from(node.children).map(walk);
            return '\\frac{' + (parts[0]||'') + '}{' + (parts[1]||'') + '}';
          }
          case 'msqrt':
            return '\\sqrt{' + children() + '}';
          case 'mroot': {
            const parts = Array.from(node.children).map(walk);
            return '\\sqrt[' + (parts[1]||'') + ']{' + (parts[0]||'') + '}';
          }
          case 'mover': {
            const parts = Array.from(node.children).map(walk);
            const over = (parts[1]||'').trim();
            if (over === '¯' || over === '‾') return '\\overline{' + (parts[0]||'') + '}';
            if (over === '^' || over === '̂')  return '\\hat{' + (parts[0]||'') + '}';
            if (over === '~' || over === '̃')  return '\\tilde{' + (parts[0]||'') + '}';
            if (over === '˙')  return '\\dot{' + (parts[0]||'') + '}';
            if (over === '→')  return '\\vec{' + (parts[0]||'') + '}';
            return '\\overset{' + over + '}{' + (parts[0]||'') + '}';
          }
          case 'munder': {
            const parts = Array.from(node.children).map(walk);
            return '\\underset{' + (parts[1]||'') + '}{' + (parts[0]||'') + '}';
          }
          case 'munderover': {
            const parts = Array.from(node.children).map(walk);
            return (parts[0]||'') + '_{' + (parts[1]||'') + '}^{' + (parts[2]||'') + '}';
          }
          case 'mtable':
            return '\\begin{matrix}' + Array.from(node.children).map(walk).join(' \\\\\n') + '\\end{matrix}';
          case 'mtr':
          case 'mlabeledtr':
            return Array.from(node.children).map(walk).join(' & ');
          case 'mtd':
            return children();
          case 'mspace':
            return '\\;';
          case 'mtext': {
            const t = (node.textContent || '').trim();
            if (!t) return '';
            return '\\text{' + t + '}';
          }
          case 'ms':
            return '\\text{"' + (node.textContent||'').trim() + '"}';
          case 'mfenced': {
            const open  = node.getAttribute('open')  || '(';
            const close = node.getAttribute('close') || ')';
            const sep   = node.getAttribute('separators') || ',';
            const inner = Array.from(node.children).map(walk).join(' ' + sep.trim() + ' ');
            const lo = open === '{' ? '\\{' : open;
            const lc = close === '}' ? '\\}' : close;
            return '\\left' + lo + ' ' + inner + ' \\right' + lc;
          }
          default:
            return children();
        }
      }
      try {
        return walk(mathEl);
      } catch (_) {
        return (mathEl.textContent || '').trim();
      }
    }

    // ── DOM → Markdown walker ──────────────────────────────
    function nodeToMd(node, ctx) {
      if (!node) return '';
      ctx = ctx || { inList: false, listDepth: 0 };

      if (node.nodeType === Node.TEXT_NODE) {
        let t = node.textContent || '';
        // Collapse whitespace (but keep single newlines as spaces)
        t = t.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
        return t;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();

      // Skip hidden elements
      const style = node.style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        // But still check for MathJax assistive MML
        if (!node.querySelector('mjx-assistive-mml, math')) return '';
      }

      // ── MathJax containers → LaTeX ───
      if (tag === 'mjx-container') {
        const assistive = node.querySelector('mjx-assistive-mml math') ||
                          node.querySelector('math');
        if (assistive) {
          const latex = mathmlToLatex(assistive);
          if (latex) {
            const isDisplay = node.hasAttribute('display') ||
                              node.getAttribute('jax') === 'CHTML' && node.closest('figure');
            return isDisplay ? '\n\n$$\n' + latex + '\n$$\n\n' : ' $' + latex + '$ ';
          }
        }
        // Fallback: extract visible text from the CHTML rendering
        const visText = node.querySelector('mjx-math')?.textContent?.trim();
        return visText ? ' $' + visText + '$ ' : '';
      }

      // Skip assistive MML when encountered outside mjx-container
      if (tag === 'mjx-assistive-mml') return '';

      const childMd = () => {
        let out = '';
        for (const child of node.childNodes) {
          out += nodeToMd(child, ctx);
        }
        return out;
      };

      switch (tag) {
        // ── Headings ───
        case 'h1': return '\n\n# ' + childMd().trim() + '\n\n';
        case 'h2': return '\n\n## ' + childMd().trim() + '\n\n';
        case 'h3': return '\n\n### ' + childMd().trim() + '\n\n';
        case 'h4': return '\n\n#### ' + childMd().trim() + '\n\n';
        case 'h5': return '\n\n##### ' + childMd().trim() + '\n\n';
        case 'h6': return '\n\n###### ' + childMd().trim() + '\n\n';

        // ── Paragraphs & blocks ───
        case 'p':
        case 'div': {
          // Check if this is really just a wrapper
          const cls = node.className || '';
          if (cls.includes('para') || tag === 'p') {
            return '\n\n' + childMd().trim() + '\n\n';
          }
          return childMd();
        }

        case 'br': return '\n';
        case 'hr': return '\n\n---\n\n';

        // ── Inline formatting ───
        case 'strong':
        case 'b': {
          const inner = childMd().trim();
          return inner ? '**' + inner + '**' : '';
        }
        case 'em':
        case 'i': {
          const inner = childMd().trim();
          return inner ? '*' + inner + '*' : '';
        }
        case 'sup': return '^(' + childMd().trim() + ')';
        case 'sub': return '_(' + childMd().trim() + ')';
        case 'code': return '`' + childMd().trim() + '`';

        // ── Links ───
        case 'a': {
          const href = node.getAttribute('href') || '';
          const text = childMd().trim();
          if (!href || href.startsWith('#')) return text;
          return '[' + text + '](' + href + ')';
        }

        // ── Images ───
        case 'img': {
          const alt = node.getAttribute('alt') || 'image';
          const src = node.src || node.getAttribute('data-src') || '';
          if (!src) return '[Image: ' + alt + ']';
          return '\n\n![' + alt + '](' + src + ')\n\n';
        }

        // ── Lists ───
        case 'ul':
        case 'ol': {
          let out = '\n';
          let idx = 1;
          for (const child of node.children) {
            if (child.tagName.toLowerCase() === 'li') {
              const prefix = tag === 'ol' ? (idx++ + '. ') : '- ';
              const indent = '  '.repeat(ctx.listDepth);
              const liContent = nodeToMd(child, { ...ctx, inList: true, listDepth: ctx.listDepth + 1 }).trim();
              out += indent + prefix + liContent + '\n';
            }
          }
          return out + '\n';
        }
        case 'li':
          return childMd();

        // ── Tables ───
        case 'table': {
          let md = '\n\n';
          const rows = [];
          const allTrs = node.querySelectorAll('tr');
          allTrs.forEach(tr => {
            const cells = [];
            tr.querySelectorAll('td, th').forEach(cell => {
              cells.push(nodeToMd(cell, ctx).trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
            });
            rows.push(cells);
          });
          if (rows.length === 0) return childMd();

          // Determine column count
          const colCount = Math.max(...rows.map(r => r.length));

          // First row as header
          const header = rows[0] || [];
          while (header.length < colCount) header.push('');
          md += '| ' + header.join(' | ') + ' |\n';
          md += '| ' + header.map(() => '---').join(' | ') + ' |\n';

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            while (row.length < colCount) row.push('');
            md += '| ' + row.join(' | ') + ' |\n';
          }
          return md + '\n';
        }

        // ── Figures ───
        case 'figure': {
          let out = '\n\n';
          for (const child of node.childNodes) {
            const childTag = child.tagName?.toLowerCase();
            if (childTag === 'figcaption') {
              out += '*' + nodeToMd(child, ctx).trim() + '*\n\n';
            } else {
              out += nodeToMd(child, ctx);
            }
          }
          return out;
        }
        case 'figcaption':
          return childMd();

        // ── Block-level ───
        case 'blockquote': {
          const inner = childMd().trim().split('\n').map(l => '> ' + l).join('\n');
          return '\n\n' + inner + '\n\n';
        }
        case 'pre': {
          const code = node.querySelector('code');
          const lang = code?.className?.replace('language-', '') || '';
          const text = (code || node).textContent || '';
          return '\n\n```' + lang + '\n' + text.trim() + '\n```\n\n';
        }

        // ── Section / article wrappers ───
        case 'section':
        case 'article':
        case 'aside':
        case 'main':
        case 'span':
        case 'header':
          return childMd();

        default:
          return childMd();
      }
    }

    // ── Run the conversion ─────────────────────────────────
    let markdown = nodeToMd(bodyClone, { inList: false, listDepth: 0 });

    // Clean up excessive blank lines
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    // ── Embed images as base64 data URIs ───────────────────
    // Collect all unique image URLs from the markdown
    const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const urlSet = new Map(); // url → placeholder token
    let match;
    while ((match = imgRegex.exec(markdown)) !== null) {
      const url = match[2];
      if (!urlSet.has(url)) {
        urlSet.set(url, null); // will be filled with data URI
      }
    }

    if (urlSet.size > 0) {
      // Fetch all images in parallel (same-origin: cookies included)
      const fetchPromises = [];
      for (const url of urlSet.keys()) {
        fetchPromises.push(
          fetch(url)
            .then(resp => {
              if (!resp.ok) throw new Error(resp.status);
              return resp.blob();
            })
            .then(blob => new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve({ url, dataUri: reader.result });
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }))
            .catch(() => ({ url, dataUri: null }))
        );
      }

      const results = await Promise.all(fetchPromises);
      for (const { url, dataUri } of results) {
        if (dataUri) {
          urlSet.set(url, dataUri);
        }
      }

      // Replace URLs with data URIs in the markdown
      markdown = markdown.replace(imgRegex, (full, alt, url) => {
        const dataUri = urlSet.get(url);
        if (dataUri) {
          return '![' + alt + '](' + dataUri + ')';
        }
        return full; // keep original URL if fetch failed
      });
    }

    // Build image list for reference
    const images = [];
    bodyClone.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      const alt = img.getAttribute('alt') || '';
      if (src) images.push({ src, alt });
    });

    return {
      markdown,
      title: doc.title || 'Yuzu Section',
      images,
    };
  } catch (err) {
    return { error: `Markdown extraction error: ${err.message}` };
  }
}


/**
 * Injected into the EPUB frame to trigger auto-scrolling.
 * This forces lazy-rendered content (MathJax, etc.) to load.
 *
 * MathJax 3 uses IntersectionObserver-based lazy rendering:
 * <mjx-lazy> placeholder elements are replaced with real CHTML
 * output when they scroll into view.  We must scroll slowly enough
 * for the observer to fire and then wait for MathJax to finish.
 */
async function performAutoScroll(delay) {
  const doc = document;
  const scrollable = doc.scrollingElement || doc.documentElement || doc.body;
  const totalHeight = Math.max(
    scrollable.scrollHeight,
    doc.body?.scrollHeight || 0,
    doc.documentElement?.scrollHeight || 0
  );
  // Use smaller step size to ensure every element enters the viewport
  const stepSize = 200;
  const steps = Math.ceil(totalHeight / stepSize);

  for (let i = 0; i <= steps; i++) {
    scrollable.scrollTop = i * stepSize;
    await new Promise(r => setTimeout(r, delay));
  }

  // Scroll to the very bottom to catch trailing elements
  scrollable.scrollTop = totalHeight;
  await new Promise(r => setTimeout(r, delay * 2));

  // ── Wait for MathJax lazy elements to render ──────────
  // MathJax lazy typesetting is asynchronous; poll until all
  // <mjx-lazy> placeholders have been replaced (or timeout).
  const mjxLazyTimeout = 10000; // 10 s max
  const mjxLazyStart = Date.now();
  while (Date.now() - mjxLazyStart < mjxLazyTimeout) {
    const lazyCount = doc.querySelectorAll('mjx-lazy').length;
    if (lazyCount === 0) break;
    // Nudge MathJax if available
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      try { await window.MathJax.typesetPromise(); } catch (_) {}
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Scroll back to top
  scrollable.scrollTop = 0;
  await new Promise(r => setTimeout(r, 200));

  // Wait for MathJax if present (final pass)
  if (window.MathJax) {
    try {
      if (typeof window.MathJax.typesetPromise === 'function') {
        await window.MathJax.typesetPromise();
      } else if (window.MathJax.Hub && typeof window.MathJax.Hub.Queue === 'function') {
        await new Promise(resolve => {
          window.MathJax.Hub.Queue(() => resolve());
          setTimeout(resolve, 5000);
        });
      }
    } catch (_) {}
  }

  // Wait for images
  const images = Array.from(doc.querySelectorAll('img'));
  await Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 5000);
    });
  }));

  // General settle time
  await new Promise(r => setTimeout(r, 500));
}
