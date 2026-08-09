/* ===================================================
   Daily Task Tracker — Excel Auto-Tracker
   Uses SheetJS (XLSX) loaded via CDN in index.html

   HOW IT WORKS
   ────────────
   Click "DB" once → pick the Study-Tracker/db/ folder.
   The app writes  db/tracker.xlsx  immediately and then
   rewrites it silently on EVERY change (epic, task,
   sprint, subtask — anything).

   The folder handle is stored in IndexedDB so the next
   time you open the app it reconnects automatically
   without asking again.

   Workbook sheets:
     Tasks    → every task with epic, sprint, status, dates
     Sprints  → every sprint with live progress counters
     Epics    → every epic with task count + completion %
     Subtasks → every subtask linked to task + epic

   Fallback: Firefox / Safari don't support the folder
   picker API — the ⬇ Export button still works everywhere.
   =================================================== */

'use strict';

// ─── SheetJS readiness guard ──────────────────────────
function _xlsx() {
  if (!window.XLSX) throw new Error('SheetJS not loaded');
  return window.XLSX;
}

// ─── Folder handle for db/ ────────────────────────────
let _dbFolder = null;
const _FS_OK  = typeof window.showDirectoryPicker === 'function';

// ─── IndexedDB — persist handle across page loads ─────
const _IDB = { db: 'dtt_xl', ver: 1, store: 'h', key: 'folder' };

function _idbOpen() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(_IDB.db, _IDB.ver);
    r.onupgradeneeded = e => e.target.result.createObjectStore(_IDB.store);
    r.onsuccess  = e => ok(e.target.result);
    r.onerror    = e => fail(e.target.error);
  });
}
async function _idbGet() {
  const db = await _idbOpen();
  return new Promise((ok, fail) => {
    const r = db.transaction(_IDB.store, 'readonly').objectStore(_IDB.store).get(_IDB.key);
    r.onsuccess = e => ok(e.target.result);
    r.onerror   = e => fail(e.target.error);
  });
}
async function _idbSet(v) {
  const db = await _idbOpen();
  return new Promise((ok, fail) => {
    const r = db.transaction(_IDB.store, 'readwrite').objectStore(_IDB.store).put(v, _IDB.key);
    r.onsuccess = () => ok();
    r.onerror   = e => fail(e.target.error);
  });
}
async function _idbDel() {
  const db = await _idbOpen();
  return new Promise((ok, fail) => {
    const r = db.transaction(_IDB.store, 'readwrite').objectStore(_IDB.store).delete(_IDB.key);
    r.onsuccess = () => ok();
    r.onerror   = e => fail(e.target.error);
  });
}

// ═══════════════════════════════════════════════════
// AUTO-RECONNECT ON PAGE LOAD
// ═══════════════════════════════════════════════════

(async function _xlBoot() {
  if (!_FS_OK) return;

  let handle;
  try { handle = await _idbGet(); } catch (_) { return; }
  if (!handle) return;

  let perm;
  try { perm = await handle.queryPermission({ mode: 'readwrite' }); }
  catch (_) { perm = 'denied'; }

  if (perm === 'granted') {
    _dbFolder = handle;
    _setBtnActive(true);
    await _readXL();    // load data FROM tracker.xlsx into app state on page load
  } else if (perm === 'prompt') {
    _showReconnectBanner(handle);
  } else {
    try { await _idbDel(); } catch (_) {}
  }
})();

// ═══════════════════════════════════════════════════
// READ tracker.xlsx FROM THE db/ FOLDER INTO STATE
// ═══════════════════════════════════════════════════

async function _readXL() {
  if (!_dbFolder) return;
  try {
    const fh  = await _dbFolder.getFileHandle('tracker.xlsx', { create: false });
    const file = await fh.getFile();
    const buf  = await file.arrayBuffer();
    const X    = _xlsx();
    const wb   = X.read(buf, { type: 'array', cellDates: true });

    const imported = _parseWorkbook(wb);

    // Only import if the sheet actually has meaningful data
    const hasData = imported.epics.length || imported.tasks.length ||
                    imported.sprints.length || imported.subtasks.length;
    if (!hasData) {
      // Sheet is blank/placeholder — write current state into it instead
      await _writeXL();
      return;
    }

    // Merge into state and persist to localStorage only — do NOT call saveState()
    // because that triggers _onSaveState → _writeXL() and overwrites the sheet we just read.
    state.epics    = imported.epics;
    state.tasks    = imported.tasks;
    state.sprints  = imported.sprints;
    state.subtasks = imported.subtasks;
    localStorage.setItem('dtt_data', JSON.stringify(state));
    render();
    showToast('📊 Loaded data from tracker.xlsx');
  } catch (e) {
    if (e && e.name === 'NotFoundError') {
      // File doesn't exist yet — write current state into it
      await _writeXL();
    } else {
      showToast('⚠️ Could not read tracker.xlsx — ' + (e && e.message ? e.message : e));
    }
  }
}

