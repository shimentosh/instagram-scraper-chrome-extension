// ── Field definitions per scrape type ────────────────────────────────────────
const SCRAPE_FIELDS = {
  profile:   ['username','full_name','user_id','bio','followers','following','posts','is_verified','is_private','is_business','category','website','profile_url','joined_recently'],
  posts:     ['shortcode','url','type','caption','hashtags','mentions','likes','comments','views','timestamp','image_url','is_sponsored','location','owner'],
  followers: ['username','full_name','user_id','is_verified','is_private','followers','following','profile_url','profile_pic_url'],
  following: ['username','full_name','user_id','is_verified','is_private','followers','following','profile_url','profile_pic_url'],
  hashtag:   ['shortcode','url','type','caption','hashtags','likes','comments','views','timestamp','image_url','location','owner'],
  comments:  ['text','username','full_name','timestamp','likes','replies','comment_id'],
  likers:    ['username','full_name','user_id','is_verified','is_private','followers','following','profile_url'],
};

const TYPE_DESC = {
  profile:   'Fetch bio, follower count, verification status and account details for any public profile.',
  posts:     'Collect recent posts with captions, hashtags, likes, comments, views and media URLs.',
  followers: 'Export the list of accounts that follow a user — username, name, verification and stats.',
  following: 'Export the list of accounts a user follows — username, name, verification and stats.',
  hashtag:   'Browse a hashtag page and pull posts with full engagement data (likes, comments, views).',
  comments:  'Scrape comments on any public post — text, author, timestamp, likes and reply count.',
  likers:    'Get the list of accounts that liked a post (limited to the first ~500 by Instagram).',
};

const DEFAULT_MAX = { profile:1, posts:50, followers:200, following:200, hashtag:50, comments:100, likers:500 };
const NEEDS_MAX   = new Set(['posts','followers','following','hashtag','comments']);
const NEEDS_USER  = new Set(['profile','posts','followers','following']);
const NEEDS_POST  = new Set(['comments','likers']);

// ── Theme ─────────────────────────────────────────────────────────────────────
const SUN_SVG  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const MOON_SVG = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
let isDark = true;

function applyTheme() {
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  const icon = document.getElementById('theme-icon');
  if (icon) icon.innerHTML = isDark ? SUN_SVG : MOON_SVG;
}

async function initTheme() {
  try {
    const { igTheme } = await chrome.storage.local.get('igTheme');
    isDark = igTheme !== 'light';
  } catch(_) { isDark = true; }
  applyTheme();
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  isDark = !isDark;
  applyTheme();
  chrome.storage.local.set({ igTheme: isDark ? 'dark' : 'light' });
});

// ── State ─────────────────────────────────────────────────────────────────────
let currentData    = null;
let currentAction  = null;
let isRunning      = false;
let enabledFields  = new Set();
let logsVisible    = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const pills         = document.querySelectorAll('.pill');
const inputUsername = document.getElementById('input-username');
const inputPosturl  = document.getElementById('input-posturl');
const inputHashtag  = document.getElementById('input-hashtag');
const usernameEl    = document.getElementById('username');
const posturlEl     = document.getElementById('posturl');
const hashtagEl     = document.getElementById('hashtag');
const maxCountEl    = document.getElementById('max-count');
const maxCountGroup = document.getElementById('max-count-group');
const fieldChips    = document.getElementById('field-chips');
const runBtn        = document.getElementById('run');
const stopBtn       = document.getElementById('stop');
const progressSec   = document.getElementById('progress-section');
const progressFill  = document.getElementById('progress-fill');
const statusEl      = document.getElementById('status');
const resultsSec    = document.getElementById('results-section');
const resultsCount  = document.getElementById('results-count');
const previewTable  = document.getElementById('preview-table');
const previewMore   = document.getElementById('preview-more');
const pageDetect    = document.getElementById('page-detect');
const logPanel      = document.getElementById('log-panel');
const logToggleBtn  = document.getElementById('log-toggle-btn');
const logOutput     = document.getElementById('log-output');
const copyLogsBtn   = document.getElementById('copy-logs');
const clearLogsBtn  = document.getElementById('clear-logs');
const logoImg       = document.getElementById('logo-img');
const logoSvg       = document.getElementById('logo-svg');

