/**
 * AI Visitor Bot — Dashboard Frontend
 */

const socket = io();
let agentMap = {};  // agentId -> card DOM

// ══════════════════════════════════════════════════════════
// CLOCK
// ══════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toTimeString().substring(0, 8);
}
setInterval(updateClock, 1000);
updateClock();

// ══════════════════════════════════════════════════════════
// SOCKET EVENTS
// ══════════════════════════════════════════════════════════
socket.on('connect', () => {
  document.getElementById('serverStatus').innerHTML =
    '<span class="dot"></span> Connected';
  document.getElementById('serverStatus').style.color = '';
  addLog('🟢 Connected to server', 'info');
  // Restore the proxy table for a fresh/reconnected client
  loadProxyList();
});

socket.on('disconnect', () => {
  document.getElementById('serverStatus').innerHTML =
    '<span class="dot" style="background:#ff5572;box-shadow:0 0 6px #ff5572"></span> Disconnected';
  addLog('🔴 Disconnected from server', 'error');
});

socket.on('stats', (data) => {
  if (data.pool) updatePoolStats(data.pool);
  if (data.proxy) updateProxyStats(data.proxy);
});

socket.on('visitComplete', (r) => {
  addLog(`✅ Visit done → ${r.url} via ${r.referral || 'Direct'} (${Math.round((r.duration||0)/1000)}s)`, 'success');
  updateAgentCard(r.agentId, 'done', r.url);
});

socket.on('visitError', (r) => {
  addLog(`❌ Visit failed → ${r.url || r.agentId}: ${r.error || ''}`, 'error');
  if (r.agentId) updateAgentCard(r.agentId, 'error');
});

socket.on('agentStart', (r) => {
  createAgentCard(r.agentId, r.url);
  addLog(`🚀 Agent ${r.agentId} started → ${r.url}`, 'info');
});

socket.on('agentEnd', (agentId) => {
  setTimeout(() => removeAgentCard(agentId), 2000);
});

socket.on('proxyStatus', (data) => {
  const phase = document.getElementById('proxyPhase');
  const progress = document.getElementById('proxyProgress');
  const fill = document.getElementById('proxyProgressFill');

  if (data.phase === 'grabbing') {
    phase.textContent = '🔍 Grabbing proxies from sources...';
    progress.style.display = 'block';
    fill.style.width = '30%';
  } else if (data.phase === 'checking') {
    const pct = data.total ? Math.round((data.done / data.total) * 100) : 45;
    phase.textContent = `🔄 Checking proxies... ${data.done || 0}/${data.total || ''}`;
    progress.style.display = 'block';
    fill.style.width = `${Math.min(95, pct)}%`;
  } else if (data.phase === 'grabbed') {
    phase.textContent = `✅ Grabbed ${data.count} proxies — Now checking...`;
    fill.style.width = '60%';
    addLog(`🌐 Grabbed ${data.count} proxies`, 'proxy');
  } else if (data.phase === 'checked') {
    phase.textContent = `✅ ${data.count} working proxies ready!`;
    fill.style.width = '100%';
    setTimeout(() => { progress.style.display = 'none'; }, 2000);
    addLog(`✅ ${data.count} working proxies`, 'proxy');
    loadProxyList();
  }
});

// ══════════════════════════════════════════════════════════
// POOL STATS
// ══════════════════════════════════════════════════════════
function updatePoolStats(pool) {
  setText('statVisits',  pool.totalVisits);
  setText('statRunning', pool.running);
  setText('statQueued',  pool.queued);
  setText('statSuccess', (pool.successRate || 0) + '%');
  setText('statErrors',  pool.totalErrors);
  setText('agentCount',  `${pool.running} active`);

  // Update agent cards from pool data
  if (pool.agents) {
    pool.agents.forEach(a => {
      if (agentMap[a.agentId]) {
        updateAgentCard(a.agentId, a.status, a.currentUrl, a.proxy, a.visitCount, a.browser, a.platform);
      } else {
        createAgentCard(a.agentId, a.currentUrl, a.proxy);
        updateAgentCard(a.agentId, a.status, a.currentUrl, a.proxy, a.visitCount, a.browser, a.platform);
      }
    });
  }

  // Update button states
  const running = pool.isRunning || pool.running > 0;
  document.getElementById('startBtn').disabled = running;
  document.getElementById('pauseBtn').disabled = !running;
  document.getElementById('stopBtn').disabled = !running;
}