// ─── Parse workbook sheets back into app state objects ─
function _parseWorkbook(wb) {
  const X = _xlsx();

  function sheetRows(name) {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return X.utils.sheet_to_json(ws, { defval: '' });
  }

  // --- Epics ---
  // Build a lookup of the current in-memory epics by id so we can preserve
  // any fields that are NOT stored in the Excel sheet (schedule*, sprintFilterId, …).
  const existingEpicById = {};
  (state.epics || []).forEach(e => { existingEpicById[e.id] = e; });

  const epicRows = sheetRows('Epics');
  const epics = epicRows
    .filter(r => r['Epic'] && r['Epic'] !== 'No epics yet')
    .map(r => {
      const id = r['__id'] || uid();
      const existing = existingEpicById[id] || {};
      return {
        // Carry over ALL existing fields first, then overwrite with sheet values.
        // This preserves schedule fields, sprintFilterId, etc. that are not in Excel.
        ...existing,
        id,
        name:      r['Epic']        || '',
        desc:      r['Description'] || '',
        priority:  r['Priority']    || 'Medium',
        createdAt: r['Created']     || existing.createdAt || new Date().toISOString(),
      };
    });

  // --- Sprints ---
  const sprintRows = sheetRows('Sprints');
  const sprints = sprintRows
    .filter(r => r['Sprint'] && r['Sprint'] !== 'No sprints yet')
    .map(r => ({
      id:        r['__id']      || uid(),
      name:      r['Sprint']   || '',
      goal:      r['Goal']     || '',
      startDate: _xlDateToISO(r['Start Date']),
      endDate:   _xlDateToISO(r['End Date']),
    }));

  // Build lookup maps by name for cross-referencing
  const epicByName   = {};
  epics.forEach(e   => { epicByName[e.name]   = e; });
  const sprintByName = {};
  sprints.forEach(s => { sprintByName[s.name] = s; });

  // --- Tasks ---
  const taskRows = sheetRows('Tasks');
  const tasks = taskRows
    .filter(r => r['Task'] && r['Task'] !== 'No tasks yet')
    .map(r => {
      const epic   = epicByName[r['Epic']]     || null;
      const sprint = sprintByName[r['Sprint']] || null;
      return {
        id:        r['__id']       || uid(),
        name:      r['Task']       || '',
        desc:      r['Description']|| '',
        epicId:    epic   ? epic.id   : '',
        sprintId:  sprint ? sprint.id : '',
        status:    r['Status']     || 'To Do',
        priority:  r['Priority']   || 'Medium',
        assignee:  r['Assignee']   || '',
        dueDate:   _xlDateToISO(r['Due Date']),
        createdAt: r['Created']    || new Date().toISOString(),
        updatedAt: r['Updated']    || new Date().toISOString(),
      };
    });

  // Build task lookup by name for subtasks
  const taskByName = {};
  tasks.forEach(t => { taskByName[t.name] = t; });

  // --- Subtasks ---
  const subtaskRows = sheetRows('Subtasks');
  const subtasks = subtaskRows
    .filter(r => r['Subtask'] && r['Subtask'] !== 'No subtasks yet')
    .map(r => {
      const task   = taskByName[r['Parent Task']] || null;
      const sprint = sprintByName[r['Sprint']]    || null;
      return {
        id:        r['__id']        || uid(),
        name:      r['Subtask']     || '',
        desc:      r['Description'] || '',
        taskId:    task   ? task.id   : '',
        sprintId:  sprint ? sprint.id : '',
        status:    r['Status']      || 'To Do',
        priority:  r['Priority']    || 'Medium',
        assignee:  r['Assignee']    || '',
        dueDate:   _xlDateToISO(r['Due Date']),
        createdAt: r['Created']     || new Date().toISOString(),
        updatedAt: r['Created']     || new Date().toISOString(),
      };
    });

  return { epics, tasks, sprints, subtasks };
}

// Convert an Excel date cell value (JS Date, ISO string, or locale string) to YYYY-MM-DD or ''
function _xlDateToISO(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return isNaN(val) ? '' : val.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    // Try parsing as a date string
    const d = new Date(val);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  return '';
}

// ─── Reconnect banner ─────────────────────────────────
function _showReconnectBanner(handle) {
  if (document.getElementById('xl-reconnect-banner')) return;
  const bar = document.createElement('div');
  bar.id        = 'xl-reconnect-banner';
  bar.className = 'xl-reconnect-banner';
  bar.innerHTML = `
    <span>📊 Excel tracker was connected to <strong>db/</strong> — click to restore auto-save</span>
    <button class="btn btn-secondary" id="xl-reconnect-btn">Reconnect db/ folder</button>
    <button class="btn btn-ghost btn-icon" id="xl-reconnect-dismiss">✕</button>
  `;
  document.body.appendChild(bar);
  document.getElementById('xl-reconnect-btn').addEventListener('click', async () => {
    bar.remove();
    await _pickFolder();
  });
  document.getElementById('xl-reconnect-dismiss').addEventListener('click', () => {
    bar.remove();
    _idbDel();
  });
}

