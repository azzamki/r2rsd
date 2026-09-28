/**
 * Agent Pool Manager
 * Manages multiple BrowserAgent instances for concurrent visits
 */
const BrowserAgent = require('./browserAgent');
const logger = require('../utils/logger');
const config = require('../config');
const EventEmitter = require('events');

class AgentPool extends EventEmitter {
  constructor(maxAgents = config.bot.maxAgents) {
    super();
    this.maxAgents = maxAgents;
    this.agents = new Map();
    this.queue = [];
    this.running = 0;
    this.totalVisits = 0;
    this.totalErrors = 0;
    this.results = [];
    this.isRunning = false;
    this.isPaused = false;
    this._agentSeq = 0;
  }

  // ──────────────────────────────────────────
  // ADD VISIT TASK TO QUEUE
  // ──────────────────────────────────────────
  addTask(targetUrl, options = {}, repeat = 1) {
    for (let i = 0; i < repeat; i++) {
      this.queue.push({ targetUrl, options, id: `task-${Date.now()}-${i}` });
    }
    logger.info(`📋 Queue: ${this.queue.length} tasks pending`);
    if (this.isRunning && !this.isPaused) {
      this._processQueue();
    }
  }

  // ──────────────────────────────────────────
  // PROCESS QUEUE
  // ──────────────────────────────────────────
  async _processQueue() {
    // Auto-replenish proxy pool if usable proxies drop low
    const proxyManager = require('../proxy/proxyManager');
    if (proxyManager.getStats().usable < this.maxAgents && !proxyManager.isGrabbing && !proxyManager.isChecking) {
      logger.info('🔄 Proxy count low — auto grabbing and checking fresh proxies...');
      proxyManager.initialize().catch(e => logger.warn(`Proxy auto-replenish warning: ${e.message}`));
    }

    while (
      this.queue.length > 0 &&
      this.running < this.maxAgents &&
      !this.isPaused
    ) {
      const task = this.queue.shift();
      this._runTask(task);
    }

    // Pool drains → mark idle so a new job can start.
    if (this.queue.length === 0 && this.running === 0 && this.isRunning) {
      this.isRunning = false;
      this.emit('drained');
    }
  }

  async _runTask(task) {
    const agentId = `A${String(++this._agentSeq).padStart(3, '0')}`;
    const agent = new BrowserAgent(agentId, task.options);
    this.agents.set(agentId, agent);
    this.running++;

    this.emit('agentStart', { agentId, url: task.targetUrl });
    logger.info(`🚀 Agent ${agentId} started | Running: ${this.running}/${this.maxAgents}`);

    try {
      const result = await agent.runVisit(task.targetUrl, task.options);
      this.results.push(result);

      if (result.success) {
        this.totalVisits++;
        this.emit('visitComplete', result);
        logger.info(`✅ Agent ${agentId} done — Total visits: ${this.totalVisits}`);
      } else {
        this.totalErrors++;
        this.emit('visitError', result);
      }
    } catch (e) {
      this.totalErrors++;
      logger.error(`Agent ${agentId} crashed: ${e.message}`);
      this.emit('visitError', { agentId, error: e.message });
    } finally {
      await agent.close();
      this.agents.delete(agentId);
      // Clamp at zero: close() can fire twice for one agent (once from the
      // agent's own cleanup, once here), which previously drove the counter
      // negative and showed "-7 active agents" on the dashboard.
      this.running = Math.max(0, this.running - 1);
      this.emit('agentEnd', agentId);

      // Continue queue
      if (this.isRunning && !this.isPaused) {
        this._processQueue();
      }
    }
  }

  // ──────────────────────────────────────────
  // START POOL
  // ──────────────────────────────────────────
  async start() {
    this.isRunning = true;
    this.isPaused = false;
    logger.info(`🎯 Agent pool started | Max agents: ${this.maxAgents}`);
    await this._processQueue();
  }

  // ──────────────────────────────────────────
  // BULK VISIT
  // ──────────────────────────────────────────
  async bulkVisit(targetUrl, totalVisits, options = {}) {
    logger.info(`🔥 Bulk visit: ${totalVisits}x → ${targetUrl}`);
    this.addTask(targetUrl, options, totalVisits);
    await this.start();

    // Wait for all tasks to complete
    await this._waitForCompletion();
    return this.results;
  }

  async _waitForCompletion() {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.running === 0 && this.queue.length === 0) {
          clearInterval(check);
          this.isRunning = false;
          resolve();
        }
      }, 1000);
    });
  }

  // ──────────────────────────────────────────
  // PAUSE / RESUME / STOP
  // ──────────────────────────────────────────
  pause() {
    this.isPaused = true;
    logger.info('⏸️ Agent pool paused');
    this.emit('paused');
  }

  resume() {
    this.isPaused = false;
    logger.info('▶️ Agent pool resumed');
    this.emit('resumed');
    this._processQueue();
  }

  async stop() {
    this.isRunning = false;
    this.isPaused = true;
    this.queue = [];
    logger.info('⏹️ Agent pool stopping...');

    const closePromises = [];
    for (const [id, agent] of this.agents) {
      closePromises.push(agent.close());
    }
    await Promise.all(closePromises);
    this.agents.clear();
    this.running = 0;
    this.emit('stopped');
    logger.info('⏹️ Agent pool stopped');
  }

  // ──────────────────────────────────────────
  // STATUS
  // ──────────────────────────────────────────
  getStatus() {
    const agentStatuses = [];
    for (const [id, agent] of this.agents) {
      agentStatuses.push(agent.getStatus());
    }

    return {
      running: this.running,
      maxAgents: this.maxAgents,
      queued: this.queue.length,
      totalVisits: this.totalVisits,
      totalErrors: this.totalErrors,
      successRate: this.totalVisits + this.totalErrors > 0
        ? Math.round((this.totalVisits / (this.totalVisits + this.totalErrors)) * 100)
        : 0,
      agents: agentStatuses,
      isPaused: this.isPaused,
      isRunning: this.isRunning,
    };
  }
}

module.exports = AgentPool;
