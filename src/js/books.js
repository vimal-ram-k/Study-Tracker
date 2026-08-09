// ═══════════════════════════════════════════════
// Book Tracker — books.js
// ═══════════════════════════════════════════════

const BK_KEY = 'bk_data';

// State
let bkState = {
  books:      [],   // array of book objects
  logs:       [],   // array of reading log entries
  categories: [],   // array of { id, name } objects
};
let bkActiveId    = null;   // currently selected book id
let bkCatFilter   = 'All';  // active category id or 'All'
let bkReaderTimer = null;   // setInterval for reader clock
let bkReaderSecs  = 0;      // elapsed seconds in reader
let bkFolderFiles = [];     // files from folder picker (FileSystemFileHandle[])

// PDF reader state
const bkPdfFileMap = new Map();   // bookId → File object (in-memory, lost on reload)
let bkPdfDoc       = null;        // current pdfjsLib PDF document
let bkPdfPage      = 1;           // current page number being displayed
let bkPdfScale     = 1.2;         // zoom scale
let bkPdfRendering = false;       // render lock
let bkTwoPage      = false;       // two-page spread mode

// ── Persistence ───────────────────────────────
function bkLoad() {
  try {
    const raw = localStorage.getItem(BK_KEY);
    if (raw) bkState = JSON.parse(raw);
    if (!bkState.books)      bkState.books      = [];
    if (!bkState.logs)       bkState.logs        = [];
    if (!bkState.categories) bkState.categories  = [];

    // ── Migration: build categories from existing book.category strings ──
    if (bkState.categories.length === 0 && bkState.books.length > 0) {
      const seen = new Set();
      bkState.books.forEach(b => {
        const name = b.category || 'Uncategorised';
        if (!seen.has(name)) {
          seen.add(name);
          bkState.categories.push({ id: bkUid(), name });
        }
      });
      // Map each book's category string to the category id
      bkState.books.forEach(b => {
        const cat = bkState.categories.find(c => c.name === (b.category || 'Uncategorised'));
        if (cat) b.categoryId = cat.id;
      });
    }
  } catch (_) {}
}
function bkSave() {
  localStorage.setItem(BK_KEY, JSON.stringify(bkState));
}

// ── Helpers ───────────────────────────────────
function bkUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function bkEsc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function bkToday() {
  return new Date().toISOString().slice(0, 10);
}
function bkFmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function bkDaysBetween(a, b) {
  // a, b are YYYY-MM-DD strings
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
  return Math.max(0, Math.ceil(ms / 86400000));
}
function bkBookById(id) {
  return bkState.books.find(b => b.id === id) || null;
}
function bkLogsFor(bookId) {
  return bkState.logs.filter(l => l.bookId === bookId)
    .sort((a, b) => b.date.localeCompare(a.date));
}
function bkTodayLog(bookId) {
  return bkState.logs.find(l => l.bookId === bookId && l.date === bkToday());
}

// Pages read today for a book
function bkTodayPages(bookId) {
  const l = bkTodayLog(bookId);
  return l ? (l.toPage - l.fromPage) : 0;
}

// Compute daily pages goal:
// If book has explicit dailyGoal → use it
// Else if targetDate set → (remaining pages) / (days remaining)
function bkDailyGoal(book) {
  if (book.dailyGoal) return book.dailyGoal;
  if (!book.targetDate) return null;
  const remaining = (book.totalPages || 0) - (book.currentPage || 0);
  const days = bkDaysBetween(bkToday(), book.targetDate);
  if (days <= 0 || remaining <= 0) return null;
  return Math.ceil(remaining / days);
}

// Pct complete
function bkPct(book) {
  if (!book.totalPages) return 0;
  return Math.min(100, Math.round((book.currentPage || 0) / book.totalPages * 100));
}

// Category helpers
function bkCatById(id) {
  return bkState.categories.find(c => c.id === id) || null;
}
function bkActiveCatName() {
  if (bkCatFilter === 'All') return 'All Books';
  return bkCatById(bkCatFilter)?.name || 'All Books';
}
function bkBooksInCat(catId) {
  if (catId === 'All') return bkState.books;
  return bkState.books.filter(b => b.categoryId === catId);
}

