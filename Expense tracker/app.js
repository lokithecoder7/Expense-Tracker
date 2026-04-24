// ─── CATEGORY CONFIG ─────────────────────────────
const CAT_COLORS = {
  'Food & Dining':      '#f97316',
  'Travel & Transport': '#3b82f6',
  'Shopping':           '#a855f7',
  'Bills & Utilities':  '#6366f1',
  'Health':             '#22c55e',
  'Entertainment':      '#ec4899',
  'Cash Withdrawal':    '#f59e0b',
  'Loan Repayment':     '#e11d48',
  'Lending':            '#06b6d4',
  'Savings':            '#84cc16',
  'Income':             '#10b981',
  'Others':             '#6b7280',
  'Pass-through':       '#94a3b8',
};

const CAT_EMOJI = {
  'Food & Dining':      '🍽️',
  'Travel & Transport': '🚌',
  'Shopping':           '🛍️',
  'Bills & Utilities':  '💡',
  'Health':             '🏥',
  'Entertainment':      '🎬',
  'Cash Withdrawal':    '🏧',
  'Loan Repayment':     '🏦',
  'Lending':            '🤝',
  'Savings':            '💹',
  'Income':             '💰',
  'Others':             '📦',
  'Pass-through':       '🔁',
};


const PASSTHROUGH_CAT = 'Pass-through';

// ─── STATE ────────────────────────────────────────
// Auto-detect current month, fall back to 'jan' if no data loaded yet
const CURRENT_MONTH_KEY = (function() {
  const monthKeys = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const now = new Date();
  const key = monthKeys[now.getMonth()]; // 0-indexed
  return { '01':'jan','02':'feb','03':'mar','04':'apr','05':'may','06':'jun',
           '07':'jul','08':'aug','09':'sep','10':'oct','11':'nov','12':'dec' }[key];
})();
let currentMonth = CURRENT_MONTH_KEY;
let MONTH_DATA = {};
let pieChartInstance = null;
let barChartInstance = null;
let _renderedTxns = []; // tracks last rendered list for category updates

const MONTH_KEY_MAP = {
  '01': 'jan', '02': 'feb', '03': 'mar', '04': 'apr',
  '05': 'may', '06': 'jun', '07': 'jul', '08': 'aug',
  '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dec',
};
const MONTH_LABEL_MAP = {
  jan: 'January', feb: 'February', mar: 'March',    apr: 'April',
  may: 'May',     jun: 'June',     jul: 'July',      aug: 'August',
  sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

function monthLabel(key) {
  const year = MONTH_DATA[key]?.[0]?.date?.substring(0, 4) || '2026';
  return `${MONTH_LABEL_MAP[key]} ${year}`;
}
function monthShort(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function getTransactions() {
  return getCycleTransactions(currentMonth);
}

// ─── AUTO-SAVE TO DISK ────────────────────────────
let dataFolderHandle = null;

function _openHandleDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('expenseai_handles', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => res(r.result);
    r.onerror  = () => rej(r.error);
  });
}
async function _saveHandleToIDB(handle) {
  const db = await _openHandleDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'dataFolder');
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function _getHandleFromIDB() {
  const db = await _openHandleDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('dataFolder');
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}

function _updateSaveStatus(connected) {
  const sidebar = document.getElementById('saveStatus');
  const box     = document.getElementById('autoSaveStatus');
  if (connected) {
    if (sidebar) { sidebar.textContent = '✅ Auto-saving'; sidebar.style.color = 'var(--green)'; sidebar.style.background = '#22c55e15'; sidebar.onclick = null; sidebar.style.cursor = 'default'; }
    if (box)     { box.innerHTML = '<span style="color:var(--green)">✅ Connected — every change saves automatically to <code>data/app-data.js</code></span>'; }
  } else {
    if (sidebar) { sidebar.textContent = '📁 Enable auto-save'; sidebar.style.color = '#f59e0b'; sidebar.style.background = '#f59e0b15'; sidebar.onclick = connectDataFolder; sidebar.style.cursor = 'pointer'; }
    if (box)     { box.innerHTML = '<span style="color:#f59e0b">⚠️ Not connected — changes saved in browser only</span>'; }
  }
}

function generateAppDataContent() {
  const snap = {};
  Object.keys(MONTH_DATA).forEach(k => { snap[`txn_${k}`] = MONTH_DATA[k]; });
  ['assets_data_v2', 'liabilities_data_v2', 'stock_data'].forEach(k => {
    const v = localStorage.getItem(k); if (v) snap[k] = JSON.parse(v);
  });
  Object.values(MONTH_KEY_MAP).forEach(k => {
    const v = localStorage.getItem(`income_override_${k}`); if (v) snap[`income_override_${k}`] = v;
  });
  return [
    '// ExpenseAI — auto-generated. Do not edit manually.',
    '// Updated: ' + new Date().toISOString(),
    '(function(){',
    '  var d=' + JSON.stringify(snap) + ';',
    '  Object.entries(d).forEach(function(e){',
    '    if(!localStorage.getItem(e[0]))',
    '      localStorage.setItem(e[0],typeof e[1]==="string"?e[1]:JSON.stringify(e[1]));',
    '  });',
    '})();',
  ].join('\n');
}

async function autoSaveToFile() {
  if (!dataFolderHandle) return;
  try {
    const fh = await dataFolderHandle.getFileHandle('app-data.js', { create: true });
    const w  = await fh.createWritable();
    await w.write(generateAppDataContent());
    await w.close();
  } catch (e) {
    if (e.name === 'NotAllowedError') { dataFolderHandle = null; _updateSaveStatus(false); }
    else console.warn('Auto-save failed:', e);
  }
}

async function connectDataFolder() {
  if (!window.showDirectoryPicker) { alert('Auto-save requires Chrome or Edge.'); return; }
  try {
    let handle = window._pendingFolderHandle;
    if (handle) {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') handle = null;
    }
    if (!handle) {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await _saveHandleToIDB(handle);
    }
    dataFolderHandle = handle;
    window._pendingFolderHandle = null;
    _updateSaveStatus(true);
    await autoSaveToFile();
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('Folder access error:', e);
  }
}

async function tryRestoreHandle() {
  try {
    const handle = await _getHandleFromIDB();
    if (!handle) { _updateSaveStatus(false); return; }
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      dataFolderHandle = handle; _updateSaveStatus(true);
    } else {
      window._pendingFolderHandle = handle; _updateSaveStatus(false);
    }
  } catch (e) { _updateSaveStatus(false); }
}

// ─── SALARY CYCLE ─────────────────────────────────
function getMonthContext(monthKey) {
  const monthKeys = Object.values(MONTH_KEY_MAP);
  const prevKey   = monthKeys[monthKeys.indexOf(monthKey) - 1];
  const currTxns  = MONTH_DATA[monthKey] || [];
  const prevTxns  = (prevKey && MONTH_DATA[prevKey]) || [];
  return { currTxns, prevTxns };
}