// ── Logo ──────────────────────────────────────────────────────────────────────
if (logoImg) {
  logoImg.src = chrome.runtime.getURL('icons/logo.png');
  logoImg.onload = () => { logoImg.style.display = 'block'; if (logoSvg) logoSvg.style.display = 'none'; };
}
document.getElementById('close-btn')?.addEventListener('click', () => window.close());

// ── Logs ──────────────────────────────────────────────────────────────────────
const logLines = [];
function ts() { return new Date().toISOString().slice(11,23); }
function appendLog(text, src='panel') {
  const line = `[${ts()}] [${src}] ${String(text).replace(/\r?\n/g,' ')}`;
  logLines.push(line);
  if (logLines.length > 200) logLines.shift();
  if (logOutput) { logOutput.textContent = line; logOutput.title = line; }
}
logToggleBtn?.addEventListener('click', () => {
  logsVisible = !logsVisible;
  logPanel.classList.toggle('hidden', !logsVisible);
  logToggleBtn.textContent = logsVisible ? '▲ Hide Logs' : '▼ Show Logs';
});
copyLogsBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(logLines.join('\n') || 'No logs.').then(() => {
    copyLogsBtn.textContent = '✓';
    setTimeout(() => { copyLogsBtn.textContent = '⎘'; }, 1500);
  });
});
clearLogsBtn?.addEventListener('click', () => { logLines.length = 0; if (logOutput) logOutput.textContent = ''; });

// ── Type pills ────────────────────────────────────────────────────────────────
function getType() { return document.querySelector('.pill.active')?.dataset.type || 'profile'; }

function setType(t) {
  pills.forEach(p => p.classList.toggle('active', p.dataset.type === t));
  updateInputs();
  buildFieldChips(t);
  const desc = document.getElementById('type-desc');
  if (desc) desc.textContent = TYPE_DESC[t] || '';
  if (advToggle?.checked) updateAdvSections(t);
}

function updateInputs() {
  const t = getType();
  inputUsername.classList.toggle('hidden', !NEEDS_USER.has(t));
  inputPosturl.classList.toggle('hidden', !NEEDS_POST.has(t));
  inputHashtag.classList.toggle('hidden', t !== 'hashtag');
  maxCountGroup.classList.toggle('hidden', !NEEDS_MAX.has(t));
  if (DEFAULT_MAX[t] !== undefined) maxCountEl.value = DEFAULT_MAX[t];
}

pills.forEach(p => p.addEventListener('click', () => setType(p.dataset.type)));

// ── Field chips ───────────────────────────────────────────────────────────────
function buildFieldChips(type) {
  const fields = SCRAPE_FIELDS[type] || [];
  enabledFields = new Set(fields);
  document.getElementById('fields-card')?.classList.toggle('hidden', fields.length === 0);
  fieldChips.innerHTML = fields.map(f =>
    `<button class="fchip on" data-field="${f}"><span class="fchip-dot"></span>${f}</button>`
  ).join('');
  fieldChips.querySelectorAll('.fchip').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.field;
      if (enabledFields.has(f)) { enabledFields.delete(f); chip.classList.remove('on'); }
      else { enabledFields.add(f); chip.classList.add('on'); }
    });
  });
}

// ── Advanced options ──────────────────────────────────────────────────────────
const ADV_SECTIONS = {
  profile:   ['verified'],
  posts:     ['type', 'verified'],
  followers: ['verified', 'private'],
  following: ['verified', 'private'],
  hashtag:   ['type'],
  comments:  ['sort', 'replies'],
  likers:    ['verified'],
};

const advToggle = document.getElementById('adv-toggle');
const advBody   = document.getElementById('adv-body');