// ── Render category panel ─────────────────────
function bkRenderCatPanel() {
  const list = document.getElementById('bk-cat-list');
  list.innerHTML = '';

  // "All Books" row
  const allRow = document.createElement('div');
  allRow.className = 'bk-cat-row' + (bkCatFilter === 'All' ? ' bk-cat-row--active' : '');
  allRow.innerHTML = `
    <span class="bk-cat-row-icon">📚</span>
    <span class="bk-cat-row-name">All Books</span>
    <span class="bk-cat-row-count">${bkState.books.length}</span>
  `;
  allRow.addEventListener('click', () => { bkCatFilter = 'All'; bkRender(); });
  list.appendChild(allRow);

  // Per-category rows
  bkState.categories.forEach(cat => {
    const count = bkBooksInCat(cat.id).length;
    const row   = document.createElement('div');
    row.className = 'bk-cat-row' + (bkCatFilter === cat.id ? ' bk-cat-row--active' : '');
    row.innerHTML = `
      <span class="bk-cat-row-icon">🗂</span>
      <span class="bk-cat-row-name" title="${bkEsc(cat.name)}">${bkEsc(cat.name)}</span>
      <span class="bk-cat-row-count">${count}</span>
      <span class="bk-cat-row-actions">
        <button class="bk-cat-action" title="Rename" data-action="rename" data-id="${cat.id}">✏️</button>
        <button class="bk-cat-action" title="Delete" data-action="delete" data-id="${cat.id}">🗑</button>
      </span>
    `;
    row.addEventListener('click', e => {
      if (e.target.closest('.bk-cat-action')) return; // handled below
      bkCatFilter = cat.id;
      bkRender();
    });
    list.appendChild(row);
  });

  // Wire action buttons (rename / delete)
  list.querySelectorAll('.bk-cat-action').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      const cat    = bkCatById(id);
      if (!cat) return;
      if (action === 'rename') {
        bkOpenCatModal(cat);
      } else if (action === 'delete') {
        if (!confirm(`Delete category "${cat.name}"? Books inside will move to Uncategorised.`)) return;
        // move books
        let unc = bkState.categories.find(c => c.name === 'Uncategorised');
        if (!unc) {
          unc = { id: bkUid(), name: 'Uncategorised' };
          bkState.categories.push(unc);
        }
        bkState.books.forEach(b => { if (b.categoryId === id) b.categoryId = unc.id; });
        bkState.categories = bkState.categories.filter(c => c.id !== id);
        if (bkCatFilter === id) bkCatFilter = 'All';
        bkSave();
        bkRender();
      }
    });
  });
}

// ── Render book list panel ────────────────────
function bkRenderSidebar() {
  bkRenderCatPanel();

  // Panel title
  document.getElementById('bk-book-panel-title').textContent = bkActiveCatName();

  // Book list
  const list  = document.getElementById('bk-list');
  list.innerHTML = '';
  const books = bkBooksInCat(bkCatFilter);
  if (books.length === 0) {
    list.innerHTML = `<div class="bk-list-empty">No books yet.<br>Click <strong>📄 PDF</strong> or <strong>+ Add</strong> to add one.</div>`;
    return;
  }
  books.forEach(book => {
    const pct   = bkPct(book);
    const done  = book.currentPage >= book.totalPages && book.totalPages > 0;
    const catName = bkCatById(book.categoryId)?.name || book.category || '';
    const item  = document.createElement('div');
    item.className = 'bk-list-item' + (book.id === bkActiveId ? ' bk-list-item--active' : '') + (done ? ' bk-list-done' : '');
    item.innerHTML = `
      <div class="bk-list-icon">${done ? '✅' : '📗'}</div>
      <div class="bk-list-info">
        <div class="bk-list-name" title="${bkEsc(book.title)}">${bkEsc(book.title)}</div>
        <div class="bk-list-meta">${bkEsc(book.author || 'Unknown author')}${catName ? ' · ' + bkEsc(catName) : ''}</div>
        <div class="bk-mini-bar"><div class="bk-mini-bar-inner" style="width:${pct}%"></div></div>
      </div>
      <div class="bk-list-pct ${done ? 'bk-list-pct--done' : ''}">${pct}%</div>
    `;
    item.addEventListener('click', () => { bkActiveId = book.id; bkRender(); });
    list.appendChild(item);
  });
}