function findSalaryTxn(txns) {
  // Salary = a likely payroll credit descriptor in bank narration
  const salary = txns.find(t => t.deposit > 0 && /(SALARY|PAYROLL)/i.test(t.desc));
  return salary || null;
}

function findSalaryDate(txns) {
  return findSalaryTxn(txns)?.date || null;
}

function getCycleTransactions(monthKey) {
  const { currTxns, prevTxns } = getMonthContext(monthKey);
  const currSalaryTxn = findSalaryTxn(currTxns);
  const prevSalaryTxn = findSalaryTxn(prevTxns);

  // Check if this is the latest month (no next-month entry exists at all, even empty)
  const order = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const nextKey = order[order.indexOf(monthKey) + 1];
  const isLatestMonth = !nextKey || !(nextKey in MONTH_DATA);

  const currSalaryIdx = currSalaryTxn ? currTxns.indexOf(currSalaryTxn) : -1;

  // For the latest month: show everything (salary + post-salary spending belong here
  // since there's no next cycle yet). For older months: cut off before salary so
  // those transactions appear in the next month's cycle instead.
  const fromCurr = (isLatestMonth || currSalaryIdx < 0) ? currTxns : currTxns.slice(0, currSalaryIdx);

  if (!prevSalaryTxn) {
    return fromCurr;
  }

  // Previous month: FROM the salary transaction onwards (inclusive — salary marks cycle start)
  const prevSalaryIdx = prevTxns.indexOf(prevSalaryTxn);
  const fromPrev = prevSalaryIdx >= 0 ? prevTxns.slice(prevSalaryIdx) : [];
  return fromPrev.concat(fromCurr);
}

function getCycleDateRange(monthKey) {
  const { currTxns, prevTxns } = getMonthContext(monthKey);
  const cycleStart = findSalaryDate(prevTxns);

  const order = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const nextKey = order[order.indexOf(monthKey) + 1];
  const isLatestMonth = !nextKey || !(nextKey in MONTH_DATA);

  // For the latest month: cycle end is the last transaction date (still ongoing)
  // For older months: cycle end is the salary date of this month
  const cycleEnd = isLatestMonth
    ? (currTxns.length > 0 ? currTxns[currTxns.length - 1].date : null)
    : findSalaryDate(currTxns);

  // Fallback start: 1st of current month
  let start = cycleStart;
  if (!start && currTxns.length > 0) {
    const monthNum = Object.entries(MONTH_KEY_MAP).find(([, k]) => k === monthKey)?.[0];
    const year = currTxns[0].date.substring(0, 4);
    start = `${year}-${monthNum}-01`;
  }

  return { start, end: cycleEnd };
}

function updateMonthBadge() {
  const badge = document.getElementById('monthBadge');
  const range = getCycleDateRange(currentMonth);
  if (range?.start) {
    const shortDate = d => `${d.slice(8)}/${d.slice(5, 7)}`;
    badge.textContent = range.end
      ? `${shortDate(range.start)} → ${shortDate(range.end)}`
      : `${shortDate(range.start)} → now`;
  } else {
    badge.textContent = monthLabel(currentMonth);
  }
}

// ─── HELPERS ─────────────────────────────────────
function escapeHTML(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return '₹' + parseFloat(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Convert internal YYYY-MM-DD to display format DD/MM/YYYY
function fmtDate(d) {
  if (!d) return '';
  return `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

function extractMerchant(desc) {
  const upiMatch = desc.match(/UPI\/\d+\/\s*([^\/]+)\//);
  if (upiMatch) {
    let name = upiMatch[1].trim();
    name = name.replace(/\s*\/.*/, '').replace(/\s*@.*/, '').trim();
    if (name.length > 2 && !/^\d+$/.test(name)) return name;
  }
  if (desc.includes('ATM WITHDRAWAL')) return 'ATM Withdrawal';
  if (desc.includes('NACH DR')) return 'Auto Debit (NACH)';
  if (desc.includes('NEFT')) return 'NEFT Transfer';
  if (desc.includes('PURCHASE')) return desc.split(' ')[1] || 'Card Purchase';
  return desc.substring(0, 30).trim();
}

// ─── AUTO-CATEGORIZE ─────────────────────────────
function categorize(desc, deposit, withdrawal) {
  if (deposit > 0 && withdrawal === 0) return 'Income';
  const d = desc.toUpperCase();
  if (/ATM WITHDRAWAL|ATM WDL/.test(d)) return 'Cash Withdrawal';
  if (/ZOMATO|SWIGGY|SWEETS|BAKERY|RESTAURANT|FOOD|CAFE|BIRYANI|IDLY|TEA STALL|JUICE|HOTEL|KITCHEN|DOMINOS|KFC|PIZZA|BURGER/.test(d)) return 'Food & Dining';
  if (/REDBUS|RAPIDO|IRCTC|UBER|OLA|RAILWAY|METRO|BUS|TRAVEL|FLIGHT|MAKEMYTRIP|IXIGO/.test(d)) return 'Travel & Transport';
  if (/AMAZON|FLIPKART|MYNTRA|SUPERMARKET|MARKET|MEESHO|NYKAA|AJIO/.test(d)) return 'Shopping';
  if (/HOSPITAL|PHARMACY|MEDICAL|CLINIC|DOCTOR|HEALTH|APOLLO|KAUVERY|MEDPLUS/.test(d)) return 'Health';
  if (/NETFLIX|SPOTIFY|YOUTUBE|HOTSTAR|PRIME|CINEMA|PVR|INOX|BOOKMYSHOW/.test(d)) return 'Entertainment';
  if (/NACH DR/.test(d)) return 'Loan Repayment';
  if (/JIO|AIRTEL|VODAFONE|BSNL|MYJIO|ELECTRICITY|NACH|BILL|RECHARGE|INSURANCE|TATA SKY|BROADBAND/.test(d)) return 'Bills & Utilities';
  if (/SIP|MUTUAL FUND|ZERODHA|GROWW|KUVERA|PPFAS|COIN|PIGGY|RD |FD |RECURRING|FIXED DEPOSIT/.test(d)) return 'Savings';
  if (/LEND|LOAN TO|BORROWED|ADVANCE TO/.test(d)) return 'Lending';
  return 'Others';
}

// ─── BACKUP & RESTORE ─────────────────────────────
function exportBackup() {
  const incomeOverrides = {};
  Object.values(MONTH_KEY_MAP).forEach(k => {
    const val = localStorage.getItem(`income_override_${k}`);
    if (val) incomeOverrides[k] = parseFloat(val);
  });

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: MONTH_DATA,
    assets:       JSON.parse(localStorage.getItem('assets_data_v2')       || 'null'),
    liabilities:  JSON.parse(localStorage.getItem('liabilities_data_v2')  || 'null'),
    stocks:       JSON.parse(localStorage.getItem('stock_data')            || 'null'),
    settings:     { incomeOverrides },
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `expenseai-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const backup = JSON.parse(e.target.result);

      if (backup.transactions) {
        Object.entries(backup.transactions).forEach(([key, txns]) => {
          // Keep current localStorage if it has newer data (more recent last transaction date)
          const current = JSON.parse(localStorage.getItem(`txn_${key}`) || 'null');
          const currentLastDate = current?.length ? current[current.length - 1].date : '';
          const backupLastDate  = txns?.length    ? txns[txns.length - 1].date       : '';
          if (!current || backupLastDate >= currentLastDate) {
            localStorage.setItem(`txn_${key}`, JSON.stringify(txns));
          }
          // If current is newer, keep it — backup is stale for this month
        });
      }
      if (backup.assets)      localStorage.setItem('assets_data_v2',      JSON.stringify(backup.assets));
      if (backup.liabilities) localStorage.setItem('liabilities_data_v2', JSON.stringify(backup.liabilities));
      if (backup.stocks)      localStorage.setItem('stock_data',           JSON.stringify(backup.stocks));
      if (backup.settings?.incomeOverrides) {
        Object.entries(backup.settings.incomeOverrides).forEach(([k, v]) => {
          localStorage.setItem(`income_override_${k}`, v);
        });
      }

      const el = document.getElementById('backupResult');
      if (el) { el.style.color = '#22c55e'; el.textContent = '✅ Backup restored — reloading...'; }
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      const el = document.getElementById('backupResult');
      if (el) { el.style.color = '#ef4444'; el.textContent = '❌ Invalid backup file: ' + err.message; }
    }
  };
  reader.readAsText(file);
}