// ═══════════════════════════════════════════════════
// "DB" BUTTON — pick the db/ folder once
// ═══════════════════════════════════════════════════

document.getElementById('btn-connect-db').addEventListener('click', async () => {
  if (!_FS_OK) {
    showToast('Auto-save needs Chrome or Edge. Use ⬇ Export instead.');
    return;
  }
  if (!window.XLSX) {
    showToast('SheetJS not loaded yet — wait a moment and try again.');
    return;
  }
  await _pickFolder();
});

async function _pickFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({
      id: 'dtt-db-folder',
      mode: 'readwrite',
      startIn: 'documents'
    });
  } catch (_) { return; }   // user cancelled

  try { await _idbSet(handle); } catch (_) {}

  _dbFolder = handle;

  // Check if tracker.xlsx already exists in the selected folder — if so, read it
  let fileExists = false;
  try { await handle.getFileHandle('tracker.xlsx', { create: false }); fileExists = true; }
  catch (_) { fileExists = false; }

  if (fileExists) {
    _setBtnActive(true);
    await _readXL();
  } else {
    const ok = await _writeXL();
    if (ok) {
      _setBtnActive(true);
      showToast(`✅ Connected to ${handle.name}/ — tracker.xlsx updates on every change`);
    }
  }
}

// ═══════════════════════════════════════════════════
// SAVE HOOK — called by saveState() in app.js
// ═══════════════════════════════════════════════════

window._onSaveState = function () {
  if (_dbFolder) _writeXL();   // async, fire-and-forget
};

// ═══════════════════════════════════════════════════
// WRITE tracker.xlsx INTO THE db/ FOLDER
// ═══════════════════════════════════════════════════

