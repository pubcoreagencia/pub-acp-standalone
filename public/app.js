let currentRunId = null;
let activeEventSource = null;
let runsMap = new Map();
let currentRunEvents = [];

// DOM Elements - Main UI
const elConnectionStatus = document.getElementById('connection-status');
const elDemoBadge = document.getElementById('demo-badge');
const elRunsList = document.getElementById('runs-list');
const elRunsCount = document.getElementById('runs-count');
const elBtnStartDemo = document.getElementById('btn-start-demo');

// Header Status
const elHeaderStatusPill = document.getElementById('header-status-pill');
const elHeaderStatusText = document.getElementById('header-status-text');

// Hero Bar Elements
const elHeroProjectTitle = document.getElementById('hero-project-title');
const elHeroDemoTag = document.getElementById('hero-demo-tag');
const elHeroExecutorTag = document.getElementById('hero-executor-tag');
const elHeroRunId = document.getElementById('hero-run-id');
const elHeroTaskId = document.getElementById('hero-task-id');
const elHeroExecutorMode = document.getElementById('hero-executor-mode');
const elHeroExecutorProvider = document.getElementById('hero-executor-provider');
const elHeroDuration = document.getElementById('hero-duration');
const elHeroStateVal = document.getElementById('hero-state-val');

// Flow Container
const elConversationFlow = document.getElementById('conversation-flow');

// Technical Details & Matrix Elements
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

const elBrowserCdpPill = document.getElementById('browser-cdp-pill');
const elBrowserCdpEndpoint = document.getElementById('browser-cdp-endpoint');
const elBrowserProfilePath = document.getElementById('browser-profile-path');

const elWsPath = document.getElementById('ws-path');
const elWsActualRepo = document.getElementById('ws-actual-repo');
const elWsBranch = document.getElementById('ws-branch');
const elWsLastCommit = document.getElementById('ws-last-commit');
const elWsGitStatus = document.getElementById('ws-git-status');

const elMetricGptTurns = document.getElementById('metric-gpt-turns');
const elMetricAgExecutions = document.getElementById('metric-ag-executions');
const elMetricToolExecutions = document.getElementById('metric-tool-executions');
const elMetricCorrections = document.getElementById('metric-corrections');

// Compatibility elements (hidden, used by existing test assertions)
const elMetricRunId = document.getElementById('metric-run-id');
const elMetricProject = document.getElementById('metric-project');
const elMetricProjectId = document.getElementById('metric-project-id');
const elMetricTaskId = document.getElementById('metric-task-id');
const elMetricState = document.getElementById('metric-state');
const elMetricDuration = document.getElementById('metric-duration');
const elMetricDeployStatus = document.getElementById('metric-deploy-status');
const elTimeline = document.getElementById('events-timeline');

const statusLabelsPt = {
  'IDLE': 'AGUARDANDO',
  'STARTING': 'INICIANDO',
  'GPT_THINKING': 'GPT PENSANDO',
  'DIRECT_RUNNING': 'GPT DIRECT',
  'TOOL_RUNNING': 'EXECUTANDO TOOLS',
  'AG_RUNNING': 'AG EXECUTANDO',
  'VALIDATING': 'VALIDANDO',
  'WAITING': 'AGUARDANDO',
  'DEPLOYING': 'FAZENDO DEPLOY',
  'COMPLETED': 'CONCLUÍDO',
  'FAILED': 'FALHOU',
  'NOT_AVAILABLE': 'NÃO DISPONÍVEL'
};

function translateStatus(stat) {
  if (!stat) return 'AGUARDANDO';
  const upper = String(stat).toUpperCase();
  return statusLabelsPt[upper] || upper;
}

// API Functions
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
    console.error('Falha ao carregar detalhes da execução:', err);
  }
}

function setConnectionState(state) {
  if (state === 'LIVE') {
    elConnectionStatus.className = 'status-indicator live';
    elConnectionStatus.querySelector('.status-text').textContent = 'CONECTADO';
  } else {
    elConnectionStatus.className = 'status-indicator disconnected';
    elConnectionStatus.querySelector('.status-text').textContent = 'DESCONECTADO';
  }
}