advToggle?.addEventListener('change', () => {
  advBody.classList.toggle('hidden', !advToggle.checked);
  if (advToggle.checked) updateAdvSections(getType());
});

function updateAdvSections(type) {
  const all = ['type','sort','replies','verified','private'];
  const show = new Set(ADV_SECTIONS[type] || []);
  all.forEach(s => {
    document.getElementById(`adv-section-${s}`)?.classList.toggle('hidden', !show.has(s));
  });
}

// Content type chips — single select
document.querySelectorAll('[data-ctype]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-ctype]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

// Sort chips — single select
document.querySelectorAll('[data-sort]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

function getAdvanced() {
  return {
    enabled:     advToggle?.checked || false,
    contentType: document.querySelector('[data-ctype].on')?.dataset.ctype || 'all',
    sortOrder:   document.querySelector('[data-sort].on')?.dataset.sort || 'popular',
    replies:     document.getElementById('adv-replies')?.checked || false,
    verifiedOnly:document.getElementById('adv-verified')?.checked || false,
    skipPrivate: document.getElementById('adv-skip-private')?.checked || false,
  };
}

function applyAdvancedFilter(rows, action) {
  const adv = getAdvanced();
  if (!adv.enabled) return rows;
  let out = rows;
  if (adv.contentType !== 'all' && (action === 'posts' || action === 'hashtag')) {
    out = out.filter(r => r.type === adv.contentType);
  }
  if (adv.verifiedOnly) {
    out = out.filter(r => r.is_verified === 'Yes');
  }
  if (adv.skipPrivate) {
    out = out.filter(r => r.is_private !== 'Yes');
  }
  return out;
}

// ── Fields collapse toggle ────────────────────────────────────────────────────
let fieldsOpen = false;
document.getElementById('fields-toggle')?.addEventListener('click', (e) => {
  if (e.target.closest('#fields-btns')) return; // don't collapse when clicking All/None
  fieldsOpen = !fieldsOpen;
  const chips    = document.getElementById('field-chips');
  const btns     = document.getElementById('fields-btns');
  const chevron  = document.getElementById('fields-chevron');
  chips.style.display   = fieldsOpen ? '' : 'none';
  btns.style.display    = fieldsOpen ? '' : 'none';
  chevron.style.transform = fieldsOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
});

document.getElementById('fields-all')?.addEventListener('click', () => {
  const fields = SCRAPE_FIELDS[getType()] || [];
  enabledFields = new Set(fields);
  fieldChips.querySelectorAll('.fchip').forEach(c => c.classList.add('on'));
});
document.getElementById('fields-none')?.addEventListener('click', () => {
  enabledFields.clear();
  fieldChips.querySelectorAll('.fchip').forEach(c => c.classList.remove('on'));
});

function filterFields(rows) {
  if (!enabledFields.size || !rows.length) return rows;
  return rows.map(row => {
    const out = {};
    for (const k of enabledFields) if (k in row) out[k] = row[k];
    return out;
  });
}

// Init
updateInputs();
buildFieldChips(getType());
// Start fields collapsed
fieldsOpen = false;
const _initChips   = document.getElementById('field-chips');
const _initBtns    = document.getElementById('fields-btns');
const _initChevron = document.getElementById('fields-chevron');
if (_initChips)   _initChips.style.display   = 'none';
if (_initBtns)    _initBtns.style.display     = 'none';
if (_initChevron) _initChevron.style.transform = 'rotate(-90deg)';
const _initDesc = document.getElementById('type-desc');
if (_initDesc) _initDesc.textContent = TYPE_DESC[getType()] || '';

// ── Auto-detect page ──────────────────────────────────────────────────────────
let detectedPage = null;
const SKIP = new Set(['explore','accounts','direct','stories','reels','locations','tv']);

const DETECT_ACTIONS = {
  profile: [
    { label:'Profile Info', type:'profile',   icon:'<circle cx="8" cy="5.5" r="2.5"/><path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5"/>' },
    { label:'Posts',        type:'posts',     icon:'<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>', noStroke:true },
    { label:'Followers',    type:'followers', icon:'<circle cx="5" cy="5" r="2"/><path d="M1 13c0-2.5 2-4 4-4s4 1.5 4 4"/><circle cx="11" cy="5" r="1.5"/><path d="M9 13c.2-.8 1-1.3 2-1.3 1.5 0 2.5.7 2.5 2"/>' },
    { label:'Following',    type:'following', icon:'<circle cx="7" cy="5" r="2.5"/><path d="M1.5 13.5c0-3 2.5-4.5 5.5-4.5 1 0 1.9.2 2.7.6"/><line x1="11.5" y1="9.5" x2="11.5" y2="15"/><line x1="8.5" y1="12.2" x2="14.5" y2="12.2"/>' },
  ],
  post: [
    { label:'Comments', type:'comments', icon:'<path d="M14 1.5H2c-.3 0-.5.2-.5.5v8c0 .3.2.5.5.5h2.5v3l3-3H14c.3 0 .5-.2.5-.5V2c0-.3-.2-.5-.5-.5z"/>' },
    { label:'Likers',   type:'likers',   icon:'<path d="M8 13.5C8 13.5 1.5 9.8 1.5 5.5a3.5 3.5 0 017 0 3.5 3.5 0 017 0c0 4.3-6.5 8-6.5 8z"/>' },
  ],
  hashtag: [
    { label:'Scrape Hashtag', type:'hashtag', icon:'<line x1="5" y1="2" x2="4" y2="14"/><line x1="11" y1="2" x2="10" y2="14"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10.5" x2="14" y2="10.5"/>' },
  ],
};

function renderDetect(page) {
  if (!page) { pageDetect.classList.add('hidden'); return; }
  const badge = document.getElementById('detect-badge');
  const val   = document.getElementById('detect-value');
  const acts  = document.getElementById('detect-actions');
  const typeLabel = page.type === 'post' ? 'Post' : page.type === 'hashtag' ? 'Hashtag' : 'Profile';
  if (badge) badge.textContent = typeLabel;
  if (val) val.textContent = page.type === 'profile' ? `@${page.value}` : page.type === 'hashtag' ? `#${page.value}` : page.value.replace(/^https?:\/\/[^/]+/, '');
  if (acts) {
    acts.innerHTML = '';
    (DETECT_ACTIONS[page.type] || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'dact';
      btn.innerHTML = `<svg viewBox="0 0 16 16" ${a.noStroke ? 'stroke="none" fill="currentColor"' : ''}>${a.icon}</svg>${a.label}`;
      btn.addEventListener('click', () => {
        if (page.type === 'post') { posturlEl.value = page.value; }
        else if (page.type === 'hashtag') { hashtagEl.value = page.value; }
        else { usernameEl.value = page.value; }
        setType(a.type);
      });
      acts.appendChild(btn);
    });
  }
  pageDetect.classList.remove('hidden');
}

async function detectPage() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
    if (!tabs.length) { pageDetect.classList.add('hidden'); return; }
    const url  = tabs[0].url;
    const path = new URL(url).pathname;
    const postM    = path.match(/^\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    const tagM     = path.match(/^\/explore\/tags\/([^/]+)/);
    const profileM = path.match(/^\/([A-Za-z0-9_.]+)\/?$/);
    if (postM) {
      detectedPage = { type:'post', value:url };
    } else if (tagM) {
      detectedPage = { type:'hashtag', value:decodeURIComponent(tagM[1]) };
    } else if (profileM && !SKIP.has(profileM[1])) {
      detectedPage = { type:'profile', value:profileM[1] };
    } else {
      detectedPage = null;
    }
    renderDetect(detectedPage);
  } catch(_) {}
}