// ── Render main detail panel ──────────────────
function bkRenderDetail() {
  const emptyState = document.getElementById('bk-empty-state');
  const detail     = document.getElementById('bk-detail');

  if (!bkActiveId) {
    emptyState.style.display = '';
    detail.classList.add('hidden');
    return;
  }
  const book = bkBookById(bkActiveId);
  if (!book) {
    emptyState.style.display = '';
    detail.classList.add('hidden');
    return;
  }

  emptyState.style.display = 'none';
  detail.classList.remove('hidden');

  // Header
  document.getElementById('bk-detail-title').textContent  = book.title;
  document.getElementById('bk-detail-author').textContent = book.author || 'Unknown author';
  document.getElementById('bk-detail-cat').textContent    = book.category || 'Uncategorised';

  // Progress bar
  const pct = bkPct(book);
  document.getElementById('bk-progress-bar').style.width = pct + '%';
  document.getElementById('bk-progress-label').textContent =
    `${book.currentPage || 0} / ${book.totalPages || '?'} pages (${pct}%)`;

  // Stats
  const goal       = bkDailyGoal(book);
  const remaining  = Math.max(0, (book.totalPages || 0) - (book.currentPage || 0));
  const todayPages = bkTodayPages(book.id);
  const daysLeft   = book.targetDate ? bkDaysBetween(bkToday(), book.targetDate) : null;
  const statsRow   = document.getElementById('bk-stats-row');
  const stats = [
    { label: 'Current Page',    value: book.currentPage || 0 },
    { label: 'Pages Remaining', value: remaining },
    { label: 'Today\'s Goal',   value: goal ? `${goal} pages` : '—' },
    { label: 'Read Today',      value: `${todayPages} pages` },
    { label: 'Days Left',       value: daysLeft !== null ? daysLeft : '—' },
    { label: 'Target Date',     value: book.targetDate ? bkFmtDate(book.targetDate) : '—' },
  ];
  statsRow.innerHTML = stats.map(s => `
    <div class="bk-stat">
      <div class="bk-stat-value">${bkEsc(String(s.value))}</div>
      <div class="bk-stat-label">${bkEsc(s.label)}</div>
    </div>
  `).join('');

  // Daily schedule section
  bkRenderSchedule(book, goal, todayPages);

  // Reading log
  bkRenderLog(book.id);
}

function bkRenderSchedule(book, goal, todayPages) {
  const grid = document.getElementById('bk-schedule-grid');
  grid.innerHTML = '';

  const today      = bkToday();
  const todayDone  = todayPages > 0 && goal ? todayPages >= goal : false;

  const cards = [
    {
      label: 'Reading Window',
      value: (book.schedStart && book.schedEnd)
        ? `${book.schedStart} – ${book.schedEnd}`
        : 'Not set',
      extra: '',
    },
    {
      label: "Today's Target Page",
      value: goal
        ? `Page ${(book.currentPage || 0) + goal}`
        : '—',
      extra: goal ? `Read ${goal} pages` : 'Set a target date or daily goal',
      cls: todayDone ? 'bk-sched-done' : 'bk-sched-today',
    },
    {
      label: "Today's Status",
      value: todayDone ? '✅ Done' : `${todayPages} / ${goal || '?'} pages`,
      cls: todayDone ? 'bk-sched-done' : '',
    },
    {
      label: 'Pages per Day Needed',
      value: goal ? `${goal} pages` : '—',
      extra: book.targetDate ? `to finish by ${bkFmtDate(book.targetDate)}` : '',
    },
  ];

  cards.forEach(c => {
    const div = document.createElement('div');
    div.className = `bk-sched-card${c.cls ? ' ' + c.cls : ''}`;
    div.innerHTML = `
      <div class="bk-sched-label">${bkEsc(c.label)}</div>
      <div class="bk-sched-value">${bkEsc(c.value)}</div>
      ${c.extra ? `<div class="bk-sched-label" style="margin-top:4px">${bkEsc(c.extra)}</div>` : ''}
    `;
    grid.appendChild(div);
  });
}