function updateRunsList(runs) {
  runsMap.clear();
  runs.forEach(r => runsMap.set(r.runId, r));
  elRunsCount.textContent = runs.length;

  if (runs.length === 0) {
    elRunsList.innerHTML = '<div class="empty-state">Nenhuma execução registrada. Clique em "Simular Demo" para testar o fluxo.</div>';
    return;
  }

  elRunsList.innerHTML = '';
  runs.forEach(run => {
    const card = document.createElement('div');
    card.className = 'run-card ' + (run.runId === currentRunId ? 'selected' : '');
    card.onclick = () => selectRun(run.runId);

    const isDemo = run.isDemo || (run.runId && run.runId.indexOf('DEMO') === 0);
    const rawStatus = run.status || 'IDLE';
    const stateClass = rawStatus.toLowerCase();
    const projLabel = run.projectName || run.project || 'Projeto Sem Nome';

    card.innerHTML =
      '<div class="run-card-header">' +
        '<span class="run-card-id monospace">' + escapeHtml(run.runId) + '</span>' +
        '<span class="state-pill ' + stateClass + '">' + escapeHtml(translateStatus(rawStatus)) + '</span>' +
      '</div>' +
      '<div class="run-card-project">' + escapeHtml(projLabel) + (isDemo ? ' <span class="badge-demo-tag">DEMO</span>' : '') + '</div>' +
      '<div class="run-card-meta">' +
        '<span>⏱️ ' + formatDuration(run.durationMs) + '</span>' +
        '<span>Turnos: ' + (run.gptTurns || 0) + '</span>' +
      '</div>';
    elRunsList.appendChild(card);
  });
}

function selectRun(runId) {
  if (currentRunId === runId && activeEventSource) return;
  currentRunId = runId;
  currentRunEvents = [];

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

  elConversationFlow.innerHTML =
    '<div class="flow-empty-state">' +
      '<div class="empty-icon">⏳</div>' +
      '<div class="empty-text">Aguardando eventos do fluxo...</div>' +
    '</div>';

  const sseUrl = '/api/runs/' + encodeURIComponent(runId) + '/stream';
  activeEventSource = new EventSource(sseUrl);

  activeEventSource.onopen = () => {
    setConnectionState('LIVE');
  };

  activeEventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      appendFlowEvent(event);
      fetchRunDetail(runId);
    } catch (err) {
      console.error('Falha ao processar evento SSE:', err);
    }
  };

  activeEventSource.onerror = () => {
    setConnectionState('DISCONNECTED');
  };
}

function appendFlowEvent(event) {
  // Prevent duplicate events
  if (currentRunEvents.some(e => e.id === event.id)) return;
  currentRunEvents.push(event);

  // Remove empty state
  const emptyPlaceholder = elConversationFlow.querySelector('.flow-empty-state');
  if (emptyPlaceholder) emptyPlaceholder.remove();

  // Route event into Turn Group or standalone card
  const turn = event.turn || 0;
  let turnBlock = null;

  if (turn > 0) {
    const turnBlockId = 'flow-turn-' + turn;
    turnBlock = document.getElementById(turnBlockId);
    if (!turnBlock) {
      turnBlock = document.createElement('div');
      turnBlock.id = turnBlockId;
      turnBlock.className = 'turn-block';
      turnBlock.innerHTML =
        '<div class="turn-header">' +
          '<span class="turn-label">TURNO ' + turn + '</span>' +
          '<span class="turn-timestamp monospace">' + formatTime(event.timestamp) + '</span>' +
        '</div>' +
        '<div class="turn-body" id="turn-body-' + turn + '"></div>';
      elConversationFlow.appendChild(turnBlock);
    }
  }

  const container = turn > 0
    ? document.getElementById('turn-body-' + turn)
    : elConversationFlow;

  const card = createCardForEvent(event);
  if (card && container) {
    container.appendChild(card);
    elConversationFlow.scrollTop = elConversationFlow.scrollHeight;
  }
}