detectPage();

// Real-time: re-detect whenever the Instagram tab navigates
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && info.url.includes('instagram.com')) detectPage();
});

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'log') { appendLog(msg.text, msg.source || 'content'); return; }
  if (msg.type === 'scrapeProgress') {
    const { count, total, label } = msg;
    statusEl.textContent = `${label ? label + ': ' : ''}${count}${total ? ' / '+total : ''} items...`;
    statusEl.className = 'st';
    if (total > 0) { progressFill.classList.remove('ind'); progressFill.style.width = Math.min(100,(count/total)*100)+'%'; }
    return;
  }
  if (msg.type === 'scrapeComplete') {
    chrome.storage.local.get(['igScrapeResult','igScrapeAction'], ({ igScrapeResult, igScrapeAction }) => {
      try { handleResults(JSON.parse(igScrapeResult || 'null'), igScrapeAction || msg.action); }
      catch(e) { showError('Failed to read results: '+e.message); }
    });
    return;
  }
  if (msg.type === 'scrapeError') showError(msg.error);
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function setRunning(on) {
  isRunning = on;
  runBtn.disabled = on;
  progressSec.classList.toggle('hidden', !on);
  if (on) {
    progressFill.classList.add('ind');
    progressFill.style.width = '';
    statusEl.textContent = 'Starting...';
    statusEl.className = 'st';
    resultsSec.classList.add('hidden');
  }
}

