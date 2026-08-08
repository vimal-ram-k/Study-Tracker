/* ===================================================
   Daily Task Tracker — Core Application Logic
   Board: Epic | Sprint | Tasks | In Progress | Practice | Revise | Done
   State persisted in localStorage under "dtt_data"
   Sprints auto-created weekly Mon–Sat, named SPR-YYYY-WNN
   =================================================== */

// ─── Column definitions (order matters) ──────────────
const COLUMNS = [
  { id: 'epic',        label: 'Epic',        color: '#7c5cd8' },
  { id: 'sprint',      label: 'Sprint',      color: '#0891b2' },
  { id: 'todo',        label: 'Tasks',       color: '#475569', status: 'To Do'       },
  { id: 'inprogress',  label: 'In Progress', color: '#2563eb', status: 'In Progress' },
  { id: 'practice',    label: 'Practice',    color: '#d97706', status: 'Practice'    },
  { id: 'revise',      label: 'Revise',      color: '#db2777', status: 'Revise'      },
  { id: 'done',        label: 'Done',        color: '#16a34a', status: 'Done'        },
];

const STATUS_LIST = COLUMNS.filter(c => c.status).map(c => c.status);
// ['To Do', 'In Progress', 'Practice', 'Revise', 'Done']

// ─── State ───────────────────────────────────────────
const STORAGE_KEY = 'dtt_data';
let state = { epics: [], tasks: [], sprints: [] };

// Currently selected epic id — null means no selection
let selectedEpicId = null;
// Currently selected sprint id — null means no selection
let selectedSprintId = null;

// ─── View mode ───────────────────────────────────────
let viewMode = 'board';            // 'board' | 'grid'
let gridSelectedEpics = new Set(); // epic ids shown in grid view
let sharedGridSprintFilter = '';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (_) { /* ignore */ }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // excel.js patches window.saveState — call the hook if wired
  if (typeof window._onSaveState === 'function') window._onSaveState();
}

// ─── Sprint helpers ───────────────────────────────────

/** Return ISO week number (1-53) for a given Date */
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/** Return Monday of the week containing `d` */
function weekMonday(d) {
  const day = d.getDay() || 7;           // treat Sun as 7
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day - 1));
  mon.setHours(0, 0, 0, 0);
  return mon;
}

/** Format Date as YYYY-MM-DD */
function toISO(d) {
  return d.toISOString().slice(0, 10);
}

/** Build sprint name from a Monday date: SPR-YYYY-WNN */
function sprintName(monday) {
  const week = String(isoWeek(monday)).padStart(2, '0');
  return `SPR-${monday.getFullYear()}-W${week}`;
}

/** Get or auto-create the sprint for the current week */
/** Return the sprint whose date range covers today, or null */
function currentSprint() {
  const today = toISO(new Date());
  return allSprints().find(s => today >= s.startDate && today <= s.endDate) || null;
}

function ensureCurrentSprint() {
  const today  = new Date();
  const mon    = weekMonday(today);
  const sat    = new Date(mon); sat.setDate(mon.getDate() + 5);
  const name   = sprintName(mon);
  const start  = toISO(mon);
  const end    = toISO(sat);

  const exists = state.sprints.find(s => s.startDate === start);
  if (!exists) {
    state.sprints.push({ id: uid(), name, goal: '', startDate: start, endDate: end, auto: true });
    saveState();
  }
}

function allSprints() {
  return state.sprints || (state.sprints = []);
}

function sprintById(id) {
  return allSprints().find(s => s.id === id);
}

// ─── IDs ─────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Helpers ─────────────────────────────────────────
function allTasks() {
  return state.tasks || (state.tasks = []);
}

function tasksOf(epicId) {
  return allTasks().filter(t => t.epicId === epicId);
}

function tasksWithStatus(status) {
  let tasks = allTasks().filter(t => t.status === status);
  if (selectedSprintId) tasks = tasks.filter(t => t.sprintId === selectedSprintId);
  if (selectedEpicId)   tasks = tasks.filter(t => t.epicId   === selectedEpicId);
  return tasks;
}

function epicById(id) {
  return state.epics.find(e => e.id === id);
}

function priorityBadge(p) {
  const map = { High: 'high', Medium: 'medium', Low: 'low' };
  const colors = { High: '#dc2626', Medium: '#f59e0b', Low: '#16a34a' };
  const label = p || 'Medium';
  return `<span class="priority-dot priority-${map[p] || 'medium'}" title="${esc(label)}" style="background:${colors[p] || colors.Medium};"></span>`;
}