function createCardForEvent(event) {
  const card = document.createElement('div');
  const timeStr = formatTime(event.timestamp);

  const provider = (event.details && event.details.provider) || 'antigravity';
  const isDirect = provider === 'gpt';

  switch (event.type) {
    case 'EXECUTOR_SELECTED': {
      card.className = 'flow-card';
      const mode = (event.details && event.details.executorMode) || 'gpt-direct';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: var(--accent-cyan)">⚡ Modo de Execução: ' + escapeHtml(mode.toUpperCase()) + '</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + ' (Provider: ' + escapeHtml(provider) + ')</div>';
      return card;
    }

    case 'GPT_DECISION': {
      card.className = 'flow-card flow-card-gpt';
      const promptText = (event.details && (event.details.prompt || event.details.promptSnippet)) || event.summary;
      const reasoning = event.details && event.details.reasoning ? ('\n\nMotivo: ' + event.details.reasoning) : '';
      const fullText = promptText + reasoning;

      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">' + (isDirect ? '🧠 GPT Decisão (Direct Tools)' : '🧠 GPT → Antigravity') + '</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        '<div class="code-container">' +
          '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(fullText) + '</pre>' +
          '<div class="flow-actions">' +
            '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver mensagem completa</button>' +
            '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
          '</div>' +
        '</div>';
      return card;
    }

    case 'TOOL_STARTED': {
      card.className = 'flow-card flow-card-tool';
      const instructionText = (event.details && (event.details.instruction || event.details.instructionSnippet)) || event.summary;
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: var(--accent-cyan)">🛠️ Execução de Tools (GPT Direct)</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        '<div class="code-container">' +
          '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(instructionText) + '</pre>' +
          '<div class="flow-actions">' +
            '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver instrução completa</button>' +
            '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
          '</div>' +
        '</div>';
      return card;
    }

    case 'SANDBOX_EXECUTION': {
      card.className = 'flow-card flow-card-sandbox';
      const telemetry = event.details && event.details.telemetry;
      const teleStr = telemetry ? JSON.stringify(telemetry, null, 2) : event.summary;
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: #68d391">🛡️ Sandbox Operacional</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        (telemetry ? (
          '<div class="code-container">' +
            '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(teleStr) + '</pre>' +
            '<div class="flow-actions">' +
              '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver telemetria</button>' +
              '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
            '</div>' +
          '</div>'
        ) : '');
      return card;
    }

    case 'TOOL_FINISHED': {
      card.className = 'flow-card flow-card-tool';
      const responseText = (event.details && (event.details.response || event.details.outputSnippet)) || event.summary;
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: #68d391">🛠️ Resultado das Tools</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        '<div class="code-container">' +
          '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(responseText) + '</pre>' +
          '<div class="flow-actions">' +
            '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver saída completa</button>' +
            '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
          '</div>' +
        '</div>';
      return card;
    }

    case 'AG_STARTED': {
      card.className = 'flow-card flow-card-ag';
      const instructionText = (event.details && (event.details.instruction || event.details.instructionSnippet)) || event.summary;
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🤖 AG Iniciou Execução</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        '<div class="code-container">' +
          '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(instructionText) + '</pre>' +
          '<div class="flow-actions">' +
            '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver instrução completa</button>' +
            '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
          '</div>' +
        '</div>';
      return card;
    }

    case 'AG_OUTPUT':
    case 'AG_FINISHED': {
      card.className = 'flow-card flow-card-ag';
      const responseText = (event.details && (event.details.response || event.details.outputSnippet)) || event.summary;
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🤖 AG → Resposta do Agente</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>' +
        '<div class="code-container">' +
          '<pre class="code-block" id="cb-' + event.id + '">' + escapeHtml(responseText) + '</pre>' +
          '<div class="flow-actions">' +
            '<button class="flow-btn-link" onclick="toggleExpandCode(\'cb-' + event.id + '\', this)">📖 Ver resposta completa</button>' +
            '<button class="flow-btn-link" onclick="copyCode(\'cb-' + event.id + '\')">📋 Copiar</button>' +
          '</div>' +
        '</div>';
      return card;
    }

    case 'VALIDATION_STARTED': {
      card.className = 'flow-card';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: var(--accent-cyan)">🔎 Validação Iniciada</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'VALIDATION_RESULT': {
      const isFail = event.summary.toLowerCase().includes('failed') ||
        (event.details && (event.details.build === 'FAIL' || event.details.unit === 'FAIL'));
      card.className = 'flow-card ' + (isFail ? 'flow-card-val-fail' : 'flow-card-val-pass');
      const errInfo = (event.details && event.details.error) ? ('\n' + event.details.error) : '';

      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">' + (isFail ? '❌ Validação com Falha' : '✅ Validação Aprovada') + '</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary + errInfo) + '</div>';
      return card;
    }

    case 'GPT_REVIEW': {
      card.className = 'flow-card flow-card-gpt';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🧠 GPT Analisou Problema</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'CORRECTION': {
      card.className = 'flow-card flow-card-correction';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🔧 Correção Solicitada</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'DEPLOY_STARTED':
    case 'DEPLOY_RESULT': {
      card.className = 'flow-card flow-card-deploy';
      const isSuccess = event.type === 'DEPLOY_RESULT' && !event.summary.toLowerCase().includes('fail');
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🚀 ' + (isSuccess ? 'Deploy Concluído' : 'Processo de Deploy') + '</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'RUN_STARTED': {
      card.className = 'flow-card';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title" style="color: var(--accent-cyan)">🏁 Início da Execução</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'RUN_COMPLETED': {
      card.className = 'flow-card flow-card-val-pass';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">🎉 Execução Concluída com Sucesso</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    case 'RUN_FAILED': {
      card.className = 'flow-card flow-card-val-fail';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">💥 Execução Encerrada com Falha</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary) + '</div>';
      return card;
    }

    default: {
      card.className = 'flow-card';
      card.innerHTML =
        '<div class="flow-card-header">' +
          '<span class="flow-card-title">' + escapeHtml(event.type) + '</span>' +
          '<span class="flow-card-time monospace">' + timeStr + '</span>' +
        '</div>' +
        '<div class="flow-card-summary">' + escapeHtml(event.summary || '') + '</div>';
      return card;
    }
  }
}

window.toggleExpandCode = function(preId, btn) {
  const pre = document.getElementById(preId);
  if (!pre) return;
  if (pre.classList.contains('expanded')) {
    pre.classList.remove('expanded');
    btn.textContent = '📖 Ver mensagem completa';
  } else {
    pre.classList.add('expanded');
    btn.textContent = '▲ Recolher';
  }
};

window.copyCode = function(preId) {
  const pre = document.getElementById(preId);
  if (!pre) return;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    alert('Copiado para a área de transferência!');
  }).catch(() => {});
};

