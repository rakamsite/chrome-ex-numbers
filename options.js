const Utils = window.ScannerUtils;
const Storage = window.ScannerStorage;
const body = document.getElementById('recordsBody');
const message = document.getElementById('message');
let records = [];

async function load() {
  records = (await Storage.getState()).records;
  body.innerHTML = '';
  records.forEach((record, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${record.site_name || ''}</td><td>${record.mobile || ''}</td><td><button data-i="${index}">Delete</button></td>`;
    body.appendChild(tr);
  });
}

body.addEventListener('click', async e => {
  const i = e.target.getAttribute('data-i');
  if (i == null) return;
  await Storage.deleteRecordAt(Number(i));
  await load();
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  const csv = Utils.recordsToCsv(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'saved-numbers.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const rows = Utils.csvToRecords(await file.text());
    await Storage.importRecords(rows, false);
    await load();
    message.textContent = 'Imported.';
  } catch (error) {
    message.textContent = error.message;
  }
  event.target.value = '';
});

document.getElementById('deleteAllBtn').addEventListener('click', async () => {
  await Storage.deleteAll();
  await load();
});

load();
