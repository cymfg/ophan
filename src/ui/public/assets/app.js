/**
 * Ophan UI Client Application
 */

// State
let currentPage = 'dashboard';
let ws = null;
let currentConfig = null;
let currentTab = 'guidelines';

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWebSocket();
  loadDashboard();
  initConfigForm();
  initTabs();
  initProposals();
  initContextStats();
  initReviewButton();
  initGoals();
  initOrchestrator();
});

// Navigation
function initNavigation() {
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = e.target.dataset.page;
      navigateTo(page);
    });
  });

  // Handle inline nav-link-btn elements (e.g. "View Goals" on dashboard)
  document.querySelectorAll('.nav-link-btn').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) navigateTo(page);
    });
  });
}

function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });

  currentPage = page;

  // Load page data
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'proposals':
      loadProposals();
      break;
    case 'context-stats':
      loadContextStats();
      break;
    case 'config':
      loadConfig();
      break;
    case 'guidelines':
      loadGuidelines();
      break;
    case 'goals':
      loadGoals();
      break;
    case 'orchestrator':
      loadOrchestratorPage();
      break;
    case 'digests':
      loadDigests();
      break;
  }
}

// WebSocket
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    updateConnectionStatus('connected');
  };

  ws.onclose = () => {
    updateConnectionStatus('disconnected');
    // Reconnect after 3 seconds
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    updateConnectionStatus('disconnected');
  };

  ws.onmessage = (event) => {
    const { event: eventType, data } = JSON.parse(event.data);
    handleWebSocketEvent(eventType, data);
  };
}

function updateConnectionStatus(status) {
  const statusEl = document.getElementById('connectionStatus');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  dot.className = 'status-dot ' + status;
  text.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
}

function handleWebSocketEvent(eventType, data) {
  switch (eventType) {
    case 'config:updated':
      if (currentPage === 'dashboard') {
        loadDashboard();
      }
      break;
    case 'task:completed':
      if (currentPage === 'dashboard') {
        loadDashboard();
      } else if (currentPage === 'goals') {
        loadGoals();
      }
      break;
    case 'review:started':
      handleReviewStarted(data);
      break;
    case 'review:progress':
      handleReviewProgress(data);
      break;
    case 'review:completed':
      handleReviewCompleted(data);
      break;
    case 'review:error':
      handleReviewError(data);
      break;
    case 'proposal:approved':
    case 'proposal:rejected':
      if (currentPage === 'proposals') {
        loadProposals();
      }
      if (currentPage === 'dashboard') {
        loadDashboard();
      }
      break;
  }
}

// Dashboard
async function loadDashboard() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    // Project name
    document.getElementById('projectName').textContent = data.projectName;

    // Metrics
    document.getElementById('totalTasks').textContent = data.metrics.totalTasks;
    document.getElementById('successRate').textContent = `${data.metrics.successRate}%`;
    document.getElementById('avgIterations').textContent = data.metrics.averageIterations;
    document.getElementById('totalCost').textContent = `$${data.metrics.totalCost}`;

    // Task summary
    document.getElementById('successfulTasks').textContent = data.metrics.successfulTasks;
    document.getElementById('failedTasks').textContent = data.metrics.failedTasks;
    document.getElementById('escalatedTasks').textContent = data.metrics.escalatedTasks;

    // Outer loop status
    document.getElementById('lastReview').textContent = data.state.lastReview
      ? new Date(data.state.lastReview).toLocaleDateString()
      : 'Never';
    document.getElementById('tasksSinceReview').textContent = data.state.tasksSinceReview;
    document.getElementById('pendingProposals').textContent = data.state.pendingProposals;
    document.getElementById('activeLearnings').textContent = data.metrics.activeLearnings;

    // Config preview
    document.getElementById('executionBackend').textContent = 'Claude Code';

    // Show model
    const ccModel = data.config.claudeCode?.model || 'sonnet';
    document.getElementById('modelName').textContent = ccModel.charAt(0).toUpperCase() + ccModel.slice(1);
    document.getElementById('maxIterations').textContent = data.config.innerLoop.maxIterations;
    document.getElementById('strategy').textContent = data.config.innerLoop.regenerationStrategy;
    document.getElementById('costLimit').textContent = data.config.innerLoop.costLimit
      ? `$${data.config.innerLoop.costLimit}`
      : 'None';

    // Task agent metrics (from status metrics)
    document.getElementById('taskAgentSuccessRate').textContent = data.metrics.successRate + '%';
    document.getElementById('taskAgentAvgIterations').textContent = data.metrics.averageIterations;
    document.getElementById('taskAgentAvgCost').textContent = '$' + data.metrics.averageCostPerTask;

    // Load context analysis metrics
    loadDashboardAgentMetrics();

    // Load goals summary
    loadDashboardGoals(data);

    // Load orchestrator metrics
    loadDashboardOrchestrator();

  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
}

