// ─── FINAI — AI Finance Manager ──────────────────────────────────────────────
const FINAI_KEY_STORE  = 'finai_gemini_key';
const FINAI_CHAT_STORE = 'finai_chat_history';
const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-001',
  'gemini-1.5-pro-latest',
  'gemini-pro',
];
let activeGeminiModel = localStorage.getItem('finai_model') || null;

let finaiHistory = []; // {role, text} pairs for display
let geminiHistory = []; // {role, parts} for API

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initFinAI() {
  const key = localStorage.getItem(FINAI_KEY_STORE);
  if (!key) {
    document.getElementById('finaiKeySetup').style.display = 'block';
    document.getElementById('finaiChatArea').style.display = 'none';
  } else {
    document.getElementById('finaiKeySetup').style.display = 'none';
    document.getElementById('finaiChatArea').style.display  = 'flex';
    loadFinAIHistory();
    if (finaiHistory.length === 0) showWelcome();
    showSuggestions();
  }
}

function saveFinAIKey() {
  const key = document.getElementById('finaiKeyInput').value.trim();
  if (!key) { alert('Please enter an API key.'); return; }
  localStorage.setItem(FINAI_KEY_STORE, key);
  initFinAI();
}

function resetFinAIKey() {
  localStorage.removeItem(FINAI_KEY_STORE);
  initFinAI();
}

// ─── WELCOME ──────────────────────────────────────────────────────────────────
function showWelcome() {
  appendMessage('finai', `Hi! 👋 I'm **FinAI**, your personal finance manager.\n\nI can use the data available in this app, including:\n- 💰 Monthly income & spending\n- 🏛️ Assets & liabilities\n- 📈 Stocks / RSU entries\n\nAsk me anything about budgeting, loans, investments, savings goals, or tax planning.`);
}

// ─── SUGGESTIONS ──────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Should I take a car loan?',
  'Suggest a good term insurance plan',
  'How much can I invest monthly?',
  'Am I saving enough?',
  'When will my home loan end?',
  'How is my net worth growing?',
  'Should I prepay my home loan?',
  'How much tax will I pay this year?',
];

function showSuggestions() {
  const el = document.getElementById('finaiSuggestions');
  // Show 4 random suggestions
  const picks = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4);
  el.innerHTML = picks.map(s =>
    `<button class="finai-suggestion" onclick="askSuggestion('${s}')">${s}</button>`
  ).join('');
}

function askSuggestion(text) {
  document.getElementById('finaiInput').value = text;
  sendToFinAI();
}