function bkRenderLog(bookId) {
  const list = document.getElementById('bk-log-list');
  list.innerHTML = '';
  const logs = bkLogsFor(bookId);
  if (!logs.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No sessions logged yet.</div>';
    return;
  }
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'bk-log-entry';
    div.innerHTML = `
      <span class="bk-log-date">${bkFmtDate(log.date)}</span>
      <span class="bk-log-pages">pp. ${log.fromPage}–${log.toPage} <span style="color:var(--muted);font-weight:400">(${log.toPage - log.fromPage} pages)</span></span>
      <span class="bk-log-notes">${bkEsc(log.notes || '')}</span>
      <button class="bk-log-del" data-log-id="${log.id}" title="Delete log">✕</button>
    `;
    div.querySelector('.bk-log-del').addEventListener('click', () => {
      bkState.logs = bkState.logs.filter(l => l.id !== log.id);
      bkSave(); bkRenderDetail();
    });
    list.appendChild(div);
  });
}

// ── Full render ───────────────────────────────
function bkRender() {
  bkRenderSidebar();
  bkRenderDetail();
}

// ── Open / Close overlay ──────────────────────
function bkOpen() {
  document.getElementById('bk-overlay').classList.remove('hidden');
  document.getElementById('btn-books').classList.add('active');
  bkRender();
}
function bkClose() {
  document.getElementById('bk-overlay').classList.add('hidden');
  document.getElementById('btn-books').classList.remove('active');
}

// ── PDF picker — count pages via PDF.js ───────
async function bkCountPdfPages(file) {
  try {
    // PDF.js needs a worker; use the CDN worker
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const arrayBuf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      return pdf.numPages;
    }
  } catch (_) {}
  return 0;
}

// ── Category Modal ────────────────────────────
function bkOpenCatModal(cat = null) {
  document.getElementById('bk-cat-modal-title').textContent = cat ? 'Rename Category' : 'New Category';
  document.getElementById('bk-cat-name-input').value = cat ? cat.name : '';
  document.getElementById('bk-cat-edit-id').value    = cat ? cat.id   : '';
  document.getElementById('bk-cat-modal').classList.remove('hidden');
  document.getElementById('bk-cat-name-input').focus();
}
function bkCloseCatModal() {
  document.getElementById('bk-cat-modal').classList.add('hidden');
}

document.getElementById('bk-cat-modal-cancel').addEventListener('click', bkCloseCatModal);
document.getElementById('bk-cat-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) bkCloseCatModal();
});
document.getElementById('bk-cat-modal-save').addEventListener('click', () => {
  const name   = document.getElementById('bk-cat-name-input').value.trim();
  if (!name) { alert('Category name is required.'); return; }
  const editId = document.getElementById('bk-cat-edit-id').value;

  if (editId) {
    // Rename
    const cat = bkCatById(editId);
    if (cat) cat.name = name;
  } else {
    // New — prevent duplicates
    const dup = bkState.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      bkCatFilter = dup.id; // just switch to it
      bkCloseCatModal();
      bkRender();
      return;
    }
    const newCat = { id: bkUid(), name };
    bkState.categories.push(newCat);
    bkCatFilter = newCat.id; // auto-select the new category
  }

  bkSave();
  bkCloseCatModal();
  bkRender();
});

document.getElementById('bk-add-cat').addEventListener('click', () => bkOpenCatModal());

// ── Book Add / Edit Modal ─────────────────────
// Build a <select> of categories for the book modal
function bkCatSelectOptions(selectedId) {
  const all = bkState.categories.map(c =>
    `<option value="${bkEsc(c.id)}"${c.id === selectedId ? ' selected' : ''}>${bkEsc(c.name)}</option>`
  ).join('');
  return `<option value="">— Uncategorised —</option>` + all;
}