// Config
function initConfigForm() {
  document.getElementById('saveConfig').addEventListener('click', saveConfig);

  // Backend selection toggle
  const backendSelect = document.getElementById('configBackend');
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    currentConfig = await response.json();

    // Claude Code settings
    if (currentConfig.claudeCode) {
      document.getElementById('configClaudeCodeModel').value = currentConfig.claudeCode.model || 'sonnet';
      document.getElementById('configPermissionMode').value = currentConfig.claudeCode.permissionMode || 'acceptEdits';
    }

    // Inner loop settings
    document.getElementById('configMaxIterations').value = currentConfig.innerLoop.maxIterations;
    document.getElementById('configStrategy').value = currentConfig.innerLoop.regenerationStrategy;
    document.getElementById('configCostLimit').value = currentConfig.innerLoop.costLimit || '';

    // Outer loop settings
    document.getElementById('configAfterTasks').value = currentConfig.outerLoop.triggers.afterTasks;
    document.getElementById('configMinOccurrences').value = currentConfig.outerLoop.minOccurrences;
    document.getElementById('configMinConfidence').value = Math.round(currentConfig.outerLoop.minConfidence * 100);
    document.getElementById('configLookbackDays').value = currentConfig.outerLoop.lookbackDays;

  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

async function saveConfig() {
  if (!currentConfig) return;

  // Build updated config
  const updatedConfig = {
    ...currentConfig,
    claudeCode: {
      model: document.getElementById('configClaudeCodeModel').value,
      permissionMode: document.getElementById('configPermissionMode').value,
      allowedTools: currentConfig.claudeCode?.allowedTools || ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: currentConfig.claudeCode?.maxTurns || 50,
    },
    innerLoop: {
      ...currentConfig.innerLoop,
      maxIterations: parseInt(document.getElementById('configMaxIterations').value),
      regenerationStrategy: document.getElementById('configStrategy').value,
      costLimit: document.getElementById('configCostLimit').value
        ? parseFloat(document.getElementById('configCostLimit').value)
        : undefined,
    },
    outerLoop: {
      ...currentConfig.outerLoop,
      triggers: {
        ...currentConfig.outerLoop.triggers,
        afterTasks: parseInt(document.getElementById('configAfterTasks').value),
      },
      minOccurrences: parseInt(document.getElementById('configMinOccurrences').value),
      minConfidence: parseInt(document.getElementById('configMinConfidence').value) / 100,
      lookbackDays: parseInt(document.getElementById('configLookbackDays').value),
    },
  };

  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedConfig),
    });

    if (response.ok) {
      currentConfig = updatedConfig;
      alert('Configuration saved successfully!');
    } else {
      const error = await response.json();
      alert(`Failed to save configuration: ${error.error}`);
    }
  } catch (error) {
    alert(`Failed to save configuration: ${error.message}`);
  }
}

// Guidelines & Criteria
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      loadGuidelines();
    });
  });
}

async function loadGuidelines() {
  const container = document.getElementById('guidelinesContent');
  container.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const endpoint = currentTab === 'guidelines' ? '/api/guidelines' : '/api/criteria';
    const response = await fetch(endpoint);
    const data = await response.json();

    const files = Object.entries(data);
    if (files.length === 0) {
      container.innerHTML = `<div class="loading">No ${currentTab} files found</div>`;
      return;
    }

    container.innerHTML = files.map(([filename, content]) => `
      <div class="guidelines-file">
        <h4>${filename}</h4>
        <pre>${escapeHtml(content)}</pre>
      </div>
    `).join('');

  } catch (error) {
    console.error('Failed to load guidelines:', error);
    container.innerHTML = '<div class="loading">Failed to load content</div>';
  }
}