// ─── CONTEXT BUILDER ─────────────────────────────────────────────────────────
function buildFinancialContext() {
  const lines = [];
  const todayDate = new Date();
  lines.push(`Today's date: ${todayDate.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`);
  lines.push('User profile: Not provided. Use only data present in this app.');

  // ── Monthly finances with category breakdown ──
  try {
    const months = Object.keys(MONTH_DATA).filter(m => MONTH_DATA[m]?.length > 0);
    const recentMonths = months.slice(-3);
    lines.push(`\n## Monthly Finances (last ${recentMonths.length} months)`);
    recentMonths.forEach(m => {
      const txns = MONTH_DATA[m];
      const income  = txns.filter(t => t.deposit > 0 && t.category !== 'Pass-through').reduce((s,t) => s+t.deposit, 0);
      const spent   = txns.filter(t => t.withdrawal > 0 && t.category !== 'Pass-through').reduce((s,t) => s+t.withdrawal, 0);
      const savings = txns.filter(t => t.category === 'Savings').reduce((s,t) => s+t.withdrawal+t.deposit, 0);
      lines.push(`\n### ${m}`);
      lines.push(`Income: ₹${Math.round(income).toLocaleString('en-IN')}, Total Spent: ₹${Math.round(spent).toLocaleString('en-IN')}, Savings: ₹${Math.round(savings).toLocaleString('en-IN')}`);
      // Category breakdown
      const catMap = {};
      txns.filter(t => t.withdrawal > 0 && t.category !== 'Pass-through' && t.category !== 'Savings').forEach(t => {
        catMap[t.category] = (catMap[t.category] || 0) + t.withdrawal;
      });
      const cats = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
      if (cats.length > 0) {
        lines.push(`Spending by category: ` + cats.map(([c,v]) => `${c} ₹${Math.round(v).toLocaleString('en-IN')}`).join(', '));
      }
      // Top 5 transactions
      const topTxns = [...txns].filter(t => t.withdrawal > 0 && t.category !== 'Pass-through').sort((a,b) => b.withdrawal - a.withdrawal).slice(0, 5);
      if (topTxns.length > 0) {
        lines.push(`Top spends: ` + topTxns.map(t => `${t.description||t.narration||'?'} ₹${Math.round(t.withdrawal).toLocaleString('en-IN')} (${t.category})`).join('; '));
      }
    });
  } catch(_) {}

  // ── Assets ──
  try {
    const goldPrice = assetsData.gold.lastLivePrice || GOLD_PRICE_FALLBACK;
    const gold    = assetsData.gold.grams * goldPrice;
    const fd      = assetsData.fd.reduce((s,f) => s + calcFDCurrentValue(f), 0);
    const rd      = assetsData.rd.reduce((s,r) => s + calcRDCurrentValue(r), 0);
    const pf      = assetsData.pf.balance;
    const house   = assetsData.houses.reduce((s,h) => s + h.currentValue, 0);
    const lic     = assetsData.lic.reduce((s,l) => s + (l.currentValue||0), 0);
    const rsu     = calcRSUValue();
    const totalA  = gold + fd + rd + pf + house + lic + rsu;
    lines.push(`\n## Assets (Total: ₹${fmt2(totalA)})`);

    // Properties
    lines.push(`\n### Real Estate (Total: ₹${fmt2(house)})`);
    assetsData.houses.forEach(h => {
      lines.push(`- ${h.name}: ₹${fmt2(h.currentValue)} (${h.builtUpSqft} sqft @ ₹${h.ratePerSqft}/sqft, purchased ${h.purchaseYear})`);
    });

    // RSU
    lines.push(`\n### RSU Stocks: ₹${fmt2(rsu)}`);

    // PF
    lines.push(`\n### Provident Fund: ₹${fmt2(pf)} (last updated ${assetsData.pf.lastUpdated})`);

    // FD
    if (assetsData.fd.length > 0) {
      lines.push(`\n### Fixed Deposits (Total current value: ₹${fmt2(fd)})`);
      assetsData.fd.forEach(f => {
        lines.push(`- ${f.bank}: Principal ₹${f.principal.toLocaleString('en-IN')}, Rate ${f.ratePercent}%, Maturity ${f.maturityDate}, Maturity value ₹${f.maturityValue?.toLocaleString('en-IN')}`);
      });
    }

    // RD
    if (assetsData.rd.length > 0) {
      lines.push(`\n### Recurring Deposits (Total current value: ₹${fmt2(rd)})`);
      assetsData.rd.forEach(r => {
        lines.push(`- ${r.bank} (${r.plan}): ₹${r.monthlyInstallment.toLocaleString('en-IN')}/month, Rate ${r.ratePercent}%, Maturity ${r.maturityDate}, Maturity value ₹${r.maturityValue?.toLocaleString('en-IN')}`);
      });
    }

    // Gold
    lines.push(`\n### Gold: ${assetsData.gold.grams}g (22K), current price ₹${goldPrice.toLocaleString('en-IN')}/g, total ₹${fmt2(gold)}`);
  } catch(_) {}

  // ── Liabilities ──
  try {
    const pl = liabilitiesData.personalLoans.reduce((s,p) => s + calcPLOutstanding(p), 0);
    const hl = calcHomeLoanOutstanding(liabilitiesData.homeLoan);
    lines.push(`\n## Liabilities (Total: ₹${fmt2(pl+hl)})`);

    // Home loan
    const loan = liabilitiesData.homeLoan;
    if (hl > 0) {
      lines.push(`\n### Home Loan`);
      lines.push(`- Original amount: ₹${fmt2(loan.originalAmount)}, Outstanding: ₹${fmt2(hl)}`);
      lines.push(`- EMI: ₹${loan.actualEmi?.toLocaleString('en-IN')}/month on day ${loan.emiDate}, Rate: ${loan.ratePercent}% p.a.`);
      lines.push(`- Loan start: ${loan.loanSanctionDate}, First EMI: ${loan.firstEmiDate}`);
      if (loan.prepayments?.length > 0) {
        lines.push(`- Prepayments made: ` + loan.prepayments.map(p => `₹${p.amount?.toLocaleString('en-IN')} on ${p.date}`).join(', '));
      }
    }

    // Personal loans
    if (liabilitiesData.personalLoans.length > 0) {
      lines.push(`\n### Personal Loans`);
      liabilitiesData.personalLoans.forEach(p => {
        const outstanding = calcPLOutstanding(p);
        lines.push(`- ${p.lender} (A/c ${p.accountNo}): Outstanding ₹${fmt2(outstanding)}, EMI ₹${p.emiMonthly?.toLocaleString('en-IN')}/month, Rate ${p.ratePercent}%, ends ${p.endDate}, ${p.emisRemaining} EMIs left`);
      });
    }
  } catch(_) {}

  // ── RSU Stocks detail ──
  try {
    const ratePerStock = stockData.stockPrice * stockData.usdInr;
    lines.push(`\n## RSU Stocks Detail`);
    lines.push(`- Stock price: $${stockData.stockPrice}, USD/INR: ${stockData.usdInr}, rate per stock: ₹${Math.round(ratePerStock).toLocaleString('en-IN')}`);
    if ((stockData.preholding || 0) > 0) {
      lines.push(`- Pre-held stocks: ${stockData.preholding} = ₹${fmt2(stockData.preholding * ratePerStock)}`);
    }
    const vested = stockData.vestings.filter(v => new Date(v.date) <= todayDate);
    const upcoming = stockData.vestings.filter(v => new Date(v.date) > todayDate);
    if (vested.length > 0) {
      const totalVested = vested.reduce((s,v) => s + (v.toPreserve || Math.round(v.stocks * (1 - (v.taxPct||35)/100))), 0);
      lines.push(`- Already vested (net): ${totalVested} stocks`);
    }
    if (upcoming.length > 0) {
      lines.push(`- Upcoming vesting (${upcoming.length} events):`);
      upcoming.forEach(v => {
        const net = v.toPreserve ?? Math.round(v.stocks * (1 - (v.taxPct||35)/100));
        lines.push(`  • ${v.date}: ${v.stocks} gross → ${net} net = ₹${fmt2(net * ratePerStock)} (${v.grant})`);
      });
    }
  } catch(_) {}

  // ── LIC ──
  try {
    assetsData.lic.forEach(p => {
      lines.push(`\n## LIC Policy — ${p.plan}`);
      lines.push(`- Policy No: ${p.policyNo}, Term: ${p.policyTerm} years (${p.commencementDate} to ${p.maturityDate})`);
      lines.push(`- Sum Assured: ₹${p.sumAssured.toLocaleString('en-IN')}, Bonus accrued so far: ₹${p.bonusAccrued.toLocaleString('en-IN')}`);
      lines.push(`- Current value: ₹${(p.currentValue||0).toLocaleString('en-IN')} (SA + bonus)`);
      lines.push(`- Premium: ₹${p.instalmentPremium.toLocaleString('en-IN')} ${p.premiumMode}, Next due: ${p.nextDueDate}`);
      const yearsLeft = ((new Date(p.maturityDate) - todayDate) / (365.25*24*3600*1000)).toFixed(1);
      lines.push(`- Years to maturity: ${yearsLeft}, Conservative maturity value: ₹${(p.sumAssured + p.bonusAccrued).toLocaleString('en-IN')}+`);
    });
  } catch(_) {}

  return lines.join('\n');
}

