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

// ---- Dialog helpers ----
function showDialog(title, bodyHTML, buttons) {
  const overlay = document.getElementById('dialog-overlay');
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-body').innerHTML = bodyHTML;
  const actions = document.getElementById('dialog-actions');
  actions.innerHTML = '';
  buttons.forEach(btn => {
    const b = document.createElement('button');
    b.textContent = btn.label;
    if (btn.cls) b.className = btn.cls;
    b.addEventListener('click', () => {
      overlay.classList.add('hidden');
      if (btn.onClick) btn.onClick();
    });
    actions.appendChild(b);
  });
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  };
  overlay.classList.remove('hidden');
}

function hideDialog() {
  document.getElementById('dialog-overlay').classList.add('hidden');
}

// ---- Error handling ----
function handleError(err, context) {
  // GitNotFoundError
  if (err.code === 'GIT_NOT_FOUND') {
    showDialog('Git Not Found', '<p>Git is not installed. Please install Git to use Session Manager.</p>', [
      { label: 'OK' },
    ]);
    return true;
  }

  // DirtyRepoError — handled specially with Discard option
  if (err.code === 'DIRTY_REPO') {
    const files = (err.files || []).map(f => `<li>${escapeHTML(f)}</li>`).join('');
    showDialog(
      'Dirty Repository',
      `<p>The repository has uncommitted changes:</p><ul>${files}</ul><p>Discard changes or commit them manually before creating a Work.</p>`,
      [
        {
          label: 'Discard Changes',
          cls: 'danger',
          onClick: () => context.onDiscard(),
        },
        { label: 'Cancel' },
      ]
    );
    return true;
  }

  // BranchExistsError
  if (err.code === 'BRANCH_EXISTS') {
    showDialog(
      'Branch Exists',
      `<p>${escapeHTML(err.userMessage || 'Branch already exists')}</p><p>Please choose a different branch name.</p>`,
      [{ label: 'OK' }]
    );
    return true;
  }

  return false; // not handled
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Work creation with error dialogs ----
async function submitWorkCreate(params) {
  try {
    const work = await api.workCreate(params);
    document.getElementById('work-create-form').classList.add('hidden');
    document.getElementById('form-work-create').reset();
    await loadWorks();
    await selectWork(work.id);
  } catch (err) {
    if (!handleError(err, {
      onDiscard: async () => {
        // Discard changes and retry
        const project = state.projects.find(p => p.id === params.projectId);
        if (project) {
          await api.projectDiscard(project.id);
        }
        await submitWorkCreate(params);
      },
    })) {
      // Generic error fallback
      showDialog('Error', `<p>${escapeHTML(err.userMessage || err.message || String(err))}</p>`, [
        { label: 'OK' },
      ]);
    }
  }
}

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', async () => {
  // Bind UI handlers first — always works regardless of data
  bindNavigation();
  bindForms();
  bindEvents();

  // Load data; failures are non-fatal
  try { await loadProjects(); } catch (e) { console.error('loadProjects failed:', e); }
  try { await loadSettings(); } catch (e) { console.error('loadSettings failed:', e); }

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
    li.className = p.id === state.selectedProjectId ? 'active' : '';

    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = p.name;
    name.addEventListener('click', () => selectProject(p.id));

    const del = document.createElement('button');
    del.className = 'project-delete';
    del.textContent = '×';
    del.title = 'Delete project';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProject(p);
    });

    li.appendChild(name);
    li.appendChild(del);
    list.appendChild(li);
  });
}

async function selectProject(id) {
  state.selectedProjectId = id;
  state.selectedWorkId = null;
  renderProjectList();
  const project = state.projects.find(p => p.id === id);
  document.getElementById('works-title').textContent =
    project?.name || 'Select a project';
  document.getElementById('works-path').textContent = project?.path || '';
  document.getElementById('btn-new-work').classList.remove('hidden');
  document.getElementById('work-detail').classList.add('hidden');
  document.getElementById('work-create-form').classList.add('hidden');
  await loadWorks();
  showView('works');
}