// Digests
async function loadDigests() {
  const list = document.getElementById('digestsList');
  list.innerHTML = '<div class="loading">Loading digests...</div>';

  try {
    const response = await fetch('/api/digests');
    const data = await response.json();

    if (data.digests.length === 0) {
      list.innerHTML = '<div class="loading">No digests found. Run `ophan review` to generate one.</div>';
      document.getElementById('digestContent').style.display = 'none';
      return;
    }

    list.innerHTML = data.digests.map(d => `
      <div class="digest-item" data-filename="${d.filename}">
        <span class="digest-date">${d.date}</span>
        <span class="digest-action">View</span>
      </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.digest-item').forEach(item => {
      item.addEventListener('click', () => loadDigestContent(item.dataset.filename));
    });

    // Load first digest
    if (data.digests.length > 0) {
      loadDigestContent(data.digests[0].filename);
    }

  } catch (error) {
    console.error('Failed to load digests:', error);
    list.innerHTML = '<div class="loading">Failed to load digests</div>';
  }
}

async function loadDigestContent(filename) {
  const content = document.getElementById('digestContent');
  const text = document.getElementById('digestText');

  // Update active state
  document.querySelectorAll('.digest-item').forEach(item => {
    item.classList.toggle('active', item.dataset.filename === filename);
  });

  content.style.display = 'block';
  text.textContent = 'Loading...';

  try {
    const response = await fetch(`/api/digests/${filename}`);
    const data = await response.json();
    text.textContent = data.content;
  } catch (error) {
    text.textContent = 'Failed to load digest content';
  }
}

// Proposals
let currentProposalId = null;

function initProposals() {
  document.getElementById('refreshProposals').addEventListener('click', loadProposals);
  document.getElementById('closeProposalDetail').addEventListener('click', closeProposalModal);
  document.getElementById('approveProposalBtn').addEventListener('click', approveCurrentProposal);
  document.getElementById('rejectProposalBtn').addEventListener('click', rejectCurrentProposal);

  document.getElementById('proposalDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'proposalDetailModal') {
      closeProposalModal();
    }
  });
}

async function loadProposals() {
  const list = document.getElementById('proposalsList');
  list.innerHTML = '<div class="loading">Loading proposals...</div>';

  try {
    const response = await fetch('/api/proposals');
    const proposals = await response.json();

    if (proposals.length === 0) {
      list.innerHTML = '<div class="empty-state">No pending proposals. Run a review to generate proposals.</div>';
      return;
    }

    list.innerHTML = proposals.map(p => `
      <div class="proposal-item" data-id="${p.id}">
        <div class="proposal-header">
          <span class="proposal-type ${p.type}">${p.type}</span>
          <span class="proposal-source">${p.source}</span>
          <span class="proposal-confidence">${Math.round(p.confidence * 100)}% confidence</span>
        </div>
        <div class="proposal-target">${p.targetFile}</div>
        <div class="proposal-reason">${escapeHtml(p.reason)}</div>
        <div class="proposal-actions">
          <button class="btn btn-sm btn-primary" onclick="showProposalDetail('${p.id}')">Review</button>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Failed to load proposals:', error);
    list.innerHTML = '<div class="loading">Failed to load proposals</div>';
  }
}

async function showProposalDetail(id) {
  currentProposalId = id;
  const modal = document.getElementById('proposalDetailModal');
  const content = document.getElementById('proposalDetailContent');

  content.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.add('active');

  try {
    const response = await fetch('/api/proposals');
    const proposals = await response.json();
    const proposal = proposals.find(p => p.id === id);

    if (!proposal) {
      content.innerHTML = '<div class="loading">Proposal not found</div>';
      return;
    }

    content.innerHTML = `
      <div class="proposal-detail">
        <div class="proposal-meta">
          <span class="proposal-type ${proposal.type}">${proposal.type}</span>
          <span class="proposal-source">from ${proposal.source}</span>
          <span class="proposal-confidence">${Math.round(proposal.confidence * 100)}% confidence</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Target File</span>
          <span class="summary-value"><code>${proposal.targetFile}</code></span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Created</span>
          <span class="summary-value">${new Date(proposal.createdAt).toLocaleString()}</span>
        </div>
        <div class="proposal-section">
          <h4>Reason</h4>
          <p>${escapeHtml(proposal.reason)}</p>
        </div>
        <div class="proposal-section">
          <h4>Proposed Change</h4>
          <pre class="proposal-change">${escapeHtml(proposal.change)}</pre>
        </div>
      </div>
    `;

    document.getElementById('proposalFeedback').value = '';

  } catch (error) {
    content.innerHTML = '<div class="loading">Failed to load proposal details</div>';
  }
}

function closeProposalModal() {
  document.getElementById('proposalDetailModal').classList.remove('active');
  currentProposalId = null;
}

async function approveCurrentProposal() {
  if (!currentProposalId) return;

  const feedback = document.getElementById('proposalFeedback').value.trim();
  const btn = document.getElementById('approveProposalBtn');
  btn.disabled = true;
  btn.textContent = 'Approving...';

  try {
    const response = await fetch(`/api/proposals/${currentProposalId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedback || undefined })
    });

    if (response.ok) {
      closeProposalModal();
      loadProposals();
    } else {
      const error = await response.json();
      alert('Failed to approve: ' + error.error);
    }
  } catch (error) {
    alert('Failed to approve proposal: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

async function rejectCurrentProposal() {
  if (!currentProposalId) return;

  const feedback = document.getElementById('proposalFeedback').value.trim();
  const btn = document.getElementById('rejectProposalBtn');
  btn.disabled = true;
  btn.textContent = 'Rejecting...';

  try {
    const response = await fetch(`/api/proposals/${currentProposalId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedback || undefined })
    });

    if (response.ok) {
      closeProposalModal();
      loadProposals();
    } else {
      const error = await response.json();
      alert('Failed to reject: ' + error.error);
    }
  } catch (error) {
    alert('Failed to reject proposal: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reject';
  }
}

