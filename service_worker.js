importScripts('utils.js', 'storage.js');

const Utils = self.ScannerUtils;
const Storage = self.ScannerStorage;
const latestByTab = new Map();
const openedDomainByTab = new Map();
const torobShopNameByTab = new Map();
const torobShopPageByTab = new Map();
let visitedDomainPartsCache = null;
let visitedSitesCache = null;

const ICONS = {
  gray: { 16: 'icons/gray-16.png', 32: 'icons/gray-32.png', 48: 'icons/gray-48.png', 128: 'icons/gray-128.png' },
  yellow: { 16: 'icons/yellow-16.png', 32: 'icons/yellow-32.png', 48: 'icons/yellow-48.png', 128: 'icons/yellow-128.png' },
  green: { 16: 'icons/green-16.png', 32: 'icons/green-32.png', 48: 'icons/green-48.png', 128: 'icons/green-128.png' },
  red: { 16: 'icons/red-16.png', 32: 'icons/red-32.png', 48: 'icons/red-48.png', 128: 'icons/red-128.png' },
  blue: { 16: 'icons/blue-16.png', 32: 'icons/blue-32.png', 48: 'icons/blue-48.png', 128: 'icons/blue-128.png' }
};

async function setIcon(tabId, color) {
  try {
    await chrome.action.setIcon({ tabId, path: ICONS[color] || ICONS.gray });
  } catch (error) {
    // Some browser pages do not allow action changes; ignore safely.
  }
}

async function setResultIcon(tabId, mobileCount) {
  if (mobileCount >= 2) return setIcon(tabId, 'blue');
  return setIcon(tabId, mobileCount === 1 ? 'green' : 'red');
}

function canScanUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  const domain = Utils.getDomain(url);
  const blockedDomains = ['torob.com', 'basalam.com'];
  return !blockedDomains.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
}

function getDomainFirstPart(url) {
  return Utils.getDomain(url).split('.')[0] || '';
}

function canTrackVisitedUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  const domain = Utils.getDomain(url);
  return domain && domain !== 'torob.com' && !domain.endsWith('.torob.com') && domain !== 'api.torob.com';
}

async function getPendingTorobShops() {
  const state = await chrome.storage.local.get({ torobPendingShops: {} });
  return state.torobPendingShops && typeof state.torobPendingShops === 'object'
    ? state.torobPendingShops
    : {};
}

async function getPendingTorobShopName(tabId) {
  if (tabId == null) return '';
  const memoryName = Utils.cleanText(torobShopNameByTab.get(tabId));
  if (memoryName) return memoryName;
  const pendingShops = await getPendingTorobShops();
  return Utils.cleanText(pendingShops[String(tabId)]);
}

async function setPendingTorobShopName(tabId, shopName) {
  if (tabId == null) return;
  const name = Utils.cleanText(shopName);
  if (name) torobShopNameByTab.set(tabId, name);
  const pendingShops = await getPendingTorobShops();
  if (name) pendingShops[String(tabId)] = name;
  else delete pendingShops[String(tabId)];
  await chrome.storage.local.set({ torobPendingShops: pendingShops });
}

async function clearPendingTorobShopName(tabId) {
  if (tabId == null) return;
  torobShopNameByTab.delete(tabId);
  const pendingShops = await getPendingTorobShops();
  delete pendingShops[String(tabId)];
  await chrome.storage.local.set({ torobPendingShops: pendingShops });
}

async function getVisitedDomainParts() {
  if (visitedDomainPartsCache) return visitedDomainPartsCache;
  const state = await chrome.storage.local.get({ records: [], visitedDomains: [], visitedSites: [] });
  const parts = new Set(Array.isArray(state.visitedDomains) ? state.visitedDomains : []);
  (Array.isArray(state.visitedSites) ? state.visitedSites : []).forEach(site => {
    if (site && site.domain) parts.add(site.domain);
  });
  (Array.isArray(state.records) ? state.records : []).forEach(record => {
    const domainFirstPart = getDomainFirstPart(record.site_url);
    if (domainFirstPart) parts.add(domainFirstPart);
  });
  visitedDomainPartsCache = parts;
  return parts;
}

function normalizeHiddenSite(site) {
  const domain = Utils.cleanText(site && site.domain);
  const name = Utils.cleanText(site && site.name);
  return domain ? { domain, name } : null;
}