function bkOpenModal(book = null) {
  document.getElementById('bk-modal-title').textContent = book ? 'Edit Book' : 'Add Book';
  document.getElementById('bk-f-id').value        = book ? book.id : '';
  document.getElementById('bk-f-title').value     = book ? book.title    : '';
  document.getElementById('bk-f-author').value    = book ? book.author   : '';
  document.getElementById('bk-f-pages').value     = book ? (book.totalPages  || '') : '';
  document.getElementById('bk-f-curpage').value   = book ? (book.currentPage || 0) : 0;
  document.getElementById('bk-f-target').value    = book ? (book.targetDate  || '') : '';
  document.getElementById('bk-f-start').value     = book ? (book.schedStart  || '') : '';
  document.getElementById('bk-f-end').value       = book ? (book.schedEnd    || '') : '';
  document.getElementById('bk-f-daily').value     = book ? (book.dailyGoal   || '') : '';

  // Pre-select category: book's own, or active filter, or blank
  const selId = book ? (book.categoryId || '') : (bkCatFilter !== 'All' ? bkCatFilter : '');
  document.getElementById('bk-f-cat').innerHTML = bkCatSelectOptions(selId);

  document.getElementById('bk-modal').classList.remove('hidden');
  document.getElementById('bk-f-title').focus();
}
function bkCloseModal() {
  document.getElementById('bk-modal').classList.add('hidden');
}

document.getElementById('bk-modal-cancel').addEventListener('click', bkCloseModal);
document.getElementById('bk-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) bkCloseModal();
});
document.getElementById('bk-modal-save').addEventListener('click', () => {
  const title = document.getElementById('bk-f-title').value.trim();
  if (!title) { alert('Book title is required.'); return; }
  const totalPages  = parseInt(document.getElementById('bk-f-pages').value)   || 0;
  const currentPage = parseInt(document.getElementById('bk-f-curpage').value) || 0;
  const editId      = document.getElementById('bk-f-id').value;
  const catId       = document.getElementById('bk-f-cat').value || null;
  const catName     = catId ? (bkCatById(catId)?.name || '') : 'Uncategorised';

  const payload = {
    title,
    author:      document.getElementById('bk-f-author').value.trim(),
    category:    catName,
    categoryId:  catId,
    totalPages,
    currentPage: Math.min(currentPage, totalPages),
    targetDate:  document.getElementById('bk-f-target').value,
    schedStart:  document.getElementById('bk-f-start').value,
    schedEnd:    document.getElementById('bk-f-end').value,
    dailyGoal:   parseInt(document.getElementById('bk-f-daily').value) || 0,
  };

  if (editId) {
    Object.assign(bkBookById(editId), payload);
  } else {
    bkState.books.push({ id: bkUid(), addedAt: new Date().toISOString(), ...payload });
    bkActiveId = bkState.books[bkState.books.length - 1].id;
  }

  bkSave();
  bkCloseModal();
  bkRender();
});

// ── Log Session Modal ─────────────────────────
function bkOpenLogModal(bookId) {
  const book = bkBookById(bookId);
  if (!book) return;
  document.getElementById('bk-lf-book-id').value = bookId;
  document.getElementById('bk-lf-from').value    = book.currentPage || 0;
  document.getElementById('bk-lf-to').value      = '';
  document.getElementById('bk-lf-date').value    = bkToday();
  document.getElementById('bk-lf-notes').value   = '';
  document.getElementById('bk-log-modal').classList.remove('hidden');
  document.getElementById('bk-lf-to').focus();
}
function bkCloseLogModal() {
  document.getElementById('bk-log-modal').classList.add('hidden');
}

