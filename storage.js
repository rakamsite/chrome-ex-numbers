/* chrome.storage.local helpers for records and category state. */
(function attachStorage(globalScope) {
  'use strict';

  const Utils = globalScope.ScannerUtils;
  const Storage = {};

  Storage.sanitizeRecord = function sanitizeRecord(record) {
    return {
      site_name: Utils.cleanText(record && record.site_name),
      site_url: Utils.cleanText(record && record.site_url) || Utils.cleanText(record && record.site_name),
      category: '',
      mobile: Utils.normalizeIranMobile(record && record.mobile) || Utils.cleanText(record && record.mobile),
      email: '',
      cms: 'Other'
    };
  };

  Storage.getState = async function getState() {
    const state = await chrome.storage.local.get(Utils.STORAGE_DEFAULTS);
    const rawRecords = Array.isArray(state.records) ? state.records : [];
    const records = rawRecords.map(Storage.sanitizeRecord).filter(record => record.mobile);
    return {
      records,
      lastCategory: '',
      scanningEnabled: state.scanningEnabled !== false
    };
  };

  Storage.setState = async function setState(nextState) {
    const current = await chrome.storage.local.get(Utils.STORAGE_DEFAULTS);
    await chrome.storage.local.set({
      records: Array.isArray(nextState.records) ? nextState.records : [],
      scanningEnabled: typeof nextState.scanningEnabled === 'boolean'
        ? nextState.scanningEnabled
        : current.scanningEnabled !== false
    });
  };

  Storage.setScanningEnabled = async function setScanningEnabled(enabled) {
    const scanningEnabled = enabled !== false;
    await chrome.storage.local.set({ scanningEnabled });
    return scanningEnabled;
  };

  Storage.saveExtractedSite = async function saveExtractedSite(payload, categoryOverride) {
    const state = await Storage.getState();
    const category = ''; // removed
    const siteUrl = Utils.normalizeSiteUrl(payload.site_url || '');
    const siteName = Utils.cleanText(payload.site_name) || Utils.extractBrandName('', siteUrl);
    const cms = payload.cms === 'WordPress' ? 'WordPress' : 'Other';
    const mobiles = Utils.unique(payload.mobiles || payload.mobile || []).map(Utils.normalizeIranMobile).filter(Boolean);
    const emails = Utils.unique(payload.emails || payload.email || []);
    const emailValue = emails.join('; ');
    const nextRecords = state.records.slice();
    const existingByKey = new Map(nextRecords.map((record, index) => [Utils.recordKey(record), index]));

    mobiles.forEach(mobile => {
      const record = { site_name: siteName, site_url: siteUrl, category, mobile, email: emailValue, cms };
      const key = Utils.recordKey(record);
      if (existingByKey.has(key)) {
        const index = existingByKey.get(key);
        nextRecords[index] = Object.assign({}, nextRecords[index], record);
      } else {
        existingByKey.set(key, nextRecords.length);
        nextRecords.push(record);
      }
    });

    await Storage.setState({ records: nextRecords, lastCategory: category });
    return { records: nextRecords, savedCount: mobiles.length, category };
  };

  Storage.updateSiteCategory = async function updateSiteCategory(siteUrl, category) {
    const state = await Storage.getState();
    const domain = Utils.normalizeSiteUrl(siteUrl);
    const nextRecords = state.records.map(record => {
      return Utils.normalizeSiteUrl(record.site_url) === domain ? Object.assign({}, record, { category }) : record;
    });
    await Storage.setState({ records: nextRecords, lastCategory: category });
    return nextRecords;
  };

  Storage.deleteSite = async function deleteSite(siteUrl) {
    const state = await Storage.getState();
    const domain = Utils.normalizeSiteUrl(siteUrl);
    const records = state.records.filter(record => Utils.normalizeSiteUrl(record.site_url) !== domain);
    await Storage.setState({ records, lastCategory: state.lastCategory });
    return records;
  };

  Storage.upsertRecord = async function upsertRecord(record) {
    const state = await Storage.getState();
    const clean = Storage.sanitizeRecord(record);
    const key = Utils.recordKey(clean);
    const records = state.records.slice();
    const index = records.findIndex(item => Utils.recordKey(item) === key);
    if (index >= 0) records[index] = clean;
    else records.push(clean);
    await Storage.setState({ records, lastCategory: clean.category || state.lastCategory });
    return records;
  };

  Storage.deleteRecordAt = async function deleteRecordAt(index) {
    const state = await Storage.getState();
    const records = state.records.filter((_, itemIndex) => itemIndex !== index);
    await Storage.setState({ records, lastCategory: state.lastCategory });
    return records;
  };

  Storage.deleteAll = async function deleteAll() {
    const state = await Storage.getState();
    await Storage.setState({ records: [], lastCategory: state.lastCategory });
  };

  Storage.getHiddenSites = async function getHiddenSites() {
    const state = await chrome.storage.local.get({ visitedSites: [], visitedDomains: [] });
    const sitesByDomain = new Map();

    (Array.isArray(state.visitedDomains) ? state.visitedDomains : []).forEach(domain => {
      const cleanDomain = Utils.cleanText(domain);
      if (cleanDomain) sitesByDomain.set(cleanDomain, { domain: cleanDomain, name: '' });
    });

    (Array.isArray(state.visitedSites) ? state.visitedSites : []).forEach(site => {
      const domain = Utils.cleanText(site && site.domain);
      if (!domain) return;
      sitesByDomain.set(domain, {
        domain,
        name: Utils.cleanText(site && site.name)
      });
    });

    return Array.from(sitesByDomain.values());
  };

  Storage.importRecords = async function importRecords(importedRecords, replaceExisting) {
    const state = await Storage.getState();
    const source = replaceExisting ? [] : state.records.slice();
    const byKey = new Map(source.map((record, index) => [Utils.recordKey(record), index]));

    importedRecords.forEach(record => {
      const clean = Storage.sanitizeRecord(record);
      if (!clean.mobile) return;
      const key = Utils.recordKey(clean);
      if (byKey.has(key)) source[byKey.get(key)] = clean;
      else {
        byKey.set(key, source.length);
        source.push(clean);
      }
    });

    await Storage.setState({ records: source, lastCategory: state.lastCategory });
    return source;
  };

  globalScope.ScannerStorage = Storage;
})(typeof self !== 'undefined' ? self : window);
