const els = {
  links: document.getElementById('torobLinks'),
  message: document.getElementById('message')
};

function normalizeTorobUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(url);
    if (!/torob\.com$/i.test(parsed.hostname)) return '';
    if (!/^\/shop\/\d+(?:\/|$)/i.test(parsed.pathname)) return '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

document.getElementById('startBtn').addEventListener('click', async () => {
  const links = els.links.value.split(/\n+/).map(normalizeTorobUrl).filter(Boolean);
  if (!links.length) {
    els.message.textContent = 'حداقل یک لینک معتبر ترب وارد کنید.';
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: 'START_TOROB_BATCH', links });
  els.message.textContent = response?.ok
    ? `شروع شد. ${response.count} لینک در صف قرار گرفت.`
    : (response?.error || 'خطا در شروع فرایند.');
});

document.getElementById('dashboardBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
