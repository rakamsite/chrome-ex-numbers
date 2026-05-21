/* Automatically scans visible page content and notifies the background service worker. */
(function contentScanner() {
  'use strict';

  const Utils = window.ScannerUtils;
  let scanTimer = null;
  let lastSignature = '';

  function isVisibleElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'svg', 'canvas'].includes(tag)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function collectText() {
    const chunks = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !isVisibleElement(parent)) return NodeFilter.FILTER_REJECT;
        const text = Utils.cleanText(node.nodeValue);
        return text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    while (walker.nextNode()) chunks.push(walker.currentNode.nodeValue);

    document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach(anchor => {
      chunks.push(anchor.getAttribute('href') || '');
    });

    return chunks.join('\n');
  }

  function collectCmsSignals() {
    const generator = document.querySelector('meta[name="generator" i]')?.getAttribute('content') || '';
    const hints = [];
    document.querySelectorAll('link[href], img[src], a[href], form[action], iframe[src]').forEach(element => {
      ['href', 'src', 'action'].forEach(attribute => {
        const value = element.getAttribute(attribute) || '';
        if (value.includes('wp-content')) hints.push(value);
      });
    });
    return { generator, htmlHints: hints.join(' ') };
  }

  async function isScanningEnabled() {
    const state = await chrome.storage.local.get({ scanningEnabled: true });
    return state.scanningEnabled !== false;
  }

  function isTorobProductPage() {
    const hostname = location.hostname.replace(/^www\./i, '').toLowerCase();
    return (hostname === 'torob.com' || hostname.endsWith('.torob.com')) && /^\/p(?:\/|$)/i.test(location.pathname);
  }

  function isTorobShopPage() {
    return Utils.isTorobShopUrl(location.href);
  }

  function isTorobApiPage() {
    const hostname = location.hostname.replace(/^www\./i, '').toLowerCase();
    return hostname === 'api.torob.com' && /^\/v4(?:\/|$)/i.test(location.pathname);
  }

  function isTorobPage() {
    const hostname = location.hostname.replace(/^www\./i, '').toLowerCase();
    return hostname === 'torob.com' || hostname.endsWith('.torob.com');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildNameAliases(names) {
    const ignoredParts = new Set([
      'فروشگاه',
      'سایت',
      'آنلاین',
      'اینترنتی',
      'مرکز',
      'بازرگانی',
      'شرکت',
      'گروه',
      'ابزار'
    ]);
    const aliases = new Set();

    names.forEach(name => {
      const cleanName = Utils.cleanText(name);
      if (!cleanName || /^untitled site$/i.test(cleanName)) return;
      aliases.add(cleanName);
      cleanName
        .split(/[\s\-–—_|،,.()[\]{}\\/]+/)
        .map(Utils.cleanText)
        .filter(part => part.length >= 3 && !ignoredParts.has(part))
        .forEach(part => aliases.add(part));
    });

    return Array.from(aliases).sort((a, b) => b.length - a.length);
  }

  function ensureTorobHighlightStyle() {
    if (document.getElementById('scanner-torob-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'scanner-torob-highlight-style';
    style.textContent = '.scanner-torob-match{background:#ff1f1f!important;color:#fff!important;border-radius:6px!important;padding:1px 5px!important;box-shadow:0 0 0 2px rgba(255,31,31,.22)!important;font-weight:900!important;}';
    document.documentElement.appendChild(style);
  }

  async function getVisitedSiteNames() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_VISITED_SITE_NAMES' }).catch(() => null);
    if (!response?.ok || !Array.isArray(response.names)) return [];
    return buildNameAliases(response.names)
      .slice(0, 500);
  }

  function highlightTorobText(names) {
    if (!document.body || !names.length) return;
    ensureTorobHighlightStyle();
    const matcher = new RegExp(names.map(escapeRegExp).join('|'), 'gi');
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !isVisibleElement(parent)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.scanner-torob-match, script, style, textarea, input')) return NodeFilter.FILTER_REJECT;
        matcher.lastIndex = 0;
        return matcher.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      matcher.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      while ((match = matcher.exec(node.nodeValue)) !== null) {
        fragment.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex, match.index)));
        const mark = document.createElement('span');
        mark.className = 'scanner-torob-match';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        lastIndex = matcher.lastIndex;
      }
      fragment.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex)));
      node.parentNode.replaceChild(fragment, node);
    });
  }

  function startTorobHighlighter() {
    let highlightTimer = null;
    let namesPromise = null;
    const scheduleHighlight = () => {
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(async () => {
        namesPromise = namesPromise || getVisitedSiteNames();
        highlightTorobText(await namesPromise);
      }, 350);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleHighlight, { once: true });
    } else {
      scheduleHighlight();
    }

    const torobObserver = new MutationObserver(scheduleHighlight);
    if (document.body) torobObserver.observe(document.body, { childList: true, subtree: true });
  }

  function readTorobShopName() {
    return Utils.cleanText(document.getElementById('shopName')?.textContent || '');
  }

  function readTorobPageTitle() {
    const headings = Array.from(document.querySelectorAll('h1, h2, [id*="shop" i], [class*="shop" i]'))
      .map(element => Utils.cleanText(element.textContent))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    return headings[0] || Utils.extractBrandName(document.title, location.href);
  }

  function startTorobApiShopCapture() {
    let lastShopName = '';
    const sendShopName = () => {
      const shopName = readTorobShopName();
      if (!shopName || shopName === lastShopName) return;
      lastShopName = shopName;
      chrome.runtime.sendMessage({
        type: 'TOROB_SHOP_NAME_FOUND',
        shopName,
        pageUrl: location.href
      }).catch(() => {});
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sendShopName, { once: true });
    } else {
      sendShopName();
    }

    const shopObserver = new MutationObserver(sendShopName);
    shopObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(sendShopName, 750);
    setTimeout(sendShopName, 2000);
  }

  function buildPayload() {
    const visibleText = collectText();
    const cmsSignals = collectCmsSignals();
    return {
      site_name: Utils.extractBrandName(document.title, location.href),
      site_url: Utils.getDomain(location.href),
      mobiles: Utils.extractIranMobiles(visibleText),
      emails: Utils.extractEmails(visibleText),
      cms: Utils.detectCmsFromSignals(cmsSignals),
      scanned_at: new Date().toISOString()
    };
  }

  function buildTorobShopPayload() {
    const visibleText = collectText();
    const outgoingLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(href => /^https?:\/\//i.test(href) && !/\btorob\.com\b/i.test(href));
    return {
      site_name: readTorobPageTitle(),
      site_url: Utils.normalizeRecordUrl(location.href),
      mobiles: Utils.extractIranMobiles(visibleText),
      emails: Utils.extractEmails(visibleText),
      outgoingLinks: Utils.unique(outgoingLinks),
      cms: 'Other',
      scanned_at: new Date().toISOString()
    };
  }

  function startTorobShopScanner() {
    let lastTorobSignature = '';
    let torobResultSent = false;
    const sendTorobShopResult = () => {
      const payload = buildTorobShopPayload();
      const signature = JSON.stringify({ url: payload.site_url, mobiles: payload.mobiles, emails: payload.emails });
      if (signature === lastTorobSignature && torobResultSent) return;
      lastTorobSignature = signature;
      torobResultSent = true;
      chrome.runtime.sendMessage({ type: 'TOROB_SHOP_SCAN_RESULT', payload }).catch(() => {});
    };

    const scheduleTorobScan = delay => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(sendTorobShopResult, delay || 350);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scheduleTorobScan(250), { once: true });
    } else {
      scheduleTorobScan(250);
    }

    const torobShopObserver = new MutationObserver(() => scheduleTorobScan(700));
    if (document.body) torobShopObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    else document.addEventListener('DOMContentLoaded', () => torobShopObserver.observe(document.body, { childList: true, subtree: true, characterData: true }), { once: true });
    setTimeout(sendTorobShopResult, 1200);
    setTimeout(sendTorobShopResult, 2500);
  }

  if (isTorobShopPage()) {
    startTorobShopScanner();
    return;
  }

  if (isTorobProductPage()) {
    startTorobHighlighter();
    return;
  }

  if (isTorobApiPage()) {
    startTorobApiShopCapture();
    return;
  }

  if (isTorobPage()) return;

  async function sendScanResult(reason) {
    if (!(await isScanningEnabled())) return;
    const payload = buildPayload();
    const signature = JSON.stringify({ url: payload.site_url, mobiles: payload.mobiles, emails: payload.emails, cms: payload.cms });
    if (signature === lastSignature && reason !== 'manual') return;
    lastSignature = signature;

    chrome.runtime.sendMessage({ type: 'SCAN_RESULT', payload }).catch(() => {
      // The extension context can disappear during reloads; the next scan will recover.
    });
  }

  function scheduleScan(reason, delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => sendScanResult(reason), delay || 350);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'RUN_SCAN') {
      isScanningEnabled().then(enabled => {
        if (!enabled) {
          sendResponse({ ok: false, disabled: true });
          return;
        }
        const payload = buildPayload();
        lastSignature = JSON.stringify({ url: payload.site_url, mobiles: payload.mobiles, emails: payload.emails, cms: payload.cms });
        sendResponse({ ok: true, payload });
        chrome.runtime.sendMessage({ type: 'SCAN_RESULT', payload }).catch(() => {});
      });
    }
    return true;
  });

  const observer = new MutationObserver(mutations => {
    const significant = mutations.some(mutation => {
      return mutation.type === 'childList' && (mutation.addedNodes.length > 2 || mutation.removedNodes.length > 2);
    });
    if (significant) scheduleScan('mutation', 900);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleScan('load', 250), { once: true });
  } else {
    scheduleScan('load', 250);
  }
})();