function renderRunDetail(run) {
  if (!run) return;

  const isDemo = run.isDemo || (run.runId && run.runId.indexOf('DEMO') === 0);
  if (isDemo) {
    elDemoBadge.classList.remove('hidden');
    elHeroDemoTag.classList.remove('hidden');
  } else {
    elDemoBadge.classList.add('hidden');
    elHeroDemoTag.classList.add('hidden');
  }

  // Header and Hero Bar
  const rawStatus = run.status || 'IDLE';
  const statusPt = translateStatus(rawStatus);
  const statusClass = rawStatus.toLowerCase();

  // Header live pill
  elHeaderStatusPill.className = 'header-status-pill ' + statusClass;
  elHeaderStatusText.textContent = statusPt;

  // Hero Bar
  elHeroProjectTitle.textContent = run.projectName || run.project || 'Projeto Sem Nome';
  elHeroRunId.textContent = run.runId || 'N/A';
  elHeroTaskId.textContent = run.taskId || 'N/A';
  elHeroDuration.textContent = formatDuration(run.durationMs);

  const executorMode = run.executorMode || 'gpt-direct';
  const executorProvider = run.provider || (executorMode === 'gpt-direct' ? 'gpt' : 'antigravity');
  if (elHeroExecutorMode) elHeroExecutorMode.textContent = executorMode;
  if (elHeroExecutorProvider) elHeroExecutorProvider.textContent = executorProvider;

  if (elHeroExecutorTag) {
    if (executorMode === 'gpt-direct') {
      elHeroExecutorTag.textContent = 'GPT DIRECT';
      elHeroExecutorTag.style.background = 'rgba(0, 242, 254, 0.15)';
      elHeroExecutorTag.style.borderColor = 'var(--accent-cyan)';
      elHeroExecutorTag.style.color = 'var(--accent-cyan)';
    } else {
      elHeroExecutorTag.textContent = 'GPT → AG';
      elHeroExecutorTag.style.background = 'rgba(255, 170, 0, 0.15)';
      elHeroExecutorTag.style.borderColor = '#ffa500';
      elHeroExecutorTag.style.color = '#ffa500';
    }
  }

  elHeroStateVal.className = 'state-pill ' + statusClass;
  elHeroStateVal.textContent = statusPt;

  // Render events if available from run detail and not yet loaded
  if (Array.isArray(run.events) && run.events.length > 0 && currentRunEvents.length === 0) {
    run.events.forEach(evt => appendFlowEvent(evt));
  }

  // Technical Details & Matrix
  const val = run.tests || {};
  setMatrixPill(elValBuild, val.build);
  setMatrixPill(elValUnit, val.unit);
  setMatrixPill(elValIntegration, val.integration);
  setMatrixPill(elValE2e, val.e2e);
  setMatrixPill(elValSmoke, val.smoke);
  elValDetails.textContent = val.details || 'Nenhum relatório de validação.';

  const dep = run.deployStatus || {};
  setMatrixPill(elDeployPill, dep.status);
  elDeployUrl.textContent = dep.publicUrl || 'N/A';
  elDeployHttpStatus.textContent = dep.httpStatus || 'N/A';
  elDeployTime.textContent = dep.lastDeploy && dep.lastDeploy !== 'NOT_AVAILABLE'
    ? formatTime(dep.lastDeploy)
    : 'N/A';

  const ws = run.workspace || {};
  elWsPath.textContent = ws.path || 'N/A';
  if (elWsActualRepo) elWsActualRepo.textContent = ws.actualRepo || 'N/A';
  if (elWsBranch) elWsBranch.textContent = ws.branch || 'N/A';
  if (elWsGitStatus) elWsGitStatus.textContent = (ws.gitStatus || 'clean').toUpperCase();
  if (elWsLastCommit) elWsLastCommit.textContent = ws.lastCommit || 'N/A';

  // Metrics Bar
  elMetricGptTurns.textContent = run.gptTurns || 0;
  elMetricAgExecutions.textContent = run.agExecutions || 0;
  if (elMetricToolExecutions) elMetricToolExecutions.textContent = run.toolExecutions || 0;
  elMetricCorrections.textContent = run.corrections || 0;

  // Sync hidden compatibility elements for existing test contracts
  if (elMetricRunId) elMetricRunId.textContent = run.runId || '';
  if (elMetricProject) elMetricProject.textContent = run.projectName || run.project || '';
  if (elMetricProjectId) elMetricProjectId.textContent = run.projectId || '';
  if (elMetricTaskId) elMetricTaskId.textContent = run.taskId || '';
  if (elMetricState) {
    elMetricState.textContent = rawStatus;
    elMetricState.className = 'state-pill ' + statusClass;
  }
  if (elMetricDuration) elMetricDuration.textContent = formatDuration(run.durationMs);
  if (elMetricDeployStatus) elMetricDeployStatus.textContent = (run.deployStatus && run.deployStatus.status) || 'NOT_AVAILABLE';
}