// Context Stats
function initContextStats() {
  document.getElementById('refreshContextStats').addEventListener('click', loadContextStats);
  document.getElementById('contextLookback').addEventListener('change', loadContextStats);
}

async function loadContextStats() {
  const days = document.getElementById('contextLookback').value;

  // Reset displays
  document.getElementById('contextTasksAnalyzed').textContent = '-';
  document.getElementById('contextHitRate').textContent = '-';
  document.getElementById('contextMissRate').textContent = '-';
  document.getElementById('contextExplorationTokens').textContent = '-';
  document.getElementById('commonMissesList').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('commonUnusedList').innerHTML = '<div class="loading">Loading...</div>';

  try {
    const response = await fetch(`/api/context-stats?days=${days}`);
    const metrics = await response.json();

    // Update metrics cards
    document.getElementById('contextTasksAnalyzed').textContent = metrics.tasksAnalyzed;
    document.getElementById('contextHitRate').textContent = metrics.averageHitRate.toFixed(1) + '%';
    document.getElementById('contextMissRate').textContent = metrics.averageMissRate.toFixed(1) + '%';
    document.getElementById('contextExplorationTokens').textContent = Math.round(metrics.averageExplorationTokens).toLocaleString();

    // Update common misses list
    const missesList = document.getElementById('commonMissesList');
    if (metrics.commonMisses.length === 0) {
      missesList.innerHTML = '<div class="empty-state">No commonly missed files</div>';
    } else {
      missesList.innerHTML = metrics.commonMisses.map(m => `
        <div class="file-item">
          <code>${escapeHtml(m.file)}</code>
          <span class="file-count">${m.count} tasks</span>
        </div>
      `).join('');
    }

    // Update common unused list
    const unusedList = document.getElementById('commonUnusedList');
    if (metrics.commonUnused.length === 0) {
      unusedList.innerHTML = '<div class="empty-state">No commonly unused files</div>';
    } else {
      unusedList.innerHTML = metrics.commonUnused.map(m => `
        <div class="file-item">
          <code>${escapeHtml(m.file)}</code>
          <span class="file-count">${m.count} tasks</span>
        </div>
      `).join('');
    }

    // Update assessment
    const hitRateAssessment = document.getElementById('hitRateAssessment');
    const missRateAssessment = document.getElementById('missRateAssessment');

    if (metrics.averageHitRate >= 70) {
      hitRateAssessment.innerHTML = '<span class="assessment-icon success">✓</span><span class="assessment-text">Hit rate meets target (>70%)</span>';
    } else {
      hitRateAssessment.innerHTML = '<span class="assessment-icon danger">✗</span><span class="assessment-text">Hit rate below target (>70%) - context includes irrelevant files</span>';
    }

    if (metrics.averageMissRate <= 20) {
      missRateAssessment.innerHTML = '<span class="assessment-icon success">✓</span><span class="assessment-text">Miss rate meets target (<20%)</span>';
    } else {
      missRateAssessment.innerHTML = '<span class="assessment-icon danger">✗</span><span class="assessment-text">Miss rate above target (<20%) - context missing important files</span>';
    }

    // Also update dashboard agent metrics
    updateContextMetrics(metrics);

  } catch (error) {
    console.error('Failed to load context stats:', error);
    document.getElementById('commonMissesList').innerHTML = '<div class="loading">Failed to load</div>';
    document.getElementById('commonUnusedList').innerHTML = '<div class="loading">Failed to load</div>';
  }
}