function updateProxyStats(proxy) {
  setText('pTotal',   proxy.total || 0);
  setText('pWorking', proxy.working || 0);
  setText('pFailed',  proxy.failed || 0);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = val;
}

// ══════════════════════════════════════════════════════════
// AGENT CARDS
// ══════════════════════════════════════════════════════════
function createAgentCard(agentId, url = '', proxy = '') {
  if (agentMap[agentId]) return;

  const grid = document.getElementById('agentGrid');
  const empty = grid.querySelector('.agent-empty');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'agent-card';
  card.id = `agent-${agentId}`;
  card.innerHTML = `
    <div class="agent-id" id="id-${agentId}">🤖 ${agentId}</div>
    <div class="agent-status idle" id="status-${agentId}">◎ Initializing</div>
    <div class="agent-url" id="url-${agentId}">${url || '...'}</div>
    <div class="agent-proxy" id="proxy-${agentId}">${proxy || 'Assigning proxy...'}</div>
    <div class="agent-visits" id="visits-${agentId}">0 visits</div>
  `;
  grid.appendChild(card);
  agentMap[agentId] = card;
}

function updateAgentCard(agentId, status, url, proxy, visits, browser, platform) {
  const card = agentMap[agentId];
  if (!card) return;

  card.className = `agent-card ${status || ''}`;

  const statusEl = document.getElementById(`status-${agentId}`);
  if (statusEl) {
    const icons = { idle: '◎', browsing: '🔄', visiting: '👁', done: '✅', error: '❌' };
    const labels = { idle: 'Idle', browsing: 'Browsing History', visiting: 'Visiting Target', done: 'Done', error: 'Error' };
    statusEl.className = `agent-status ${status}`;
    statusEl.textContent = `${icons[status] || '◎'} ${labels[status] || status}`;
  }

  // Show the browser fingerprint (e.g. "chrome / MacIntel") when known
  if (browser) {
    const idEl = document.getElementById(`id-${agentId}`);
    if (idEl) {
      const platformIcons = { Win32: '🪟', MacIntel: '🍎', 'Linux x86_64': '🐧', Android: '🤖', iPhone: '📱', iPad: '📲' };
      const browserIcons = { chrome: '🌐', edge: '🧭', opera: '🎭', brave: '🦁', safari: '🧭' };
      idEl.textContent = `${browserIcons[browser] || '🌐'} ${browser} / ${platform || '?'}`;
    }
  }

  if (url) {
    const urlEl = document.getElementById(`url-${agentId}`);
    if (urlEl) urlEl.textContent = url;
  }

  if (proxy) {
    const proxyEl = document.getElementById(`proxy-${agentId}`);
    if (proxyEl) proxyEl.textContent = `🔌 ${proxy}`;
  }

  if (visits !== undefined) {
    const visitEl = document.getElementById(`visits-${agentId}`);
    if (visitEl) visitEl.textContent = `${visits} visits`;
  }
}

function removeAgentCard(agentId) {
  const card = agentMap[agentId];
  if (!card) return;
  card.style.opacity = '0';
  card.style.transform = 'scale(0.9)';
  card.style.transition = 'all 0.3s';
  setTimeout(() => {
    card.remove();
    delete agentMap[agentId];
    const grid = document.getElementById('agentGrid');
    if (grid.children.length === 0) {
      grid.innerHTML = '<div class="agent-empty">No agents running. Start a job to begin.</div>';
    }
  }, 300);
}

