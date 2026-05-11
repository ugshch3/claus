// Session Manager — Application Logic
// ==========================================

// ---- State ----
const state = {
  projects: [],
  works: [],
  selectedProjectId: null,
  selectedWorkId: null,
  activeRuns: {},      // workId → { events: [] }
  settings: {},
  currentView: 'works', // 'works' | 'project-create' | 'settings'
};

// ---- API helpers ----
const api = window.electronAPI;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', async () => {
  await loadProjects();
  await loadSettings();
  bindNavigation();
  bindForms();
  bindEvents();
  showView('works');
});

// ---- Data loading ----
async function loadProjects() {
  state.projects = await api.projectList();
  renderProjectList();
}

async function loadWorks() {
  state.works = state.selectedProjectId
    ? await api.workList(state.selectedProjectId)
    : [];
  renderWorkList();
}

async function loadSettings() {
  state.settings = await api.settingsGet();
  renderSettingsForm();
}

// ---- Navigation ----
function bindNavigation() {
  document.getElementById('btn-new-project').addEventListener('click', () => showView('project-create'));
  document.getElementById('btn-settings').addEventListener('click', () => showView('settings'));
  document.getElementById('btn-cancel-project').addEventListener('click', () => showView('works'));
  document.getElementById('btn-cancel-settings').addEventListener('click', () => showView('works'));
}

function showView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  if (name === 'works') {
    document.getElementById('view-works').classList.remove('hidden');
  } else if (name === 'project-create') {
    document.getElementById('view-project-create').classList.remove('hidden');
  } else if (name === 'settings') {
    document.getElementById('view-settings').classList.remove('hidden');
  }
}

// ---- Project List ----
function renderProjectList() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  state.projects.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.className = p.id === state.selectedProjectId ? 'active' : '';
    li.addEventListener('click', () => selectProject(p.id));
    list.appendChild(li);
  });
}

async function selectProject(id) {
  state.selectedProjectId = id;
  state.selectedWorkId = null;
  renderProjectList();
  document.getElementById('works-title').textContent =
    state.projects.find(p => p.id === id)?.name || 'Select a project';
  document.getElementById('btn-new-work').classList.remove('hidden');
  document.getElementById('work-detail').classList.add('hidden');
  document.getElementById('work-create-form').classList.add('hidden');
  await loadWorks();
  showView('works');
}

// ---- Project Create ----
function bindForms() {
  document.getElementById('form-project-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('proj-name').value.trim();
    const path = document.getElementById('proj-path').value.trim();
    const profile = document.getElementById('proj-profile').value;
    if (!name || !path) return;

    try {
      await api.projectCreate({ name, path, profile });
      document.getElementById('form-project-create').reset();
      await loadProjects();
      showView('works');
    } catch (err) {
      alert('Error: ' + (err.userMessage || err.message || String(err)));
    }
  });

  // New Work button
  document.getElementById('btn-new-work').addEventListener('click', () => {
    document.getElementById('work-detail').classList.add('hidden');
    document.getElementById('work-create-form').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-work').addEventListener('click', () => {
    document.getElementById('work-create-form').classList.add('hidden');
    document.getElementById('form-work-create').reset();
  });

  // Work Create form
  document.getElementById('form-work-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = document.getElementById('work-desc').value.trim();
    const branchName = document.getElementById('work-branch').value.trim();
    if (!description || !branchName) return;

    try {
      const work = await api.workCreate({
        projectId: state.selectedProjectId,
        description,
        branchName,
      });
      document.getElementById('work-create-form').classList.add('hidden');
      document.getElementById('form-work-create').reset();
      await loadWorks();
      selectWork(work.id);
    } catch (err) {
      alert('Error: ' + (err.userMessage || err.message || String(err)));
    }
  });

  // Work respond form
  document.getElementById('form-respond').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('respond-message').value.trim();
    if (!message || !state.selectedWorkId) return;
    document.getElementById('respond-message').value = '';
    await api.workRespond(state.selectedWorkId, message);
  });

  // Complete work
  document.getElementById('btn-complete-work').addEventListener('click', async () => {
    if (!state.selectedWorkId) return;
    await api.workComplete(state.selectedWorkId);
    await loadWorks();
    document.getElementById('work-detail').classList.add('hidden');
    state.selectedWorkId = null;
  });

  // Cancel run
  document.getElementById('btn-cancel-run').addEventListener('click', async () => {
    if (!state.selectedWorkId) return;
    await api.workCancel(state.selectedWorkId);
  });

  // Settings form
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      watchdogTimeoutMinutes: parseInt(document.getElementById('set-watchdog').value) || 10,
      defaultMaxTurns: parseInt(document.getElementById('set-max-turns').value) || 25,
      defaultProfile: document.getElementById('set-profile').value,
    };
    state.settings = await api.settingsUpdate(settings);
    renderSettingsForm();
    showView('works');
  });
}

