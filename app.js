// ── Config ─────────────────────────────────────────────────
// FIX: Replace the string below with your deployed backend URL after deployment.
// Example: 'https://wedtask-backend.onrender.com/api'
// For local development it automatically uses localhost:8080.
// const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
//   ? 'http://localhost:8080/api'
//   : 'https://wedtask-backend.onrender.com/api';

const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8080'
  : 'https://wedtask-backend.onrender.com'; // ← replace this

const API = BACKEND_URL + '/api';

async function waitForServer() {
  while (true) {
    try {
      const res = await fetch(BACKEND_URL + '/api/ping');
      if (res.ok) return; // server is up, proceed
    } catch (e) {
      // still sleeping, keep trying
    }
    await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
  }
}

// ── State ──────────────────────────────────────────────────
let currentUser = null;
let allTasks    = [];
let allUsers    = [];
let pollTimer   = null;

// ── Helpers ────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── API Helper ─────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.text().catch(() => 'Error');
    throw new Error(err);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  setTimeout(() => el.className = '', 3000);
}

// ── Init ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('wedtask_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    showApp();
  } else {
    hideLoading();
  }

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Enter key on entry screen
  document.getElementById('entry-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleEntry();
  });
});

// ── Loading ────────────────────────────────────────────────
function hideLoading() {
  const ls = document.getElementById('loading-screen');
  ls.style.opacity = '0';
  setTimeout(() => ls.style.display = 'none', 500);
  document.getElementById('app-header').style.display = '';
  document.getElementById('app-main').style.display   = '';
}

// ── Entry / Switch ─────────────────────────────────────────
async function handleEntry() {
  const name = document.getElementById('entry-name').value.trim();
  const code = document.getElementById('entry-admin-code').value.trim();
  if (!name) return toast('Please enter your name', 'error');

  try {
    const res = await api('POST', '/users', { name, adminCode: code || null });
    currentUser = res;
    sessionStorage.setItem('wedtask_user', JSON.stringify(res));
    showApp();
    toast(`Welcome, ${res.name}! 🌸`);
  } catch (e) {
    toast('Could not connect to server. Check your API URL.', 'error');
  }
}

function switchUser() {
  stopPolling();
  currentUser = null;
  sessionStorage.removeItem('wedtask_user');
  document.getElementById('entry-screen').style.display = '';
  document.getElementById('app-screen').style.display   = 'none';
  document.getElementById('fab-create').style.display   = 'none';
  document.getElementById('header-admin-badge').style.display = 'none';
  document.getElementById('entry-name').value = '';
  document.getElementById('entry-admin-code').value = '';
}

