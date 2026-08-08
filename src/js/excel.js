/* ===================================================
   Daily Task Tracker — Excel DB + Export
   Uses SheetJS (XLSX) loaded via CDN in index.html

   DB button   → user picks / creates TaskTracker_DB.xlsx once.
                 Every saveState() call after that silently
                 overwrites the file (File System Access API,
                 Chrome / Edge).  Falls back on Firefox.
   Export btn  → one-off download, works in all browsers.

   Workbook layout:
     Sheet1   → master table (all epics + tasks)
     Sprints  → all sprints with progress
     <Epic N> → per-epic task list
   =================================================== */

// ─── DB file handle ───────────────────────────────────
let _dbHandle   = null;
const FS_OK     = typeof window.showSaveFilePicker === 'function';

// ─── Hook called by saveState() in app.js ─────────────
window._onSaveState = function () {
  if (_dbHandle) _writeToDB();
};

// ─── DB button ────────────────────────────────────────
document.getElementById('btn-connect-db').addEventListener('click', async () => {
  if (!FS_OK) {
    showToast('Auto-save requires Chrome or Edge. Use ⬇ Export instead.');
    return;
  }
  if (!window.XLSX) { showToast('SheetJS not loaded yet.'); return; }

  try {
    _dbHandle = await window.showSaveFilePicker({
      suggestedName: 'TaskTracker_DB.xlsx',
      types: [{
        description: 'Excel Workbook',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
      }]
    });
  } catch (_) { return; }   // user cancelled

  // Write immediately so file is initialised with current data
  const ok = await _writeToDB();
  if (ok) {
    const btn = document.getElementById('btn-connect-db');
    btn.classList.add('active');
    btn.title = `DB connected: ${_dbHandle.name} — auto-saving on every change`;
    showToast(`✅ DB connected: ${_dbHandle.name}`);
  }
});

// ─── Write workbook to the connected file ─────────────
async function _writeToDB() {
  if (!_dbHandle || !window.XLSX) return false;
  try {
    const buf    = XLSX.write(buildWorkbook(), { bookType: 'xlsx', type: 'array' });
    const blob   = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const writer = await _dbHandle.createWritable();
    await writer.write(blob);
    await writer.close();
    showToast('💾 DB updated');
    return true;
  } catch (e) {
    _dbHandle = null;
    const btn = document.getElementById('btn-connect-db');
    btn.classList.remove('active');
    btn.title = 'Connect Excel DB';
    showToast('DB write failed — click DB to reconnect.');
    return false;
  }
}

// ─── Export button (download, all browsers) ───────────
document.getElementById('btn-export').addEventListener('click', () => {
  if (!window.XLSX) { showToast('SheetJS not loaded.'); return; }
  if (!state.epics || state.epics.length === 0) {
    showToast('Nothing to export — add some epics first.');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(buildWorkbook(), `DailyTaskTracker_${today}.xlsx`);
  showToast('Excel exported!');
});

// ─── Build workbook ───────────────────────────────────
function buildWorkbook() {
  const wb        = XLSX.utils.book_new();
  const usedNames = new Set(['Sheet1', 'Sprints']);

  XLSX.utils.book_append_sheet(wb, _sheet(masterRows()),  'Sheet1');
  XLSX.utils.book_append_sheet(wb, _sheet(sprintRows()),  'Sprints');

  (state.epics || []).forEach(epic => {
    let name = _safeName(epic.name);
    let n = 2;
    while (usedNames.has(name)) name = _safeName(epic.name).slice(0, 28) + '_' + n++;
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, _sheet(epicRows(epic)), name);
  });

  return wb;
}

// ─── Sheet1: master task table ────────────────────────
function masterRows() {
  const rows = [[
    'Epic', 'Epic Priority', 'Sprint', 'Task', 'Description',
    'Assignee', 'Due Date', 'Priority', 'Status', 'Created At', 'Updated At'
  ]];
  const spr = _sprintMap();

  (state.epics || []).forEach(epic => {
    const tasks = (state.tasks || []).filter(t => t.epicId === epic.id);
    if (!tasks.length) {
      rows.push([epic.name, epic.priority, '', '(no tasks)', '', '', '', '', '', _d(epic.createdAt), '']);
      return;
    }
    tasks.forEach(t => rows.push([
      epic.name, epic.priority,
      spr(t.sprintId),
      t.name, t.desc || '', t.assignee || '',
      t.dueDate  ? _d(t.dueDate + 'T00:00:00') : '',
      t.priority, t.status,
      _d(t.createdAt),
      _d(t.updatedAt || t.createdAt)
    ]));
  });
  return rows;
}

// ─── Sprints sheet ────────────────────────────────────
function sprintRows() {
  const rows = [['Sprint Name', 'Start Date', 'End Date', 'Goal', 'Tasks', 'Done', '% Done']];
  (state.sprints || []).forEach(s => {
    const tasks = (state.tasks || []).filter(t => t.sprintId === s.id);
    const done  = tasks.filter(t => t.status === 'Done').length;
    const pct   = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    rows.push([s.name, s.startDate, s.endDate, s.goal || '', tasks.length, done, pct + '%']);
  });
  if (rows.length === 1) rows.push(['No sprints', '', '', '', '', '', '']);
  return rows;
}

// ─── Per-epic sheet ───────────────────────────────────
function epicRows(epic) {
  const rows = [
    [`Epic: ${epic.name}`], [`Priority: ${epic.priority}`],
    [`Description: ${epic.desc || '—'}`], [],
    ['Task', 'Description', 'Assignee', 'Due Date', 'Priority', 'Status', 'Sprint', 'Created At']
  ];
  const spr   = _sprintMap();
  const tasks = (state.tasks || []).filter(t => t.epicId === epic.id);
  if (!tasks.length) { rows.push(['No tasks yet', '', '', '', '', '', '', '']); return rows; }
  tasks.forEach(t => rows.push([
    t.name, t.desc || '', t.assignee || '',
    t.dueDate ? _d(t.dueDate + 'T00:00:00') : '',
    t.priority, t.status, spr(t.sprintId), _d(t.createdAt)
  ]));
  return rows;
}

// ─── Helpers ─────────────────────────────────────────
function _sheet(rows) {
  const ws  = XLSX.utils.aoa_to_sheet(rows);
  const wch = [];
  rows.forEach(r => (r || []).forEach((c, i) => {
    wch[i] = Math.max(wch[i] || 0, c != null ? String(c).length : 0);
  }));
  ws['!cols'] = wch.map(w => ({ wch: Math.min(Math.max(w + 2, 10), 50) }));
  return ws;
}

function _sprintMap() {
  const m = {};
  (state.sprints || []).forEach(s => { m[s.id] = s.name; });
  return id => (id && m[id]) ? m[id] : '';
}

function _safeName(n) {
  return String(n).replace(/[\\\/\?\*\[\]\:]/g, '').trim().slice(0, 31) || 'Sheet';
}

function _d(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return iso; }
}
