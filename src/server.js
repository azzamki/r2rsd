/**
 * Express + Socket.IO Server
 * Serves the dashboard and handles API calls
 */
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');
const proxyManager = require('./proxy/proxyManager');
const AgentPool = require('./agent/agentPool');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let agentPool = new AgentPool(config.bot.maxAgents);
let jobHistory = [];

// Real-time stats broadcast
const broadcastStats = () => {
  io.emit('stats', {
    pool: agentPool.getStatus(),
    proxy: proxyManager.getStats(),
    jobHistory: jobHistory.slice(-50),
    timestamp: Date.now(),
  });
};

setInterval(broadcastStats, 1500);

// Attach pool event forwarding ONCE for the current pool.
// Call this whenever a new pool is created so we never register
// duplicate listeners (which double-counted every visit in jobHistory).
function attachPoolListeners(pool) {
  // Remove any listeners left over from a previous pool
  pool.removeAllListeners();

  pool.on('visitComplete', (r) => {
    jobHistory.push({ ...r, type: 'success', ts: Date.now() });
    io.emit('visitComplete', r);
    broadcastStats();
  });
  pool.on('visitError', (r) => {
    jobHistory.push({ ...r, type: 'error', ts: Date.now() });
    io.emit('visitError', r);
    broadcastStats();
  });
  pool.on('agentStart', (r) => io.emit('agentStart', r));
  pool.on('agentEnd', (id) => io.emit('agentEnd', id));
  pool.on('stopped', () => broadcastStats());
}

attachPoolListeners(agentPool);

// ══════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════

// ── Status ──
app.get('/api/status', (req, res) => {
  res.json({
    pool: agentPool.getStatus(),
    proxy: proxyManager.getStats(),
  });
});

// ── Start visit job ──
app.post('/api/visit/start', async (req, res) => {
  const {
    url,
    visits = 1,
    maxAgents = config.bot.maxAgents,
    buildHistory = true,
    minDuration,
    maxDuration,
    clickSelectors = [],
    useProxy = true,
    autoClickInternal = true,
    autoClickExternal = true,
  } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Reject if a job is currently running
  if (agentPool.isRunning) {
    return res.status(409).json({ error: 'A job is already running. Stop it first.' });
  }

  agentPool = new AgentPool(maxAgents);
  attachPoolListeners(agentPool);

  const options = {
    buildHistory,
    clickSelectors,
    useProxy,
    autoClickInternal,
    autoClickExternal,
    ...(minDuration && { minDuration: minDuration * 1000 }),
    ...(maxDuration && { maxDuration: maxDuration * 1000 }),
  };

  logger.info(`🎯 New job: ${url} × ${visits} visits | ${maxAgents} agents | proxy: ${useProxy ? 'on' : 'off'} | autoClick: internal=${autoClickInternal}, external=${autoClickExternal}`);
  res.json({ status: 'started', url, visits, maxAgents });

  // Run async
  agentPool.addTask(url, options, visits);
  agentPool.start().catch(e => logger.error('Pool error:', e));
});

// ── Pause / Resume / Stop ──
app.post('/api/visit/pause', (req, res) => {
  agentPool.pause();
  res.json({ status: 'paused' });
});

app.post('/api/visit/resume', (req, res) => {
  agentPool.resume();
  res.json({ status: 'resumed' });
});

app.post('/api/visit/stop', async (req, res) => {
  await agentPool.stop();
  res.json({ status: 'stopped' });
});

// ── Proxy: Grab ──
app.post('/api/proxy/grab', async (req, res) => {
  const { manualProxies = [] } = req.body;
  io.emit('proxyStatus', { phase: 'grabbing' });

  proxyManager.once('grabbed', (count) => io.emit('proxyStatus', { phase: 'grabbed', count }));
  proxyManager.once('checked', (count) => io.emit('proxyStatus', { phase: 'checked', count }));

  const onProgress = (p) => io.emit('proxyStatus', { phase: 'checking', ...p });
  proxyManager.on('checkProgress', onProgress);
  proxyManager.once('checked', () => proxyManager.off('checkProgress', onProgress));

  try {
    const working = await proxyManager.initialize(manualProxies);
    res.json({
      total: proxyManager.proxies.length,
      working: working.length,
      list: working.slice(0, 100),
    });
  } catch (e) {
    logger.error('Proxy grab failed:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    proxyManager.off('checkProgress', onProgress);
  }
});

// ── Proxy: Check only ──
app.post('/api/proxy/check', async (req, res) => {
  const { proxies = [] } = req.body;
  io.emit('proxyStatus', { phase: 'checking' });

  const onProgress = (p) => io.emit('proxyStatus', { phase: 'checking', ...p });
  proxyManager.on('checkProgress', onProgress);
  proxyManager.once('checked', () => proxyManager.off('checkProgress', onProgress));

  try {
    let working;
    if (proxies.length > 0) {
      // Validate ONLY the caller-supplied list (fast), then merge the
      // survivors into the pool. Avoids re-checking thousands of proxies.
      const cleaned = proxies
        .map(p => String(p || '').trim())
        .filter(p => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$/.test(p));
      proxyManager.addProxies(cleaned);
      working = await proxyManager.checkAllProxies(cleaned);
    } else {
      working = await proxyManager.checkAllProxies();
    }
    res.json({ working: working.length, list: working });
  } catch (e) {
    logger.error('Proxy check failed:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    proxyManager.off('checkProgress', onProgress);
  }
});

// ── Proxy: List ──
app.get('/api/proxy/list', (req, res) => {
  res.json({
    working: proxyManager.workingProxies.slice(0, 100),
    stats: proxyManager.getStats(),
  });
});

// ── Clear history ──
app.post('/api/history/clear', (req, res) => {
  jobHistory = [];
  res.json({ cleared: true });
});

// ── Config get/set ──
app.get('/api/config', (req, res) => {
  res.json({
    maxAgents: config.bot.maxAgents,
    minVisitDuration: config.bot.minVisitDuration,
    maxVisitDuration: config.bot.maxVisitDuration,
    headless: config.bot.headless,
  });
});

// ── Socket connection ──
io.on('connection', (socket) => {
  logger.info(`📡 Dashboard connected: ${socket.id}`);
  socket.emit('stats', {
    pool: agentPool.getStatus(),
    proxy: proxyManager.getStats(),
    jobHistory: jobHistory.slice(-50),
  });
  socket.on('disconnect', () => {
    logger.info(`📡 Dashboard disconnected: ${socket.id}`);
  });
});

// ══════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════
function startServer() {
  server.listen(config.server.port, config.server.host, () => {
    logger.info(`🌐 Dashboard: http://${config.server.host}:${config.server.port}`);
  });
}

module.exports = { app, server, io, startServer };
