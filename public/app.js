let currentRunId = null;
let activeEventSource = null;
let runsMap = new Map();

// Elements
const elConnectionStatus = document.getElementById('connection-status');
const elDemoBadge = document.getElementById('demo-badge');
const elRunsList = document.getElementById('runs-list');
const elRunsCount = document.getElementById('runs-count');
const elBtnStartDemo = document.getElementById('btn-start-demo');

const elMetricRunId = document.getElementById('metric-run-id');
const elMetricProject = document.getElementById('metric-project');
const elMetricProjectId = document.getElementById('metric-project-id');
const elMetricTaskId = document.getElementById('metric-task-id');
const elMetricState = document.getElementById('metric-state');
const elMetricDuration = document.getElementById('metric-duration');
const elMetricGptTurns = document.getElementById('metric-gpt-turns');
const elMetricAgExecutions = document.getElementById('metric-ag-executions');
const elMetricCorrections = document.getElementById('metric-corrections');
const elMetricDeployStatus = document.getElementById('metric-deploy-status');

const elTimeline = document.getElementById('events-timeline');

const elGptTimestamp = document.getElementById('gpt-timestamp');
const elGptLastDecision = document.getElementById('gpt-last-decision');
const elGptContext = document.getElementById('gpt-context');
const elGptAnalyzed = document.getElementById('gpt-analyzed');
const elGptNextAction = document.getElementById('gpt-next-action');

const elAgStatusPill = document.getElementById('ag-status-pill');
const elAgCurrentExec = document.getElementById('ag-current-exec');
const elAgDuration = document.getElementById('ag-duration');
const elAgCommand = document.getElementById('ag-command');
const elAgStdout = document.getElementById('ag-stdout');
const elAgChangedFiles = document.getElementById('ag-changed-files');

const elValLastRun = document.getElementById('validation-last-run');
const elValBuild = document.getElementById('val-build');
const elValUnit = document.getElementById('val-unit');
const elValIntegration = document.getElementById('val-integration');
const elValE2e = document.getElementById('val-e2e');
const elValSmoke = document.getElementById('val-smoke');
const elValDetails = document.getElementById('val-details');

const elDeployPill = document.getElementById('deploy-pill');
const elDeployUrl = document.getElementById('deploy-url');
const elDeployHttpStatus = document.getElementById('deploy-http-status');
const elDeployTime = document.getElementById('deploy-time');

const elWsGitStatus = document.getElementById('ws-git-status');
const elWsPath = document.getElementById('ws-path');
const elWsExpectedRepo = document.getElementById('ws-expected-repo');
const elWsActualRepo = document.getElementById('ws-actual-repo');
const elWsBranch = document.getElementById('ws-branch');
const elWsLastCommit = document.getElementById('ws-last-commit');

// API helpers
async function fetchRuns() {
  try {
    const res = await fetch('/api/runs');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const runs = await res.json();
    updateRunsList(runs);
    setConnectionState('LIVE');
    
    if (!currentRunId && runs.length > 0) {
      selectRun(runs[0].runId);
    }
  } catch (err) {
    setConnectionState('DISCONNECTED');
  }
}

