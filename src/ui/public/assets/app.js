/**
 * Ophan UI Client Application
 */

// State
let currentPage = 'dashboard';
let ws = null;
let logsOffset = 0;
const logsLimit = 20;
let currentConfig = null;
let currentTab = 'guidelines';
let runningTaskId = null;

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWebSocket();
  loadDashboard();
  initConfigForm();
  initLogModal();
  initTabs();
  initTaskRunner();
  initProposals();
  initContextStats();
  initReviewButton();
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
    case 'run-task':
      checkRunningTask();
      break;
    case 'logs':
      logsOffset = 0;
      loadLogs();
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
    case 'task:started':
      handleTaskStarted(data);
      break;
    case 'task:progress':
      handleTaskProgress(data);
      break;
    case 'task:iteration':
      handleTaskIteration(data);
      break;
    case 'task:escalation':
      handleTaskEscalation(data);
      break;
    case 'task:completed':
      handleTaskCompleted(data);
      if (currentPage === 'dashboard') {
        loadDashboard();
      } else if (currentPage === 'logs') {
        loadLogs();
      }
      break;
    case 'task:cancelled':
      handleTaskCancelled(data);
      break;
    case 'task:error':
      handleTaskError(data);
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

    // Load context agent metrics
    loadDashboardAgentMetrics();

  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
}

// Logs
async function loadLogs() {
  const tbody = document.getElementById('logsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading logs...</td></tr>';

  try {
    const response = await fetch(`/api/logs?limit=${logsLimit}&offset=${logsOffset}`);
    const data = await response.json();

    if (data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No task logs found</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs.map(log => `
      <tr data-id="${log.id}">
        <td><code>${log.id.substring(0, 20)}...</code></td>
        <td>${escapeHtml(log.description?.substring(0, 50) || '-')}${log.description?.length > 50 ? '...' : ''}</td>
        <td><span class="status-badge ${log.status}">${log.status}</span></td>
        <td>${log.iterations || '-'}</td>
        <td>${log.cost ? `$${log.cost.toFixed(2)}` : '-'}</td>
        <td>${log.startTime ? new Date(log.startTime).toLocaleString() : '-'}</td>
      </tr>
    `).join('');

    // Add click handlers
    tbody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', () => showLogDetail(row.dataset.id));
    });

    // Pagination
    renderPagination(data.total);

  } catch (error) {
    console.error('Failed to load logs:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Failed to load logs</td></tr>';
  }
}

function renderPagination(total) {
  const pagination = document.getElementById('logsPagination');
  const totalPages = Math.ceil(total / logsLimit);
  const currentPageNum = Math.floor(logsOffset / logsLimit) + 1;

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  let html = '';
  if (currentPageNum > 1) {
    html += `<button data-page="${currentPageNum - 1}">Previous</button>`;
  }
  for (let i = 1; i <= Math.min(totalPages, 5); i++) {
    html += `<button data-page="${i}" class="${i === currentPageNum ? 'active' : ''}">${i}</button>`;
  }
  if (currentPageNum < totalPages) {
    html += `<button data-page="${currentPageNum + 1}">Next</button>`;
  }

  pagination.innerHTML = html;

  pagination.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      logsOffset = (parseInt(btn.dataset.page) - 1) * logsLimit;
      loadLogs();
    });
  });
}

function initLogModal() {
  document.getElementById('closeLogDetail').addEventListener('click', () => {
    document.getElementById('logDetailModal').classList.remove('active');
  });

  document.getElementById('logDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'logDetailModal') {
      document.getElementById('logDetailModal').classList.remove('active');
    }
  });

  document.getElementById('refreshLogs').addEventListener('click', loadLogs);
}