function fmt2(n) {
  if (n >= 1e7) return (n/1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return (n/1e5).toFixed(2) + ' L';
  return n.toLocaleString('en-IN');
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendToFinAI() {
  const input = document.getElementById('finaiInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  document.getElementById('finaiSuggestions').innerHTML = '';
  appendMessage('user', text);

  const btn = document.getElementById('finaiSendBtn');
  btn.disabled = true;
  btn.textContent = '…';

  const typingId = appendTyping();

  try {
    const reply = await callGemini(text);
    removeTyping(typingId);
    appendMessage('finai', reply);
    saveFinAIHistory();
  } catch(e) {
    removeTyping(typingId);
    appendMessage('finai', `⚠️ Error: ${e.message}. Check your API key or try again.`);
  }

  btn.disabled = false;
  btn.textContent = 'Send';
  scrollChat();
}

function detectProvider(key) {
  if (key.startsWith('sk-'))  return 'openai';
  if (key.startsWith('gsk_')) return 'groq';
  return 'gemini';
}

async function callGemini(userText) {
  const key      = localStorage.getItem(FINAI_KEY_STORE);
  const provider = detectProvider(key);
  console.log('FinAI provider:', provider, '| key prefix:', key?.slice(0, 8));

  const systemPrompt = `You are FinAI, a sharp and friendly personal finance manager. You have the user's real financial data below from this app. Always use this data to give specific, personalized answers when possible.

Rules:
- Always cite actual numbers (balances, EMIs, dates, amounts) from context in your answer
- Do maths when needed — calculate loan tenure, net worth growth, tax estimates, etc.
- Use Indian context: INR, Indian tax slabs (old/new regime), PPF, NPS, ELSS, SIP, Section 80C/80D
- Be concise and direct — use bullet points or short sections
- If you don't have enough data to answer precisely, say what you'd need

FINANCIAL DATA:
${buildFinancialContext()}`;

  // ── OpenAI / Groq (OpenAI-compatible) ──
  if (provider === 'openai' || provider === 'groq') {
    const url   = provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
    const model = provider === 'openai' ? 'gpt-4o-mini' : 'meta-llama/llama-4-scout-17b-16e-instruct';

    // Build messages array (OpenAI format)
    const messages = [{ role: 'system', content: systemPrompt }];
    geminiHistory.forEach(m => messages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.parts[0].text
    }));
    messages.push({ role: 'user', content: userText });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const reply = data.choices?.[0]?.message?.content || 'No response.';
    geminiHistory.push({ role: 'user',  parts: [{ text: userText }] });
    geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
    return reply;
  }

  // ── Gemini ──
  geminiHistory.push({ role: 'user', parts: [{ text: userText }] });
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: geminiHistory,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
  };
  const modelsToTry = activeGeminiModel ? [activeGeminiModel] : GEMINI_MODELS;
  let lastErr = '';
  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 404 || res.status === 400) { const e = await res.json(); lastErr = e.error?.message || `HTTP ${res.status}`; continue; }
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
    activeGeminiModel = model;
    localStorage.setItem('finai_model', model);
    geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
    return reply;
  }
  throw new Error(`No working model found. Last error: ${lastErr}`);
}