function setMatrixPill(el, status) {
  if (!el) return;
  const stat = status || 'NOT_AVAILABLE';
  el.textContent = stat;
  el.className = 'matrix-pill ' + stat.toLowerCase().replace('_', '-');
}

function formatDuration(ms) {
  if (!ms || ms === 0) return '0.0s';
  const seconds = (ms / 1000).toFixed(1);
  return seconds + 's';
}

function formatTime(iso) {
  if (!iso || iso === 'NOT_AVAILABLE') return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR');
  } catch (e) {
    return String(iso);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Dispatch Form Elements
const elDispatchForm = document.getElementById('dispatch-form');
const elSelectProject = document.getElementById('select-project');
const elSelectExecutor = document.getElementById('select-executor');
const elSelectConversation = document.getElementById('select-conversation');
const elInputInstruction = document.getElementById('input-instruction');
const elBtnDispatch = document.getElementById('btn-dispatch');
const elDispatchFeedback = document.getElementById('dispatch-feedback');

// Start Demo Click
elBtnStartDemo.onclick = async () => {
  try {
    elBtnStartDemo.disabled = true;
    const res = await fetch('/api/demo/start', { method: 'POST' });
    const data = await res.json();
    await fetchRuns();
    selectRun(data.runId);
  } catch (err) {
    alert('Falha ao iniciar simulação demo: ' + err.message);
  } finally {
    setTimeout(() => { elBtnStartDemo.disabled = false; }, 1000);
  }
};

// --- Dispatch Form Integration ---

async function loadProjects() {
  if (!elSelectProject) return;
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const projects = await res.json();

    elSelectProject.innerHTML = '<option value="">Selecione um projeto...</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.projectId;
      const branchInfo = p.defaultBranch ? ` (${p.defaultBranch})` : '';
      opt.textContent = `${p.projectName || p.projectId}${branchInfo}`;
      elSelectProject.appendChild(opt);
    });

    if (projects.length === 1) {
      elSelectProject.value = projects[0].projectId;
      loadConversations(projects[0].projectId);
    }
  } catch (err) {
    console.error('Falha ao carregar lista de projetos:', err);
    showDispatchFeedback('Falha ao carregar projetos registrados.', 'error');
  }
}