function showApp() {
  hideLoading();
  document.getElementById('entry-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = '';
  document.getElementById('header-user-info').textContent = currentUser.name;

  // FIX: currentUser.isAdmin is now correctly populated from backend
  // because we added @JsonProperty("isAdmin") to the User model and DTO.
  if (currentUser.isAdmin) {
    document.getElementById('header-admin-badge').style.display = '';
    document.getElementById('admin-view').style.display  = '';
    document.getElementById('member-view').style.display = 'none';
    document.getElementById('status-strip').style.display = 'none';
    document.getElementById('fab-create').style.display  = '';
  } else {
    document.getElementById('admin-view').style.display  = 'none';
    document.getElementById('member-view').style.display = '';
    document.getElementById('status-strip').style.display = '';
    document.getElementById('fab-create').style.display  = 'none';
    updateStatusUI(currentUser.status);
  }

  fetchAll();
  startPolling();
}

// ── Tabs ───────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const panels = ['tasks', 'team'];
    b.classList.toggle('active', panels[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}

// ── Data Fetch ─────────────────────────────────────────────
async function fetchAll() {
  await waitForServer();
  try {
    const [tasks, users, progress] = await Promise.all([
      api('GET', '/tasks'),
      api('GET', '/users'),
      api('GET', '/tasks/progress'),
    ]);
    allTasks = tasks;
    allUsers = users;
    renderTasks(tasks);
    renderUsers(users);
    renderProgress(progress);
    // Refresh current user state from server (e.g. status changed elsewhere)
    const me = users.find(u => u.id === currentUser.id);
    if (me) {
      currentUser = { ...currentUser, ...me };
      sessionStorage.setItem('wedtask_user', JSON.stringify(currentUser));
    }
  } catch(e) {
    console.error('Fetch error', e);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(fetchAll, 10000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Render Tasks ───────────────────────────────────────────
function renderTasks(tasks) {
  if (currentUser?.isAdmin) {
    renderAdminTasks(tasks);
  } else {
    renderMyTasks(tasks.filter(t => t.assignedTo?.toLowerCase() === currentUser?.name.toLowerCase()));
  }
}

function renderAdminTasks(tasks) {
  const before = tasks.filter(t => t.timeCategory === 'BEFORE');
  const during = tasks.filter(t => t.timeCategory === 'DURING');
  const after  = tasks.filter(t => t.timeCategory === 'AFTER');

  document.getElementById('count-before').textContent = before.length;
  document.getElementById('count-during').textContent = during.length;
  document.getElementById('count-after').textContent  = after.length;

  renderTaskList('tasks-before', before, true);
  renderTaskList('tasks-during', during, true);
  renderTaskList('tasks-after',  after,  true);
}

function renderMyTasks(tasks) {
  document.getElementById('my-task-count').textContent = tasks.length;

  const before = tasks.filter(t => t.timeCategory === 'BEFORE');
  const during = tasks.filter(t => t.timeCategory === 'DURING');
  const after  = tasks.filter(t => t.timeCategory === 'AFTER');

  renderTaskList('my-tasks-before', before, false);
  renderTaskList('my-tasks-during', during, false);
  renderTaskList('my-tasks-after',  after,  false);
}

function renderTaskList(containerId, tasks, isAdmin) {
  const el = document.getElementById(containerId);
  if (!tasks.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🌿</div><p>No tasks here yet</p></div>`;
    return;
  }
  el.innerHTML = tasks.map(t => taskCard(t, isAdmin)).join('');
}

// FIX: Removed the duplicated doneBtn block. Both admin and member views
// now share a single Done/Undo button, which is correct behavior.
// Admin-only actions (Edit, Delete) are shown separately.
function taskCard(t, isAdmin) {
  const isDone   = t.status === 'DONE';
  // FIX: t.isUrgent was always undefined before because Jackson serialized the
  // boolean field as "urgent" (Lombok generates isUrgent() getter).
  // Now fixed with @JsonProperty("isUrgent") on Task, TaskResponse, and CreateTaskRequest.
  const isUrgent = t.isUrgent && !isDone;
  const cls = [isDone ? 'done' : '', isUrgent ? 'urgent' : ''].filter(Boolean).join(' ');

  const scheduled = t.scheduledAt ? `<span class="meta-chip">🕐 ${formatTime(t.scheduledAt)}</span>` : '';
  const assignee  = t.assignedTo
    ? `<span class="meta-chip">👤 ${escHtml(t.assignedTo)}</span>`
    : `<span class="meta-chip" style="color:var(--rose)">Unassigned</span>`;

  // Done/Undo button — available to both admin and member
  const doneBtn = `
    <button class="btn btn-sm ${isDone ? 'btn-secondary' : 'btn-primary'}"
      onclick="toggleDone('${t.id}', '${t.status}')">
      ${isDone ? '↩ Undo' : '✓ Done'}
    </button>`;

  // Edit/Delete — admin only
  const adminActions = isAdmin ? `
    <button class="btn btn-sm btn-secondary" onclick="openEditModal('${t.id}')">Edit</button>
    <button class="btn btn-sm btn-danger" onclick="deleteTask('${t.id}')">✕</button>
  ` : '';

  return `
  <div class="task-card ${cls}" id="task-${t.id}">
    <div class="task-card-top">
      <div style="flex:1;min-width:0">
        <div class="task-title-row">
          <span class="task-title">${escHtml(t.title)}</span>
          ${isUrgent ? '<span class="badge badge-urgent">🔴 Urgent</span>' : ''}
          ${isDone   ? '<span class="badge badge-done">✅ Done</span>' : '<span class="badge badge-pending">⏳ Pending</span>'}
        </div>
        ${t.description ? `<p class="task-desc">${escHtml(t.description)}</p>` : ''}
        <div class="task-meta">
          ${assignee}
          ${scheduled}
        </div>
      </div>
      <div class="task-actions">
        ${doneBtn}
        ${adminActions}
      </div>
    </div>
  </div>`;
}

// ── Render Users ───────────────────────────────────────────
function renderUsers(users) {
  const list = document.getElementById('users-list');
  if (list) {
    if (!users.length) {
      list.innerHTML = '<div class="empty-state"><p>No members yet</p></div>';
    } else {
      list.innerHTML = users.map(u => userRow(u)).join('');
      document.getElementById('users-count').textContent = users.length + ' members';
    }
  }

  const freeUsers = users.filter(u => u.status === 'FREE');
  const freeList  = document.getElementById('free-users-list');
  if (freeList) {
    if (!freeUsers.length) {
      freeList.innerHTML = '<div class="empty-state"><p>Nobody free right now</p></div>';
    } else {
      freeList.innerHTML = freeUsers.map(u => userRow(u, true)).join('');
    }
    document.getElementById('free-count').textContent = freeUsers.length + ' free';
  }

  // Quick-assign chips in modal
  const qa = document.getElementById('quick-assign-free');
  if (qa) {
    qa.innerHTML = freeUsers.map(u =>
      `<span class="qa-chip" onclick="quickAssign('${escHtml(u.name)}')">${escHtml(u.name)}</span>`
    ).join('');
  }
}

function userRow(u, withAssignBtn = false) {
  const initial  = u.name.charAt(0).toUpperCase();
  // FIX: u.isAdmin is now correctly populated — was always falsy before due to
  // Lombok's isAdmin() getter being serialized as "admin" by Jackson.
  const adminChip  = u.isAdmin ? '<span class="user-status-chip chip-admin">Admin</span>' : '';
  const statusChip = u.status === 'FREE'
    ? '<span class="user-status-chip chip-free">🟢 Free</span>'
    : '<span class="user-status-chip chip-busy">🔴 Busy</span>';

  const assignBtn = withAssignBtn
    ? `<button class="btn btn-sm btn-secondary" onclick="openAssignModal('${escHtml(u.name)}')">Assign Task</button>`
    : '';

  return `
  <div class="user-row">
    <div class="user-info">
      <div class="user-avatar">${initial}</div>
      <div>
        <div class="user-name">${escHtml(u.name)}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${adminChip}
      ${statusChip}
      ${assignBtn}
    </div>
  </div>`;
}

// ── Render Progress ────────────────────────────────────────
function renderProgress(p) {
  const pct = Math.round(p.percentage);
  document.getElementById('progress-pct').textContent  = pct + '%';
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('stat-done').textContent     = p.completedTasks;
  document.getElementById('stat-pending').textContent  = p.pendingTasks;
  document.getElementById('stat-total').textContent    = p.totalTasks;
}

// ── Status Toggle ──────────────────────────────────────────
async function setMyStatus(status) {
  try {
    const updated = await api('PATCH', `/users/${currentUser.id}/status`, { status });
    currentUser.status = updated.status;
    sessionStorage.setItem('wedtask_user', JSON.stringify(currentUser));
    updateStatusUI(status);
    toast(status === 'FREE' ? '🟢 You are now Free' : '🔴 You are now Busy');
  } catch(e) {
    toast('Failed to update status', 'error');
  }
}

function updateStatusUI(status) {
  const dot     = document.getElementById('status-dot');
  const label   = document.getElementById('status-label-text');
  const btnFree = document.getElementById('btn-free');
  const btnBusy = document.getElementById('btn-busy');

  if (status === 'FREE') {
    dot.className = 'status-dot free';
    label.textContent = 'You are FREE';
    btnFree.classList.add('active');
    btnBusy.classList.remove('active');
  } else {
    dot.className = 'status-dot busy';
    label.textContent = 'You are BUSY';
    btnBusy.classList.add('active');
    btnFree.classList.remove('active');
  }
}

// ── Task Actions ───────────────────────────────────────────
async function toggleDone(taskId, currentStatus) {
  const newStatus = currentStatus === 'DONE' ? 'PENDING' : 'DONE';
  try {
    await api('PATCH', `/tasks/${taskId}`, { status: newStatus });
    toast(newStatus === 'DONE' ? '✅ Task completed!' : 'Task reopened', 'success');
    fetchAll();
  } catch(e) {
    toast('Failed to update task', 'error');
  }
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    await api('DELETE', `/tasks/${taskId}`);
    toast('Task deleted');
    fetchAll();
  } catch(e) {
    toast('Failed to delete task', 'error');
  }
}

// ── Modal ──────────────────────────────────────────────────
function openCreateModal() {
  document.getElementById('modal-title').textContent   = 'Create Task';
  document.getElementById('task-title').value          = '';
  document.getElementById('task-desc').value           = '';
  document.getElementById('task-time').value           = 'BEFORE';
  document.getElementById('task-assigned').value       = '';
  document.getElementById('task-urgent').checked       = false;
  document.getElementById('task-scheduled').value      = '';
  document.getElementById('editing-task-id').value     = '';

  const freeUsers = allUsers.filter(u => u.status === 'FREE');
  const qa = document.getElementById('quick-assign-free');
  qa.innerHTML = freeUsers.length
    ? freeUsers.map(u => `<span class="qa-chip" onclick="quickAssign('${escHtml(u.name)}')">${escHtml(u.name)}</span>`).join('')
    : '<span style="font-size:.78rem;color:var(--sage)">No one is free right now</span>';

  openModal('task-modal');
}

function openEditModal(taskId) {
  const t = allTasks.find(t => t.id === taskId);
  if (!t) return;
  document.getElementById('modal-title').textContent   = 'Edit Task';
  document.getElementById('task-title').value          = t.title;
  document.getElementById('task-desc').value           = t.description || '';
  document.getElementById('task-time').value           = t.timeCategory;
  document.getElementById('task-assigned').value       = t.assignedTo || '';
  // FIX: t.isUrgent now works correctly after the @JsonProperty fix
  document.getElementById('task-urgent').checked       = t.isUrgent;
  document.getElementById('task-scheduled').value      = t.scheduledAt ? t.scheduledAt.slice(0,16) : '';
  document.getElementById('editing-task-id').value     = t.id;
  openModal('task-modal');
}

function openAssignModal(name) {
  openCreateModal();
  document.getElementById('task-assigned').value = name;
}

async function submitTask() {
  const title     = document.getElementById('task-title').value.trim();
  const desc      = document.getElementById('task-desc').value.trim();
  const time      = document.getElementById('task-time').value;
  const assigned  = document.getElementById('task-assigned').value.trim();
  const urgent    = document.getElementById('task-urgent').checked;
  const scheduled = document.getElementById('task-scheduled').value;
  const editingId = document.getElementById('editing-task-id').value;

  if (!title) return toast('Title is required', 'error');

  const payload = {
    title,
    description:  desc || null,
    timeCategory: time,
    assignedTo:   assigned || null,
    // FIX: key must be "isUrgent" to match @JsonProperty on the DTO
    isUrgent:     urgent,
    scheduledAt:  scheduled || null,
  };

  try {
    if (editingId) {
      await api('PATCH', `/tasks/${editingId}`, payload);
      toast('Task updated ✨', 'success');
    } else {
      await api('POST', '/tasks', payload);
      toast('Task created 🌸', 'success');
    }
    closeModal('task-modal');
    fetchAll();
  } catch(e) {
    toast('Failed to save task', 'error');
  }
}

function quickAssign(name) {
  document.getElementById('task-assigned').value = name;
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