function showError(msg) {
  setRunning(false);
  progressSec.classList.remove('hidden');
  progressFill.classList.remove('ind');
  progressFill.style.width = '0%';
  statusEl.textContent = '⚠ ' + msg;
  statusEl.className = 'st err';
  appendLog('Error: ' + msg);
}

function handleResults(raw, action) {
  setRunning(false);
  let rows = [];
  if (action === 'hashtag' && raw?.posts) {
    rows = raw.posts;
    appendLog(`Hashtag #${raw.info?.hashtag}: scraped ${rows.length} posts`);
  } else if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw) {
    rows = [raw];
  }
  rows = applyAdvancedFilter(rows, action);
  currentData = rows;
  currentAction = action;
  const filtered = filterFields(rows);
  const n = rows.length;
  resultsCount.textContent = `${n.toLocaleString()} item${n!==1?'s':''} scraped`;
  statusEl.textContent = `✓ Done — ${n.toLocaleString()} items`;
  statusEl.className = 'st ok';
  progressSec.classList.remove('hidden');
  progressFill.classList.remove('ind');
  progressFill.style.width = '100%';
  renderPreview(filtered);
  resultsSec.classList.remove('hidden');
  appendLog(`Done: ${n} ${action} items`);
}

function renderPreview(rows) {
  if (!rows.length) { previewTable.innerHTML = '<tr><td style="color:var(--muted);padding:10px">No data returned.</td></tr>'; return; }
  const keys  = Object.keys(rows[0]);
  const slice = rows.slice(0,5);
  const esc   = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  previewTable.innerHTML =
    `<thead><tr>${keys.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead>`+
    `<tbody>${slice.map(r=>`<tr>${keys.map(k=>`<td title="${esc(r[k])}">${esc(String(r[k]??'').slice(0,40))}</td>`).join('')}</tr>`).join('')}</tbody>`;
  previewMore.textContent = rows.length>5 ? `+ ${(rows.length-5).toLocaleString()} more rows — export to see all` : '';
}