function updateContextMetrics(metrics) {
  document.getElementById('contextAgentHitRate').textContent = metrics.averageHitRate.toFixed(1) + '%';
  document.getElementById('contextAgentMissRate').textContent = metrics.averageMissRate.toFixed(1) + '%';
  document.getElementById('contextAgentTasksAnalyzed').textContent = metrics.tasksAnalyzed;
}

// Review Button
let reviewRunning = false;

function initReviewButton() {
  document.getElementById('runReviewBtn').addEventListener('click', startReview);
}

async function startReview() {
  if (reviewRunning) return;

  const btn = document.getElementById('runReviewBtn');
  const status = document.getElementById('reviewStatus');

  btn.disabled = true;
  btn.textContent = 'Running...';
  status.textContent = 'Starting review...';
  status.className = 'review-status running';
  reviewRunning = true;

  try {
    const response = await fetch('/api/review', { method: 'POST' });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start review');
    }

    status.textContent = 'Review in progress...';

  } catch (error) {
    status.textContent = 'Error: ' + error.message;
    status.className = 'review-status error';
    btn.disabled = false;
    btn.textContent = 'Run Review';
    reviewRunning = false;
  }
}

function handleReviewStarted(data) {
  const status = document.getElementById('reviewStatus');
  status.textContent = 'Review started...';
  status.className = 'review-status running';
}

function handleReviewProgress(data) {
  const status = document.getElementById('reviewStatus');
  status.textContent = data.message;
}

function handleReviewCompleted(data) {
  const btn = document.getElementById('runReviewBtn');
  const status = document.getElementById('reviewStatus');

  btn.disabled = false;
  btn.textContent = 'Run Review';
  reviewRunning = false;

  status.textContent = `Complete: ${data.proposalsGenerated} proposals generated`;
  status.className = 'review-status success';

  // Refresh dashboard data
  if (currentPage === 'dashboard') {
    loadDashboard();
    loadContextStats();
  }
}

function handleReviewError(data) {
  const btn = document.getElementById('runReviewBtn');
  const status = document.getElementById('reviewStatus');

  btn.disabled = false;
  btn.textContent = 'Run Review';
  reviewRunning = false;

  status.textContent = 'Error: ' + data.error;
  status.className = 'review-status error';
}

// Dashboard Agent Metrics
async function loadDashboardAgentMetrics() {
  try {
    // Load context stats for context analysis metrics
    const contextResponse = await fetch('/api/context-stats?days=30');
    const contextMetrics = await contextResponse.json();
    updateContextMetrics(contextMetrics);

    // Task agent metrics come from the status API (already loaded in loadDashboard)
  } catch (error) {
    console.error('Failed to load agent metrics:', error);
  }
}

// Goals Page
let goalsData = [];

function initGoals() {
  document.getElementById('refreshGoals').addEventListener('click', loadGoals);
  document.getElementById('closeGoalDetail').addEventListener('click', () => {
    document.getElementById('goalDetailModal').classList.remove('active');
  });
  document.getElementById('goalDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'goalDetailModal') {
      document.getElementById('goalDetailModal').classList.remove('active');
    }
  });
}