// ─── STORAGE ──────────────────────────────────────
function clearAllBrowserData() {
  if (!confirm('This will clear all cached transaction data from the browser. You will need to re-import your CSV. Continue?')) return;
  Object.values(MONTH_KEY_MAP).forEach(k => {
    localStorage.removeItem(`txn_${k}`);
    localStorage.removeItem(`income_override_${k}`);
  });
  MONTH_DATA = {};
  document.getElementById('monthSwitcher').innerHTML = '';
  document.getElementById('txBody').innerHTML = '';
  alert('Done. Now re-import your CSV from the Upload section above.');
}

function saveMonthToStorage(key, transactions) {
  try {
    localStorage.setItem(`txn_${key}`, JSON.stringify(transactions));
  } catch (e) {
    console.warn('localStorage full, could not save month data:', e);
  }
  autoSaveToFile();
}

function loadMonthsFromStorage() {
  for (const key of Object.values(MONTH_KEY_MAP)) {
    const raw = localStorage.getItem(`txn_${key}`);
    if (raw) {
      try {
        const transactions = JSON.parse(raw);
        if (transactions.length > 0) {
          // Validate: all transactions must belong to this calendar month (guard against stale data)
          const expectedMonthNum = Object.entries(MONTH_KEY_MAP).find(([, k]) => k === key)?.[0];
          const isClean = transactions.every(t => t.date && t.date.substring(5, 7) === expectedMonthNum);
          if (!isClean) {
            localStorage.removeItem(`txn_${key}`); // wipe stale/corrupted entry
            continue;
          }
          MONTH_DATA[key] = transactions;
          const year = transactions[0].date.substring(0, 4);
          addMonthButton(key, `${key.charAt(0).toUpperCase() + key.slice(1)} ${year}`);
        }
      } catch (e) { /* corrupted entry, skip */ }
    }
  }

  // Restore auto-created next-cycle month button (salary detected, no own transactions yet)
  const cycleNextRaw = localStorage.getItem('cycle_next_month');
  if (cycleNextRaw) {
    try {
      const { key, year } = JSON.parse(cycleNextRaw);
      if (key && !MONTH_DATA[key]?.length) {
        MONTH_DATA[key] = [];
        addMonthButton(key, `${key.charAt(0).toUpperCase() + key.slice(1)} ${year}`);
      } else if (key && MONTH_DATA[key]?.length > 0) {
        // Month now has real data — clear the placeholder marker
        localStorage.removeItem('cycle_next_month');
      }
    } catch (e) { /* ignore */ }
  }
}

// ─── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  tryRestoreHandle(); // attempt to reconnect saved folder handle
  // Load pre-bundled month data files (window.STORED_MONTH_DATA set by data/*.js files)
  if (window.STORED_MONTH_DATA) {
    for (const [key, data] of Object.entries(window.STORED_MONTH_DATA)) {
      if (data && data.length > 0) {
        // Validate: guard against an old all-data.js with cross-month contamination
        const expectedMonthNum = Object.entries(MONTH_KEY_MAP).find(([, k]) => k === key)?.[0];
        const isClean = data.every(t => t.date && t.date.substring(5, 7) === expectedMonthNum);
        if (!isClean) continue; // skip corrupted static data
        MONTH_DATA[key] = data;
        const year = data[0].date.substring(0, 4);
        addMonthButton(key, `${key.charAt(0).toUpperCase() + key.slice(1)} ${year}`);
      }
    }
  }
  loadMonthsFromStorage(); // localStorage overrides static files (preserves category edits)

  updateMonthBadge();
  // Switch to current month if data exists, else fall back to latest available
  const availableMonths = Object.keys(MONTH_DATA);
  if (availableMonths.includes(CURRENT_MONTH_KEY)) {
    currentMonth = CURRENT_MONTH_KEY;
  } else if (availableMonths.length > 0) {
    // Walk backwards from current month to find the most recent available
    const order = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const currentIdx = order.indexOf(CURRENT_MONTH_KEY);
    let found = false;
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (availableMonths.includes(order[i])) {
        currentMonth = order[i];
        found = true;
        break;
      }
    }
    // If nothing found going backwards, just pick the latest available
    if (!found) {
      currentMonth = availableMonths.sort((a,b) => order.indexOf(a) - order.indexOf(b)).pop();
    }
  }
 
  // Highlight correct month button in sidebar
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.month === currentMonth);
  });
  renderDashboard();
  renderTransactions(getTransactions());
  renderBudget();
  setupNav();
  setupFilters();
});

// ─── NAV ─────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tab = link.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      link.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
      if (tab === 'dashboard') renderDashboard();
      if (tab === 'finai') initFinAI();
    });
  });
}

// ─── MONTH SWITCHER ───────────────────────────────
function switchMonth(month) {
  // A month is accessible if it has its own transactions OR cycle transactions from prev month's post-salary data
  const hasCycleData = (MONTH_DATA[month] && MONTH_DATA[month].length > 0) ||
                       getCycleTransactions(month).length > 0;
  if (!hasCycleData) {
    alert('No data loaded for that month yet. Upload a CSV in the Import tab.');
    return;
  }
  currentMonth = month;

  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.month === month);
  });

  document.getElementById('sidebarMonth').textContent = monthLabel(month);
  updateMonthBadge();

  renderDashboard();
  renderTransactions(getTransactions());
  renderBudget();
}

function addMonthButton(key, label) {
  if (document.querySelector(`.month-btn[data-month="${key}"]`)) return; // already exists
  const btn = document.createElement('button');
  btn.className = 'month-btn';
  btn.dataset.month = key;
  btn.textContent = label;
  btn.onclick = () => switchMonth(key);
  document.getElementById('monthSwitcher').appendChild(btn);
}