// ══════════════════════════════════════════════════════════
// JOB CONTROLS
// ══════════════════════════════════════════════════════════
async function startJob() {
  const url = document.getElementById('targetUrl').value.trim();
  if (!url) { showToast('❌ Please enter a target URL', 'error'); return; }

  const visits      = parseInt(document.getElementById('visitCount').value) || 10;
  const maxAgents   = parseInt(document.getElementById('maxAgents').value) || 3;
  const minDuration = parseInt(document.getElementById('minDuration').value) || 15;
  const maxDuration = parseInt(document.getElementById('maxDuration').value) || 90;
  const buildHistory = document.getElementById('buildHistory').checked;
  const useProxy     = document.getElementById('useProxy').checked;
  const autoClickInternal = document.getElementById('autoClickInternal').checked;
  const autoClickExternal = document.getElementById('autoClickExternal').checked;
  const clickRaw    = document.getElementById('clickSelectors').value.trim();
  const clickSelectors = clickRaw ? clickRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];

  addLog(`🚀 Starting job: ${url} × ${visits} visits with ${maxAgents} agents`, 'info');

  try {
    const res = await fetch('/api/visit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, visits, maxAgents, buildHistory, useProxy, autoClickInternal, autoClickExternal, minDuration, maxDuration, clickSelectors }),
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`✅ Job started: ${visits} visits`, 'success');
    } else {
      showToast(`❌ ${data.error}`, 'error');
      addLog(`❌ Job failed: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`❌ Request failed: ${e.message}`, 'error');
  }
}

async function pauseJob() {
  await fetch('/api/visit/pause', { method: 'POST' });
  showToast('⏸️ Job paused', 'info');
  addLog('⏸️ Job paused', 'info');
}

async function stopJob() {
  await fetch('/api/visit/stop', { method: 'POST' });
  showToast('⏹️ Job stopped', 'info');
  addLog('⏹️ Job stopped', 'info');
  agentMap = {};
  const grid = document.getElementById('agentGrid');
  grid.innerHTML = '<div class="agent-empty">No agents running. Start a job to begin.</div>';
}

// ══════════════════════════════════════════════════════════
// PROXY
// ══════════════════════════════════════════════════════════
async function grabProxies() {
  const btn = document.getElementById('grabProxyBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Grabbing...';

  const manualRaw = document.getElementById('manualProxies').value.trim();
  const manualProxies = manualRaw ? manualRaw.split('\n').map(p => p.trim()).filter(Boolean) : [];

  addLog('🔍 Starting proxy grab from free sources...', 'proxy');

  try {
    const res = await fetch('/api/proxy/grab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualProxies }),
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`✅ ${data.working} working proxies ready`, 'success');
      addLog(`🌐 Grab done: ${data.total} total, ${data.working} working`, 'proxy');
    } else {
      showToast(`❌ ${data.error || 'Grab failed'}`, 'error');
      addLog(`❌ Proxy grab failed: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`❌ Request failed: ${e.message}`, 'error');
    addLog(`❌ Proxy grab request failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> Grab + Check';
  }
  loadProxyList();
}

async function checkManualProxies() {
  const raw = document.getElementById('manualProxies').value.trim();
  const proxies = raw ? raw.split('\n').map(p => p.trim()).filter(Boolean) : [];
  if (proxies.length === 0) { showToast('❌ No proxies to check', 'error'); return; }

  addLog(`🔄 Checking ${proxies.length} manual proxies...`, 'proxy');
  try {
    const res = await fetch('/api/proxy/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxies }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`✅ ${data.working} working proxies`, 'success');
    } else {
      showToast(`❌ ${data.error || 'Check failed'}`, 'error');
    }
  } catch (e) {
    showToast(`❌ Request failed: ${e.message}`, 'error');
  }
  loadProxyList();
}

async function loadProxyList() {
  const res = await fetch('/api/proxy/list');
  const data = await res.json();
  const tbody = document.getElementById('proxyTableBody');

  if (!data.working || data.working.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No proxies loaded. Click "Grab + Check"</td></tr>';
    return;
  }

  tbody.innerHTML = data.working.slice(0, 50).map((p, i) => {
    const latencyClass = p.latency < 2000 ? 'fast' : p.latency < 5000 ? 'medium' : 'slow';
    return `<tr>
      <td>${i + 1}</td>
      <td>${p.proxy}</td>
      <td>${p.ip || '—'}</td>
      <td><span class="latency-badge ${latencyClass}">${p.latency}ms</span></td>
      <td><span style="color:var(--green)">✅ Working</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// LOG
// ══════════════════════════════════════════════════════════
function addLog(message, type = 'info') {
  const container = document.getElementById('logContainer');
  const now = new Date().toTimeString().substring(0, 8);
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${now}</span>
    <span class="log-msg ${type}">${message}</span>
  `;
  container.prepend(entry);

  // Keep max 200 entries
  while (container.children.length > 200) {
    container.removeChild(container.lastChild);
  }
}

function clearLog() {
  document.getElementById('logContainer').innerHTML = '';
  fetch('/api/history/clear', { method: 'POST' });
}

// ══════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
addLog('🤖 AI Visitor Bot dashboard ready', 'info');
addLog('💡 Enter a URL and click Start to begin', 'info');