document.getElementById('bk-log-cancel').addEventListener('click', bkCloseLogModal);
document.getElementById('bk-log-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) bkCloseLogModal();
});
document.getElementById('bk-log-save').addEventListener('click', () => {
  const bookId   = document.getElementById('bk-lf-book-id').value;
  const fromPage = parseInt(document.getElementById('bk-lf-from').value) || 0;
  const toPage   = parseInt(document.getElementById('bk-lf-to').value)   || 0;
  if (toPage <= fromPage) { alert('To page must be greater than From page.'); return; }

  const date  = document.getElementById('bk-lf-date').value || bkToday();
  const notes = document.getElementById('bk-lf-notes').value.trim();

  // Remove any existing log for same book+date (replace)
  bkState.logs = bkState.logs.filter(l => !(l.bookId === bookId && l.date === date));
  bkState.logs.push({ id: bkUid(), bookId, date, fromPage, toPage, notes });

  // Update book's current page if this session advances it
  const book = bkBookById(bookId);
  if (book && toPage > (book.currentPage || 0)) {
    book.currentPage = toPage;
  }

  bkSave();
  bkCloseLogModal();
  bkRender();
});

// ── Detail panel buttons ──────────────────────
document.getElementById('bk-read-btn').addEventListener('click', () => {
  if (bkActiveId) bkOpenReader(bkActiveId);
});
document.getElementById('bk-edit-btn').addEventListener('click', () => {
  if (bkActiveId) bkOpenModal(bkBookById(bkActiveId));
});
document.getElementById('bk-delete-btn').addEventListener('click', () => {
  if (!bkActiveId) return;
  const book = bkBookById(bkActiveId);
  if (!book) return;
  if (!confirm(`Delete "${book.title}"? This also removes all reading logs for it.`)) return;
  bkState.books = bkState.books.filter(b => b.id !== bkActiveId);
  bkState.logs  = bkState.logs.filter(l => l.bookId !== bkActiveId);
  bkActiveId = bkState.books[0]?.id || null;
  bkSave(); bkRender();
});
document.getElementById('bk-log-add').addEventListener('click', () => {
  if (bkActiveId) bkOpenLogModal(bkActiveId);
});

// ── Full Screen Reader ────────────────────────
// Render one page onto a canvas element
async function bkRenderCanvas(canvas, pageNum) {
  const page     = await bkPdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: bkPdfScale });
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

// Render current page(s); in two-page mode renders pageNum and pageNum+1 side by side
async function bkRenderPage(pageNum) {
  if (!bkPdfDoc || bkPdfRendering) return;
  bkPdfRendering = true;
  bkPdfPage = Math.max(1, Math.min(pageNum, bkPdfDoc.numPages));

  const canvasL = document.getElementById('bk-pdf-canvas');
  const canvasR = document.getElementById('bk-pdf-canvas-r');
  const container = document.getElementById('bk-pdf-container');

  await bkRenderCanvas(canvasL, bkPdfPage);

  if (bkTwoPage && bkPdfPage + 1 <= bkPdfDoc.numPages) {
    await bkRenderCanvas(canvasR, bkPdfPage + 1);
    canvasR.style.display = '';
    container.classList.add('two-page');
  } else {
    canvasR.style.display = 'none';
    container.classList.remove('two-page');
  }

  bkPdfRendering = false;

  // Update page jump input
  const jump = document.getElementById('bk-page-jump');
  if (jump) jump.value = bkPdfPage;

  // Update nav button states
  const step = bkTwoPage ? 2 : 1;
  document.getElementById('bk-prev-page').disabled = (bkPdfPage <= 1);
  document.getElementById('bk-next-page').disabled = (bkPdfPage + step - 1 >= bkPdfDoc.numPages);
}