async function loadGoals() {
  const list = document.getElementById('goalsList');
  list.innerHTML = '<div class="loading">Loading goals...</div>';

  try {
    const response = await fetch('/api/goals');
    goalsData = await response.json();

    // Update summary metrics
    const active = goalsData.filter(g => ['in_progress', 'planning'].includes(g.status)).length;
    const completed = goalsData.filter(g => g.status === 'completed').length;
    const pending = goalsData.filter(g => g.status === 'pending').length;
    const totalCost = goalsData.reduce((sum, g) => sum + (g.totalCost || 0), 0);

    document.getElementById('goalsActive').textContent = active;
    document.getElementById('goalsCompleted').textContent = completed;
    document.getElementById('goalsPending').textContent = pending;
    document.getElementById('goalsTotalCost').textContent = `$${totalCost.toFixed(2)}`;

    if (goalsData.length === 0) {
      list.innerHTML = '<div class="empty-state">No goals found. Create goal files in .ophan/goals/ to get started.</div>';
      return;
    }

    list.innerHTML = goalsData.map(goal => `
      <div class="card goal-card" data-goal-id="${goal.id}" onclick="showGoalDetail('${goal.id}')">
        <div class="goal-card-header">
          <h4>${escapeHtml(goal.title)}</h4>
          <span class="status-badge ${goal.status}">${goal.status}</span>
        </div>
        ${goal.priority ? `<span class="goal-priority priority-${goal.priority}">${goal.priority}</span>` : ''}
        <div class="goal-card-body">
          <div class="goal-progress">
            <div class="goal-progress-bar">
              <div class="goal-progress-fill" style="width: ${getGoalProgressPercent(goal)}%"></div>
            </div>
            <span class="goal-progress-text">${goal.taskProgress}</span>
          </div>
          <div class="goal-card-meta">
            ${goal.tags && goal.tags.length ? `<span class="goal-tags">${goal.tags.map(t => `<span class="goal-tag">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
            <span class="goal-cost">$${(goal.totalCost || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Failed to load goals:', error);
    list.innerHTML = '<div class="loading">Failed to load goals</div>';
  }
}

function getGoalProgressPercent(goal) {
  if (!goal.taskProgress || goal.taskProgress === 'no tasks') return 0;
  const parts = goal.taskProgress.split('/');
  if (parts.length !== 2) return 0;
  const completed = parseInt(parts[0]);
  const total = parseInt(parts[1]);
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

function showGoalDetail(goalId) {
  const goal = goalsData.find(g => g.id === goalId);
  if (!goal) return;

  const modal = document.getElementById('goalDetailModal');
  const title = document.getElementById('goalDetailTitle');
  const content = document.getElementById('goalDetailContent');

  title.textContent = goal.title;
  modal.classList.add('active');

  content.innerHTML = `
    <div class="goal-detail">
      <div class="goal-detail-meta">
        <span class="status-badge ${goal.status}">${goal.status}</span>
        ${goal.priority ? `<span class="goal-priority priority-${goal.priority}">${goal.priority}</span>` : ''}
        ${goal.tags && goal.tags.length ? goal.tags.map(t => `<span class="goal-tag">${escapeHtml(t)}</span>`).join('') : ''}
      </div>

      ${goal.description ? `
        <div class="goal-section">
          <h4>Description</h4>
          <p>${escapeHtml(goal.description)}</p>
        </div>
      ` : ''}

      ${goal.acceptanceCriteria && goal.acceptanceCriteria.length ? `
        <div class="goal-section">
          <h4>Acceptance Criteria</h4>
          <ul class="goal-criteria-list">
            ${goal.acceptanceCriteria.map(ac => `<li>${escapeHtml(ac)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${goal.dependsOn && goal.dependsOn.length ? `
        <div class="goal-section">
          <h4>Dependencies</h4>
          <p>${goal.dependsOn.map(d => `<code>${escapeHtml(d)}</code>`).join(', ')}</p>
        </div>
      ` : ''}

      <div class="goal-section">
        <h4>Progress</h4>
        <div class="goal-progress" style="margin-bottom: 12px;">
          <div class="goal-progress-bar">
            <div class="goal-progress-fill" style="width: ${getGoalProgressPercent(goal)}%"></div>
          </div>
          <span class="goal-progress-text">${goal.taskProgress} tasks</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Cost</span>
          <span class="summary-value">$${(goal.totalCost || 0).toFixed(4)}</span>
        </div>
        ${goal.startedAt ? `<div class="summary-item"><span class="summary-label">Started</span><span class="summary-value">${new Date(goal.startedAt).toLocaleString()}</span></div>` : ''}
        ${goal.completedAt ? `<div class="summary-item"><span class="summary-label">Completed</span><span class="summary-value">${new Date(goal.completedAt).toLocaleString()}</span></div>` : ''}
      </div>

      ${goal.tasks && goal.tasks.length ? `
        <div class="goal-section">
          <h4>Tasks (${goal.tasks.length})</h4>
          <table class="logs-table goal-tasks-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Status</th>
                <th>Iterations</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              ${goal.tasks.map(task => `
                <tr class="goal-task-row" onclick="toggleTaskDetail('${escapeHtml(task.id)}')">
                  <td>${escapeHtml(task.description)}</td>
                  <td><span class="status-badge ${task.status}">${task.status}</span></td>
                  <td>${task.result?.iterations || '-'}</td>
                  <td>${task.result?.cost ? `$${task.result.cost.toFixed(4)}` : '-'}</td>
                </tr>
                <tr class="goal-task-detail" id="task-detail-${escapeHtml(task.id)}" style="display: none;">
                  <td colspan="4">
                    <div class="task-detail-expanded">
                      ${task.rationale ? `<div class="task-detail-field"><span class="task-detail-label">Rationale</span><p>${escapeHtml(task.rationale)}</p></div>` : ''}
                      ${task.result?.summary ? `<div class="task-detail-field"><span class="task-detail-label">Result Summary</span><p>${escapeHtml(task.result.summary)}</p></div>` : ''}
                      ${task.dependsOn && task.dependsOn.length ? `<div class="task-detail-field"><span class="task-detail-label">Depends On</span><p>${task.dependsOn.map(d => `<code>${escapeHtml(d)}</code>`).join(', ')}</p></div>` : ''}
                      ${!task.rationale && !task.result?.summary ? '<div class="task-detail-field"><p class="text-muted">No additional details available</p></div>' : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function toggleTaskDetail(taskId) {
  const detail = document.getElementById(`task-detail-${taskId}`);
  if (detail) {
    detail.style.display = detail.style.display === 'none' ? '' : 'none';
  }
}

// Orchestrator Page
let currentMemoryTab = 'preferences';
let memoryData = null;

function initOrchestrator() {
  document.getElementById('refreshOrchestrator').addEventListener('click', loadOrchestratorPage);
  document.getElementById('closeSessionDetail').addEventListener('click', () => {
    document.getElementById('sessionDetailModal').classList.remove('active');
  });
  document.getElementById('sessionDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'sessionDetailModal') {
      document.getElementById('sessionDetailModal').classList.remove('active');
    }
  });

  // Memory tab switching
  document.querySelectorAll('[data-memory-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-memory-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMemoryTab = tab.dataset.memoryTab;
      if (memoryData) {
        renderMemoryTab(memoryData);
      }
    });
  });
}

async function loadOrchestratorPage() {
  // Fetch all data in parallel
  try {
    const [statusRes, sessionsRes, memoryRes] = await Promise.all([
      fetch('/api/orchestrator/status'),
      fetch('/api/orchestrator/sessions'),
      fetch('/api/orchestrator/memory'),
    ]);

    const status = await statusRes.json();
    const sessions = await sessionsRes.json();
    memoryData = await memoryRes.json();

    // Update status metrics
    document.getElementById('orchGoalsCreated').textContent = status.goalsCreated ?? 0;
    document.getElementById('orchGuidelinesUpdated').textContent = status.guidelinesUpdated ?? 0;
    document.getElementById('orchConversations').textContent = status.conversationsHandled ?? 0;
    document.getElementById('orchCompletionRate').textContent =
      status.supervisedGoalCompletionRate != null
        ? `${Math.round(status.supervisedGoalCompletionRate * 100)}%`
        : '-';

    // Daemon status
    document.getElementById('orchLastCheck').textContent = status.lastProactiveCheck
      ? new Date(status.lastProactiveCheck).toLocaleString()
      : 'Never';
    const alerts = status.recentAlerts || [];
    document.getElementById('orchAlertCount').textContent = alerts.length;
    const alertsList = document.getElementById('orchAlertsList');
    if (alerts.length === 0) {
      alertsList.innerHTML = '<div class="empty-state">No recent alerts</div>';
    } else {
      alertsList.innerHTML = alerts.map(a => `
        <div class="alert-item">
          <span class="alert-type">${escapeHtml(a.type || 'alert')}</span>
          <span class="alert-message">${escapeHtml(a.message || a.summary || JSON.stringify(a))}</span>
        </div>
      `).join('');
    }

    // Sessions list
    const sessionsList = document.getElementById('orchSessionsList');
    if (sessions.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state">No conversation sessions found</div>';
    } else {
      sessionsList.innerHTML = sessions.map(s => `
        <div class="session-item" onclick="showSessionDetail('${s.id}')">
          <div class="session-header">
            <span class="session-date">${new Date(s.startedAt).toLocaleString()}</span>
            <span class="session-msg-count">${s.messageCount} messages</span>
          </div>
          <div class="session-preview">${escapeHtml(s.summary || 'No preview')}</div>
        </div>
      `).join('');
    }

    // Memory
    renderMemoryTab(memoryData);

  } catch (error) {
    console.error('Failed to load orchestrator page:', error);
  }
}

function renderMemoryTab(memory) {
  const container = document.getElementById('memoryContent');

  if (currentMemoryTab === 'preferences') {
    const prefs = memory.preferences || [];
    if (prefs.length === 0) {
      container.innerHTML = '<div class="empty-state">No preferences recorded yet</div>';
    } else {
      container.innerHTML = `<div class="memory-list">${prefs.map(p => `
        <div class="memory-item">
          <div class="memory-item-text">${escapeHtml(p.text || p.content || JSON.stringify(p))}</div>
          ${p.confidence != null ? `<span class="memory-confidence">${Math.round(p.confidence * 100)}% confidence</span>` : ''}
          ${p.source ? `<span class="memory-source">from ${escapeHtml(p.source)}</span>` : ''}
        </div>
      `).join('')}</div>`;
    }
  } else if (currentMemoryTab === 'episodes') {
    const episodes = memory.episodes || [];
    if (episodes.length === 0) {
      container.innerHTML = '<div class="empty-state">No episodes recorded yet</div>';
    } else {
      container.innerHTML = `<div class="memory-list">${episodes.map(e => `
        <div class="memory-item">
          <div class="memory-item-text">${escapeHtml(e.summary || e.description || JSON.stringify(e))}</div>
          ${e.outcome ? `<span class="memory-outcome ${e.outcome}">${e.outcome}</span>` : ''}
          ${e.timestamp ? `<span class="memory-date">${new Date(e.timestamp).toLocaleDateString()}</span>` : ''}
        </div>
      `).join('')}</div>`;
    }
  } else if (currentMemoryTab === 'patterns') {
    const patterns = memory.patterns || [];
    if (patterns.length === 0) {
      container.innerHTML = '<div class="empty-state">No patterns detected yet</div>';
    } else {
      container.innerHTML = `<div class="memory-list">${patterns.map(p => `
        <div class="memory-item">
          <div class="memory-item-text">${escapeHtml(p.description || p.pattern || JSON.stringify(p))}</div>
          ${p.occurrences != null ? `<span class="memory-count">${p.occurrences} occurrences</span>` : ''}
          ${p.confidence != null ? `<span class="memory-confidence">${Math.round(p.confidence * 100)}% confidence</span>` : ''}
        </div>
      `).join('')}</div>`;
    }
  }
}

async function showSessionDetail(sessionId) {
  const modal = document.getElementById('sessionDetailModal');
  const content = document.getElementById('sessionDetailContent');

  content.innerHTML = '<div class="loading">Loading session...</div>';
  modal.classList.add('active');

  try {
    const response = await fetch(`/api/orchestrator/sessions/${sessionId}`);
    const session = await response.json();

    content.innerHTML = `
      <div class="session-detail">
        <div class="session-detail-meta">
          <div class="summary-item">
            <span class="summary-label">Started</span>
            <span class="summary-value">${new Date(session.startedAt).toLocaleString()}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Last Active</span>
            <span class="summary-value">${new Date(session.lastActiveAt).toLocaleString()}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Messages</span>
            <span class="summary-value">${session.messages?.length || 0}</span>
          </div>
        </div>
        <div class="conversation-thread">
          ${(session.messages || []).map(msg => `
            <div class="conversation-message role-${msg.role}">
              <div class="message-header">
                <span class="message-role">${msg.role}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
              <div class="message-content">${escapeHtml(msg.content)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

  } catch (error) {
    content.innerHTML = '<div class="loading">Failed to load session details</div>';
  }
}

// Dashboard extensions for Goals and Orchestrator
async function loadDashboardGoals(statusData) {
  if (statusData && statusData.goals) {
    const g = statusData.goals;
    document.getElementById('dashActiveGoals').textContent = g.active ?? 0;
    document.getElementById('dashCompletedGoals').textContent = g.completed ?? 0;
    document.getElementById('dashGoalsCost').textContent = `$${(g.totalCost ?? 0).toFixed(2)}`;
  }
}

async function loadDashboardOrchestrator() {
  try {
    const response = await fetch('/api/orchestrator/status');
    const status = await response.json();

    document.getElementById('orchAgentGoalsCreated').textContent = status.goalsCreated ?? 0;
    document.getElementById('orchAgentConversations').textContent = status.conversationsHandled ?? 0;
    document.getElementById('orchAgentCompletionRate').textContent =
      status.supervisedGoalCompletionRate != null
        ? `${Math.round(status.supervisedGoalCompletionRate * 100)}%`
        : '-';
  } catch (error) {
    console.error('Failed to load orchestrator metrics:', error);
  }
}

// Utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