async function fetchRunDetail(runId) {
  try {
    const res = await fetch('/api/runs/' + encodeURIComponent(runId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const run = await res.json();
    runsMap.set(run.runId, run);
    renderRunDetail(run);
  } catch (err) {
    console.error('Failed to load run detail:', err);
  }
}

function setConnectionState(state) {
  if (state === 'LIVE') {
    elConnectionStatus.className = 'status-indicator live';
    elConnectionStatus.querySelector('.status-text').textContent = 'LIVE';
  } else {
    elConnectionStatus.className = 'status-indicator disconnected';
    elConnectionStatus.querySelector('.status-text').textContent = 'DISCONNECTED';
  }
}

function updateRunsList(runs) {
  runsMap.clear();
  runs.forEach(r => runsMap.set(r.runId, r));
  elRunsCount.textContent = runs.length;

  if (runs.length === 0) {
    elRunsList.innerHTML = '<div class="empty-state">No runs recorded yet. Click "Start Demo Run" or trigger ClosedLoopEngine.</div>';
    return;
  }

  elRunsList.innerHTML = '';
  runs.forEach(run => {
    const card = document.createElement('div');
    card.className = 'run-card ' + (run.runId === currentRunId ? 'selected' : '');
    card.onclick = () => selectRun(run.runId);

    const isDemo = run.isDemo || (run.runId && run.runId.indexOf('DEMO') === 0);
    const stateClass = (run.status || 'idle').toLowerCase();
    const projLabel = run.projectName || run.project || 'N/A';

    card.innerHTML =
      '<div class="run-card-header">' +
        '<span class="run-card-id monospace">' + escapeHtml(run.runId) + '</span>' +
        '<span class="state-pill ' + stateClass + '">' + escapeHtml(run.status) + '</span>' +
      '</div>' +
      '<div class="run-card-project">' + escapeHtml(projLabel) + (isDemo ? ' <span class="badge">DEMO</span>' : '') + '</div>' +
      '<div class="run-card-meta">' +
        '<span>' + formatDuration(run.durationMs) + '</span>' +
        '<span>Turns: ' + (run.gptTurns || 0) + '</span>' +
      '</div>';
    elRunsList.appendChild(card);
  });
}

function selectRun(runId) {
  if (currentRunId === runId && activeEventSource) return;
  currentRunId = runId;

  document.querySelectorAll('.run-card').forEach(card => {
    const idEl = card.querySelector('.run-card-id');
    card.classList.toggle('selected', idEl && idEl.textContent === runId);
  });

  connectSSE(runId);
  fetchRunDetail(runId);
}

function connectSSE(runId) {
  if (activeEventSource) {
    activeEventSource.close();
  }

  elTimeline.innerHTML = '';
  const sseUrl = '/api/runs/' + encodeURIComponent(runId) + '/stream';
  activeEventSource = new EventSource(sseUrl);

  activeEventSource.onopen = () => {
    setConnectionState('LIVE');
  };

  activeEventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      appendTimelineEvent(event);
      fetchRunDetail(runId);
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  };

  activeEventSource.onerror = () => {
    setConnectionState('DISCONNECTED');
  };
}

function appendTimelineEvent(event) {
  const existing = document.getElementById('evt-' + event.id);
  if (existing) return;

  const placeholder = elTimeline.querySelector('.timeline-empty');
  if (placeholder) placeholder.remove();

  const entry = document.createElement('div');
  entry.id = 'evt-' + event.id;
  entry.className = 'event-entry event-' + event.type;

  const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '';
  const turnBadge = event.turn ? '<span class="event-turn-badge">T' + event.turn + '</span>' : '';
  const detailsJson = event.details ? JSON.stringify(event.details, null, 2) : '';

  entry.innerHTML =
    '<div class="event-header">' +
      '<div>' +
        '<span class="event-badge">' + event.type + '</span>' +
        turnBadge +
      '</div>' +
      '<span class="event-time">' + timeStr + '</span>' +
    '</div>' +
    '<div class="event-summary">' + escapeHtml(event.summary || '') + '</div>' +
    (detailsJson ?
      '<button class="event-details-toggle" onclick="toggleDetails(this)">▶ View Details</button>' +
      '<div class="event-details-box" style="display: none;">' + escapeHtml(detailsJson) + '</div>'
      : '');

  elTimeline.appendChild(entry);
  elTimeline.scrollTop = elTimeline.scrollHeight;
}

window.toggleDetails = function(btn) {
  const box = btn.nextElementSibling;
  if (box.style.display === 'none') {
    box.style.display = 'block';
    btn.textContent = '▼ Hide Details';
  } else {
    box.style.display = 'none';
    btn.textContent = '▶ View Details';
  }
};

function renderRunDetail(run) {
  if (!run) return;

  if (run.isDemo || (run.runId && run.runId.indexOf('DEMO') === 0)) {
    elDemoBadge.classList.remove('hidden');
  } else {
    elDemoBadge.classList.add('hidden');
  }

  elMetricRunId.textContent = run.runId || 'N/A';
  elMetricProject.textContent = run.projectName || run.project || 'N/A';
  if (elMetricProjectId) elMetricProjectId.textContent = run.projectId || 'N/A';
  if (elMetricTaskId) elMetricTaskId.textContent = run.taskId || 'N/A';
  elMetricState.textContent = run.status || 'IDLE';
  elMetricState.className = 'state-pill ' + (run.status || 'idle').toLowerCase();
  elMetricDuration.textContent = formatDuration(run.durationMs);
  elMetricGptTurns.textContent = run.gptTurns || 0;
  elMetricAgExecutions.textContent = run.agExecutions || 0;
  elMetricCorrections.textContent = run.corrections || 0;
  
  const deployStat = (run.deployStatus && run.deployStatus.status) || 'NOT_AVAILABLE';
  elMetricDeployStatus.textContent = deployStat;
  elMetricDeployStatus.className = 'state-pill ' + deployStat.toLowerCase().replace('_', '-');

  const gpt = run.gptView || {};
  elGptTimestamp.textContent = gpt.timestamp && gpt.timestamp !== 'NOT_AVAILABLE'
    ? new Date(gpt.timestamp).toLocaleTimeString()
    : 'NOT_AVAILABLE';
  elGptLastDecision.textContent = gpt.lastDecision || 'NOT_AVAILABLE';
  elGptContext.textContent = gpt.contextSummary || 'NOT_AVAILABLE';
  elGptAnalyzed.textContent = gpt.analyzedResult || 'NOT_AVAILABLE';
  elGptNextAction.textContent = gpt.nextAction || 'NOT_AVAILABLE';

  const ag = run.agView || {};
  elAgStatusPill.textContent = ag.status || 'IDLE';
  elAgStatusPill.className = 'state-pill ' + (ag.status || 'idle').toLowerCase();
  elAgCurrentExec.textContent = ag.currentExecution || 'NOT_AVAILABLE';
  elAgDuration.textContent = ag.durationMs !== 'NOT_AVAILABLE' && typeof ag.durationMs === 'number'
    ? (ag.durationMs / 1000).toFixed(1) + 's'
    : 'NOT_AVAILABLE';
  elAgCommand.textContent = ag.commandOrAction || 'NOT_AVAILABLE';
  elAgStdout.textContent = ag.stdoutSummary || 'NOT_AVAILABLE';
  elAgChangedFiles.textContent = (ag.changedFiles && ag.changedFiles.length > 0)
    ? ag.changedFiles.join(', ')
    : 'None';

  const val = run.tests || {};
  elValLastRun.textContent = val.lastRunAt && val.lastRunAt !== 'NOT_AVAILABLE'
    ? new Date(val.lastRunAt).toLocaleTimeString()
    : 'NOT_AVAILABLE';
  setMatrixPill(elValBuild, val.build);
  setMatrixPill(elValUnit, val.unit);
  setMatrixPill(elValIntegration, val.integration);
  setMatrixPill(elValE2e, val.e2e);
  setMatrixPill(elValSmoke, val.smoke);
  elValDetails.textContent = val.details || 'No validation reports recorded.';

  const dep = run.deployStatus || {};
  setMatrixPill(elDeployPill, dep.status);
  elDeployUrl.textContent = dep.publicUrl || 'NOT_AVAILABLE';
  elDeployHttpStatus.textContent = dep.httpStatus || 'NOT_AVAILABLE';
  elDeployTime.textContent = dep.lastDeploy && dep.lastDeploy !== 'NOT_AVAILABLE'
    ? new Date(dep.lastDeploy).toLocaleTimeString()
    : 'NOT_AVAILABLE';

  const ws = run.workspace || {};
  elWsPath.textContent = ws.path || 'NOT_AVAILABLE';
  if (elWsExpectedRepo) elWsExpectedRepo.textContent = ws.expectedRepo || 'NOT_AVAILABLE';
  if (elWsActualRepo) elWsActualRepo.textContent = ws.actualRepo || 'NOT_AVAILABLE';
  if (elWsBranch) elWsBranch.textContent = ws.branch || 'NOT_AVAILABLE';
  elWsGitStatus.textContent = (ws.gitStatus || 'clean').toUpperCase();
  elWsLastCommit.textContent = ws.lastCommit || 'NOT_AVAILABLE';
}

function setMatrixPill(el, status) {
  const stat = status || 'NOT_AVAILABLE';
  el.textContent = stat;
  el.className = 'matrix-pill ' + stat.toLowerCase().replace('_', '-');
}

function formatDuration(ms) {
  if (!ms || ms === 0) return '0.0s';
  const seconds = (ms / 1000).toFixed(1);
  return seconds + 's';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

elBtnStartDemo.onclick = async () => {
  try {
    elBtnStartDemo.disabled = true;
    const res = await fetch('/api/demo/start', { method: 'POST' });
    const data = await res.json();
    await fetchRuns();
    selectRun(data.runId);
  } catch (err) {
    alert('Failed to start demo: ' + err.message);
  } finally {
    setTimeout(() => { elBtnStartDemo.disabled = false; }, 1000);
  }
};

fetchRuns();
setInterval(fetchRuns, 5000);