async function bkOpenReader(bookId) {
  const book = bkBookById(bookId);
  if (!book) return;

  document.getElementById('bk-reader-title').textContent = book.title;

  // Daily target line
  const goal = bkDailyGoal(book);
  const targetPage = goal ? (book.currentPage || 0) + goal : null;
  document.getElementById('bk-reader-target').innerHTML = targetPage
    ? `🎯 p.${targetPage} (${goal} pgs)`
    : '';

  // Reset two-page & fullscreen button states
  bkTwoPage = false;
  document.getElementById('bk-two-page').classList.remove('bk-active');
  bkUpdateFsIcons(false);

  // Reset timer
  bkReaderSecs = 0;
  document.getElementById('bk-reader-timer').textContent = '00:00';
  clearInterval(bkReaderTimer);
  bkReaderTimer = setInterval(() => {
    bkReaderSecs++;
    const m = String(Math.floor(bkReaderSecs / 60)).padStart(2, '0');
    const s = String(bkReaderSecs % 60).padStart(2, '0');
    document.getElementById('bk-reader-timer').textContent = `${m}:${s}`;
  }, 1000);

  document.getElementById('bk-reader').classList.remove('hidden');

  // Try to load PDF
  const file = bkPdfFileMap.get(bookId);
  if (file) {
    await bkLoadPdfFile(file, book.currentPage || 1);
  } else {
    // Show no-file placeholder
    bkPdfDoc = null;
    document.getElementById('bk-pdf-container').style.display = 'none';
    document.getElementById('bk-pdf-no-file').classList.remove('hidden');
    document.getElementById('bk-page-total').textContent = book.totalPages || '—';
    document.getElementById('bk-page-jump').value = book.currentPage || 1;
    document.getElementById('bk-prev-page').disabled = true;
    document.getElementById('bk-next-page').disabled = true;
  }
}

// Load a File into PDF.js and render starting page
async function bkLoadPdfFile(file, startPage) {
  if (!window.pdfjsLib) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  try {
    const arrayBuf = await file.arrayBuffer();
    bkPdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const total = bkPdfDoc.numPages;
    document.getElementById('bk-page-total').textContent = total;

    document.getElementById('bk-pdf-container').style.display = '';
    document.getElementById('bk-pdf-no-file').classList.add('hidden');

    const page = Math.min(Math.max(startPage || 1, 1), total);
    await bkRenderPage(page);
  } catch (err) {
    console.error('PDF load error', err);
    document.getElementById('bk-pdf-container').style.display = 'none';
    document.getElementById('bk-pdf-no-file').classList.remove('hidden');
  }
}

function bkCloseReader() {
  clearInterval(bkReaderTimer);
  bkReaderTimer = null;

  // Auto-save current rendered page as progress
  if (bkActiveId) {
    const book = bkBookById(bkActiveId);
    if (book) {
      const toPage   = bkPdfDoc ? bkPdfPage : (parseInt(document.getElementById('bk-page-jump').value) || 0);
      const fromPage = book.currentPage || 0;
      if (toPage > fromPage) {
        bkState.logs = bkState.logs.filter(l => !(l.bookId === bkActiveId && l.date === bkToday()));
        bkState.logs.push({
          id: bkUid(), bookId: bkActiveId, date: bkToday(),
          fromPage, toPage,
          notes: `Reader session — ${Math.floor(bkReaderSecs / 60)}m ${bkReaderSecs % 60}s`,
        });
        book.currentPage = toPage;
        bkSave();
        bkRender();
      }
    }
  }

  bkPdfDoc = null;
  document.getElementById('bk-reader').classList.add('hidden');
}

document.getElementById('bk-reader-done').addEventListener('click',  bkCloseReader);
document.getElementById('bk-reader-close').addEventListener('click', bkCloseReader);

// ── PDF nav controls ──────────────────────────
document.getElementById('bk-prev-page').addEventListener('click', () => {
  if (!bkPdfDoc) return;
  const step = bkTwoPage ? 2 : 1;
  if (bkPdfPage > 1) bkRenderPage(bkPdfPage - step);
});
document.getElementById('bk-next-page').addEventListener('click', () => {
  if (!bkPdfDoc) return;
  const step = bkTwoPage ? 2 : 1;
  if (bkPdfPage + step - 1 < bkPdfDoc.numPages) bkRenderPage(bkPdfPage + step);
});
document.getElementById('bk-page-jump').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !bkPdfDoc) return;
  const n = parseInt(e.target.value);
  if (n >= 1 && n <= bkPdfDoc.numPages) await bkRenderPage(n);
});
document.getElementById('bk-zoom-in').addEventListener('click', () => {
  bkPdfScale = Math.min(bkPdfScale + 0.25, 4);
  if (bkPdfDoc) bkRenderPage(bkPdfPage);
});
document.getElementById('bk-zoom-out').addEventListener('click', () => {
  bkPdfScale = Math.max(bkPdfScale - 0.25, 0.5);
  if (bkPdfDoc) bkRenderPage(bkPdfPage);
});