// ── Run ───────────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  if (isRunning) return;
  const type     = getType();
  const maxCount = Math.max(1, parseInt(maxCountEl.value) || DEFAULT_MAX[type]);
  const params   = {};

  if (NEEDS_USER.has(type)) {
    const username = usernameEl.value.trim().replace(/^@/,'').replace(/^https?:\/\/(?:www\.)?instagram\.com\//,'').replace(/\/$/,'');
    if (!username) { showError('Please enter a username.'); return; }
    params.username = username; params.maxCount = maxCount;
  } else if (NEEDS_POST.has(type)) {
    const postUrl = posturlEl.value.trim();
    if (!postUrl || !/instagram\.com/.test(postUrl)) { showError('Please enter a valid Instagram post URL.'); return; }
    params.postUrl = postUrl; params.maxCount = maxCount;
    const adv = getAdvanced();
    if (adv.enabled) { params.sortOrder = adv.sortOrder; params.includeReplies = adv.replies; }
  } else if (type === 'hashtag') {
    const hashtag = hashtagEl.value.trim().replace(/^#/,'');
    if (!hashtag) { showError('Please enter a hashtag.'); return; }
    params.hashtag = hashtag; params.maxCount = maxCount;
  }

  try {
    const igTabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
    if (!igTabs.length) { showError('No Instagram tab found. Please open instagram.com first.'); return; }
    await chrome.storage.local.remove(['igScrapeResult','igScrapeAction']);
    setRunning(true);
    appendLog(`Starting ${type} scrape...`);
    const tabId = igTabs[0].id;

    if (type === 'hashtag') {
      const tagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(params.hashtag)}/`;
      statusEl.textContent = 'Opening hashtag page...';
      await chrome.tabs.update(tabId, { url: tagUrl });
      await new Promise(resolve => {
        const fn = (id, info) => { if (id===tabId && info.status==='complete') { chrome.tabs.onUpdated.removeListener(fn); resolve(); } };
        chrome.tabs.onUpdated.addListener(fn);
      });
      statusEl.textContent = 'Waiting for page to render...';
      await new Promise(r => setTimeout(r, 3000));
    }

    chrome.tabs.sendMessage(tabId, { type:'startScrape', action:type, params }, (resp) => {
      if (chrome.runtime.lastError) { showError('Content script not ready. Reload the Instagram tab and try again.'); return; }
      if (!resp?.ok) showError(resp?.error || 'Failed to start scrape.');
    });
  } catch(e) { showError(e.message); }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
  const igTabs = await chrome.tabs.query({ url:'*://*.instagram.com/*' });
  if (igTabs.length) chrome.tabs.sendMessage(igTabs[0].id, { type:'stopScrape' });
  appendLog('Stop requested...');
});

// ── Export ────────────────────────────────────────────────────────────────────
function getExportData() { return filterFields(currentData || []); }

function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc  = v => `"${String(v??'').replace(/"/g,'""')}"`;
  return [keys.map(esc).join(','), ...rows.map(r => keys.map(k=>esc(r[k])).join(','))].join('\r\n');
}
function toHTML(rows) {
  if (!rows.length) return '<p>No data</p>';
  const keys = Object.keys(rows[0]);
  const esc  = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Instagram — ${currentAction}</title>
<style>body{font-family:system-ui;padding:20px;color:#111}h1{font-size:18px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e0e0e0;padding:8px 12px;text-align:left}
th{background:#f8f8f8;font-weight:600}tr:nth-child(even){background:#fafafa}</style>
</head><body><h1>Instagram — ${currentAction} (${rows.length} items)</h1>
<table><thead><tr>${keys.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
</table></body></html>`;
}
function toTXT(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join('\t'), ...rows.map(r => keys.map(k=>String(r[k]??'')).join('\t'))].join('\n');
}
function dl(content, name, mime) {
  const url = URL.createObjectURL(new Blob([content], { type:mime }));
  const a   = Object.assign(document.createElement('a'), { href:url, download:name });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fname(ext) { return `ig_${currentAction}_${new Date().toISOString().slice(0,10)}.${ext}`; }

document.getElementById('export-csv')?.addEventListener('click',  () => { const d=getExportData(); if(d.length) dl('﻿'+toCSV(d), fname('csv'), 'text/csv;charset=utf-8;'); });
document.getElementById('export-json')?.addEventListener('click', () => { const d=getExportData(); if(d.length) dl(JSON.stringify(d,null,2), fname('json'), 'application/json'); });
document.getElementById('export-html')?.addEventListener('click', () => { const d=getExportData(); if(d.length) dl(toHTML(d), fname('html'), 'text/html;charset=utf-8;'); });
document.getElementById('export-txt')?.addEventListener('click',  () => { const d=getExportData(); if(d.length) dl(toTXT(d), fname('txt'), 'text/plain;charset=utf-8;'); });

appendLog('Instagram Scraper ready', 'panel');
initTheme();
