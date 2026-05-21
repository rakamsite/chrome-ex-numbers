const Utils = window.ScannerUtils;
const Storage = window.ScannerStorage;
const DASHBOARD_RECORD_LIMIT = 200;
const state = { records: [], hiddenSites: [], query: '', category: '', scanningEnabled: true, showHiddenDb: false };
const els = {
  body: document.getElementById('recordsBody'),
  hiddenDbBody: document.getElementById('hiddenDbBody'),
  hiddenDbCard: document.getElementById('hiddenDbCard'),
  hiddenDbCount: document.getElementById('hiddenDbCount'),
  hiddenDbToggle: document.getElementById('hiddenDbToggle'),
  count: document.getElementById('recordCount'),
  search: document.getElementById('search'),
  categoryFilter: document.getElementById('categoryFilter'),
  scanToggle: document.getElementById('scanToggle'),
  message: document.getElementById('message')
};

function filteredRecords() {
  const query = state.query.toLowerCase();
  return state.records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !state.category || record.category === state.category)
    .filter(({ record }) => !query || Object.values(record).join(' ').toLowerCase().includes(query))
    .reverse()
    .slice(0, DASHBOARD_RECORD_LIMIT);
}

function input(value, name, type = 'text') {
  const element = document.createElement('input');
  element.type = type;
  element.name = name;
  element.value = value || '';
  return element;
}

function cmsSelect(value) {
  const select = document.createElement('select');
  ['WordPress', 'Other'].forEach(cms => {
    const option = document.createElement('option');
    option.value = cms;
    option.textContent = cms;
    option.selected = value === cms;
    select.appendChild(option);
  });
  return select;
}

function renderCategories() {
  const categories = Utils.unique(state.records.map(record => record.category).filter(Boolean)).sort();
  const previous = els.categoryFilter.value;
  els.categoryFilter.innerHTML = '<option value="">All categories</option>';
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    els.categoryFilter.appendChild(option);
  });
  els.categoryFilter.value = categories.includes(previous) ? previous : '';
  state.category = els.categoryFilter.value;
}

function renderScanToggle() {
  els.scanToggle.textContent = state.scanningEnabled ? 'Scanner On' : 'Scanner Off';
  els.scanToggle.setAttribute('aria-pressed', String(state.scanningEnabled));
  els.scanToggle.classList.toggle('off', !state.scanningEnabled);
}

function renderHiddenDb() {
  els.hiddenDbToggle.textContent = state.showHiddenDb ? 'Hide Hidden DB' : 'Show Hidden DB';
  els.hiddenDbCard.hidden = !state.showHiddenDb;
  els.hiddenDbCount.textContent = String(state.hiddenSites.length);
  els.hiddenDbBody.innerHTML = '';

  const sites = state.hiddenSites
    .slice()
    .sort((first, second) => (first.name || first.domain).localeCompare(second.name || second.domain));

  if (!sites.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.textContent = 'Hidden database is empty.';
    tr.appendChild(td);
    els.hiddenDbBody.appendChild(tr);
    return;
  }

  sites.forEach(site => {
    const tr = document.createElement('tr');
    ['domain', 'name'].forEach(field => {
      const td = document.createElement('td');
      td.textContent = site[field] || '';
      tr.appendChild(td);
    });
    els.hiddenDbBody.appendChild(tr);
  });
}

function render() {
  renderScanToggle();
  renderHiddenDb();
  renderCategories();
  els.body.innerHTML = '';
  els.count.textContent = String(state.records.length);
  const rows = filteredRecords();

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.textContent = 'No records found.';
    tr.appendChild(td);
    els.body.appendChild(tr);
    return;
  }

  rows.forEach(({ record, index }) => {
    const tr = document.createElement('tr');
    const fields = ['site_name', 'site_url', 'category', 'mobile', 'email'];
    fields.forEach(field => {
      const td = document.createElement('td');
      td.className = field.replace('site_', '');
      td.appendChild(input(record[field], field));
      tr.appendChild(td);
    });

    const cmsTd = document.createElement('td');
    cmsTd.appendChild(cmsSelect(record.cms));
    tr.appendChild(cmsTd);

    const actions = document.createElement('td');
    actions.className = 'row-actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const updated = {};
      fields.forEach(field => updated[field] = tr.querySelector(`[name="${field}"]`).value);
      updated.cms = cmsTd.querySelector('select').value;
      await Storage.deleteRecordAt(index);
      await Storage.upsertRecord(updated);
      await load();
      els.message.textContent = 'Record saved.';
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await Storage.deleteRecordAt(index);
      await load();
      els.message.textContent = 'Record deleted.';
    });

    actions.append(saveBtn, deleteBtn);
    tr.appendChild(actions);
    els.body.appendChild(tr);
  });
}

async function load() {
  const next = await Storage.getState();
  const hiddenSites = await Storage.getHiddenSites();
  state.records = next.records;
  state.hiddenSites = hiddenSites;
  state.scanningEnabled = next.scanningEnabled !== false;
  render();
}

els.search.addEventListener('input', event => {
  state.query = event.target.value;
  render();
});

els.categoryFilter.addEventListener('change', event => {
  state.category = event.target.value;
  render();
});

els.scanToggle.addEventListener('click', async () => {
  const nextEnabled = !state.scanningEnabled;
  const response = await chrome.runtime.sendMessage({ type: 'SET_SCANNING_ENABLED', enabled: nextEnabled });
  if (!response?.ok) throw new Error(response?.error || 'Could not update scanner status.');
  state.scanningEnabled = response.scanningEnabled !== false;
  renderScanToggle();
  els.message.textContent = state.scanningEnabled
    ? 'Scanner enabled. New pages can be scanned again.'
    : 'Scanner disabled. No websites will be scanned.';
});

els.hiddenDbToggle.addEventListener('click', () => {
  state.showHiddenDb = !state.showHiddenDb;
  renderHiddenDb();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const csv = Utils.recordsToCsv(state.records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `iran-mobile-site-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  els.message.textContent = 'CSV exported with UTF-8 encoding.';
});

document.getElementById('importFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const records = Utils.csvToRecords(text);
    await Storage.importRecords(records, false);
    await load();
    els.message.textContent = `Imported ${records.length} CSV rows.`;
  } catch (error) {
    els.message.textContent = error.message;
  } finally {
    event.target.value = '';
  }
});

document.getElementById('deleteAllBtn').addEventListener('click', async () => {
  if (!confirm('Delete all saved records? This cannot be undone.')) return;
  await Storage.deleteAll();
  await load();
  els.message.textContent = 'All records deleted.';
});

load().catch(error => els.message.textContent = error.message);