async function getVisitedSites() {
  if (visitedSitesCache) return visitedSitesCache;
  const state = await chrome.storage.local.get({ records: [], visitedDomains: [], visitedSites: [] });
  const sitesByDomain = new Map();

  (Array.isArray(state.visitedDomains) ? state.visitedDomains : []).forEach(domain => {
    if (domain) sitesByDomain.set(domain, { domain, name: '' });
  });
  (Array.isArray(state.visitedSites) ? state.visitedSites : []).forEach(site => {
    const clean = normalizeHiddenSite(site);
    if (!clean) return;
    sitesByDomain.set(clean.domain, Object.assign({}, sitesByDomain.get(clean.domain), clean));
  });
  (Array.isArray(state.records) ? state.records : []).forEach(record => {
    const domain = getDomainFirstPart(record.site_url);
    if (!domain) return;
    const current = sitesByDomain.get(domain) || { domain, name: '' };
    sitesByDomain.set(domain, { domain, name: current.name || Utils.cleanText(record.site_name) });
  });

  visitedSitesCache = Array.from(sitesByDomain.values());
  visitedDomainPartsCache = new Set(visitedSitesCache.map(site => site.domain));
  return visitedSitesCache;
}

async function saveVisitedSites(sites) {
  const cleanSites = sites.map(normalizeHiddenSite).filter(Boolean);
  visitedSitesCache = cleanSites;
  visitedDomainPartsCache = new Set(cleanSites.map(site => site.domain));
  await chrome.storage.local.set({
    visitedSites: cleanSites,
    visitedDomains: Array.from(visitedDomainPartsCache)
  });
}

async function registerVisitedSite(tabId, url, siteName) {
  if (!canTrackVisitedUrl(url)) return false;
  const domainFirstPart = getDomainFirstPart(url);
  if (!domainFirstPart) return false;

  const sites = await getVisitedSites();
  const siteIndex = sites.findIndex(site => site.domain === domainFirstPart);
  const torobShopName = await getPendingTorobShopName(tabId);
  if (siteIndex >= 0 && openedDomainByTab.get(tabId) !== domainFirstPart) {
    return true;
  }

  const name = torobShopName || Utils.cleanText(siteName);
  if (siteIndex >= 0) {
    if (name && sites[siteIndex].name !== name) {
      sites[siteIndex] = { domain: domainFirstPart, name };
      await saveVisitedSites(sites);
    }
  } else {
    sites.push({ domain: domainFirstPart, name });
    await saveVisitedSites(sites);
  }
  openedDomainByTab.set(tabId, domainFirstPart);
  await clearPendingTorobShopName(tabId);
  return false;
}

async function registerTorobShopName(tabId, shopName) {
  const name = Utils.cleanText(shopName);
  if (!name) return false;
  await setPendingTorobShopName(tabId, name);
  return true;
}

async function registerTorobShopPage(tabId, payload) {
  if (tabId == null) return false;
  const cleanPayload = Object.assign({}, payload, {
    site_url: Utils.normalizeRecordUrl(payload && payload.site_url || ''),
    site_name: Utils.cleanText(payload && payload.site_name),
    mobiles: Utils.unique((payload && payload.mobiles) || []).map(Utils.normalizeIranMobile).filter(Boolean),
    emails: Utils.unique((payload && payload.emails) || []).filter(Boolean),
    cms: 'Other'
  });
  if (!cleanPayload.site_url) return false;
  torobShopPageByTab.set(tabId, cleanPayload);
  latestByTab.set(tabId, cleanPayload);
  if (cleanPayload.mobiles.length) {
    await Storage.saveExtractedSite(cleanPayload);
  }
  await setIcon(tabId, cleanPayload.mobiles.length ? 'green' : 'yellow');
  await closeTabAfterSaved(tabId);
  return true;
}

async function getHiddenSiteNameForUrl(url) {
  const domainFirstPart = getDomainFirstPart(url);
  if (!domainFirstPart) return '';
  const sites = await getVisitedSites();
  const site = sites.find(item => item.domain === domainFirstPart);
  return Utils.cleanText(site && site.name);
}

async function isScanningEnabled() {
  const state = await Storage.getState();
  return state.scanningEnabled !== false;
}

async function setAllTabIcons(color) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id == null ? null : setIcon(tab.id, color)));
}

async function triggerTabScan(tabId) {
  if (!(await isScanningEnabled())) return setIcon(tabId, 'gray');
  await setIcon(tabId, 'yellow');
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RUN_SCAN' });
  } catch (error) {
    await setIcon(tabId, 'gray');
  }
}

function formatSavedCountBadge(count) {
  if (!count) return '';
  const thousands = Math.floor(count / 100) / 10;
  return Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1);
}