// ─── CHAT RENDERING ───────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const el = document.getElementById('finaiMessages');
  const div = document.createElement('div');
  div.className = `finai-msg finai-msg--${role}`;
  div.innerHTML = `
    ${role === 'finai' ? '<div class="finai-avatar">✨</div>' : ''}
    <div class="finai-bubble">${renderMarkdown(text)}</div>
  `;
  el.appendChild(div);
  finaiHistory.push({ role, text });
  scrollChat();
  return div;
}

function appendTyping() {
  const el  = document.getElementById('finaiMessages');
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'finai-msg finai-msg--finai';
  div.id = id;
  div.innerHTML = `<div class="finai-avatar">✨</div><div class="finai-bubble finai-typing"><span></span><span></span><span></span></div>`;
  el.appendChild(div);
  scrollChat();
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

function scrollChat() {
  const el = document.getElementById('finaiMessages');
  el.scrollTop = el.scrollHeight;
}

// Basic markdown: bold, bullet lists, line breaks
function renderMarkdown(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3}\s(.+)$/gm, '<div class="finai-md-h">$1</div>')
    .replace(/^[-•]\s(.+)$/gm, '<div class="finai-md-li">$1</div>')
    .replace(/\n/g, '<br>');
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function saveFinAIHistory() {
  // Keep last 40 messages
  const trimmed = finaiHistory.slice(-40);
  localStorage.setItem(FINAI_CHAT_STORE, JSON.stringify(trimmed));
}

function loadFinAIHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(FINAI_CHAT_STORE) || '[]');
    finaiHistory = [];
    geminiHistory = [];
    saved.forEach(m => {
      appendMessage(m.role, m.text);
      if (m.role === 'user')  geminiHistory.push({ role: 'user',  parts: [{ text: m.text }] });
      if (m.role === 'finai') geminiHistory.push({ role: 'model', parts: [{ text: m.text }] });
    });
  } catch(_) { finaiHistory = []; geminiHistory = []; }
}

function clearFinAIChat() {
  finaiHistory = [];
  geminiHistory = [];
  localStorage.removeItem(FINAI_CHAT_STORE);
  document.getElementById('finaiMessages').innerHTML = '';
  showWelcome();
  showSuggestions();
}