async function deleteProject(project) {
  showDialog(
    'Delete Project',
    `<p>Delete project <strong>${escapeHTML(project.name)}</strong>?</p><p>Works and session data will be permanently removed. This action cannot be undone.</p>`,
    [
      {
        label: 'Delete',
        cls: 'danger',
        onClick: async () => {
          try {
            await api.projectDelete(project.id);
            if (state.selectedProjectId === project.id) {
              state.selectedProjectId = null;
              state.selectedWorkId = null;
              document.getElementById('works-title').textContent = 'Select a project';
              document.getElementById('works-path').textContent = '';
              document.getElementById('btn-new-work').classList.add('hidden');
              document.getElementById('work-detail').classList.add('hidden');
              document.getElementById('work-list').innerHTML = '';
            }
            await loadProjects();
          } catch (err) {
            showDialog('Error', `<p>${escapeHTML(err.userMessage || err.message || String(err))}</p>`, [
              { label: 'OK' },
            ]);
          }
        },
      },
      { label: 'Cancel' },
    ]
  );
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
      if (!handleError(err, {})) {
        showDialog('Error', `<p>${escapeHTML(err.userMessage || err.message || String(err))}</p>`, [
          { label: 'OK' },
        ]);
      }
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
    const name = document.getElementById('work-name').value.trim();
    const description = document.getElementById('work-desc').value.trim();
    if (!name || !description) return;

    await submitWorkCreate({ projectId: state.selectedProjectId, name, description });
  });

  // Work respond form
  document.getElementById('form-respond').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('respond-message').value.trim();
    if (!message || !state.selectedWorkId) return;
    document.getElementById('respond-message').value = '';

    // Immediately show progress view for instant feedback
    document.getElementById('run-progress').classList.remove('hidden');
    document.getElementById('awaiting-input').classList.add('hidden');
    document.getElementById('btn-cancel-run').classList.remove('hidden');
    document.getElementById('stream-events').innerHTML = '';

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

  // Delete work
  document.getElementById('btn-delete-work').addEventListener('click', () => {
    if (!state.selectedWorkId) return;
    const work = state.works.find(w => w.id === state.selectedWorkId);
    const name = work ? workDisplayName(work) : 'this work';
    showDialog(
      'Delete Work',
      `<p>Delete <strong>${escapeHTML(name)}</strong>?</p><p>The work and its session data will be permanently removed. This action cannot be undone.</p>`,
      [
        {
          label: 'Delete',
          cls: 'danger',
          onClick: async () => {
            try {
              await api.workDelete(state.selectedWorkId);
              document.getElementById('work-detail').classList.add('hidden');
              state.selectedWorkId = null;
              await loadWorks();
            } catch (err) {
              showDialog('Error', `<p>${escapeHTML(err.userMessage || err.message || String(err))}</p>`, [
                { label: 'OK' },
              ]);
            }
          },
        },
        { label: 'Cancel' },
      ]
    );
  });

  // Cancel run
  document.getElementById('btn-cancel-run').addEventListener('click', async () => {
    if (!state.selectedWorkId) return;
    await api.workCancel(state.selectedWorkId);
  });

  // Rename work
  document.getElementById('btn-rename-work').addEventListener('click', () => {
    const titleRow = document.getElementById('work-detail-title-row');
    const renameRow = document.getElementById('work-detail-rename');
    const input = document.getElementById('rename-input');
    const work = state.works.find(w => w.id === state.selectedWorkId);
    input.value = work ? workDisplayName(work) : '';
    titleRow.classList.add('hidden');
    renameRow.classList.remove('hidden');
    input.focus();
  });

  document.getElementById('btn-rename-save').addEventListener('click', async () => {
    const name = document.getElementById('rename-input').value.trim();
    if (!name || !state.selectedWorkId) return;
    await api.workRename(state.selectedWorkId, name);
    await loadWorks();
    const { work, lastResult } = await api.workGet(state.selectedWorkId);
    renderWorkDetail(work, lastResult);
  });

  document.getElementById('rename-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-rename-save').click();
    } else if (e.key === 'Escape') {
      document.getElementById('btn-rename-cancel').click();
    }
  });

  document.getElementById('btn-rename-cancel').addEventListener('click', () => {
    document.getElementById('work-detail-title-row').classList.remove('hidden');
    document.getElementById('work-detail-rename').classList.add('hidden');
  });

  // Settings form
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      watchdogTimeoutMinutes: parseInt(document.getElementById('set-watchdog').value) || 10,
      defaultMaxTurns: parseInt(document.getElementById('set-max-turns').value) || 25,
      defaultProfile: document.getElementById('set-profile').value,
      customPromptFragment: document.getElementById('set-custom-prompt').value,
    };
    state.settings = await api.settingsUpdate(settings);
    renderSettingsForm();
    showView('works');
  });
}