// ---- Work List ----
function renderWorkList() {
  const list = document.getElementById('work-list');
  list.innerHTML = '';

  if (state.works.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.selectedProjectId ? 'No works yet. Create one!' : 'Select a project to see works.';
    list.appendChild(empty);
    return;
  }

  state.works.forEach(w => {
    const li = document.createElement('li');
    li.className = w.id === state.selectedWorkId ? 'active' : '';

    const main = document.createElement('div');
    main.className = 'work-item-main';

    const desc = document.createElement('div');
    desc.className = 'work-item-desc';
    desc.textContent = w.description;

    const meta = document.createElement('div');
    meta.className = 'work-item-meta';
    const date = new Date(w.lastActiveAt).toLocaleString();
    meta.textContent = `Branch: ${w.branch} · Runs: ${w.runCount} · ${date}`;

    main.appendChild(desc);
    main.appendChild(meta);
    li.appendChild(main);
    li.appendChild(renderStatusBadge(w.status, w.statusNote));

    li.addEventListener('click', () => selectWork(w.id));
    list.appendChild(li);
  });
}

// ---- Status Badge ----
function renderStatusBadge(status, note) {
  const span = document.createElement('span');
  span.className = `status-badge status-${status}`;
  const labels = { IN_PROGRESS: 'Running', AWAITING_INPUT: 'Needs input', COMPLETED: 'Done' };
  span.textContent = note ? `${labels[status] || status} (${note})` : (labels[status] || status);
  return span;
}

// ---- Work Detail ----
async function selectWork(workId) {
  state.selectedWorkId = workId;
  renderWorkList();
  document.getElementById('work-create-form').classList.add('hidden');

  const { work, lastResult } = await api.workGet(workId);
  renderWorkDetail(work, lastResult);
}

function renderWorkDetail(work, lastResult) {
  document.getElementById('work-detail').classList.remove('hidden');
  document.getElementById('work-detail-title').textContent = work.description;
  document.getElementById('work-detail-branch').textContent = `Branch: ${work.branch}`;
  document.getElementById('work-detail-runs').textContent = `Runs: ${work.runCount}`;

  const statusBadge = renderStatusBadge(work.status, work.statusNote);
  const statusContainer = document.getElementById('work-detail-status');
  statusContainer.innerHTML = '';
  statusContainer.appendChild(statusBadge);

  const runProgress = document.getElementById('run-progress');
  const awaitingInput = document.getElementById('awaiting-input');
  const cancelBtn = document.getElementById('btn-cancel-run');

  if (work.status === 'IN_PROGRESS') {
    runProgress.classList.remove('hidden');
    awaitingInput.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    // Show existing events if we have them
    renderStreamEvents(work.id);
  } else if (work.status === 'AWAITING_INPUT') {
    runProgress.classList.add('hidden');
    awaitingInput.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    const resultEl = document.getElementById('last-result');
    resultEl.textContent = lastResult || '(no output)';
    document.getElementById('respond-message').value = '';
  } else {
    // COMPLETED
    runProgress.classList.add('hidden');
    awaitingInput.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    if (lastResult) {
      document.getElementById('awaiting-input').classList.remove('hidden');
      document.getElementById('last-result').textContent = lastResult;
      document.getElementById('form-respond').classList.add('hidden');
    }
  }
}