// ─── DASHBOARD ───────────────────────────────────
function renderDashboard() {
  const txns = getTransactions();
  const debits  = txns.filter(t => t.withdrawal > 0 && t.category !== PASSTHROUGH_CAT);
  const credits = txns.filter(t => t.deposit > 0    && t.category !== PASSTHROUGH_CAT);

  const totalSpent    = debits.reduce((s, t) => s + t.withdrawal, 0);
  const totalReceived = credits.reduce((s, t) => s + t.deposit, 0);

  // Opening balance = balance before first transaction in the cycle
  const firstTxn  = txns[0];
  const opening   = firstTxn
    ? (firstTxn.balance || 0) + (firstTxn.withdrawal || 0) - (firstTxn.deposit || 0)
    : 0;
  const openingOn = firstTxn ? `as of ${fmtDate(firstTxn.date)}` : 'Start of cycle';

  // Closing balance = account balance after the last transaction in the cycle
  const lastTxn   = txns[txns.length - 1];
  const closing   = lastTxn?.balance || 0;
  const closingOn = lastTxn ? `as of ${fmtDate(lastTxn.date)}` : '';

  // PT net for reconciliation line
  const ptNet = txns.reduce((s, t) => {
    if (t.category !== PASSTHROUGH_CAT) return s;
    return s + (t.withdrawal || 0) - (t.deposit || 0);
  }, 0);

  // Biggest spend excludes income/savings transfers; looks only at actual spending
  const spendingDebits = debits.filter(t => !['Income', 'Savings', 'Loan Repayment'].includes(t.category));
  const biggest = spendingDebits.length
    ? spendingDebits.reduce((a, b) => b.withdrawal > a.withdrawal ? b : a, spendingDebits[0])
    : null;

  const savingsTxns = txns.filter(t => t.category === 'Savings');
  const totalSavings = savingsTxns.reduce((s, t) => s + t.withdrawal + t.deposit, 0);

  document.getElementById('totalSpent').textContent     = fmt(totalSpent);
  document.getElementById('txCount').textContent        = `${debits.length} debit transactions`;
  document.getElementById('totalReceived').textContent  = fmt(totalReceived);
  document.getElementById('totalSavings').textContent   = fmt(totalSavings);
  document.getElementById('savingsCount').textContent   = `${savingsTxns.length} transfer${savingsTxns.length !== 1 ? 's' : ''}`;
  document.getElementById('openingBalance').textContent = fmt(opening);
  document.getElementById('openingCardSub').textContent = openingOn;
  document.getElementById('closingBalance').textContent = fmt(closing);
  document.getElementById('closingCardSub').textContent = closingOn;
  const ptPart = ptNet !== 0 ? ` − ${fmt(Math.abs(ptNet))} PT` : '';
  document.getElementById('closingReconcile').textContent =
    `${fmt(opening)} + ${fmt(totalReceived)} − ${fmt(totalSpent)}${ptPart} = ${fmt(closing)}`;
  document.getElementById('biggestSpend').textContent   = biggest ? fmt(biggest.withdrawal) : '₹0';
  document.getElementById('biggestDesc').textContent    = biggest
    ? `${extractMerchant(biggest.desc).substring(0, 18)} · ${fmtDate(biggest.date)}`
    : '—';

  renderPieChart(debits);
  renderBarChart(debits);
  renderTopMerchants(debits);
}

function renderPieChart(debits) {
  if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }

  const catTotals = {};
  debits.forEach(t => {
    if (t.category === 'Income' || t.category === PASSTHROUGH_CAT) return;
    catTotals[t.category] = (catTotals[t.category] || 0) + t.withdrawal;
  });

  // Sort largest slice first
  const sorted = Object.entries(catTotals).sort(([, a], [, b]) => b - a);
  const labels = sorted.map(([l]) => l);
  const data   = sorted.map(([, v]) => v);
  const colors = labels.map(l => CAT_COLORS[l] || '#6b7280');
  const total  = data.reduce((s, v) => s + v, 0);

  const centerTextPlugin = {
    id: 'centerText',
    afterDraw(chart) {
      const { ctx, chartArea: { top, bottom, left, right } } = chart;
      const cx = (left + right) / 2, cy = (top + bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 10px DM Sans, sans-serif';
      ctx.fillStyle = '#9494b0';
      ctx.fillText('SPENT', cx, cy - 12);
      ctx.font = 'bold 14px DM Mono, monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(fmt(total), cx, cy + 8);
      ctx.restore();
    }
  };

  pieChartInstance = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${fmt(ctx.raw)} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [centerTextPlugin]
  });

  // Custom legend
  document.getElementById('pieLegend').innerHTML = sorted.map(([label, val], i) => {
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
    return `<div class="pie-legend-row">
      <span class="pie-legend-dot" style="background:${colors[i]}"></span>
      <span class="pie-legend-label">${CAT_EMOJI[label] || ''} ${label}</span>
      <span class="pie-legend-pct">${pct}%</span>
      <span class="pie-legend-val mono">${fmt(val)}</span>
    </div>`;
  }).join('');
}

function renderBarChart(debits) {
  if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }

  const daily = {};
  debits.forEach(t => {
    if (t.category === PASSTHROUGH_CAT) return;
    daily[t.date] = (daily[t.date] || 0) + t.withdrawal;
  });

  const days    = Object.keys(daily).sort();
  const amounts = days.map(d => daily[d]);

  const dayLabels = days.map(d => `${d.slice(8)}/${d.slice(5, 7)}`);

  const range = getCycleDateRange(currentMonth);
  if (range?.start) {
    document.getElementById('barChartTitle').textContent =
      `Daily Spending  ${fmtDate(range.start)} → ${range.end ? fmtDate(range.end) : 'now'}`;
  }

  barChartInstance = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [{
        data: amounts,
        backgroundColor: '#6c63ff55',
        borderColor: '#6c63ff',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1e1e2a' } },
        y: {
          ticks: {
            color: '#6b7280', font: { size: 10 },
            callback: v => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
          },
          grid: { color: '#1e1e2a' }
        }
      }
    }
  });
}

function renderTopMerchants(debits) {
  const merchants = {};
  debits.forEach(t => {
    if (t.category === PASSTHROUGH_CAT) return;
    const name = extractMerchant(t.desc);
    merchants[name] = (merchants[name] || 0) + t.withdrawal;
  });

  const top = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 10);

  document.getElementById('topMerchants').innerHTML = top.map(([name, amt]) => `
    <div class="merchant-item">
      <span class="merchant-name">${escapeHTML(name.substring(0, 24))}</span>
      <span class="merchant-amount">${fmt(amt)}</span>
    </div>
  `).join('');
}