async function updateSavedCountBadge(records) {
  const state = Array.isArray(records) ? { records } : await Storage.getState();
  await chrome.action.setBadgeBackgroundColor({ color: '#198754' });
  await chrome.action.setBadgeText({ text: formatSavedCountBadge(state.records.length) });
}

async function closeTabAfterSaved(tabId) {
  latestByTab.delete(tabId);
  openedDomainByTab.delete(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // The tab may already be closed by the user or browser; saving has already completed.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await Storage.getState();
  await Storage.setState(state);
  await updateSavedCountBadge(state.records);
});

chrome.runtime.onStartup.addListener(() => {
  updateSavedCountBadge().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.records) {
    visitedSitesCache = null;
    visitedDomainPartsCache = null;
    updateSavedCountBadge(changes.records.newValue).catch(() => {});
  }
  if (areaName === 'local' && changes.visitedDomains) {
    visitedDomainPartsCache = new Set(Array.isArray(changes.visitedDomains.newValue) ? changes.visitedDomains.newValue : []);
  }
  if (areaName === 'local' && changes.visitedSites) {
    visitedSitesCache = Array.isArray(changes.visitedSites.newValue)
      ? changes.visitedSites.newValue.map(normalizeHiddenSite).filter(Boolean)
      : [];
    visitedDomainPartsCache = new Set(visitedSitesCache.map(site => site.domain));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  (async () => {
    const enabled = await isScanningEnabled();
    if (!enabled) return setIcon(tabId, 'gray');
    if (changeInfo.status === 'loading') {
      const url = changeInfo.url || tab.url;
      if (Utils.isTorobShopUrl(url)) {
        return setIcon(tabId, 'yellow');
      }
      if (await registerVisitedSite(tabId, url)) return closeTabAfterSaved(tabId);
      return setIcon(tabId, canScanUrl(url) ? 'yellow' : 'gray');
    }
    if (changeInfo.status === 'complete') {
      if (Utils.isTorobShopUrl(tab.url)) {
        return setIcon(tabId, latestByTab.get(tabId)?.mobiles?.length ? 'green' : 'yellow');
      }
      const siteName = Utils.extractBrandName(tab.title || '', tab.url || '');
      if (await registerVisitedSite(tabId, tab.url, siteName)) return closeTabAfterSaved(tabId);
      if (canScanUrl(tab.url)) return triggerTabScan(tabId);
    }
  })();
});