function renderStreamEvents(workId) {
  const container = document.getElementById('stream-events');
  const events = state.activeRuns[workId]?.events || [];
  container.innerHTML = '';
  events.forEach(ev => container.appendChild(renderStreamEvent(ev)));
  container.scrollTop = container.scrollHeight;
}

// ---- Stream Event Card ----
function renderStreamEvent(event) {
  const div = document.createElement('div');
  div.className = `stream-event type-${event.type}`;

  const typeLabel = document.createElement('div');
  typeLabel.className = 'event-type';
  typeLabel.textContent = event.type + (event.subtype ? ` / ${event.subtype}` : '');

  const content = document.createElement('div');
  content.className = 'event-content';

  if (event.type === 'assistant' && event.message?.content) {
    event.message.content.forEach(part => {
      if (part.type === 'thinking') {
        const toggle = document.createElement('span');
        toggle.className = 'thinking-toggle';
        toggle.textContent = '[thinking] ';
        toggle.addEventListener('click', function () {
          const t = this.nextElementSibling;
          t.style.display = t.style.display === 'block' ? 'none' : 'block';
        });
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-content';
        thinkingDiv.textContent = part.thinking;
        content.appendChild(toggle);
        content.appendChild(thinkingDiv);
      } else if (part.type === 'text') {
        const textEl = document.createElement('span');
        textEl.textContent = part.text;
        content.appendChild(textEl);
      }
    });
  } else if (event.type === 'result') {
    const pre = document.createElement('pre');
    pre.textContent = `Result: ${event.result}\nTurns: ${event.num_turns} · Cost: $${event.total_cost_usd}`;
    content.appendChild(pre);
  } else if (event.type === 'system' && event.subtype === 'init') {
    content.textContent = `Session started · Model: ${event.model} · Tools: ${event.tools?.length || 0}`;
  } else {
    content.textContent = JSON.stringify(event, null, 1);
  }

  div.appendChild(typeLabel);
  div.appendChild(content);
  return div;
}

// ---- Settings ----
function renderSettingsForm() {
  document.getElementById('set-watchdog').value = state.settings.watchdogTimeoutMinutes;
  document.getElementById('set-max-turns').value = state.settings.defaultMaxTurns;
  document.getElementById('set-profile').value = state.settings.defaultProfile;
}

// ---- IPC Events (Main → Renderer) ----
function bindEvents() {
  api.onRunStarted(({ workId }) => {
    if (!state.activeRuns[workId]) {
      state.activeRuns[workId] = { events: [] };
    }
    state.activeRuns[workId].events = [];
    if (workId === state.selectedWorkId) {
      document.getElementById('stream-events').innerHTML = '';
    }
    // Refresh work list to show IN_PROGRESS
    loadWorks();
  });

  api.onRunEvent(({ workId, event }) => {
    // Store event
    if (!state.activeRuns[workId]) {
      state.activeRuns[workId] = { events: [] };
    }
    state.activeRuns[workId].events.push(event);

    // Update UI if this work is selected
    if (workId === state.selectedWorkId) {
      const container = document.getElementById('stream-events');
      container.appendChild(renderStreamEvent(event));
      container.scrollTop = container.scrollHeight;
    }
  });

  api.onRunCompleted(async ({ workId, exitCode, reason }) => {
    // Refresh work data
    await loadWorks();

    // Update detail view if selected
    if (workId === state.selectedWorkId) {
      const { work, lastResult } = await api.workGet(workId);
      renderWorkDetail(work, lastResult);
    }
  });

  api.onWorkUpdated(async ({ work }) => {
    await loadWorks();
    if (work.id === state.selectedWorkId) {
      const { work: w, lastResult } = await api.workGet(work.id);
      renderWorkDetail(w, lastResult);
    }
  });
}