// ─── TRANSACTIONS ─────────────────────────────────
function renderTransactions(list) {
  _renderedTxns = list;

  // Table footer totals
  const totalDebit  = list.reduce((s, t) => s + (t.withdrawal || 0), 0);
  const totalCredit = list.reduce((s, t) => s + (t.deposit    || 0), 0);
  const net         = totalCredit - totalDebit;
  document.getElementById('txCount').textContent = `${list.length} transaction${list.length !== 1 ? 's' : ''}`;
  document.getElementById('txAmounts').innerHTML =
    `<span class="amount-debit">−${fmt(totalDebit)}</span> <span class="tfoot-sep">/</span> <span class="amount-credit">+${fmt(totalCredit)}</span>`;
  document.getElementById('txNet').innerHTML =
    `Net <span class="${net >= 0 ? 'amount-credit' : 'amount-debit'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span>`;

  const tbody = document.getElementById('txBody');
  // Display newest-first; indices still map to _renderedTxns for category updates
  const display = [...list].reverse();
  tbody.innerHTML = display.map((t, displayIdx) => {
    const i = list.length - 1 - displayIdx; // map back to _renderedTxns index
    const isDebit  = t.withdrawal > 0;
    const amount   = isDebit ? t.withdrawal : t.deposit;
    const merchant = extractMerchant(t.desc);
    const opts = Object.keys(CAT_COLORS).map(cat =>
      `<option value="${cat}" ${cat === t.category ? 'selected' : ''}>${CAT_EMOJI[cat] || ''} ${cat}</option>`
    ).join('');
    return `
      <tr>
        <td style="font-family:'DM Mono',monospace;font-size:0.8rem;white-space:nowrap">${fmtDate(t.date)}</td>
        <td>
          <div style="font-weight:500;font-size:0.85rem">${escapeHTML(merchant.substring(0, 35))}</div>
          <div class="td-desc">${escapeHTML(t.desc.substring(0, 60))}...</div>
        </td>
        <td><select class="cat-select" onchange="updateCategory(${i}, this.value)">${opts}</select></td>
        <td class="${isDebit ? 'amount-debit' : 'amount-credit'}">${isDebit ? '-' : '+'}${fmt(amount)}</td>
        <td class="${isDebit ? 'type-debit' : 'type-credit'}">${isDebit ? '↓ Debit' : '↑ Credit'}</td>
      </tr>
    `;
  }).join('');
}

function updateCategory(index, newCat) {
  const t = _renderedTxns[index];
  if (!t) return;
  t.category = newCat;
  for (const key of Object.keys(MONTH_DATA)) {
    if (MONTH_DATA[key].includes(t)) {
      saveMonthToStorage(key, MONTH_DATA[key]);  // always save to localStorage
      break;
    }
  }
  renderDashboard();
}

function setupFilters() {
  const catFilter  = document.getElementById('catFilter');
  const typeFilter = document.getElementById('typeFilter');

  function applyFilters() {
    let filtered = getTransactions();
    if (catFilter.value)              filtered = filtered.filter(t => t.category === catFilter.value);
    if (typeFilter.value === 'debit') filtered = filtered.filter(t => t.withdrawal > 0);
    if (typeFilter.value === 'credit') filtered = filtered.filter(t => t.deposit > 0);
    renderTransactions(filtered);
  }

  catFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change', applyFilters);
}

// ─── BUDGET (50 / 30 / 20) ───────────────────────
const BUCKET_DEFS = [
  {
    key: 'needs', label: 'Needs', pct: 50, color: '#3b82f6',
    icon: '🏠', desc: 'Fixed & essential — must-haves',
    categories: ['Loan Repayment', 'Bills & Utilities', 'Health'],
  },
  {
    key: 'wants', label: 'Wants', pct: 30, color: '#f59e0b',
    icon: '🛍️', desc: 'Lifestyle & discretionary spending',
    categories: ['Food & Dining', 'Shopping', 'Entertainment', 'Travel & Transport', 'Cash Withdrawal', 'Others'],
  },
  {
    key: 'savings', label: 'Savings & Investments', pct: 20, color: '#22c55e',
    icon: '💹', desc: 'Wealth building & emergency fund',
    categories: ['Savings'],
  },
];

function getDetectedIncome() {
  const txns = getTransactions();
  const incomeTxns = txns.filter(t => t.deposit > 0 && t.category === 'Income');
  if (incomeTxns.length > 0) return incomeTxns.reduce((s, t) => s + t.deposit, 0);
  // Fallback: sum all deposits except pass-through (when nothing is tagged as Income)
  return txns.filter(t => t.deposit > 0 && t.category !== PASSTHROUGH_CAT).reduce((s, t) => s + t.deposit, 0);
}

function getEffectiveIncome() {
  const override = parseFloat(localStorage.getItem('income_override_' + currentMonth));
  return isNaN(override) ? getDetectedIncome() : override;
}

function setIncomeOverride() {
  const val = parseFloat(document.getElementById('incomeOverride').value);
  if (!isNaN(val) && val > 0) {
    localStorage.setItem('income_override_' + currentMonth, val);
    document.getElementById('incomeOverride').value = '';
    renderBudget();
  }
}

function clearIncomeOverride() {
  localStorage.removeItem('income_override_' + currentMonth);
  renderBudget();
}

function renderBudget() {
  const txns = getTransactions();
  const spent = {};
  txns.forEach(t => {
    if (t.withdrawal > 0 && t.category !== PASSTHROUGH_CAT) spent[t.category] = (spent[t.category] || 0) + t.withdrawal;
  });

  const income = getEffectiveIncome();
  const isOverride = !!localStorage.getItem('income_override_' + currentMonth);

  document.getElementById('budgetIncome').textContent = fmt(income) + (isOverride ? ' (manual)' : ' (auto)');

  const range = getCycleDateRange(currentMonth);
  const period = range?.start
    ? `${range.start.slice(8)}/${range.start.slice(5,7)} → ${range.end ? range.end.slice(8)+'/'+range.end.slice(5,7) : 'now'}`
    : monthLabel(currentMonth);
  document.getElementById('budgetPeriodBadge').textContent = period;

  // Compute bucket totals
  const bucketSpent = {};
  BUCKET_DEFS.forEach(b => {
    bucketSpent[b.key] = b.categories.reduce((s, cat) => s + (spent[cat] || 0), 0);
  });

  // Savings = income - needs - wants (actual money not spent)
  const actualSavings = Math.max(0, income - bucketSpent.needs - bucketSpent.wants);

  document.getElementById('budgetBuckets').innerHTML = BUCKET_DEFS.map(b => {
    const target  = (income * b.pct) / 100;
    const actual  = b.key === 'savings' ? actualSavings : bucketSpent[b.key];
    const pct     = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
    const over    = target > 0 && actual > target;
    const barCls  = b.key === 'savings'
      ? (pct >= 100 ? 'progress-ok' : pct >= 60 ? 'progress-warn' : 'progress-over')
      : (pct < 70 ? 'progress-ok' : pct < 90 ? 'progress-warn' : 'progress-over');

    const catRows = b.key === 'savings'
      ? `<div class="bucket-cat-row"><span>💹 Savings (tagged)</span><span>${fmt(bucketSpent.savings)}</span></div>
         <div class="bucket-cat-row"><span>🏦 Unspent surplus</span><span>${fmt(Math.max(0, actualSavings - bucketSpent.savings))}</span></div>`
      : b.categories.map(cat => {
          const s = spent[cat] || 0;
          if (s === 0) return '';
          return `<div class="bucket-cat-row">
            <span>${CAT_EMOJI[cat] || ''} ${cat}</span>
            <span>${fmt(s)}</span>
          </div>`;
        }).join('');

    const statusText = b.key === 'savings'
      ? (pct >= 100 ? '✅ On target' : `⚠️ ${Math.round(pct)}% of goal — save ${fmt(target - actual)} more`)
      : (over ? `🔴 Over by ${fmt(actual - target)}` : `${fmt(target - actual)} remaining`);

    return `
      <div class="bucket-card" style="--bucket-color:${b.color}">
        <div class="bucket-header">
          <div class="bucket-title-row">
            <span class="bucket-icon">${b.icon}</span>
            <div>
              <div class="bucket-label">${b.label} <span class="bucket-pct-badge">${b.pct}%</span></div>
              <div class="bucket-desc">${b.desc}</div>
            </div>
          </div>
          <div class="bucket-amounts">
            <div class="bucket-actual">${fmt(actual)}</div>
            <div class="bucket-target">of ${fmt(target)}</div>
          </div>
        </div>
        <div class="progress-bar-bg" style="margin:14px 0 6px">
          <div class="progress-bar-fill ${barCls}" style="width:${pct}%;background:${b.color}"></div>
        </div>
        <div class="progress-label">
          <span style="color:${b.color}">${statusText}</span>
          <span>${Math.round(pct)}%</span>
        </div>
        <div class="bucket-cats">${catRows}</div>
      </div>`;
  }).join('');
}