async function showLogDetail(id) {
  const modal = document.getElementById('logDetailModal');
  const content = document.getElementById('logDetailContent');

  content.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.add('active');

  try {
    const response = await fetch(`/api/logs/${id}`);
    const data = await response.json();

    content.innerHTML = `
      <div class="log-detail">
        <h4>Task: ${escapeHtml(data.task?.description || 'Unknown')}</h4>
        <div class="summary-item">
          <span class="summary-label">ID</span>
          <span class="summary-value"><code>${data.task?.id || id}</code></span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Status</span>
          <span class="summary-value"><span class="status-badge ${data.task?.status}">${data.task?.status}</span></span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Iterations</span>
          <span class="summary-value">${data.task?.iterations || '-'}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Cost</span>
          <span class="summary-value">${data.task?.cost ? `$${data.task.cost.toFixed(4)}` : '-'}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Started</span>
          <span class="summary-value">${data.task?.startTime ? new Date(data.task.startTime).toLocaleString() : '-'}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Ended</span>
          <span class="summary-value">${data.task?.endTime ? new Date(data.task.endTime).toLocaleString() : '-'}</span>
        </div>

        ${data.iterations ? `
          <h4 style="margin-top: 20px;">Iterations (${data.iterations.length})</h4>
          ${data.iterations.map((iter, i) => `
            <div class="guidelines-file">
              <h4>Iteration ${i + 1}</h4>
              <pre>${escapeHtml(JSON.stringify(iter, null, 2))}</pre>
            </div>
          `).join('')}
        ` : ''}
      </div>
    `;
  } catch (error) {
    content.innerHTML = '<div class="loading">Failed to load log details</div>';
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

// Task Runner
function initTaskRunner() {
  document.getElementById('runTaskBtn').addEventListener('click', startTask);
  document.getElementById('cancelTaskBtn').addEventListener('click', cancelTask);
  document.getElementById('newTaskBtn').addEventListener('click', resetTaskRunner);
  document.getElementById('viewLogsBtn').addEventListener('click', () => {
    navigateTo('logs');
  });
}

async function checkRunningTask() {
  try {
    const response = await fetch('/api/task/current');
    const data = await response.json();

    if (data.running) {
      runningTaskId = data.task.id;
      showRunningSection(data.task.description);
    }
  } catch (error) {
    console.error('Failed to check running task:', error);
  }
}

async function startTask() {
  const description = document.getElementById('taskDescription').value.trim();

  if (!description) {
    alert('Please enter a task description');
    return;
  }

  const btn = document.getElementById('runTaskBtn');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const response = await fetch('/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Failed to start task');
      btn.disabled = false;
      btn.textContent = 'Run Task';
      return;
    }

    runningTaskId = data.taskId;
    showRunningSection(description);

  } catch (error) {
    alert('Failed to start task: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Run Task';
  }
}

async function cancelTask() {
  if (!runningTaskId) return;

  const btn = document.getElementById('cancelTaskBtn');
  btn.disabled = true;

  try {
    await fetch('/api/task/cancel', { method: 'POST' });
  } catch (error) {
    console.error('Failed to cancel task:', error);
    btn.disabled = false;
  }
}

function showRunningSection(description) {
  document.getElementById('taskInputSection').style.display = 'none';
  document.getElementById('taskRunningSection').style.display = 'block';
  document.getElementById('taskResultSection').style.display = 'none';

  document.getElementById('runningTaskDesc').textContent = description;
  document.getElementById('runningTaskStatus').textContent = 'Starting...';
  document.getElementById('taskStatusText').textContent = 'Starting task...';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('iterationCount').textContent = 'Iteration 0';
  document.getElementById('logEntries').innerHTML = '';

  addLogEntry('Task started', 'info');
}

function showResultSection(status, iterations, cost) {
  document.getElementById('taskInputSection').style.display = 'none';
  document.getElementById('taskRunningSection').style.display = 'none';
  document.getElementById('taskResultSection').style.display = 'block';

  const isSuccess = status === 'converged';
  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');

  icon.textContent = isSuccess ? '✓' : '✗';
  icon.className = 'result-icon ' + (isSuccess ? 'success' : 'danger');
  title.textContent = isSuccess ? 'Task Completed Successfully' : 'Task ' + status.charAt(0).toUpperCase() + status.slice(1);

  document.getElementById('finalStatus').innerHTML = `<span class="status-badge ${status}">${status}</span>`;
  document.getElementById('finalIterations').textContent = iterations || '-';
  document.getElementById('finalCost').textContent = cost ? `$${cost.toFixed(4)}` : '-';
}

function resetTaskRunner() {
  runningTaskId = null;

  document.getElementById('taskInputSection').style.display = 'block';
  document.getElementById('taskRunningSection').style.display = 'none';
  document.getElementById('taskResultSection').style.display = 'none';

  document.getElementById('taskDescription').value = '';
  document.getElementById('runTaskBtn').disabled = false;
  document.getElementById('runTaskBtn').textContent = 'Run Task';
}

function addLogEntry(message, type = 'info') {
  const entries = document.getElementById('logEntries');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;

  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-message">${escapeHtml(message)}</span>`;

  entries.appendChild(entry);
  entries.scrollTop = entries.scrollHeight;
}

// Task WebSocket Event Handlers
function handleTaskStarted(data) {
  if (currentPage === 'run-task') {
    runningTaskId = data.task?.id;
    showRunningSection(data.task?.description || 'Unknown task');
    document.getElementById('maxIterations').textContent = '/ ' + (data.maxIterations || 5);
  }
}

function handleTaskProgress(data) {
  if (currentPage === 'run-task' && data.message) {
    addLogEntry(data.message, 'info');
    document.getElementById('runningTaskStatus').textContent = data.message;
    document.getElementById('taskStatusText').textContent = data.message;
  }
}

function handleTaskIteration(data) {
  if (currentPage === 'run-task') {
    const iteration = data.iteration || 0;
    const maxIterations = data.maxIterations || 5;
    const progress = (iteration / maxIterations) * 100;

    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('iterationCount').textContent = 'Iteration ' + iteration;
    document.getElementById('maxIterations').textContent = '/ ' + maxIterations;

    const status = data.passed ? 'Passed' : 'Failed';
    const score = data.score !== undefined ? ` (score: ${data.score.toFixed(2)})` : '';
    addLogEntry(`Iteration ${iteration} ${status}${score}`, data.passed ? 'success' : 'warning');

    if (data.failures && data.failures.length > 0) {
      data.failures.forEach(f => addLogEntry(`  - ${f}`, 'error'));
    }
  }
}

function handleTaskEscalation(data) {
  if (currentPage === 'run-task') {
    addLogEntry(`Task escalated: ${data.reason}`, 'error');
    if (data.context?.suggestedAction) {
      addLogEntry(`Suggested: ${data.context.suggestedAction}`, 'warning');
    }
  }
}

function handleTaskCompleted(data) {
  runningTaskId = null;

  if (currentPage === 'run-task') {
    const status = data.status || 'completed';
    addLogEntry(`Task completed with status: ${status}`, status === 'converged' ? 'success' : 'warning');
    showResultSection(status, data.iterations, data.cost);
  }
}

function handleTaskCancelled(data) {
  runningTaskId = null;

  if (currentPage === 'run-task') {
    addLogEntry('Task cancelled', 'warning');
    showResultSection('cancelled', data.iterations, data.cost);
  }
}

function handleTaskError(data) {
  runningTaskId = null;

  if (currentPage === 'run-task') {
    addLogEntry(`Error: ${data.error || 'Unknown error'}`, 'error');
    showResultSection('failed', null, null);
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
    updateContextAgentMetrics(metrics);

  } catch (error) {
    console.error('Failed to load context stats:', error);
    document.getElementById('commonMissesList').innerHTML = '<div class="loading">Failed to load</div>';
    document.getElementById('commonUnusedList').innerHTML = '<div class="loading">Failed to load</div>';
  }
}

function updateContextAgentMetrics(metrics) {
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
    // Load context stats for context agent metrics
    const contextResponse = await fetch('/api/context-stats?days=30');
    const contextMetrics = await contextResponse.json();
    updateContextAgentMetrics(contextMetrics);

    // Task agent metrics come from the status API (already loaded in loadDashboard)
  } catch (error) {
    console.error('Failed to load agent metrics:', error);
  }
}

// Utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
