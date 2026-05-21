/* Shared extraction and CSV helpers. Safe for content scripts, extension pages, and MV3 service worker. */
(function attachUtils(globalScope) {
  'use strict';

  const Utils = {};

  Utils.STORAGE_DEFAULTS = Object.freeze({
    records: [],
    scanningEnabled: true,
    visitedDomains: [],
    visitedSites: []
  });

  Utils.cleanText = function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  };

  Utils.normalizeDigits = function normalizeDigits(value) {
    return String(value || '')
      .replace(/[\u06F0-\u06F9]/g, char => String(char.charCodeAt(0) - 0x06F0))
      .replace(/[\u0660-\u0669]/g, char => String(char.charCodeAt(0) - 0x0660));
  };

  Utils.getDomain = function getDomain(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    try {
      return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (error) {
      const withoutProtocol = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '');
      return withoutProtocol.split(/[/?#]/)[0].toLowerCase();
    }
  };

  Utils.normalizeUrl = function normalizeUrl(url) {
    return Utils.getDomain(url);
  };

  Utils.normalizeRecordUrl = function normalizeRecordUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    const normalizedInput = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(normalizedInput);
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}${parsed.hash}`.replace(/\/+$/, '');
    } catch (error) {
      return Utils.getDomain(value);
    }
  };

  Utils.isTorobShopUrl = function isTorobShopUrl(url) {
    const value = String(url || '').trim();
    if (!value) return false;
    try {
      const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      return (hostname === 'torob.com' || hostname.endsWith('.torob.com')) && /^\/shop\/\d+(?:\/|$)/i.test(parsed.pathname);
    } catch (error) {
      return false;
    }
  };

  Utils.normalizeSiteUrl = function normalizeSiteUrl(url) {
    return Utils.isTorobShopUrl(url) ? Utils.normalizeRecordUrl(url) : Utils.getDomain(url);
  };

  Utils.extractBrandName = function extractBrandName(title, url) {
    const cleanTitle = Utils.cleanText(title);
    const separators = /\s*(?:\||-|–|—|:|::|•|»|«|›|>|\/\/|\\)\s*/g;
    const parts = cleanTitle.split(separators).map(Utils.cleanText).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];

    const domain = Utils.getDomain(url);
    if (!domain) return cleanTitle || 'Untitled site';
    const withoutTld = domain.split('.')[0] || domain;
    return withoutTld.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  };

  Utils.urlForDisplay = function urlForDisplay(siteUrl) {
    const value = String(siteUrl || '').trim();
    if (!value) return '#';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  };

  Utils.unique = function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  };

  Utils.extractEmails = function extractEmails(text) {
    const source = String(text || '');
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    return Utils.unique((source.match(emailRegex) || []).map(email => email.toLowerCase()));
  };

  Utils.extractIranMobiles = function extractIranMobiles(text) {
    const source = Utils.normalizeDigits(text);
    const results = new Set();
    const phoneRegex = /(?:tel:\s*)?(?:\+?98|0098|0)?[\s\-.()]*9(?:[\s\-.()]*\d){9}/gi;
    let match;

    while ((match = phoneRegex.exec(source)) !== null) {
      const normalized = Utils.normalizeIranMobile(match[0]);
      if (normalized) results.add(normalized);
    }

    return Array.from(results).sort();
  };

  Utils.normalizeIranMobile = function normalizeIranMobile(rawValue) {
    if (!rawValue) return '';
    let value = Utils.normalizeDigits(rawValue)
      .replace(/^tel:/i, '')
      .replace(/[^\d+]/g, '')
      .trim();

    if (value.startsWith('0098')) value = value.slice(2);
    if (value.startsWith('+98')) value = value.slice(1);
    if (value.startsWith('98') && value.length === 12) value = '0' + value.slice(2);
    if (value.startsWith('9') && value.length === 10) value = '0' + value;

    const digits = value.replace(/\D/g, '');
    return /^09\d{9}$/.test(digits) ? digits : '';
  };

  Utils.detectCmsFromSignals = function detectCmsFromSignals(signals) {
    const meta = String(signals && signals.generator || '').toLowerCase();
    const haystack = String(signals && signals.htmlHints || '').toLowerCase();
    if (meta.includes('wordpress') || haystack.includes('wp-content')) return 'WordPress';
    return 'Other';
  };

  Utils.recordKey = function recordKey(record) {
    return `${Utils.normalizeSiteUrl(record.site_url)}::${record.mobile}`;
  };

  Utils.recordsToCsv = function recordsToCsv(records) {
    const header = ['site_name', 'mobile'];
    const rows = [header].concat((records || []).map(record => {
      return header.map(key => {
        if (key === 'mobile') return Utils.formatMobileForCsv(record[key] || '');
        return record[key] || '';
      });
    }));
    return '\ufeff' + rows.map(row => row.map(Utils.csvEscape).join(',')).join('\r\n');
  };

  Utils.formatMobileForCsv = function formatMobileForCsv(value) {
    const mobile = Utils.normalizeIranMobile(value) || String(value || '');
    // Spreadsheet apps often remove the leading zero from CSV numbers; formula text keeps it intact.
    return mobile ? `="${mobile}"` : '';
  };

  Utils.csvEscape = function csvEscape(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  Utils.csvToRecords = function csvToRecords(csvText) {
    const rows = Utils.parseCsvRows(String(csvText || '').replace(/^\ufeff/, ''));
    if (!rows.length) return [];
    const header = rows.shift().map(name => name.trim());
    const expected = ['site_name', 'mobile'];
    const validHeader = expected.every((name, index) => header[index] === name);
    if (!validHeader) throw new Error('CSV header must be exactly: site_name,mobile');

    return rows
      .filter(row => row.some(cell => String(cell || '').trim()))
      .map(row => {
        const record = {};
        expected.forEach((key, index) => {
          record[key] = Utils.cleanText(row[index] || '');
        });
        record.mobile = Utils.normalizeIranMobile(record.mobile.replace(/^="(.*)"$/, '$1')) || record.mobile;
        return record;
      });
  };

  Utils.parseCsvRows = function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\r') {
        continue;
      } else if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  };

  globalScope.ScannerUtils = Utils;
})(typeof self !== 'undefined' ? self : window);