async function loadConversations(projectId) {
  if (!elSelectConversation) return;
  elSelectConversation.innerHTML = '<option value="">-- Nova conversation (padrão) --</option>';

  if (!projectId) {
    elSelectConversation.disabled = true;
    return;
  }

  elSelectConversation.disabled = true;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversations`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const convList = Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : []);

    if (convList.length > 0) {
      convList.forEach(conv => {
        const opt = document.createElement('option');
        opt.value = conv.conversationId;
        const preview = conv.title || conv.summarySnippet || (conv.conversationId.slice(0, 8) + '...');
        const updated = conv.lastModifiedTime ? ` (${formatTime(conv.lastModifiedTime)})` : (conv.updatedAt ? ` (${formatTime(conv.updatedAt)})` : '');
        opt.textContent = `${preview}${updated}`;
        elSelectConversation.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn('Falha ao buscar conversations do projeto:', err);
  } finally {
    elSelectConversation.disabled = false;
  }
}

function showDispatchFeedback(msg, type = 'info') {
  if (!elDispatchFeedback) return;
  elDispatchFeedback.textContent = msg;
  elDispatchFeedback.className = 'dispatch-feedback ' + type;
}

function clearDispatchFeedback() {
  if (!elDispatchFeedback) return;
  elDispatchFeedback.textContent = '';
  elDispatchFeedback.className = 'dispatch-feedback';
}

if (elSelectProject) {
  elSelectProject.addEventListener('change', (e) => {
    clearDispatchFeedback();
    loadConversations(e.target.value);
  });
}

if (elDispatchForm) {
  elDispatchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearDispatchFeedback();

    const projectId = elSelectProject ? elSelectProject.value.trim() : '';
    const conversationId = elSelectConversation ? elSelectConversation.value.trim() : '';
    const instruction = elInputInstruction ? elInputInstruction.value.trim() : '';

    if (!projectId) {
      showDispatchFeedback('Por favor, selecione um projeto.', 'error');
      return;
    }

    if (!instruction) {
      showDispatchFeedback('Por favor, digite uma instrução para o Antigravity.', 'error');
      return;
    }

    // Double-submit protection
    if (elBtnDispatch) {
      elBtnDispatch.disabled = true;
      elBtnDispatch.textContent = 'DISPATCHING...';
    }

    try {
      const executorMode = elSelectExecutor ? elSelectExecutor.value : 'gpt-direct';
      const payload = {
        projectId,
        instruction,
        executorMode
      };
      if (conversationId) {
        payload.conversationId = conversationId;
      }

      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const body = await res.json().catch(() => ({}));

      if (res.status === 202) {
        showDispatchFeedback(`Execução aceita (${executorMode})! Run ID: ${body.runId}`, 'success');
        if (elInputInstruction) elInputInstruction.value = '';

        // Immediate refresh and selection
        await fetchRuns();
        if (body.runId) {
          selectRun(body.runId);
        }
      } else if (res.status === 409) {
        showDispatchFeedback(`Bloqueado: ${body.error || 'Workspace já em execução.'}`, 'error');
      } else {
        showDispatchFeedback(`Erro (${res.status}): ${body.error || 'Falha ao despachar execução.'}`, 'error');
      }
    } catch (err) {
      showDispatchFeedback(`Erro de rede ao despachar: ${err.message}`, 'error');
    } finally {
      if (elBtnDispatch) {
        elBtnDispatch.disabled = false;
        elBtnDispatch.textContent = 'DISPARAR EXECUÇÃO';
      }
    }
  });
}

// Browser Station Status polling
async function fetchBrowserStatus() {
  if (!elBrowserCdpPill) return;
  try {
    const res = await fetch('/api/browser/status');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.status === 'CONNECTED') {
      elBrowserCdpPill.textContent = 'CONNECTED';
      elBrowserCdpPill.className = 'matrix-pill pass';
    } else {
      elBrowserCdpPill.textContent = 'DISCONNECTED';
      elBrowserCdpPill.className = 'matrix-pill not-available';
    }
    if (elBrowserCdpEndpoint) elBrowserCdpEndpoint.textContent = data.cdpEndpoint || 'http://127.0.0.1:9222';
    if (elBrowserProfilePath) elBrowserProfilePath.textContent = data.profileDir || '~/Documents/PUB-ACP/browser-profile';
  } catch {
    if (elBrowserCdpPill) {
      elBrowserCdpPill.textContent = 'OFFLINE';
      elBrowserCdpPill.className = 'matrix-pill not-available';
    }
  }
}

// Initializations
loadProjects();
fetchRuns();
fetchBrowserStatus();
setInterval(fetchRuns, 5000);
setInterval(fetchBrowserStatus, 10000);
