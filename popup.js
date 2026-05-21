const Utils = window.ScannerUtils;
const els = {
  siteName: document.getElementById('siteName'),
  siteUrl: document.getElementById('siteUrl'),
  cms: document.getElementById('cms'),
  category: document.getElementById('category'),
  mobiles: document.getElementById('mobiles'),
  emails: document.getElementById('emails'),
  mobileCount: document.getElementById('mobileCount'),
  emailCount: document.getElementById('emailCount'),
  statusPill: document.getElementById('statusPill'),
  message: document.getElementById('message')
};
let currentPayload = null;

function send(type, data = {}) {
  return chrome.runtime.sendMessage(Object.assign({ type }, data));
}

function fillList(element, items, emptyText) {
  element.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = emptyText;
    element.appendChild(li);
    return;
  }
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    element.appendChild(li);
  });
}

function getEditedMobiles() {
  return Utils.extractIranMobiles(els.mobiles.value);
}

function renderEditableMobiles(mobiles) {
  els.mobiles.value = Utils.unique(mobiles).join('\n');
  els.mobileCount.textContent = String(getEditedMobiles().length);
}

async function loadPopup() {
  const response = await send('GET_CURRENT_SITE');
  if (!response.ok) throw new Error(response.error || 'Unable to load current site');
  const latest = response.latest || {};
  const tab = response.tab || {};
  const scanningEnabled = response.state?.scanningEnabled !== false;
  currentPayload = latest;

  const siteRecords = response.siteRecords || [];
  const category = siteRecords[0]?.category || response.state?.lastCategory || '';
  const mobiles = latest.mobiles || siteRecords.map(record => record.mobile).filter(Boolean);
  const emails = latest.emails || Utils.unique(siteRecords.flatMap(record => (record.email || '').split(';').map(item => item.trim())));

  els.siteName.textContent = latest.site_name || tab.title || 'No scannable site';
  const displayUrl = Utils.normalizeUrl(latest.site_url || tab.url || '');
  els.siteUrl.textContent = displayUrl || '-';
  els.siteUrl.href = Utils.urlForDisplay(displayUrl || tab.url || '#');
  els.cms.textContent = latest.cms || siteRecords[0]?.cms || '-';
  els.category.value = category;
  renderEditableMobiles(mobiles);
  els.emailCount.textContent = String(emails.length);
  els.statusPill.textContent = scanningEnabled ? (mobiles.length ? 'Found' : 'No Mobile') : 'Scanner Off';
  els.statusPill.style.background = scanningEnabled
    ? (mobiles.length ? (mobiles.length >= 2 ? '#38bdf8' : '#1d9a57') : '#d84235')
    : '#6b7280';
  els.statusPill.style.color = 'white';
  fillList(els.emails, emails, 'No email address found.');
}

els.mobiles.addEventListener('input', () => {
  els.mobileCount.textContent = String(getEditedMobiles().length);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const mobiles = getEditedMobiles();
  const response = await send('SAVE_SITE_CATEGORY', { category: els.category.value, mobiles });
  els.message.textContent = response.ok ? `Saved ${mobiles.length} mobile number(s) and updated category.` : response.error;
  await loadPopup();
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  if (!confirm('Delete all records for this site?')) return;
  const response = await send('DELETE_CURRENT_SITE');
  els.message.textContent = response.ok ? 'This site was deleted from saved records.' : response.error;
  await loadPopup();
});

document.getElementById('rescanBtn').addEventListener('click', async () => {
  els.message.textContent = 'Rescanning...';
  const response = await send('RESCAN_CURRENT_TAB');
  if (response?.disabled) els.message.textContent = 'Scanner is off. Turn it on from the dashboard/options page.';
  setTimeout(loadPopup, 900);
});

document.getElementById('dashboardBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

loadPopup().catch(error => {
  els.message.textContent = error.message;
});