// ── Two-page toggle ───────────────────────────
document.getElementById('bk-two-page').addEventListener('click', () => {
  bkTwoPage = !bkTwoPage;
  document.getElementById('bk-two-page').classList.toggle('bk-active', bkTwoPage);
  if (bkPdfDoc) bkRenderPage(bkPdfPage);
});

// ── Fullscreen toggle ─────────────────────────
function bkUpdateFsIcons(isFs) {
  document.getElementById('bk-fs-enter').style.display = isFs ? 'none' : '';
  document.getElementById('bk-fs-exit').style.display  = isFs ? '' : 'none';
  document.getElementById('bk-fullscreen').classList.toggle('bk-active', isFs);
}
document.getElementById('bk-fullscreen').addEventListener('click', () => {
  const el = document.getElementById('bk-reader');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});
document.addEventListener('fullscreenchange', () => {
  bkUpdateFsIcons(!!document.fullscreenElement);
  // Re-render at new size after a short delay
  if (bkPdfDoc) setTimeout(() => bkRenderPage(bkPdfPage), 120);
});

// Re-select PDF button (shown when file not in memory)
document.getElementById('bk-reload-pdf').addEventListener('click', () => {
  document.getElementById('bk-pdf-input').value = '';
  document.getElementById('bk-pdf-input').click();
});

// ── Sidebar + header wiring ───────────────────
document.getElementById('btn-books').addEventListener('click', () => {
  const overlay = document.getElementById('bk-overlay');
  if (overlay.classList.contains('hidden')) bkOpen(); else bkClose();
});
document.getElementById('bk-close').addEventListener('click', bkClose);

// PDF picker — click button → trigger hidden file input
document.getElementById('bk-add-pdf').addEventListener('click', () => {
  document.getElementById('bk-pdf-input').value = ''; // reset so same file can be re-picked
  document.getElementById('bk-pdf-input').click();
});
document.getElementById('bk-pdf-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // If reader is open, this is a re-select for the current book
  const readerVisible = !document.getElementById('bk-reader').classList.contains('hidden');
  if (readerVisible && bkActiveId) {
    const file = files[0];
    bkPdfFileMap.set(bkActiveId, file);
    const book = bkBookById(bkActiveId);
    await bkLoadPdfFile(file, book ? (book.currentPage || 1) : 1);
    return;
  }

  // Normal add-PDF flow — assign to the active category
  const activeCatId   = bkCatFilter !== 'All' ? bkCatFilter : null;
  const activeCatName = activeCatId ? (bkCatById(activeCatId)?.name || 'Books') : 'Books';

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    const title  = file.name.replace(/\.pdf$/i, '').trim();
    let book = bkState.books.find(b => b.title.toLowerCase() === title.toLowerCase());
    if (!book) {
      const totalPages = await bkCountPdfPages(file);
      book = {
        id: bkUid(), title, author: '',
        category: activeCatName, categoryId: activeCatId,
        totalPages, currentPage: 0,
        targetDate: '', dailyGoal: 0,
        schedStart: '', schedEnd: '',
        addedAt: new Date().toISOString(),
        fromPdf: true,
      };
      bkState.books.push(book);
      bkActiveId = book.id;
    }
    // Always store the fresh File object so reader can use it
    bkPdfFileMap.set(book.id, file);
  }
  bkSave();
  bkRender();
});

document.getElementById('bk-add-manual').addEventListener('click', () => bkOpenModal());

// Escape closes overlay / reader
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('bk-reader').classList.contains('hidden')) {
    bkCloseReader(); return;
  }
  if (!document.getElementById('bk-overlay').classList.contains('hidden')) {
    bkClose();
  }
});

// ── Boot ──────────────────────────────────────
bkLoad();