// ─── CSV IMPORT ───────────────────────────────────
function uploadCSV() {
  const file = document.getElementById('csvFile').files[0];
  if (!file) {
    showCSVResult('Please select a CSV file first.', false);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const allTransactions = parseCSVText(e.target.result);
      if (allTransactions.length === 0) {
        showCSVResult('No transactions found. Check the CSV columns match: Date, Transaction, Currency, Deposit, Withdrawal, Running Balance.', false);
        return;
      }

      // Split transactions by month
      const byMonth = {};
      allTransactions.forEach(t => {
        const monthNum = t.date.substring(5, 7);
        const year     = t.date.substring(0, 4);
        const key      = MONTH_KEY_MAP[monthNum] || monthNum;
        if (!byMonth[key]) byMonth[key] = { txns: [], year };
        byMonth[key].txns.push(t);
      });

      const order = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const detectedKeys = [];

      for (const [key, { txns, year }] of Object.entries(byMonth)) {
        // SC CSV is newest-first; reverse so same-day entries become oldest-first,
        // then stable-sort by date. This preserves the bank's intra-day entry order
        // so salary-cycle slicing (by entry position, not date) works correctly.
        const sorted = [...txns].reverse();
        sorted.sort((a, b) => a.date.localeCompare(b.date));

        // Merge with existing month data instead of overwriting — dedupe by date+desc+amount
        const existing = MONTH_DATA[key] || [];
        const existingKeys = new Set(existing.map(t => `${t.date}|${t.desc}|${t.deposit}|${t.withdrawal}`));
        const newOnly = sorted.filter(t => !existingKeys.has(`${t.date}|${t.desc}|${t.deposit}|${t.withdrawal}`));
        const merged = [...existing, ...newOnly];
        merged.sort((a, b) => a.date.localeCompare(b.date));

        MONTH_DATA[key] = merged;
        saveMonthToStorage(key, merged);
        addMonthButton(key, `${key.charAt(0).toUpperCase() + key.slice(1)} ${year}`);
        detectedKeys.push(key);
      }


      // If the latest month has a salary, auto-create the next month so the new cycle is accessible
      const latestKey = detectedKeys.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
      const latestIdx = order.indexOf(latestKey);
      const nextKey = latestIdx >= 0 && latestIdx < order.length - 1 ? order[latestIdx + 1] : null;
      if (nextKey && findSalaryTxn(MONTH_DATA[latestKey] || []) && !MONTH_DATA[nextKey]?.length) {
        const yearOfLatest = (MONTH_DATA[latestKey]?.[0]?.date?.substring(0, 4)) || '2026';
        const nextYear = latestKey === 'dec' ? String(parseInt(yearOfLatest) + 1) : yearOfLatest;
        MONTH_DATA[nextKey] = MONTH_DATA[nextKey] || [];
        // Persist a marker so the next-cycle month button survives page refresh
        localStorage.setItem('cycle_next_month', JSON.stringify({ key: nextKey, year: nextYear }));
        addMonthButton(nextKey, `${nextKey.charAt(0).toUpperCase() + nextKey.slice(1)} ${nextYear}`);
        detectedKeys.push(nextKey);
        switchMonth(nextKey);
      } else {
        switchMonth(latestKey);
      }

      const monthNames = detectedKeys
        .filter((k, i, a) => a.indexOf(k) === i) // dedupe
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .map(k => k.charAt(0).toUpperCase() + k.slice(1))
        .join(', ');

      showCSVResult(
        `✅ Loaded ${allTransactions.length} transactions across ${detectedKeys.length} month(s): ${monthNames}. Use "💾 Backup" in the sidebar to save permanently.`,
        true
      );
    } catch (err) {
      showCSVResult('Error parsing CSV: ' + err.message, false);
    }
  };
  reader.readAsText(file);
}

function showCSVResult(msg, success) {
  const el = document.getElementById('csvResult');
  el.style.color = success ? '#22c55e' : '#ef4444';
  el.textContent = msg;
}