// ---- Work helpers ----
function workDisplayName(w) {
  return w.name || w.description;
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
    desc.textContent = workDisplayName(w);

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
  document.getElementById('work-detail-title').textContent = workDisplayName(work);
  document.getElementById('work-detail-branch').textContent = `Branch: ${work.branch}`;
  document.getElementById('work-detail-runs').textContent = `Runs: ${work.runCount}`;

  // Rename controls
  const titleRow = document.getElementById('work-detail-title-row');
  const renameRow = document.getElementById('work-detail-rename');
  titleRow.classList.remove('hidden');
  renameRow.classList.add('hidden');

  const statusBadge = renderStatusBadge(work.status, work.statusNote);
  const statusContainer = document.getElementById('work-detail-status');
  statusContainer.innerHTML = '';
  statusContainer.appendChild(statusBadge);

  const runProgress = document.getElementById('run-progress');
  const awaitingInput = document.getElementById('awaiting-input');
  const cancelBtn = document.getElementById('btn-cancel-run');
  const deleteBtn = document.getElementById('btn-delete-work');

  if (work.status === 'IN_PROGRESS') {
    runProgress.classList.remove('hidden');
    awaitingInput.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    deleteBtn.classList.add('hidden');
    // Show existing events if we have them
    renderStreamEvents(work.id);
  } else if (work.status === 'AWAITING_INPUT') {
    runProgress.classList.add('hidden');
    awaitingInput.classList.remove('hidden');
    document.getElementById('form-respond').classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    deleteBtn.classList.add('hidden');
    const resultEl = document.getElementById('last-result');
    if (work.lastError) {
      // Run failed (e.g. exit 127 — wrapper misconfigured): surface stderr
      // instead of the stale result from the previous successful run.
      resultEl.textContent = `⚠️ Run failed${work.statusNote ? ` (${work.statusNote})` : ''}:\n\n${work.lastError}`;
      resultEl.classList.add('result-error');
    } else {
      resultEl.textContent = lastResult || '(no output)';
      resultEl.classList.remove('result-error');
    }
    document.getElementById('respond-message').value = '';
  } else {
    // COMPLETED
    runProgress.classList.add('hidden');
    awaitingInput.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    deleteBtn.classList.remove('hidden');
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
      } else if (part.type === 'tool_use') {
        content.appendChild(renderToolUse(part));
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

function renderToolUse(part) {
  const div = document.createElement('div');
  div.className = 'tool-use-block';

  const label = document.createElement('div');
  label.className = 'tool-use-label';
  label.textContent = part.name;
  div.appendChild(label);

  if (part.name === 'AskUserQuestion' && part.input?.questions) {
    part.input.questions.forEach(q => {
      const qDiv = document.createElement('div');
      qDiv.className = 'tool-use-question';
      qDiv.textContent = q.question;
      if (q.options) {
        const opts = document.createElement('ul');
        opts.className = 'tool-use-options';
        q.options.forEach(opt => {
          const li = document.createElement('li');
          li.textContent = opt.label + (opt.description ? ` — ${opt.description}` : '');
          opts.appendChild(li);
        });
        qDiv.appendChild(opts);
      }
      div.appendChild(qDiv);
    });
  } else {
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(part.input, null, 1);
    div.appendChild(details);
  }

  return div;
}

// ---- Settings ----
function renderSettingsForm() {
  document.getElementById('set-watchdog').value = state.settings.watchdogTimeoutMinutes;
  document.getElementById('set-max-turns').value = state.settings.defaultMaxTurns;
  document.getElementById('set-profile').value = state.settings.defaultProfile;
  document.getElementById('set-custom-prompt').value = state.settings.customPromptFragment || '';
}

// ---- IPC Events (Main → Renderer) ----
function bindEvents() {
  api.onRunStarted(async ({ workId }) => {
    if (!state.activeRuns[workId]) {
      state.activeRuns[workId] = { events: [] };
    }
    state.activeRuns[workId].events = [];
    if (workId === state.selectedWorkId) {
      document.getElementById('stream-events').innerHTML = '';
    }
    await loadWorks();
    // Transition UI to IN_PROGRESS if this work is selected
    // Check status: if onRunCompleted already fired (fast exit), skip to avoid overwriting
    if (workId === state.selectedWorkId) {
      const { work } = await api.workGet(workId);
      if (work.status === 'IN_PROGRESS') {
        renderWorkDetail(work, null);
      }
    }
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