chrome.tabs.onRemoved.addListener(tabId => {
  latestByTab.delete(tabId);
  openedDomainByTab.delete(tabId);
  torobShopNameByTab.delete(tabId);
  torobShopPageByTab.delete(tabId);
  clearPendingTorobShopName(tabId).catch(() => {});
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (!(await isScanningEnabled()) || !tab) return setIcon(activeInfo.tabId, 'gray');
  if (Utils.isTorobShopUrl(tab.url)) {
    const latest = latestByTab.get(activeInfo.tabId);
    return setIcon(activeInfo.tabId, latest?.mobiles?.length ? 'green' : 'yellow');
  }
  if (!canScanUrl(tab.url)) return setIcon(activeInfo.tabId, 'gray');
  const latest = latestByTab.get(activeInfo.tabId);
  if (!latest) return triggerTabScan(activeInfo.tabId);
  return setResultIcon(activeInfo.tabId, latest.mobiles.length);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) return sendResponse({ ok: false, error: 'Unknown message' });

    if (message.type === 'SCAN_RESULT') {
      const tabId = sender.tab && sender.tab.id;
      const sourceUrl = sender.tab?.url || message.payload?.site_url || '';
      if (Utils.isTorobShopUrl(sourceUrl)) {
        if (tabId != null) await setIcon(tabId, 'yellow');
        return sendResponse({ ok: false, ignored: true, torobShop: true });
      }
      if (!canScanUrl(sourceUrl)) {
        if (tabId != null) await setIcon(tabId, 'gray');
        return sendResponse({ ok: false, ignored: true });
      }
      if (!(await isScanningEnabled())) {
        if (tabId != null) await setIcon(tabId, 'gray');
        return sendResponse({ ok: false, disabled: true });
      }
      const payload = message.payload || {};
      payload.site_url = Utils.normalizeUrl(payload.site_url || sender.tab?.url || '');
      payload.mobiles = Utils.unique(payload.mobiles || []).map(Utils.normalizeIranMobile).filter(Boolean);
      payload.emails = Utils.unique(payload.emails || []);
      payload.cms = payload.cms === 'WordPress' ? 'WordPress' : 'Other';
      if (tabId != null) await registerVisitedSite(tabId, sourceUrl, payload.site_name);
      payload.site_name = await getHiddenSiteNameForUrl(sourceUrl) || payload.site_name;
      if (tabId != null) latestByTab.set(tabId, payload);
      let saved = false;
      if (payload.mobiles.length) {
        await Storage.saveExtractedSite(payload);
        saved = true;
      }
      if (tabId != null) await setResultIcon(tabId, payload.mobiles.length);
      sendResponse({ ok: true, payload, saved });
      if (tabId != null && (saved || payload.mobiles.length === 0)) await closeTabAfterSaved(tabId);
      return;
    }

    if (message.type === 'TOROB_SHOP_NAME_FOUND') {
      const tabId = sender.tab && sender.tab.id;
      await registerTorobShopName(tabId, message.shopName);
      sendResponse({ ok: true, saved: true });
      return;
    }

    if (message.type === 'TOROB_SHOP_SCAN_RESULT') {
      const tabId = sender.tab && sender.tab.id;
      const payload = message.payload || {};
      const saved = await registerTorobShopPage(tabId, payload);
      sendResponse({ ok: true, saved, payload: torobShopPageByTab.get(tabId) || payload });
      return;
    }

    if (message.type === 'GET_VISITED_SITE_NAMES') {
      const sites = await getVisitedSites();
      const names = Utils.unique(sites.map(site => Utils.cleanText(site.name)).filter(Boolean));
      return sendResponse({ ok: true, names });
    }

    if (message.type === 'GET_CURRENT_SITE') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const latest = tab ? latestByTab.get(tab.id) : null;
      const state = await Storage.getState();
      const siteUrl = Utils.normalizeSiteUrl(latest?.site_url || tab?.url || '');
      const siteRecords = state.records.filter(record => Utils.normalizeSiteUrl(record.site_url) === siteUrl);
      return sendResponse({ ok: true, tab, latest, siteRecords, state });
    }

    if (message.type === 'RESCAN_CURRENT_TAB') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!(await isScanningEnabled())) {
        if (tab?.id != null) await setIcon(tab.id, 'gray');
        return sendResponse({ ok: false, disabled: true });
      }
      if (tab && canScanUrl(tab.url)) await triggerTabScan(tab.id);
      return sendResponse({ ok: true });
    }

    if (message.type === 'SET_SCANNING_ENABLED') {
      const scanningEnabled = await Storage.setScanningEnabled(message.enabled !== false);
      if (!scanningEnabled) {
        latestByTab.clear();
        await setAllTabIcons('gray');
      }
      return sendResponse({ ok: true, scanningEnabled });
    }

    if (message.type === 'SAVE_SITE_CATEGORY') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const latest = tab ? latestByTab.get(tab.id) : null;
      const category = Utils.cleanText(message.category || '');
      const siteUrl = Utils.normalizeSiteUrl(latest?.site_url || tab?.url || '');
      const manualMobiles = Array.isArray(message.mobiles)
        ? Utils.unique(message.mobiles.map(Utils.normalizeIranMobile).filter(Boolean))
        : null;
      await chrome.storage.local.set({ lastCategory: category });

      if (manualMobiles) {
        const payload = Object.assign({}, latest || {}, {
          site_name: latest?.site_name || Utils.extractBrandName(tab?.title || '', tab?.url || ''),
          site_url: siteUrl,
          mobiles: manualMobiles,
          emails: latest?.emails || [],
          cms: latest?.cms || 'Other'
        });
        if (siteUrl) await Storage.deleteSite(siteUrl);
        if (manualMobiles.length) await Storage.saveExtractedSite(payload, category);
        if (tab?.id != null) {
          latestByTab.set(tab.id, payload);
          await setResultIcon(tab.id, manualMobiles.length);
        }
      } else {
        if (latest && latest.mobiles.length) await Storage.saveExtractedSite(latest, category);
        if (siteUrl) await Storage.updateSiteCategory(siteUrl, category);
        if (tab?.id != null && latest) await setResultIcon(tab.id, latest.mobiles.length);
      }

      return sendResponse({ ok: true });
    }

    if (message.type === 'DELETE_CURRENT_SITE') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const latest = tab ? latestByTab.get(tab.id) : null;
      const url = Utils.normalizeSiteUrl(latest?.site_url || tab?.url || '');
      await Storage.deleteSite(url);
      if (tab?.id != null) await setResultIcon(tab.id, latest?.mobiles?.length || 0);
      return sendResponse({ ok: true });
    }

    return sendResponse({ ok: false, error: 'Unknown message type' });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

updateSavedCountBadge().catch(() => {});