function parseCSVText(text) {
  // Step 1: Normalize line endings
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').filter(l => l.trim());
  if (rawLines.length < 2) return [];

  // Step 2: Auto-detect header row (scan first 10 rows)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
    const lower = rawLines[i].toLowerCase();
    if (lower.includes('date') && (lower.includes('transaction') || lower.includes('withdrawal') || lower.includes('deposit') || lower.includes('debit'))) {
      headerIdx = i;
      break;
    }
  }

  const headerParts = parseCSVLine(rawLines[headerIdx]);
  const cols = headerParts.map(c => c.trim().toLowerCase().replace(/"/g, ''));

  const idx = {
    date:       cols.findIndex(c => c.includes('date')),
    desc:       cols.findIndex(c => c.includes('transaction') || c.includes('description') || c.includes('narration') || c.includes('particulars') || c.includes('detail')),
    deposit:    cols.findIndex(c => c.includes('deposit') || (c.includes('credit') && !c.includes('card')) || c === 'cr'),
    withdrawal: cols.findIndex(c => c.includes('withdrawal') || c.includes('debit') || c === 'dr'),
    balance:    cols.findIndex(c => c.includes('balance') || c.includes('running')),
  };

  if (idx.date === -1 || idx.desc === -1) {
    throw new Error('Could not find Date or Transaction columns in CSV header.');
  }

  // SC CSV already wraps all Indian-format amounts in quotes (e.g. "1,375.00").
  // Unquoted numeric fields are always plain decimals (e.g. 123, 762.36) with no commas,
  // so the standard CSV parser handles them correctly without any pre-processing.
  const dataLines = rawLines.slice(headerIdx + 1);
  const transactions = [];
  for (let i = 0; i < dataLines.length; i++) {
    const parts = parseCSVLine(dataLines[i]);
    const rawDate    = (parts[idx.date] || '').trim().replace(/"/g, '');
    const desc       = (parts[idx.desc] || '').trim().replace(/"/g, '');
    const deposit    = parseAmount(parts[idx.deposit]);
    const withdrawal = parseAmount(parts[idx.withdrawal]);
    const balance    = parseAmount(parts[idx.balance]);

    // Skip rows without a valid date (e.g. footer/summary rows)
    if (!rawDate || !/\d{2}[\/\-]\d{2}[\/\-]\d{2,4}/.test(rawDate)) continue;
    if (!deposit && !withdrawal) continue;

    const date     = convertDate(rawDate);
    const category = categorize(desc, deposit, withdrawal);
    transactions.push({ date, desc, deposit, withdrawal, balance, category });
  }
  return transactions;
}

function parseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function parseAmount(raw) {
  if (!raw) return 0;
  return parseFloat(raw.toString().replace(/[,\s"]/g, '')) || 0;
}

function convertDate(dateStr) {
  // DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3 && parts[0].length <= 2) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr;
}

// ─── SPENDING INSIGHTS (local, no API needed) ────
function generateAIInsights() {
  const output = document.getElementById('aiInsightsOutput');
  const btn    = document.getElementById('aiInsightsBtn');
  btn.disabled = true;

  const txns    = getTransactions();
  const EXCLUDE = [PASSTHROUGH_CAT, 'Income'];
  const debits  = txns.filter(t => t.withdrawal > 0 && !EXCLUDE.includes(t.category));
  const credits = txns.filter(t => t.deposit > 0   && !EXCLUDE.includes(t.category));

  if (debits.length === 0) {
    output.innerHTML = '<span style="color:var(--muted)">No spending data to analyse for this period.</span>';
    btn.disabled = false;
    return;
  }

  const totalSpent    = debits.reduce((s, t) => s + t.withdrawal, 0);
  const totalReceived = credits.reduce((s, t) => s + t.deposit, 0);

  // Discretionary spend = total minus fixed committed items
  const fixedCats    = ['Loan Repayment', 'Savings'];
  const fixedSpent   = debits.filter(t => fixedCats.includes(t.category)).reduce((s, t) => s + t.withdrawal, 0);
  const discretionary = totalSpent - fixedSpent;
  const savingsRate  = totalReceived > 0 ? ((totalReceived - discretionary) / totalReceived) * 100 : null;

  // Category totals — exclude fixed categories from "top spend" ranking
  const catTotals = {};
  debits.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.withdrawal; });
  const spendingCatTotals = Object.fromEntries(
    Object.entries(catTotals).filter(([cat]) => !fixedCats.includes(cat))
  );
  const sortedCats = Object.entries(spendingCatTotals).sort((a, b) => b[1] - a[1]);
  const topCat     = sortedCats[0];

  // Daily spending — find busiest day (exclude fixed)
  const daily = {};
  debits.forEach(t => {
    if (fixedCats.includes(t.category)) return;
    daily[t.date] = (daily[t.date] || 0) + t.withdrawal;
  });
  const sortedDays    = Object.entries(daily).sort((a, b) => b[1] - a[1]);
  const busiestDay    = sortedDays[0];
  const avgDailySpend = discretionary / Math.max(1, Object.keys(daily).length);

  // Merchant frequency (exclude fixed categories)
  const merchantFreq = {};
  const merchantAmt  = {};
  debits.forEach(t => {
    if (fixedCats.includes(t.category)) return;
    const name = extractMerchant(t.desc);
    merchantFreq[name] = (merchantFreq[name] || 0) + 1;
    merchantAmt[name]  = (merchantAmt[name]  || 0) + t.withdrawal;
  });
  const topByFreq = Object.entries(merchantFreq).sort((a, b) => b[1] - a[1])[0];

  // Food delivery check (Zomato + Swiggy combined)
  const foodDelivery = debits
    .filter(t => /ZOMATO|SWIGGY/i.test(t.desc))
    .reduce((s, t) => s + t.withdrawal, 0);
  const foodDeliveryCount = debits.filter(t => /ZOMATO|SWIGGY/i.test(t.desc)).length;

  // Loan repayments
  const loanTotal = catTotals['Loan Repayment'] || 0;
  const loanPct   = totalSpent > 0 ? (loanTotal / totalSpent) * 100 : 0;

  // Savings tagged
  const savingsTotal = catTotals['Savings'] || 0;

  // Cash withdrawals
  const cashTotal = catTotals['Cash Withdrawal'] || 0;
  const cashPct   = discretionary > 0 ? (cashTotal / discretionary) * 100 : 0;

  // Cycle duration
  const cycleDays = txns.length > 1
    ? Math.max(1, Math.round((new Date(txns[txns.length - 1].date) - new Date(txns[0].date)) / 86400000))
    : 28;

  const insights = [];

  // 1. Top category
  const topCatPct = ((topCat[1] / totalSpent) * 100).toFixed(0);
  insights.push({
    icon: '📊',
    title: 'Biggest spend category',
    text: `<strong>${topCat[0]}</strong> consumed ${fmt(topCat[1])} — <strong>${topCatPct}%</strong> of your total spend this cycle.`,
  });

  // 2. Food delivery habit
  if (foodDeliveryCount > 0) {
    const avgPerOrder = (foodDelivery / foodDeliveryCount).toFixed(0);
    insights.push({
      icon: '🍔',
      title: 'Food delivery habit',
      text: `You ordered food delivery <strong>${foodDeliveryCount} times</strong> spending ${fmt(foodDelivery)} total (avg ₹${avgPerOrder}/order). ${foodDelivery > 3000 ? 'Cooking more often could save you significantly.' : 'Reasonable, but keep an eye on it.'}`,
    });
  }

  // 3. Loan repayments
  if (loanTotal > 0) {
    insights.push({
      icon: '🏦',
      title: 'Loan repayments',
      text: `EMI auto-debits totalled <strong>${fmt(loanTotal)}</strong> — <strong>${loanPct.toFixed(0)}%</strong> of gross spend. This is a fixed committed expense, so your discretionary budget is actually ${fmt(totalSpent - loanTotal)}.`,
    });
  }

  // 4. Cash withdrawal opacity
  if (cashTotal > 0) {
    insights.push({
      icon: '🏧',
      title: 'Cash withdrawals',
      text: `<strong>${fmt(cashTotal)}</strong> (${cashPct.toFixed(0)}% of spend) was withdrawn as cash — this spending is <strong>untracked</strong>. Consider paying digitally so every rupee shows up here.`,
    });
  }

  // 5. Busiest spending day
  if (busiestDay) {
    const d = busiestDay[0];
    const label = `${parseInt(d.slice(8))}/${d.slice(5, 7)}`;
    insights.push({
      icon: '📅',
      title: 'Heaviest spending day',
      text: `Your biggest single-day spend was <strong>${fmt(busiestDay[1])}</strong> on <strong>${label}</strong> — ${(busiestDay[1] / avgDailySpend).toFixed(1)}× your daily average of ${fmt(avgDailySpend)}.`,
    });
  }

  // 6. Most frequent merchant
  if (topByFreq && topByFreq[1] > 1) {
    insights.push({
      icon: '🔁',
      title: 'Most visited merchant',
      text: `<strong>${escapeHTML(topByFreq[0])}</strong> appeared <strong>${topByFreq[1]} times</strong> totalling ${fmt(merchantAmt[topByFreq[0]])}. ${topByFreq[1] >= 5 ? 'Consider if a subscription or bulk deal could save you money.' : ''}`,
    });
  }

  // 7. Savings tagged
  if (savingsTotal > 0) {
    const savingsPct = totalReceived > 0 ? ((savingsTotal / totalReceived) * 100).toFixed(0) : 0;
    insights.push({
      icon: '💹',
      title: 'Tagged savings',
      text: `You moved <strong>${fmt(savingsTotal)}</strong> into savings this cycle — <strong>${savingsPct}%</strong> of income. ${savingsPct >= 20 ? 'On track with the 20% savings goal!' : 'Aim to hit 20% of income for long-term wealth building.'}`,
    });
  }

  // 8. Savings rate
  if (savingsRate !== null) {
    const color  = savingsRate >= 30 ? 'var(--green)' : savingsRate >= 10 ? 'var(--yellow)' : 'var(--red)';
    const remark = savingsRate >= 30 ? 'Great discipline!' : savingsRate >= 10 ? 'Room to improve — aim for 30%.' : 'Discretionary spending is high this cycle — review the top categories above.';
    insights.push({
      icon: '💰',
      title: 'Net savings rate',
      text: `Income ${fmt(totalReceived)}, discretionary spend ${fmt(discretionary)}. Net rate: <strong style="color:${color}">${savingsRate.toFixed(1)}%</strong>. ${remark}`,
    });
  }

  // 8. Actionable tip based on top category
  const tips = {
    'Food & Dining':      'Tip: batch-cook on weekends to cut dining-out costs by 30–40%.',
    'Shopping':           'Tip: add items to your wishlist and wait 48 hours before buying — impulse purchases drop significantly.',
    'Bills & Utilities':  'Tip: audit recurring bills — unused subscriptions are easy money to recover.',
    'Cash Withdrawal':    'Tip: switch to UPI for even small payments so all spending is visible and trackable.',
    'Loan Repayment':     'Tip: list all your active loans with their interest rates — closing the highest-rate one first (avalanche method) saves the most.',
    'Travel & Transport': 'Tip: booking transport or tickets 3–7 days in advance usually saves 15–25%.',
    'Entertainment':      'Tip: share streaming subscriptions with family to halve the cost.',
    'Others':             'Tip: categorise "Others" transactions — hidden spending patterns are often the easiest to cut.',
  };
  const tip = tips[topCat[0]] || 'Tip: review your top 3 categories each month and set a target to reduce one by 10%.';
  insights.push({ icon: '💡', title: 'Action tip', text: tip });

  // Render
  const range = getCycleDateRange(currentMonth);
  const period = range?.start
    ? `${range.start.slice(8)}/${range.start.slice(5,7)} → ${range.end ? range.end.slice(8)+'/'+range.end.slice(5,7) : 'now'}`
    : monthLabel(currentMonth);

  output.innerHTML = `
    <div class="insights-period">Cycle: ${period} · ${cycleDays} days · ${debits.length} transactions</div>
    <div class="insights-grid">
      ${insights.map(ins => `
        <div class="insight-card">
          <div class="insight-icon">${ins.icon}</div>
          <div>
            <div class="insight-title">${ins.title}</div>
            <div class="insight-text">${ins.text}</div>
          </div>
        </div>
      `).join('')}
    </div>`;

  btn.disabled = false;
}

// ─── SMS PARSER ──────────────────────────────────
function convertSMSDate(dateStr) {
  // Handles DD-Mon-YYYY (05-Jan-2026) and DD/MM/YYYY and DD-MM-YYYY
  const MON = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const parts = dateStr.split(/[-\/]/);
  if (parts.length === 3 && parts[0].length <= 2) {
    const month = MON[parts[1].toLowerCase()] || parts[1].padStart(2, '0');
    return `${parts[2]}-${month}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr;
}

function parseSMS() {
  const text = document.getElementById('smsInput').value.trim();
  if (!text) return;

  const result = document.getElementById('parseResult');
  result.textContent = 'Parsing...';

  const lines = text.split('\n').filter(l => l.trim());
  const imported = [];

  lines.forEach(line => {
    const amtMatch    = line.match(/(?:Rs\.?|INR)\s*([\d,]+\.?\d*)/i);
    const dateMatch   = line.match(/(\d{2}[-\/]\w{3}[-\/]\d{4}|\d{2}[-\/]\d{2}[-\/]\d{4})/);
    const debitMatch  = /debited|debit|paid|withdrawal|spent/i.test(line);
    const creditMatch = /credited|credit|received|deposit/i.test(line);

    if (amtMatch && dateMatch) {
      const amount     = parseFloat(amtMatch[1].replace(/,/g, ''));
      const date       = convertSMSDate(dateMatch[1]);
      const deposit    = (creditMatch && !debitMatch) ? amount : 0;
      const withdrawal = (debitMatch || (!creditMatch && amount > 0)) ? amount : 0;
      const category   = categorize(line, deposit, withdrawal);
      imported.push({ date, desc: line.substring(0, 120), deposit, withdrawal, balance: 0, category });
    }
  });

  if (imported.length === 0) {
    result.style.color = '#ef4444';
    result.textContent = '❌ No transactions found. Make sure SMS contains amount (Rs.200) and date.';
    return;
  }

  // Group by month and merge into MONTH_DATA
  const byMonth = {};
  imported.forEach(t => {
    const key = MONTH_KEY_MAP[t.date.substring(5, 7)];
    if (key) (byMonth[key] = byMonth[key] || []).push(t);
  });

  Object.entries(byMonth).forEach(([key, txns]) => {
    MONTH_DATA[key] = (MONTH_DATA[key] || []).concat(txns);
    saveMonthToStorage(key, MONTH_DATA[key]);
    const year = txns[0].date.substring(0, 4);
    addMonthButton(key, `${key.charAt(0).toUpperCase() + key.slice(1)} ${year}`);
  });

  const monthsAdded = Object.keys(byMonth).join(', ');
  result.style.color = '#22c55e';
  result.textContent = `✅ Imported ${imported.length} transaction(s) into ${monthsAdded}. Switch to that month in the sidebar to view.`;
}