function statusClass(s) {
  return s.toLowerCase().replace(/\s+/g, '');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dueDate, status) {
  if (!dueDate || status === 'Done') return false;
  return new Date(dueDate + 'T00:00:00') < new Date(new Date().toDateString());
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseTimeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

function formatTimeLabel(epic) {
  if (!epic?.scheduleEnabled || !epic?.scheduleStart || !epic?.scheduleEnd) return '';
  const label = epic.scheduleLabel ? `${epic.scheduleLabel} ` : '';
  return `${label}${epic.scheduleStart}–${epic.scheduleEnd}`;
}

function getScheduledTasksForEpic(epicId) {
  const epic = epicById(epicId);
  if (!epic || !Array.isArray(epic.scheduledTaskIds)) return [];
  return allTasks().filter(task => task.epicId === epicId && epic.scheduledTaskIds.includes(task.id));
}

function isScheduleMissed(epic) {
  if (!epic?.scheduleEnabled || !epic?.scheduleStart || !epic?.scheduleEnd) return false;
  const scheduledTasks = getScheduledTasksForEpic(epic.id);
  const incomplete = scheduledTasks.filter(task => task.status !== 'Done');
  if (!scheduledTasks.length || !incomplete.length) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= parseTimeToMinutes(epic.scheduleEnd);
}

function buildSubtaskSummaryHtml(total, done) {
  return `⊞${total ? ` <span class="subtask-pill">${done}/${total}</span>` : ''}`;
}

// ─── Summary bar ─────────────────────────────────────
function renderHeaderSprintBadge() {
  const badge = document.getElementById('header-sprint-badge');
  if (!badge) return;
  const active = currentSprint();
  badge.textContent = active ? active.name : 'No current sprint';
}

function renderSummary() {
  let tasks = allTasks();
  if (selectedSprintId) tasks = tasks.filter(t => t.sprintId === selectedSprintId);
  else if (selectedEpicId) tasks = tasks.filter(t => t.epicId === selectedEpicId);

  const selectedEpic   = selectedEpicId   ? epicById(selectedEpicId)     : null;
  const selectedSprint = selectedSprintId ? sprintById(selectedSprintId) : null;

  const total    = tasks.length;
  const done     = tasks.filter(t => t.status === 'Done').length;
  const inprog   = tasks.filter(t => t.status === 'In Progress').length;
  const practice = tasks.filter(t => t.status === 'Practice').length;
  const revise   = tasks.filter(t => t.status === 'Revise').length;
  const overdue  = tasks.filter(t => isOverdue(t.dueDate, t.status)).length;
  const activeSprint  = currentSprint();
  const sprintCount   = activeSprint
    ? allTasks().filter(t => t.sprintId === activeSprint.id).length
    : 0;

  document.getElementById('summary-bar').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-value">${state.epics.length}</div>
      <div class="stat-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-start;">
        ${selectedEpic ? `<span title="${esc(selectedEpic.name)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;display:inline-block;">${esc(selectedEpic.name)}</span>` : 'Epics'}
        ${selectedEpic ? `<button class="btn-clear-epic" data-action="clear-epic" title="Clear filter">✕ clear</button>` : ''}
      </div>
    </div>
    <div class="stat-card sprint">
      <div class="stat-value">${selectedSprint ? total : sprintCount}</div>
      <div class="stat-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-start;">
        ${selectedSprint ? `<span title="${esc(selectedSprint.name)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;display:inline-block;">${esc(selectedSprint.name)}</span>` : 'Sprint Tasks'}
        ${selectedSprint ? `<button class="btn-clear-epic" data-action="clear-epic" title="Clear filter">✕ clear</button>` : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${total}</div>
      <div class="stat-label">${selectedSprint ? 'Sprint Tasks' : selectedEpic ? 'Epic Tasks' : 'Total Tasks'}</div>
    </div>
    <div class="stat-card warn">
      <div class="stat-value">${inprog}</div>
      <div class="stat-label">In Progress</div>
    </div>
    <div class="stat-card practice">
      <div class="stat-value">${practice}</div>
      <div class="stat-label">Practice</div>
    </div>
    <div class="stat-card revise">
      <div class="stat-value">${revise}</div>
      <div class="stat-label">Revise</div>
    </div>
    <div class="stat-card success">
      <div class="stat-value">${done}</div>
      <div class="stat-label">Done</div>
    </div>
    ${overdue ? `<div class="stat-card danger"><div class="stat-value">${overdue}</div><div class="stat-label">Overdue</div></div>` : ''}
  `;
}

// ─── Build the Kanban board ───────────────────────────
function renderBoard() {
  const grid = document.getElementById('epics-grid');
  grid.innerHTML = '';

  COLUMNS.forEach(col => {
    if      (col.id === 'epic')   grid.appendChild(buildEpicColumn());
    else if (col.id === 'sprint') grid.appendChild(buildSprintColumn());
    else                          grid.appendChild(buildStatusColumn(col));
  });
}

// ── Epic column ──────────────────────────────────────
function buildEpicColumn() {
  const col = document.createElement('div');
  col.className = 'kanban-col';

  const epics = state.epics;

  col.innerHTML = `
    <div class="col-header" style="--col-color:#7c5cd8">
      <span class="col-title">Epic</span>
      <span class="col-count">${epics.length}</span>
    </div>
    <div class="col-body" id="col-epic">
      ${epics.length === 0
        ? '<div class="col-empty">No epics yet.<br>Click + New Epic to start.</div>'
        : epics.map(e => buildEpicCard(e)).join('')}
    </div>
    <div class="col-footer">
      <button class="btn-col-add" data-action="add-epic">+ New Epic</button>
    </div>
  `;
  return col;
}

function buildEpicCard(epic) {
  const tasks    = tasksOf(epic.id);
  const total    = tasks.length;
  const done     = tasks.filter(t => t.status === 'Done').length;
  const pct      = total ? Math.round((done / total) * 100) : 0;
  const selected = selectedEpicId === epic.id;

  return `
    <div class="kcard kcard-epic${selected ? ' kcard-selected' : ''}"
         data-epic-id="${epic.id}" title="Click to filter board by this epic">
      <div class="kcard-select-area" data-action="select-epic" data-epic-id="${epic.id}">
        <div class="kcard-title" title="${esc(epic.name)}">${esc(epic.name)}</div>
        ${epic.desc ? `<div class="kcard-sub">${esc(epic.desc)}</div>` : ''}
        <div class="kcard-meta">
          ${priorityBadge(epic.priority)}
          <span class="kcard-count">${total} task${total !== 1 ? 's' : ''}</span>
        </div>
        <div class="kcard-progress">
          <div class="kprog-bar"><div class="kprog-fill" style="width:${pct}%"></div></div>
          <span class="kprog-label">${pct}%</span>
        </div>
      </div>
      <div class="kcard-actions">
        <button class="btn btn-secondary btn-icon" data-action="add-task" data-epic-id="${epic.id}" title="Add task">＋</button>
        <button class="btn btn-ghost btn-sm" data-action="edit-epic" data-id="${epic.id}" title="Edit">Edit</button>
        <button class="btn btn-delete" data-action="delete-epic" data-id="${epic.id}">Delete</button>
      </div>
    </div>
  `;
}

// ── Sprint column ────────────────────────────────────
function buildSprintColumn() {
  const el = document.createElement('div');
  el.className = 'kanban-col';

  const sprints = allSprints().slice().sort((a, b) => b.startDate.localeCompare(a.startDate));

  // Mark current / upcoming / past
  const today = toISO(new Date());

  el.innerHTML = `
    <div class="col-header col-header-sprint">
      <span class="col-title">Sprint</span>
      <span class="col-count">${sprints.length}</span>
    </div>
    <div class="col-body" id="col-sprint">
      ${sprints.length === 0
        ? '<div class="col-empty">No sprints yet</div>'
        : sprints.map(s => buildSprintCard(s, today)).join('')}
    </div>
    <div class="col-footer">
      <button class="btn-col-add" data-action="add-sprint">+ New Sprint</button>
    </div>
  `;
  return el;
}

function buildSprintCard(sprint, today) {
  const tasks      = allTasks().filter(t => t.sprintId === sprint.id
                       && (!selectedEpicId || t.epicId === selectedEpicId));
  const done       = tasks.filter(t => t.status === 'Done').length;
  const pct        = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const subTasks   = subtasksForSprint(sprint.id);
  const subDone    = subTasks.filter(s => s.status === 'Done').length;
  const isCurrent  = today >= sprint.startDate && today <= sprint.endDate;
  const isUpcoming = today < sprint.startDate;
  const statusTag  = isCurrent  ? '<span class="sprint-tag sprint-tag--active">Active</span>'
                   : isUpcoming ? '<span class="sprint-tag sprint-tag--upcoming">Upcoming</span>'
                   :              '<span class="sprint-tag sprint-tag--past">Past</span>';

  const isSelected = selectedSprintId === sprint.id;

  return `
    <div class="kcard kcard-sprint${isCurrent ? ' kcard-sprint--active' : ''}${isSelected ? ' kcard-selected' : ''}"
         title="Click to filter board by this sprint">
      <div class="kcard-select-area" data-action="select-sprint" data-id="${sprint.id}">
        <div class="kcard-title">${esc(sprint.name)} ${statusTag}</div>
        <div class="sprint-dates">📅 ${sprint.startDate} → ${sprint.endDate}</div>
        ${sprint.goal ? `<div class="kcard-sub">${esc(sprint.goal)}</div>` : ''}
        <div class="kcard-meta">
          <span class="kcard-count">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
        </div>
        ${tasks.length > 0 ? `
        <div class="kcard-progress">
          <div class="kprog-bar"><div class="kprog-fill" style="width:${pct}%"></div></div>
          <span class="kprog-label">${pct}%</span>
        </div>` : ''}
      </div>
      <button class="btn-subtasks" data-action="complete-sprint" data-id="${sprint.id}" title="View sprint subtasks">
        ${buildSubtaskSummaryHtml(subTasks.length, subDone)}
      </button>
      <div class="kcard-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-sprint" data-id="${sprint.id}" title="Edit">Edit</button>
        <button class="btn btn-delete" data-action="delete-sprint" data-id="${sprint.id}">Delete</button>
      </div>
    </div>
  `;
}

// ── Status column ────────────────────────────────────
function buildStatusColumn(col) {
  const tasks = tasksWithStatus(col.status);

  const el = document.createElement('div');
  el.className = 'kanban-col';
  el.dataset.status = col.status;

  // Determine the right empty-state message
  let emptyMsg;
  if (selectedEpicId) {
    emptyMsg = `<div class="col-empty">No ${col.label} tasks for this epic</div>`;
  } else if (selectedSprintId) {
    emptyMsg = `<div class="col-empty">No ${col.label} tasks in this sprint</div>`;
  } else if (allTasks().length === 0) {
    emptyMsg = `<div class="col-empty col-empty-hint">👈 Add tasks via an epic</div>`;
  } else {
    emptyMsg = `<div class="col-empty">No tasks here</div>`;
  }

  el.innerHTML = `
    <div class="col-header" style="--col-color:${col.color}">
      <span class="col-title">${col.label}</span>
      <span class="col-count">${tasks.length}</span>
    </div>
    <div class="col-body" id="col-${col.id}">
      ${tasks.length === 0 ? emptyMsg : tasks.map(t => buildTaskCard(t)).join('')}
    </div>
  `;
  return el;
}

function buildTaskCard(task) {
  const over       = isOverdue(task.dueDate, task.status);
  const epic       = epicById(task.epicId);
  const active     = currentSprint();
  const inSprint   = active && task.sprintId === active.id;
  const subCount   = subtasksOf(task.id).length;
  const subDone    = subtasksOf(task.id).filter(s => s.status === 'Done').length;
  const isActive   = _panelTaskId === task.id;

  return `
    <div class="kcard${isActive ? ' kcard--panel-active' : ''}" draggable="true" data-task-id="${task.id}">
      <div class="kcard-title" title="${esc(task.name)}">${esc(task.name)}</div>
      ${epic ? `<div class="kcard-epic-tag">${esc(epic.name)}</div>` : ''}
      ${inSprint ? `<div class="task-sprint-badge" title="${esc(active.name)}">⚡ ${esc(active.name)}</div>` : ''}
      <div class="kcard-meta">
        ${priorityBadge(task.priority)}
        ${task.assignee ? `<span class="kcard-assignee">👤 ${esc(task.assignee)}</span>` : ''}
      </div>
      ${task.dueDate ? `
        <div class="kcard-due ${over ? 'overdue' : ''}">
          ${over ? '⚠️ ' : '📅 '}${formatDate(task.dueDate)}
        </div>` : ''}
      <button class="btn-subtasks" data-action="view-subtasks" data-task-id="${task.id}">
        ${buildSubtaskSummaryHtml(subCount, subDone)}
      </button>
      <div class="kcard-actions">
        ${active
          ? inSprint
            ? `<button class="btn btn-secondary btn-icon btn-sprint-remove" data-action="remove-from-sprint" data-task-id="${task.id}" title="Remove from current sprint">✕</button>`
            : `<button class="btn btn-secondary btn-icon btn-sprint-add" data-action="add-to-sprint" data-task-id="${task.id}" title="Add to ${esc(active.name)}">⚡</button>`
          : ''}
        <button class="btn btn-ghost btn-sm" data-action="edit-task" data-task-id="${task.id}" title="Edit">Edit</button>
        <button class="btn btn-delete" data-action="delete-task" data-task-id="${task.id}">Delete</button>
      </div>
    </div>
  `;
}

// ─── Full re-render ───────────────────────────────────
function render() {
  renderHeaderSprintBadge();
  const summaryBar = document.getElementById('summary-bar');
  if (viewMode === 'grid') {
    summaryBar.style.display = 'none';
    renderGridView();
  } else {
    summaryBar.style.display = '';
    renderSummary();
    renderBoard();
    initDragDrop();
  }
  document.querySelectorAll('.col-body').forEach(cb => {
    cb.addEventListener('scroll', drawConnector, { passive: true });
  });
  requestAnimationFrame(drawConnector);
}

// ═══════════════════════════════════════════════════
// ─── Grid View ──────────────────────────────────────
// ═══════════════════════════════════════════════════

const GV_COLS = COLUMNS.filter(c => c.status);

// ── Picker bar ──────────────────────────────────────
function renderGridPicker() {
  const chips = document.getElementById('gv-picker-chips');
  const sharedSelect = document.getElementById('gv-shared-sprint-select');
  chips.innerHTML = '';
  state.epics.forEach(epic => {
    const on  = gridSelectedEpics.has(epic.id);
    const btn = document.createElement('button');
    btn.className   = 'gv-chip' + (on ? ' gv-chip--on' : '');
    btn.textContent = epic.name;
    btn.title       = epic.name;
    btn.dataset.epicId = epic.id;
    btn.addEventListener('click', () => {
      if (gridSelectedEpics.has(epic.id)) gridSelectedEpics.delete(epic.id);
      else                                gridSelectedEpics.add(epic.id);
      render();
    });
    chips.appendChild(btn);
  });

  sharedSelect.innerHTML = '<option value="">All sprints</option>';
  allSprints().slice().sort((a, b) => b.startDate.localeCompare(a.startDate)).forEach(sprint => {
    const option = document.createElement('option');
    option.value = sprint.id;
    option.textContent = sprint.name;
    if (sharedGridSprintFilter === sprint.id) option.selected = true;
    sharedSelect.appendChild(option);
  });
  sharedSelect.value = sharedGridSprintFilter;
}

// ── Main grid renderer ──────────────────────────────
function renderGridView() {
  const grid = document.getElementById('epics-grid');
  grid.innerHTML = '';
  grid.className  = 'epics-grid epics-grid--gv';

  renderGridPicker();

  // Default: select all if nothing chosen yet
  if (gridSelectedEpics.size === 0 && state.epics.length > 0) {
    state.epics.forEach(e => gridSelectedEpics.add(e.id));
    renderGridPicker();
  }

  const epicsToShow = state.epics.filter(e => gridSelectedEpics.has(e.id));
  if (epicsToShow.length === 0) {
    grid.innerHTML = '<div class="gv-empty">No epics selected — use the picker above.</div>';
    return;
  }

  // Chunk into rows of 2
  for (let i = 0; i < epicsToShow.length; i += 2) {
    const rowEl = document.createElement('div');
    rowEl.className = 'gv-row';
    epicsToShow.slice(i, i + 2).forEach(epic => buildGvPane(epic, rowEl));
    grid.appendChild(rowEl);
  }

  initGridDragDrop();
}

// ── One pane per epic ───────────────────────────────
function buildGvPane(epic, rowEl) {
  const pane = document.createElement('div');
  pane.className   = 'gv-pane';
  pane.dataset.epicId = epic.id;

  const sprintScope = epic.sprintFilterId || sharedGridSprintFilter || '';
  const tasks   = allTasks().filter(t => t.epicId === epic.id && (!sprintScope || t.sprintId === sprintScope));
  const done    = tasks.filter(t => t.status === 'Done').length;
  const missed  = isScheduleMissed(epic);
  const timeLabel = formatTimeLabel(epic);
  const scheduledTasks = getScheduledTasksForEpic(epic.id);

  if (missed) pane.classList.add('gv-pane--missed');

  // Compact pane header: epic name + progress + add-task button
  const hdr = document.createElement('div');
  hdr.className = 'gv-pane-header';
  hdr.innerHTML = `
    <div class="gv-pane-title" title="${esc(epic.name)}">${esc(epic.name)}</div>
    <div class="gv-pane-meta">
      ${priorityBadge(epic.priority)}
      ${timeLabel ? `<span class="gv-pane-schedule">⏰ ${esc(timeLabel)}</span>` : ''}
      ${scheduledTasks.length ? `<span class="gv-pane-schedule gv-pane-schedule--task">${scheduledTasks.length} scheduled</span>` : ''}
      ${missed ? '<span class="gv-pane-missed">Missed</span>' : ''}
      <label class="gv-pane-filter">
        <span>Sprint</span>
        <select data-action="set-sprint-filter" data-epic-id="${epic.id}">
          <option value="">All</option>
          ${allSprints().slice().sort((a, b) => b.startDate.localeCompare(a.startDate)).map(sprint => `<option value="${sprint.id}" ${epic.sprintFilterId === sprint.id ? 'selected' : ''}>${esc(sprint.name)}</option>`).join('')}
        </select>
      </label>
      <span class="gv-pane-stat">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      <span class="gv-pane-progress">${done} of ${tasks.length}</span>
      <button class="btn btn-secondary btn-sm" data-action="add-task" data-epic-id="${epic.id}">+ Task</button>
    </div>
  `;
  hdr.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'add-task') openTaskModal(b.dataset.epicId);
  });
  hdr.querySelector('select[data-action="set-sprint-filter"]')?.addEventListener('change', e => {
    const epicToUpdate = state.epics.find(entry => entry.id === e.target.dataset.epicId);
    if (!epicToUpdate) return;
    epicToUpdate.sprintFilterId = e.target.value || '';
    saveState(); render();
  });
  pane.appendChild(hdr);

  // Status columns
  const colRow = document.createElement('div');
  colRow.className = 'gv-col-row';

  GV_COLS.forEach(col => {
    const colTasks = tasks.filter(t => t.status === col.status);
    const colEl    = document.createElement('div');
    colEl.className = 'gv-col';
    colEl.innerHTML = `
      <div class="gv-col-header">
        <span class="gv-col-title">${col.label}</span>
        <span class="col-count">${colTasks.length}</span>
      </div>
      <div class="gv-col-body" id="gv-col-${epic.id}-${col.id}"
           data-epic-id="${epic.id}" data-status="${col.status}">
        ${colTasks.length === 0
          ? '<div class="col-empty" style="font-size:11px">Empty</div>'
          : colTasks.map(t => buildGvTaskCard(t, {
              missed: isScheduleMissed(epic) && getScheduledTasksForEpic(epic.id).some(task => task.id === t.id)
            })).join('')}
      </div>
    `;
    colRow.appendChild(colEl);
  });

  colRow.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action } = b.dataset;
    if (action === 'edit-task') {
      const task = allTasks().find(t => t.id === b.dataset.taskId);
      if (task) openTaskModal(task.epicId, task);
    }
    if (action === 'delete-task') {
      const task = allTasks().find(t => t.id === b.dataset.taskId);
      openConfirm(`Delete task "${task.name}"?`, () => {
        state.tasks = allTasks().filter(t => t.id !== b.dataset.taskId);
        saveState(); render(); showToast('Task deleted.');
      });
    }
    if (action === 'view-subtasks') openSubtaskPanel(b.dataset.taskId);
  });

  pane.appendChild(colRow);
  rowEl.appendChild(pane);
}

// ── Task card inside grid view ───────────────────────
function buildGvTaskCard(task, options = {}) {
  const over     = isOverdue(task.dueDate, task.status);
  const subCount = subtasksOf(task.id).length;
  const subDone  = subtasksOf(task.id).filter(s => s.status === 'Done').length;
  const isActive = _panelTaskId === task.id;
  const missed   = !!options.missed;
  return `
    <div class="kcard gv-kcard${isActive ? ' kcard--panel-active' : ''}${missed ? ' gv-kcard--missed' : ''}"
         draggable="true" data-task-id="${task.id}" data-epic-id="${task.epicId}">
      <div class="kcard-title" title="${esc(task.name)}">${esc(task.name)}</div>
      ${missed ? '<div class="gv-missed-pill">Missed schedule</div>' : ''}
      <div class="kcard-meta">
        ${priorityBadge(task.priority)}
        ${task.assignee ? `<span class="kcard-assignee">👤 ${esc(task.assignee)}</span>` : ''}
      </div>
      ${task.dueDate ? `<div class="kcard-due ${over ? 'overdue' : ''}">${over ? '⚠️ ' : '📅 '}${formatDate(task.dueDate)}</div>` : ''}
      <button class="btn-subtasks" data-action="view-subtasks" data-task-id="${task.id}">
        ${buildSubtaskSummaryHtml(subCount, subDone)}
      </button>
      <div class="kcard-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-task" data-task-id="${task.id}" title="Edit">Edit</button>
        <button class="btn btn-delete" data-action="delete-task" data-task-id="${task.id}">Delete</button>
      </div>
    </div>
  `;
}

// ── Drag-drop scoped per pane ────────────────────────
let _gvDragTaskId = null;

function initGridDragDrop() {
  document.querySelectorAll('.gv-kcard[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      _gvDragTaskId = card.dataset.taskId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _gvDragTaskId);
      requestAnimationFrame(() => card.classList.add('kcard--dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kcard--dragging');
      _gvDragTaskId = null;
      document.querySelectorAll('.gv-col-body.col-body--over')
        .forEach(el => el.classList.remove('col-body--over'));
    });
  });

  document.querySelectorAll('.gv-col-body').forEach(zone => {
    let _ec = 0;
    const sameEpic = () => {
      if (!_gvDragTaskId) return false;
      const t = allTasks().find(t => t.id === _gvDragTaskId);
      return t && t.epicId === zone.dataset.epicId;
    };
    zone.addEventListener('dragenter', e => {
      if (!sameEpic()) return;
      e.preventDefault(); _ec++;
      zone.classList.add('col-body--over');
    });
    zone.addEventListener('dragleave', () => {
      _ec--; if (_ec <= 0) { _ec = 0; zone.classList.remove('col-body--over'); }
    });
    zone.addEventListener('dragover', e => {
      if (!sameEpic()) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    });
    zone.addEventListener('drop', e => {
      e.preventDefault(); _ec = 0;
      zone.classList.remove('col-body--over');
      const taskId = _gvDragTaskId || e.dataTransfer.getData('text/plain');
      if (!taskId) return;
      const task = allTasks().find(t => t.id === taskId);
      if (!task || task.epicId !== zone.dataset.epicId) return;
      if (task.status === zone.dataset.status) return;
      task.status    = zone.dataset.status;
      task.updatedAt = new Date().toISOString();
      _gvDragTaskId  = null;
      saveState();
      requestAnimationFrame(() => render());
    });
  });
}

// ── Toggle button ────────────────────────────────────
document.getElementById('btn-grid-view').addEventListener('click', () => {
  viewMode = viewMode === 'grid' ? 'board' : 'grid';
  const btn    = document.getElementById('btn-grid-view');
  const picker = document.getElementById('gv-picker');
  if (viewMode === 'grid') {
    btn.classList.add('active');
    btn.title = 'Switch to board view';
    picker.classList.remove('hidden');
    closeSubtaskPanel();
  } else {
    btn.classList.remove('active');
    btn.title = 'Switch to grid view';
    picker.classList.add('hidden');
    document.getElementById('epics-grid').className = 'epics-grid';
  }
  render();
});

document.getElementById('gv-select-all').addEventListener('click', () => {
  state.epics.forEach(e => gridSelectedEpics.add(e.id));
  render();
});
document.getElementById('gv-clear-all').addEventListener('click', () => {
  gridSelectedEpics.clear();
  render();
});
document.getElementById('gv-shared-sprint-select').addEventListener('change', (e) => {
  sharedGridSprintFilter = e.target.value;
  render();
});
document.getElementById('gv-shared-sprint-select').addEventListener('change', (e) => {
  sharedGridSprintFilter = e.target.value;
  render();
});

// ─── Epic Modal ───────────────────────────────────────
let epicEditId = null;

function populateEpicScheduleTaskSelect(epic) {
  const select = document.getElementById('epic-scheduled-task-ids');
  const selectedIds = epic?.scheduledTaskIds || [];
  const tasks = allTasks()
    .filter(task => !epic || task.epicId === epic.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  select.innerHTML = '';
  if (!tasks.length) {
    const option = document.createElement('option');
    option.textContent = 'No tasks yet';
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  tasks.forEach(task => {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = `${task.name} (${task.status})`;
    if (selectedIds.includes(task.id)) option.selected = true;
    select.appendChild(option);
  });
  select.disabled = false;
}

function openEpicModal(epic = null) {
  epicEditId = epic ? epic.id : null;
  document.getElementById('epic-modal-title').textContent = epic ? 'Edit Epic' : 'New Epic';
  document.getElementById('epic-name').value     = epic ? epic.name     : '';
  document.getElementById('epic-desc').value     = epic ? epic.desc     : '';
  document.getElementById('epic-priority').value = epic ? epic.priority : 'Medium';
  document.getElementById('epic-schedule-enabled').checked = !!(epic?.scheduleEnabled);
  document.getElementById('epic-schedule-label').value = epic ? (epic.scheduleLabel || '') : '';
  document.getElementById('epic-schedule-start').value = epic ? (epic.scheduleStart || '') : '';
  document.getElementById('epic-schedule-end').value = epic ? (epic.scheduleEnd || '') : '';
  populateEpicScheduleTaskSelect(epic);
  document.getElementById('epic-modal').classList.remove('hidden');
  document.getElementById('epic-name').focus();
}

function closeEpicModal() {
  document.getElementById('epic-modal').classList.add('hidden');
}

document.getElementById('btn-add-epic').addEventListener('click', () => openEpicModal());
document.getElementById('epic-cancel').addEventListener('click', closeEpicModal);
document.getElementById('epic-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEpicModal();
});

document.getElementById('epic-save').addEventListener('click', () => {
  const name = document.getElementById('epic-name').value.trim();
  if (!name) { showToast('Epic name is required.'); return; }

  const scheduleSelect = document.getElementById('epic-scheduled-task-ids');
  const scheduledTaskIds = Array.from(scheduleSelect.selectedOptions).map(option => option.value).filter(Boolean);
  const schedulePayload = {
    scheduleEnabled: document.getElementById('epic-schedule-enabled').checked,
    scheduleLabel: document.getElementById('epic-schedule-label').value.trim(),
    scheduleStart: document.getElementById('epic-schedule-start').value,
    scheduleEnd: document.getElementById('epic-schedule-end').value,
    scheduledTaskIds,
  };

  if (epicEditId) {
    const epic = state.epics.find(e => e.id === epicEditId);
    epic.name     = name;
    epic.desc     = document.getElementById('epic-desc').value.trim();
    epic.priority = document.getElementById('epic-priority').value;
    Object.assign(epic, schedulePayload);
  } else {
    state.epics.push({
      id: uid(), name,
      desc:     document.getElementById('epic-desc').value.trim(),
      priority: document.getElementById('epic-priority').value,
      createdAt: new Date().toISOString(),
      ...schedulePayload
    });
  }
  saveState(); closeEpicModal(); render();
  showToast(epicEditId ? 'Epic updated.' : 'Epic created!');
});

// ─── Task Modal ───────────────────────────────────────
function openTaskModal(epicId, task = null) {
  document.getElementById('task-modal-title').textContent = task ? 'Edit Task' : 'Add Task';
  document.getElementById('task-epic-id').value  = epicId;
  document.getElementById('task-edit-id').value  = task ? task.id : '';
  document.getElementById('task-name').value     = task ? task.name      : '';
  document.getElementById('task-desc').value     = task ? task.desc      : '';
  document.getElementById('task-assignee').value = task ? task.assignee  : '';
  document.getElementById('task-due').value      = task ? task.dueDate   : '';
  document.getElementById('task-priority').value = task ? task.priority  : 'Medium';
  document.getElementById('task-status').value   = task ? task.status    : 'To Do';
  document.getElementById('task-modal').classList.remove('hidden');
  document.getElementById('task-name').focus();
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
}

document.getElementById('task-cancel').addEventListener('click', closeTaskModal);
document.getElementById('task-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTaskModal();
});

document.getElementById('task-save').addEventListener('click', () => {
  const name = document.getElementById('task-name').value.trim();
  if (!name) { showToast('Task name is required.'); return; }
  const epicId  = document.getElementById('task-epic-id').value;
  const editId  = document.getElementById('task-edit-id').value;
  const taskData = {
    name,
    desc:     document.getElementById('task-desc').value.trim(),
    assignee: document.getElementById('task-assignee').value.trim(),
    dueDate:  document.getElementById('task-due').value,
    priority: document.getElementById('task-priority').value,
    status:   document.getElementById('task-status').value,
  };

  if (editId) {
    Object.assign(allTasks().find(t => t.id === editId), taskData, { updatedAt: new Date().toISOString() });
    showToast('Task updated.');
  } else {
    allTasks().push({ id: uid(), epicId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData });
    showToast('Task added!');
  }
  saveState(); closeTaskModal(); render();
});

// ─── Confirm / Delete modal ───────────────────────────
let pendingDelete = null;

function openConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.remove('hidden');
  pendingDelete = cb;
}

document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-modal').classList.add('hidden');
  pendingDelete = null;
});
document.getElementById('confirm-ok').addEventListener('click', () => {
  document.getElementById('confirm-modal').classList.add('hidden');
  if (pendingDelete) { pendingDelete(); pendingDelete = null; }
});

// ─── Delegated events on board + summary bar ─────────
document.getElementById('epics-grid').addEventListener('click', handleGridClick);
// Redraw connector when columns are scrolled (cards shift vertically)
document.getElementById('epics-grid').addEventListener('scroll', drawConnector, { passive: true });

// Clear-epic button lives inside summary bar
document.getElementById('summary-bar').addEventListener('click', e => {
  if (e.target.closest('[data-action="clear-epic"]')) {
    selectedEpicId   = null;
    selectedSprintId = null;
    render();
  }
});

function handleGridClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;

  if (action === 'select-sprint') {
    const id = btn.dataset.id;
    selectedSprintId = selectedSprintId === id ? null : id;
    selectedEpicId   = null;   // clear epic filter when switching to sprint view
    render();
    return;
  }
  if (action === 'select-epic') {
    const epicId = btn.dataset.epicId;
    selectedEpicId   = selectedEpicId === epicId ? null : epicId;
    selectedSprintId = null;   // clear sprint filter when switching to epic view
    render();
    return;
  }
  if (action === 'add-sprint') {
    openSprintModal();
  }
  if (action === 'edit-sprint') {
    openSprintModal(sprintById(btn.dataset.id));
  }
  if (action === 'complete-sprint') {
    const sprint = sprintById(btn.dataset.id);
    if (!sprint) return;
    const sourceRect = btn.getBoundingClientRect();
    selectedSprintId = sprint.id;
    selectedEpicId = null;
    render();
    openSubtaskPanel({ sprintId: sprint.id, sourceRect });
    return;
  }
  if (action === 'delete-sprint') {
    const id  = btn.dataset.id;
    const spr = sprintById(id);
    openConfirm(`Delete sprint "${spr.name}"? Tasks will keep their sprint assignment.`, () => {
      if (selectedSprintId === id) selectedSprintId = null;
      state.sprints = allSprints().filter(s => s.id !== id);
      saveState(); render();
      showToast('Sprint deleted.');
    });
  }
  if (action === 'add-epic') {
    openEpicModal();
  }
  if (action === 'add-task') {
    openTaskModal(btn.dataset.epicId);
  }
  if (action === 'edit-epic') {
    openEpicModal(state.epics.find(ep => ep.id === btn.dataset.id));
  }
  if (action === 'delete-epic') {
    const id   = btn.dataset.id;
    const epic = state.epics.find(ep => ep.id === id);
    const cnt  = tasksOf(id).length;
    openConfirm(
      `Delete epic "${epic.name}"${cnt ? ` and its ${cnt} task(s)` : ''}? This cannot be undone.`,
      () => {
        if (selectedEpicId === id) selectedEpicId = null; // deselect if deleted
        state.epics = state.epics.filter(ep => ep.id !== id);
        state.tasks = allTasks().filter(t => t.epicId !== id);
        saveState(); render();
        showToast('Epic deleted.');
      }
    );
  }
  if (action === 'view-subtasks') {
    openSubtaskPanel({ taskId: btn.dataset.taskId, sourceEl: btn });
    return;
  }
  if (action === 'edit-task') {
    const task = allTasks().find(t => t.id === btn.dataset.taskId);
    openTaskModal(task.epicId, task);
  }
  if (action === 'add-to-sprint') {
    const active = currentSprint();
    if (!active) { showToast('No active sprint this week.'); return; }
    const task = allTasks().find(t => t.id === btn.dataset.taskId);
    task.sprintId = active.id;
    saveState(); render();
    showToast(`Added to ${active.name}`);
    return;
  }
  if (action === 'remove-from-sprint') {
    const task = allTasks().find(t => t.id === btn.dataset.taskId);
    task.sprintId = null;
    saveState(); render();
    showToast('Removed from sprint.');
    return;
  }
  if (action === 'delete-task') {
    const id   = btn.dataset.taskId;
    const task = allTasks().find(t => t.id === id);
    openConfirm(`Delete task "${task.name}"?`, () => {
      state.tasks = allTasks().filter(t => t.id !== id);
      saveState(); render();
      showToast('Task deleted.');
    });
  }
}

// ─── Sprint Modal ─────────────────────────────────────
function openSprintModal(sprint = null) {
  document.getElementById('sprint-modal-title').textContent = sprint ? 'Edit Sprint' : 'New Sprint';
  document.getElementById('sprint-edit-id').value = sprint ? sprint.id : '';

  if (sprint) {
    document.getElementById('sprint-name').value  = sprint.name;
    document.getElementById('sprint-goal').value  = sprint.goal || '';
    document.getElementById('sprint-start').value = sprint.startDate;
    document.getElementById('sprint-end').value   = sprint.endDate;
  } else {
    // Default to next available week that has no sprint yet
    const today = new Date();
    let mon = weekMonday(today);
    // If current week already has a sprint, jump to next Monday
    while (allSprints().find(s => s.startDate === toISO(mon))) {
      mon = new Date(mon); mon.setDate(mon.getDate() + 7);
    }
    const sat = new Date(mon); sat.setDate(mon.getDate() + 5);
    document.getElementById('sprint-name').value  = sprintName(mon);
    document.getElementById('sprint-goal').value  = '';
    document.getElementById('sprint-start').value = toISO(mon);
    document.getElementById('sprint-end').value   = toISO(sat);
  }
  document.getElementById('sprint-modal').classList.remove('hidden');
  document.getElementById('sprint-name').focus();
}

function closeSprintModal() {
  document.getElementById('sprint-modal').classList.add('hidden');
}

document.getElementById('sprint-cancel').addEventListener('click', closeSprintModal);
document.getElementById('sprint-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSprintModal();
});

// Auto-fill end date when start date changes
document.getElementById('sprint-start').addEventListener('change', () => {
  const start = document.getElementById('sprint-start').value;
  if (!start) return;
  const mon = new Date(start + 'T00:00:00');
  const sat = new Date(mon); sat.setDate(mon.getDate() + 5);
  document.getElementById('sprint-end').value   = toISO(sat);
  document.getElementById('sprint-name').value  = sprintName(mon);
});

document.getElementById('sprint-save').addEventListener('click', () => {
  const name  = document.getElementById('sprint-name').value.trim();
  const start = document.getElementById('sprint-start').value;
  const end   = document.getElementById('sprint-end').value;
  if (!name)  { showToast('Sprint name is required.');  return; }
  if (!start) { showToast('Start date is required.');   return; }
  if (!end)   { showToast('End date is required.');     return; }

  const editId = document.getElementById('sprint-edit-id').value;
  if (editId) {
    const s = sprintById(editId);
    s.name = name; s.goal = document.getElementById('sprint-goal').value.trim();
    s.startDate = start; s.endDate = end; s.auto = false;
    showToast('Sprint updated.');
  } else {
    allSprints().push({
      id: uid(), name,
      goal: document.getElementById('sprint-goal').value.trim(),
      startDate: start, endDate: end, auto: false
    });
    showToast('Sprint created!');
  }
  saveState(); closeSprintModal(); render();
});

// ─── Drag-and-drop ────────────────────────────────────
// Attach drag events directly to drop-zone elements after every render.
// This avoids bubbling/delegation issues with dragleave firing on children.

let _dragTaskId = null;

// Called after every render() to wire up drag sources + drop zones freshly
function initDragDrop() {
  // ── Drag source: every task card ──
  document.querySelectorAll('.kcard[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      _dragTaskId = card.dataset.taskId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragTaskId);
      requestAnimationFrame(() => card.classList.add('kcard--dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kcard--dragging');
      _dragTaskId = null;
      _clearOver();
    });
  });

  // ── Drop zones: only status col-bodies (not epic, not sprint) ──
  COLUMNS.filter(c => c.status).forEach(col => {
    const zone = document.getElementById(`col-${col.id}`);
    if (!zone) return;

    // Counter tracks nested enters so dragleave only fires on true exit
    let _enterCount = 0;

    zone.addEventListener('dragenter', e => {
      e.preventDefault();
      _enterCount++;
      zone.classList.add('col-body--over');
    });
    zone.addEventListener('dragleave', () => {
      _enterCount--;
      if (_enterCount <= 0) { _enterCount = 0; zone.classList.remove('col-body--over'); }
    });
    zone.addEventListener('dragover', e => {
      e.preventDefault();                    // required to allow drop
      e.dataTransfer.dropEffect = 'move';
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      _enterCount = 0;
      zone.classList.remove('col-body--over');

      const taskId = _dragTaskId || e.dataTransfer.getData('text/plain');
      if (!taskId) return;
      const task = allTasks().find(t => t.id === taskId);
      if (!task || task.status === col.status) return;

      task.status    = col.status;
      task.updatedAt = new Date().toISOString();
      _dragTaskId    = null;
      saveState();
      // Defer render until after the full drag-event chain finishes so the
      // DOM rebuild (and new initDragDrop wiring) happens on a clean frame.
      requestAnimationFrame(() => render());
    });
  });
}

function _clearOver() {
  document.querySelectorAll('.col-body--over').forEach(el => el.classList.remove('col-body--over'));
}

// ─── Toast ────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ─── Fullscreen toggle ────────────────────────────────
(function () {
  const btn      = document.getElementById('btn-fullscreen');
  const iconExp  = document.getElementById('fs-icon-expand');
  const iconComp = document.getElementById('fs-icon-compress');

  function updateIcons(isFs) {
    iconExp.style.display  = isFs ? 'none' : '';
    iconComp.style.display = isFs ? ''     : 'none';
    btn.title              = isFs ? 'Exit fullscreen' : 'Enter fullscreen';
    btn.classList.toggle('active', isFs);
  }

  btn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', () => {
    updateIcons(!!document.fullscreenElement);
  });
})();

// ─── Dark / Light mode toggle ─────────────────────────
(function () {
  const btn      = document.getElementById('btn-theme');
  const iconMoon = document.getElementById('theme-icon-moon');
  const iconSun  = document.getElementById('theme-icon-sun');
  const PREF_KEY = 'dtt_theme';

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    iconMoon.style.display = dark ? 'none' : '';
    iconSun.style.display  = dark ? ''     : 'none';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.classList.toggle('active', dark);
    localStorage.setItem(PREF_KEY, dark ? 'dark' : 'light');
  }

  btn.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
  });

  // Restore saved preference, else use system preference
  const saved = localStorage.getItem(PREF_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);
})();

// ─── Subtask helpers ──────────────────────────────────
function allSubtasks() {
  return state.subtasks || (state.subtasks = []);
}
function subtasksOf(taskId) {
  return allSubtasks().filter(s => s.taskId === taskId);
}
function subtasksForSprint(sprintId) {
  const sprintTaskIds = allTasks()
    .filter(t => t.sprintId === sprintId)
    .map(t => t.id);
  return allSubtasks().filter(s => sprintTaskIds.includes(s.taskId));
}

// ─── Subtask Panel state ──────────────────────────────
let _panelTaskId = null;   // which task's subtasks are shown
let _panelContext = null; // { type: 'task'|'sprint', id?: string, sprintId?: string }
let _panelAnchorEl = null; // clicked button/card element used for connector
let _panelAnchorRect = null; // captured rect when the source element is re-rendered away

// Status columns shown in the subtask panel (no Epic column)
const SUB_COLS = [
  { id: 'todo',       label: 'Tasks',       color: '#475569', status: 'To Do'       },
  { id: 'inprogress', label: 'In Progress', color: '#2563eb', status: 'In Progress' },
  { id: 'practice',   label: 'Practice',    color: '#d97706', status: 'Practice'    },
  { id: 'revise',     label: 'Revise',      color: '#db2777', status: 'Revise'      },
  { id: 'done',       label: 'Done',        color: '#16a34a', status: 'Done'        },
];

// ─── Connector line (SVG bezier + two dots) ───────────
const _connSvg = document.getElementById('connector-svg');

function drawConnector() {
  const panel = document.getElementById('subtask-panel');
  if (!panel || panel.classList.contains('hidden')) { clearConnector(); return; }

  let cr = null;
  if (_panelAnchorRect) {
    cr = _panelAnchorRect;
  } else if (_panelAnchorEl && _panelAnchorEl.isConnected) {
    cr = _panelAnchorEl.getBoundingClientRect();
  } else if (_panelTaskId) {
    const card = document.querySelector(`.kcard[data-task-id="${_panelTaskId}"]`);
    if (card) cr = card.getBoundingClientRect();
  }

  if (!cr) { clearConnector(); return; }

  const pr = panel.getBoundingClientRect();

  // Card dot: right-middle edge of the task card
  const cx = cr.right;
  const cy = cr.top + cr.height / 2;

  // Panel dot: pick the nearest edge midpoint on the panel
  // Choose left or right panel edge based on which is closer to card
  const panelMidY = pr.top + pr.height / 2;
  let px, py;
  if (Math.abs(pr.left - cx) <= Math.abs(pr.right - cx)) {
    px = pr.left;   py = panelMidY;   // connect to panel left edge
  } else {
    px = pr.right;  py = panelMidY;   // connect to panel right edge
  }

  // Cubic bezier control points (horizontal pull)
  const pull = Math.min(Math.abs(px - cx) * 0.55, 180);
  const cpx1 = cx + pull;
  const cpy1 = cy;
  const cpx2 = px - (px > cx ? pull : -pull);
  const cpy2 = py;

  const DOT_R = 5;
  _connSvg.innerHTML = `
    <defs>
      <marker id="conn-arrow" markerWidth="6" markerHeight="6"
              refX="3" refY="3" orient="auto">
        <circle cx="3" cy="3" r="2.2" fill="var(--border-strong)"/>
      </marker>
    </defs>
    <path d="M${cx},${cy} C${cpx1},${cpy1} ${cpx2},${cpy2} ${px},${py}"
          fill="none" stroke="var(--border-strong)" stroke-width="1.5"
          stroke-dasharray="5 3" />
    <circle cx="${cx}" cy="${cy}" r="${DOT_R}"
            fill="var(--surface)" stroke="var(--border-strong)" stroke-width="2"/>
    <circle cx="${px}" cy="${py}" r="${DOT_R}"
            fill="var(--surface)" stroke="var(--border-strong)" stroke-width="2"/>
  `;
  _connSvg.style.display = '';
}

function clearConnector() {
  _connSvg.innerHTML = '';
  _connSvg.style.display = 'none';
}

// ─── Panel drag + resize ──────────────────────────────
(function initPanelInteraction() {
  const panel   = document.getElementById('subtask-panel');
  const header  = document.getElementById('subtask-panel-header');
  const MIN_W   = 320;
  const MIN_H   = 200;

  // Set default position when first opened (centered, lower half)
  function setDefaultPosition() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w  = Math.min(Math.round(vw * 0.62), vw - 40);
    const h  = Math.round(vh * 0.48);
    panel.style.width  = w + 'px';
    panel.style.height = h + 'px';
    panel.style.left   = Math.round((vw - w) / 2) + 'px';
    panel.style.top    = Math.round(vh - h - 20) + 'px';
  }

  // Expose so openSubtaskPanel can call it on first show
  window._setPanelDefaultPos = setDefaultPosition;

  // ── Drag by header ────────────────────────────────
  let _dx = 0, _dy = 0, _dragging = false;

  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    _dragging = true;
    const rect = panel.getBoundingClientRect();
    _dx = e.clientX - rect.left;
    _dy = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_dragging && !_resizing) return;
    if (_dragging) {
      const vw   = window.innerWidth;
      const vh   = window.innerHeight;
      const pw   = panel.offsetWidth;
      const ph   = panel.offsetHeight;
      panel.style.left = Math.max(0, Math.min(e.clientX - _dx, vw - pw)) + 'px';
      panel.style.top  = Math.max(0, Math.min(e.clientY - _dy, vh - ph)) + 'px';
    }
    if (_resizing) {
      const vw  = window.innerWidth;
      const vh  = window.innerHeight;
      const dx  = e.clientX - _sx;
      const dy  = e.clientY - _sy;
      let l = _origL, t = _origT, w = _origW, h = _origH;
      if (_dir.includes('e')) w = Math.max(MIN_W, _origW + dx);
      if (_dir.includes('s')) h = Math.max(MIN_H, _origH + dy);
      if (_dir.includes('w')) { const nw = Math.max(MIN_W, _origW - dx); l = _origL + (_origW - nw); w = nw; }
      if (_dir.includes('n')) { const nh = Math.max(MIN_H, _origH - dy); t = _origT + (_origH - nh); h = nh; }
      l = Math.max(0, Math.min(l, vw - w));
      t = Math.max(0, Math.min(t, vh - h));
      panel.style.left   = l + 'px';
      panel.style.top    = t + 'px';
      panel.style.width  = w + 'px';
      panel.style.height = h + 'px';
    }
    // Redraw connector live as panel moves/resizes
    drawConnector();
  });

  document.addEventListener('mouseup', () => { _dragging = false; _resizing = false; });

  // ── Resize by edge/corner handles ─────────────────
  let _resizing = false, _dir = '', _sx = 0, _sy = 0;
  let _origL = 0, _origT = 0, _origW = 0, _origH = 0;

  panel.querySelectorAll('.sp-resize').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      _resizing = true;
      _dir  = handle.dataset.dir;
      _sx   = e.clientX;
      _sy   = e.clientY;
      const rect = panel.getBoundingClientRect();
      _origL = rect.left; _origT = rect.top;
      _origW = rect.width; _origH = rect.height;
    });
  });
})();

function openSubtaskPanel(context) {
  const panel = document.getElementById('subtask-panel');
  const isNew = panel.classList.contains('hidden');
  _panelContext = null;
  _panelTaskId = null;
  _panelAnchorEl = null;
  _panelAnchorRect = null;

  if (context && typeof context === 'object' && context.sprintId) {
    _panelContext = { type: 'sprint', sprintId: context.sprintId };
    const sprint = sprintById(context.sprintId);
    document.getElementById('subtask-panel-task-name').textContent = sprint ? `${sprint.name} subtasks` : 'Sprint subtasks';
    if (context.sourceEl) {
      _panelAnchorEl = context.sourceEl;
      const rect = context.sourceEl.getBoundingClientRect();
      _panelAnchorRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    } else if (context.sourceRect) {
      _panelAnchorRect = context.sourceRect;
    }
  } else {
    const taskId = typeof context === 'string' ? context : (context && context.taskId) ? context.taskId : null;
    _panelTaskId = taskId;
    const task = allTasks().find(t => t.id === taskId);
    document.getElementById('subtask-panel-task-name').textContent = task ? task.name : '';
    if (context && context.sourceEl) {
      _panelAnchorEl = context.sourceEl;
      const rect = context.sourceEl.getBoundingClientRect();
      _panelAnchorRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    } else if (context && context.sourceRect) {
      _panelAnchorRect = context.sourceRect;
    } else if (taskId) {
      const btn = document.querySelector(`.btn-subtasks[data-action="view-subtasks"][data-task-id="${taskId}"]`);
      if (btn) {
        _panelAnchorEl = btn;
      }
    }
  }

  panel.classList.remove('hidden');
  // Position at default only the first time (or if no inline style set yet)
  if (isNew && !panel.style.left) window._setPanelDefaultPos();
  renderSubtaskPanel(context);
  // Draw connector after DOM settles
  requestAnimationFrame(drawConnector);
}

function closeSubtaskPanel() {
  document.getElementById('subtask-panel').classList.add('hidden');
  _panelTaskId = null;
  _panelContext = null;
  _panelAnchorEl = null;
  _panelAnchorRect = null;
  clearConnector();
}

function renderSubtaskPanel(context) {
  const subs = _panelContext && _panelContext.type === 'sprint'
    ? subtasksForSprint(_panelContext.sprintId)
    : subtasksOf(_panelTaskId);

  if (!subs) return;
  const done  = subs.filter(s => s.status === 'Done').length;
  document.getElementById('subtask-panel-count').innerHTML =
    buildSubtaskSummaryHtml(subs.length, done);

  const board = document.getElementById('subtask-board');
  board.innerHTML = '';

  SUB_COLS.forEach(col => {
    const items = subs.filter(s => s.status === col.status);
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col sub-col';

    colEl.innerHTML = `
      <div class="col-header" style="--col-color:${col.color}">
        <span class="col-title">${col.label}</span>
        <span class="col-count">${items.length}</span>
      </div>
      <div class="col-body sub-col-body" id="sub-col-${col.id}">
        ${items.length === 0
          ? '<div class="col-empty">No subtasks here</div>'
          : items.map(s => buildSubtaskCard(s)).join('')}
      </div>
    `;
    board.appendChild(colEl);
  });

  initSubDragDrop();
}

function buildSubtaskCard(sub) {
  const over = isOverdue(sub.dueDate, sub.status);
  return `
    <div class="kcard sub-kcard" draggable="true" data-sub-id="${sub.id}">
      <div class="kcard-title" title="${esc(sub.name)}">${esc(sub.name)}</div>
      ${sub.desc ? `<div class="kcard-sub">${esc(sub.desc)}</div>` : ''}
      <div class="kcard-meta">
        ${priorityBadge(sub.priority)}
        ${sub.assignee ? `<span class="kcard-assignee">👤 ${esc(sub.assignee)}</span>` : ''}
      </div>
      ${sub.dueDate ? `
        <div class="kcard-due ${over ? 'overdue' : ''}">
          ${over ? '⚠️ ' : '📅 '}${formatDate(sub.dueDate)}
        </div>` : ''}
      <div class="kcard-actions">
        <button class="btn btn-ghost btn-sm" data-sub-action="edit-subtask" data-sub-id="${sub.id}" title="Edit">Edit</button>
        <button class="btn btn-delete" data-sub-action="delete-subtask" data-sub-id="${sub.id}">Delete</button>
      </div>
    </div>
  `;
}

// ─── Subtask drag-drop (scoped to panel) ─────────────
let _dragSubId = null;

function initSubDragDrop() {
  document.querySelectorAll('.sub-kcard[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      _dragSubId = card.dataset.subId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragSubId);
      requestAnimationFrame(() => card.classList.add('kcard--dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kcard--dragging');
      _dragSubId = null;
      document.querySelectorAll('.sub-col-body.col-body--over')
        .forEach(el => el.classList.remove('col-body--over'));
    });
  });

  SUB_COLS.forEach(col => {
    const zone = document.getElementById(`sub-col-${col.id}`);
    if (!zone) return;
    let _ec = 0;
    zone.addEventListener('dragenter', e => { e.preventDefault(); _ec++; zone.classList.add('col-body--over'); });
    zone.addEventListener('dragleave', () => { _ec--; if (_ec <= 0) { _ec = 0; zone.classList.remove('col-body--over'); } });
    zone.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      _ec = 0;
      zone.classList.remove('col-body--over');
      const subId = _dragSubId || e.dataTransfer.getData('text/plain');
      if (!subId) return;
      const sub = allSubtasks().find(s => s.id === subId);
      if (!sub || sub.status === col.status) return;
      sub.status    = col.status;
      sub.updatedAt = new Date().toISOString();
      _dragSubId    = null;
      saveState();
      requestAnimationFrame(() => renderSubtaskPanel());
    });
  });
}

// ─── Subtask panel header buttons ────────────────────
document.getElementById('subtask-panel-close').addEventListener('click', closeSubtaskPanel);
document.getElementById('subtask-panel-add').addEventListener('click', () => {
  if (_panelTaskId) openSubtaskModal(_panelTaskId);
});

// Delegated click handler for subtask card actions
document.getElementById('subtask-board').addEventListener('click', e => {
  const btn = e.target.closest('[data-sub-action]');
  if (!btn) return;
  const action = btn.dataset.subAction;
  if (action === 'edit-subtask') {
    const sub = allSubtasks().find(s => s.id === btn.dataset.subId);
    if (sub) openSubtaskModal(sub.taskId, sub);
  }
  if (action === 'delete-subtask') {
    const id  = btn.dataset.subId;
    const sub = allSubtasks().find(s => s.id === id);
    openConfirm(`Delete subtask "${sub.name}"?`, () => {
      state.subtasks = allSubtasks().filter(s => s.id !== id);
      saveState();
      renderSubtaskPanel();
      render();   // refresh parent task card subtask count
      showToast('Subtask deleted.');
    });
  }
});

// ─── Subtask Modal ────────────────────────────────────
function openSubtaskModal(taskId, sub = null) {
  document.getElementById('subtask-modal-title').textContent = sub ? 'Edit Subtask' : 'Add Subtask';
  document.getElementById('subtask-task-id').value    = taskId;
  document.getElementById('subtask-edit-id').value    = sub ? sub.id      : '';
  document.getElementById('subtask-name').value       = sub ? sub.name    : '';
  document.getElementById('subtask-desc').value       = sub ? sub.desc    : '';
  document.getElementById('subtask-assignee').value   = sub ? sub.assignee: '';
  document.getElementById('subtask-due').value        = sub ? sub.dueDate : '';
  document.getElementById('subtask-priority').value   = sub ? sub.priority: 'Medium';
  document.getElementById('subtask-status').value     = sub ? sub.status  : 'To Do';
  document.getElementById('subtask-modal').classList.remove('hidden');
  document.getElementById('subtask-name').focus();
}

function closeSubtaskModal() {
  document.getElementById('subtask-modal').classList.add('hidden');
}

document.getElementById('subtask-cancel').addEventListener('click', closeSubtaskModal);
document.getElementById('subtask-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSubtaskModal();
});

document.getElementById('subtask-save').addEventListener('click', () => {
  const name = document.getElementById('subtask-name').value.trim();
  if (!name) { showToast('Subtask name is required.'); return; }
  const taskId = document.getElementById('subtask-task-id').value;
  const editId = document.getElementById('subtask-edit-id').value;
  const data = {
    name,
    desc:     document.getElementById('subtask-desc').value.trim(),
    assignee: document.getElementById('subtask-assignee').value.trim(),
    dueDate:  document.getElementById('subtask-due').value,
    priority: document.getElementById('subtask-priority').value,
    status:   document.getElementById('subtask-status').value,
  };
  if (editId) {
    Object.assign(allSubtasks().find(s => s.id === editId), data, { updatedAt: new Date().toISOString() });
    showToast('Subtask updated.');
  } else {
    allSubtasks().push({ id: uid(), taskId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data });
    showToast('Subtask added!');
  }
  saveState();
  closeSubtaskModal();
  renderSubtaskPanel();
  render();   // refresh parent task card subtask count
});

// ─── Boot ─────────────────────────────────────────────
loadState();
if (!state.tasks)    state.tasks    = [];
if (!state.sprints)  state.sprints  = [];
if (!state.subtasks) state.subtasks = [];
ensureCurrentSprint();   // auto-create this week's sprint if missing
render();