async function _writeXL() {
  if (!_dbFolder) return false;
  try {
    const X   = _xlsx();
    const buf = X.write(_buildWorkbook(), { bookType: 'xlsx', type: 'array' });
    const fh  = await _dbFolder.getFileHandle('tracker.xlsx', { create: true });
    const w   = await fh.createWritable();
    await w.write(new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    await w.close();
    return true;
  } catch (e) {
    _dbFolder = null;
    try { await _idbDel(); } catch (_) {}
    _setBtnActive(false);
    showToast('⚠️ Excel write failed — click DB to reconnect');
    return false;
  }
}

// ═══════════════════════════════════════════════════
// ⬇ EXPORT BUTTON — one-off download, all browsers
// ═══════════════════════════════════════════════════

document.getElementById('btn-export').addEventListener('click', () => {
  if (!window.XLSX) { showToast('SheetJS not loaded yet.'); return; }
  if (!state.epics || state.epics.length === 0) {
    showToast('Nothing to export — add some epics first.');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  window.XLSX.writeFile(_buildWorkbook(), `TaskTracker_${today}.xlsx`);
  showToast('✅ Excel exported!');
});

// ═══════════════════════════════════════════════════
// BUILD WORKBOOK — 4 sheets
// ═══════════════════════════════════════════════════

function _buildWorkbook() {
  const X  = _xlsx();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, _ws(_tasksRows()),    'Tasks');
  X.utils.book_append_sheet(wb, _ws(_sprintsRows()),  'Sprints');
  X.utils.book_append_sheet(wb, _ws(_epicsRows()),    'Epics');
  X.utils.book_append_sheet(wb, _ws(_subtasksRows()), 'Subtasks');
  return wb;
}

// ─── Tasks sheet ──────────────────────────────────────
function _tasksRows() {
  const sprMap  = _sprLookup();
  const epicMap = _epicLookup();
  const rows = [[
    'Task', 'Description', 'Epic', 'Epic Priority',
    'Sprint', 'Month', 'Status', 'Priority',
    'Assignee', 'Due Date', 'Created', 'Updated', '__id'
  ]];
  (state.tasks || []).forEach(t => {
    const spr = sprMap(t.sprintId);
    rows.push([
      t.name,
      t.desc        || '',
      epicMap(t.epicId),
      _epicPrio(t.epicId),
      spr.name      || '',
      spr.startDate ? spr.startDate.slice(0, 7) : _mon(t.createdAt),
      t.status      || 'To Do',
      t.priority    || 'Medium',
      t.assignee    || '',
      t.dueDate     ? _d(t.dueDate + 'T00:00:00') : '',
      _d(t.createdAt),
      _d(t.updatedAt || t.createdAt),
      t.id
    ]);
  });
  if (rows.length === 1) rows.push(['No tasks yet']);
  return rows;
}

// ─── Sprints sheet ────────────────────────────────────
function _sprintsRows() {
  const rows = [[
    'Sprint', 'Goal', 'Start Date', 'End Date', 'Month',
    'Total Tasks', 'Done', 'In Progress', 'Practice', 'Revise', 'To Do', '% Done', '__id'
  ]];
  (state.sprints || []).forEach(s => {
    const tasks = (state.tasks || []).filter(t => t.sprintId === s.id);
    const cnt   = st => tasks.filter(t => t.status === st).length;
    const done  = cnt('Done');
    const pct   = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    rows.push([
      s.name, s.goal || '',
      s.startDate || '', s.endDate || '',
      s.startDate ? s.startDate.slice(0, 7) : '',
      tasks.length, done, cnt('In Progress'), cnt('Practice'), cnt('Revise'), cnt('To Do'),
      pct + '%', s.id
    ]);
  });
  if (rows.length === 1) rows.push(['No sprints yet']);
  return rows;
}

// ─── Epics sheet ──────────────────────────────────────
function _epicsRows() {
  const rows = [[
    'Epic', 'Description', 'Priority',
    'Total Tasks', 'Done', 'In Progress', 'Practice', 'Revise', 'To Do',
    '% Done', 'Created', '__id'
  ]];
  (state.epics || []).forEach(e => {
    const tasks = (state.tasks || []).filter(t => t.epicId === e.id);
    const cnt   = st => tasks.filter(t => t.status === st).length;
    const done  = cnt('Done');
    const pct   = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    rows.push([
      e.name, e.desc || '', e.priority || 'Medium',
      tasks.length, done, cnt('In Progress'), cnt('Practice'), cnt('Revise'), cnt('To Do'),
      pct + '%', _d(e.createdAt), e.id
    ]);
  });
  if (rows.length === 1) rows.push(['No epics yet']);
  return rows;
}

// ─── Subtasks sheet ───────────────────────────────────
function _subtasksRows() {
  const sprMap  = _sprLookup();
  const epicMap = _epicLookup();
  const taskMap = _taskLookup();
  const rows = [[
    'Subtask', 'Description', 'Parent Task', 'Epic', 'Sprint',
    'Status', 'Priority', 'Assignee', 'Due Date', 'Created', '__id'
  ]];
  (state.subtasks || []).forEach(s => {
    const task   = taskMap(s.taskId);
    const epicId = s.epicId || (task ? task.epicId : '');
    const spr    = sprMap(s.sprintId || (task ? task.sprintId : ''));
    rows.push([
      s.name,
      s.desc        || '',
      task ? task.name : '',
      epicMap(epicId),
      spr.name      || '',
      s.status      || 'To Do',
      s.priority    || 'Medium',
      s.assignee    || '',
      s.dueDate     ? _d(s.dueDate + 'T00:00:00') : '',
      _d(s.createdAt),
      s.id
    ]);
  });
  if (rows.length === 1) rows.push(['No subtasks yet']);
  return rows;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function _ws(rows) {
  const X  = _xlsx();
  const ws = X.utils.aoa_to_sheet(rows);
  const wc = [];
  rows.forEach(r => (r || []).forEach((c, i) => {
    wc[i] = Math.max(wc[i] || 0, c != null ? String(c).length : 0);
  }));
  ws['!cols'] = wc.map(w => ({ wch: Math.min(Math.max(w + 2, 10), 55) }));
  return ws;
}

function _sprLookup() {
  const m = {};
  (state.sprints || []).forEach(s => { m[s.id] = s; });
  return id => (id && m[id]) ? m[id] : {};
}
function _epicLookup() {
  const m = {};
  (state.epics || []).forEach(e => { m[e.id] = e.name; });
  return id => (id && m[id]) ? m[id] : '';
}
function _epicPrio(epicId) {
  const e = (state.epics || []).find(x => x.id === epicId);
  return e ? (e.priority || 'Medium') : '';
}
function _taskLookup() {
  const m = {};
  (state.tasks || []).forEach(t => { m[t.id] = t; });
  return id => (id && m[id]) ? m[id] : null;
}
function _mon(iso) {
  try { return new Date(iso).toISOString().slice(0, 7); } catch (_) { return ''; }
}
function _d(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return iso; }
}

function _setBtnActive(on) {
  const btn = document.getElementById('btn-connect-db');
  if (!btn) return;
  if (on) {
    btn.classList.add('active');
    btn.title = 'db/ connected — tracker.xlsx auto-saves on every change';
  } else {
    btn.classList.remove('active');
    btn.title = 'Connect Excel DB — select the db/ folder';
  }
}
