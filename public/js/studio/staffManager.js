/**
 * public/js/studio/staffManager.js
 * ────────────────────────────────
 * Administración del EQUIPO OPERATIVO (mozos y cocina) desde el Studio.
 *
 * El dueño no comparte su contraseña: da de alta a cada persona, le muestra un
 * QR de turno UNA sola vez y decide qué mesas ve en su teléfono. El servidor
 * guarda solo el hash del secreto; por eso un QR perdido no se puede volver a
 * mostrar (se regenera y el anterior deja de servir).
 *
 * Reglas de la casa:
 *  - Cero `on*=` / `window.confirm`; confirmaciones con `showConfirmDialog`.
 *  - Render con DOM API (`createElement` + `textContent`), nunca `innerHTML`.
 *  - Asignar mesas NO dispara el autosave de la carta (`triggerAutoSave`): el
 *    servidor tampoco bumpea `updatedAt`, así que no genera 409 falsos.
 */
import { apiFetch } from './api.js';
import { showConfirmDialog } from './ui/confirmDialog.js';
import { waitForQrSource } from './qrGenerator.js';
import { state } from './state.js';

const STAFF_ROLES = Object.freeze(['waiter', 'kitchen']);
const ROLE_LABELS = Object.freeze({ waiter: 'Mozo', kitchen: 'Cocina' });

let staffData = {
  staff: [],
  assignments: {},
  restaurant: { id: '', name: '', tableCount: 1 }
};
let editingStaffId = '';
let loading = false;
let qrState = { link: '', staffId: '', name: '' };
const busyIds = new Set();

// ── Helpers puros (importables en Node) ─────────────────────────────────────

export function sortTableKeys(keys) {
  const unique = Array.from(new Set((Array.isArray(keys) ? keys : []).map((k) => String(k))));
  const numeric = unique
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, 'es'));
  const custom = unique
    .filter((key) => !/^\d+$/.test(key))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  return [...numeric, ...custom];
}

export function buildAssignmentRows({ tableCount, assignments, staff } = {}) {
  const count = Math.min(200, Math.max(1, Math.floor(Number(tableCount) || 1)));
  const map = assignments && typeof assignments === 'object' ? assignments : {};
  const people = Array.isArray(staff) ? staff : [];
  const keys = [];
  for (let i = 1; i <= count; i++) keys.push(String(i));
  for (const key of Object.keys(map)) keys.push(key);
  const validIds = new Set(people.map((p) => p && p.id).filter(Boolean));

  return sortTableKeys(keys).map((key, index) => {
    const rawStaffId = typeof map[key] === 'string' ? map[key] : '';
    return {
      key,
      label: /^\d+$/.test(key) ? `Mesa ${key}` : key,
      staffId: validIds.has(rawStaffId) ? rawStaffId : '',
      selectId: `staffTableAssign${index + 1}`
    };
  });
}

export function collectAssignmentsFromRows(rows) {
  const assignments = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const table = String(row.table == null ? '' : row.table).trim();
    const staffId = String(row.staffId == null ? '' : row.staffId).trim();
    if (!table || !staffId) continue;
    assignments.set(table, staffId);
  }
  return Object.fromEntries(assignments);
}

export function staffInitial(name) {
  const chars = Array.from(String(name == null ? '' : name).trim());
  return chars.length ? chars[0].toUpperCase() : '?';
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.waiter;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setHidden(node, hidden) {
  if (!node) return;
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

function setStatus(id, message, tone = '') {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message || '';
  node.classList.remove('is-error', 'is-ok');
  if (tone === 'error') node.classList.add('is-error');
  if (tone === 'ok') node.classList.add('is-ok');
  setHidden(node, !message);
}

function errorMessage(err, fallback) {
  if (err && err.status === 401) return 'Tu sesión venció. Recargá la página e iniciá sesión de nuevo.';
  if (err && err.status === 403) return err.message || 'Tu suscripción no permite esta acción.';
  return (err && err.message) || fallback || 'No pudimos completar la operación.';
}

function findStaff(id) {
  return staffData.staff.find((person) => person.id === id) || null;
}

// ── Render ──────────────────────────────────────────────────────────────────

function createActionButton(label, { ariaLabel, className = '', disabled = false, title = '', onClick }) {
  const button = el('button', `staff-action-btn${className ? ` ${className}` : ''}`, label);
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel || label);
  if (title) button.title = title;
  button.disabled = Boolean(disabled);
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function renderStaffCard(person) {
  const card = el('article', `staff-card${person.active === false ? ' is-inactive' : ''}`);
  const head = el('div', 'staff-card-head');
  const avatar = el('span', 'staff-avatar', staffInitial(person.name));
  avatar.setAttribute('aria-hidden', 'true');

  const identity = el('div', 'staff-card-identity');
  identity.append(el('div', 'staff-card-name', person.name || 'Sin nombre'));

  const meta = el('div', 'staff-card-meta');
  meta.append(el('span', 'staff-chip', person.roleLabel || roleLabel(person.role)));
  const statusChip = el(
    'span',
    `staff-chip ${person.active === false ? 'is-off' : 'is-live'}`,
    person.active === false ? 'Desactivado' : 'Activo'
  );
  meta.append(statusChip);
  const sessionCount = Number(person.activeSessions) || 0;
  if (sessionCount > 0) {
    meta.append(
      el(
        'span',
        'staff-chip is-live',
        sessionCount === 1 ? '● 1 turno abierto' : `● ${sessionCount} turnos abiertos`
      )
    );
  }
  identity.append(meta);
  head.append(avatar, identity);
  card.append(head);

  const tables = Array.isArray(person.tables) ? person.tables : [];
  const chips = el('div', 'staff-chips');
  if (tables.length === 0) {
    chips.append(el('span', 'staff-chip', 'Sin mesas asignadas'));
  } else {
    const visible = tables.slice(0, 10);
    for (const table of visible) {
      const label = table && (table.label || table.number);
      if (!label) continue;
      chips.append(el('span', 'staff-chip-table', label));
    }
    if (tables.length > visible.length) {
      chips.append(el('span', 'staff-chip', `+${tables.length - visible.length}`));
    }
  }
  card.append(chips);

  const actions = el('div', 'staff-card-actions');
  const name = person.name || 'esta persona';
  const inactive = person.active === false;
  const busy = busyIds.has(person.id);

  actions.append(
    createActionButton('📱 QR de turno', {
      ariaLabel: `Generar un QR de turno nuevo para ${name}`,
      className: 'is-gold',
      title: inactive
        ? 'Reactivá a la persona para generarle un QR'
        : 'El QR anterior deja de servir al generar uno nuevo',
      disabled: inactive || busy,
      onClick: () => rotateStaffCredential(person.id)
    })
  );
  actions.append(
    createActionButton('✏️ Editar', {
      ariaLabel: `Editar a ${name}`,
      disabled: busy,
      onClick: () => openStaffEditModal(person.id)
    })
  );
  actions.append(
    createActionButton(inactive ? '▶️ Reactivar' : '⏸ Desactivar', {
      ariaLabel: inactive ? `Reactivar a ${name}` : `Desactivar a ${name} y cerrar sus turnos`,
      disabled: busy,
      onClick: () => toggleStaffActive(person.id)
    })
  );
  if (sessionCount > 0) {
    actions.append(
      createActionButton('⏹ Cerrar turnos', {
        ariaLabel: `Cerrar los turnos abiertos de ${name}`,
        className: 'is-danger',
        disabled: busy,
        onClick: () => revokeStaffSessions(person.id)
      })
    );
  }
  actions.append(
    createActionButton('🗑 Eliminar', {
      ariaLabel: `Eliminar a ${name} del equipo`,
      className: 'is-danger',
      disabled: busy,
      onClick: () => deleteStaffMember(person.id)
    })
  );
  card.append(actions);
  return card;
}

function renderStaffList() {
  const list = document.getElementById('staffList');
  const empty = document.getElementById('staffEmpty');
  if (!list) return;
  list.replaceChildren();
  const people = Array.isArray(staffData.staff) ? staffData.staff : [];
  setHidden(empty, people.length > 0);
  for (const person of people) list.append(renderStaffCard(person));
}

function renderAssignments() {
  const container = document.getElementById('staffAssignmentRows');
  if (!container) return;
  container.replaceChildren();
  const people = Array.isArray(staffData.staff) ? staffData.staff : [];
  if (people.length === 0) {
    container.append(
      el('p', 'staff-assignment-empty', 'Agregá a tu primer integrante para poder asignarle mesas.')
    );
    return;
  }

  const rows = buildAssignmentRows({
    tableCount: staffData.restaurant.tableCount || (state.restaurant && state.restaurant.tableCount) || 1,
    assignments: staffData.assignments,
    staff: people
  });

  for (const row of rows) {
    const wrapper = el('div', 'staff-assignment-row');
    const label = el('label', 'staff-assignment-label', row.label);
    label.htmlFor = row.selectId;

    const select = document.createElement('select');
    select.className = 'form-input';
    select.id = row.selectId;
    select.setAttribute('data-table', row.key);
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Sin asignar';
    select.append(none);
    for (const person of people) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = `${person.name} · ${person.roleLabel || roleLabel(person.role)}${
        person.active === false ? ' (desactivado)' : ''
      }`;
      if (person.id === row.staffId) option.selected = true;
      select.append(option);
    }
    wrapper.append(label, select);
    container.append(wrapper);
  }
}

export function renderStaff() {
  renderStaffList();
  renderAssignments();
}

// ── Carga y asignaciones ────────────────────────────────────────────────────

export async function loadStaff({ silent = false } = {}) {
  if (loading) return;
  loading = true;
  if (!silent && staffData.staff.length === 0) setStatus('staffBanner', 'Cargando equipo…');
  try {
    const payload = await apiFetch('/api/studio/staff');
    staffData = {
      staff: Array.isArray(payload.staff) ? payload.staff : [],
      assignments: payload.assignments && typeof payload.assignments === 'object' ? payload.assignments : {},
      restaurant: payload.restaurant || { id: '', name: '', tableCount: 1 }
    };
    if (state.restaurant) {
      state.restaurant.tableAssignments = { ...staffData.assignments };
      if (staffData.restaurant && staffData.restaurant.tableCount) {
        state.restaurant.tableCount = staffData.restaurant.tableCount;
      }
    }
    if (!silent) setStatus('staffBanner', '');
    renderStaff();
  } catch (err) {
    setStatus('staffBanner', errorMessage(err, 'No pudimos cargar el equipo.'), 'error');
  } finally {
    loading = false;
  }
}

export async function saveStaffAssignments() {
  const container = document.getElementById('staffAssignmentRows');
  const selects = container ? Array.from(container.querySelectorAll('select[data-table]')) : [];
  const assignments = collectAssignmentsFromRows(
    selects.map((select) => ({ table: select.getAttribute('data-table'), staffId: select.value }))
  );
  const button = document.querySelector('[data-js-click="saveStaffAssignments"]');
  if (button) button.disabled = true;
  setStatus('staffTableBanner', 'Guardando asignación…');
  try {
    const payload = await apiFetch('/api/studio/staff/tables', {
      method: 'PATCH',
      body: JSON.stringify({ assignments })
    });
    staffData.assignments =
      payload.assignments && typeof payload.assignments === 'object' ? payload.assignments : {};
    if (state.restaurant) state.restaurant.tableAssignments = { ...staffData.assignments };
    await loadStaff({ silent: true });
    setStatus('staffTableBanner', 'Asignación guardada. Los teléfonos del equipo ya la ven.', 'ok');
  } catch (err) {
    setStatus('staffTableBanner', errorMessage(err, 'No pudimos guardar la asignación.'), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

// ── Alta / edición ──────────────────────────────────────────────────────────

export function openStaffCreateModal() {
  editingStaffId = '';
  const title = document.getElementById('staffEditorTitle');
  const nameInput = document.getElementById('staffNameInput');
  const roleInput = document.getElementById('staffRoleInput');
  const hint = document.getElementById('staffEditorHint');
  const submit = document.getElementById('staffEditorSubmitBtn');
  if (title) title.textContent = 'Agregar integrante';
  if (nameInput) nameInput.value = '';
  if (roleInput) roleInput.value = 'waiter';
  if (hint) {
    hint.style.color = '';
    hint.textContent = 'Al guardar te mostramos su QR de turno una sola vez.';
  }
  if (submit) submit.textContent = 'Guardar y ver QR';
  const modal = document.getElementById('staffEditorModal');
  if (modal) modal.classList.add('active');
}

export function openStaffEditModal(id) {
  const person = findStaff(id);
  if (!person) {
    setStatus('staffBanner', 'No encontramos a esa persona. Actualizá la lista.', 'error');
    return;
  }
  editingStaffId = id;
  const title = document.getElementById('staffEditorTitle');
  const nameInput = document.getElementById('staffNameInput');
  const roleInput = document.getElementById('staffRoleInput');
  const hint = document.getElementById('staffEditorHint');
  const submit = document.getElementById('staffEditorSubmitBtn');
  if (title) title.textContent = `Editar a ${person.name}`;
  if (nameInput) nameInput.value = person.name || '';
  if (roleInput) roleInput.value = STAFF_ROLES.includes(person.role) ? person.role : 'waiter';
  if (hint) {
    hint.style.color = '';
    hint.textContent = 'Cambiar el nombre o el rol no rota el QR de turno.';
  }
  if (submit) submit.textContent = 'Guardar cambios';
  const modal = document.getElementById('staffEditorModal');
  if (modal) modal.classList.add('active');
}

export function closeStaffEditor() {
  editingStaffId = '';
  const modal = document.getElementById('staffEditorModal');
  if (modal) modal.classList.remove('active');
  const form = document.getElementById('staffEditorForm');
  if (form) form.reset();
  const hint = document.getElementById('staffEditorHint');
  if (hint) {
    hint.style.color = '';
    hint.textContent = 'Al guardar te mostramos su QR de turno una sola vez.';
  }
}

export async function saveStaffEditor(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const nameInput = document.getElementById('staffNameInput');
  const roleInput = document.getElementById('staffRoleInput');
  const hint = document.getElementById('staffEditorHint');
  const submit = document.getElementById('staffEditorSubmitBtn');
  const name = nameInput ? String(nameInput.value || '').trim() : '';
  const role = roleInput && STAFF_ROLES.includes(roleInput.value) ? roleInput.value : 'waiter';

  if (!name) {
    if (hint) {
      hint.style.color = '#FCA5A5';
      hint.textContent = 'Escribí el nombre de la persona.';
    }
    if (nameInput) nameInput.focus();
    return;
  }
  if (hint) {
    hint.style.color = '';
    hint.textContent = 'Guardando…';
  }
  if (submit) submit.disabled = true;

  try {
    if (editingStaffId) {
      await apiFetch(`/api/studio/staff/${encodeURIComponent(editingStaffId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, role })
      });
      closeStaffEditor();
      await loadStaff({ silent: true });
      setStatus('staffBanner', 'Datos del integrante actualizados.', 'ok');
      return;
    }

    const payload = await apiFetch('/api/studio/staff', {
      method: 'POST',
      body: JSON.stringify({ name, role })
    });
    closeStaffEditor();
    await loadStaff({ silent: true });
    setStatus('staffBanner', 'Integrante agregado. Mostrale el QR de turno ahora.', 'ok');
    if (payload.credential && payload.enrollmentUrl) {
      showStaffQrModal(
        payload.staff || { name, role, roleLabel: roleLabel(role) },
        payload.enrollmentUrl
      );
    }
  } catch (err) {
    if (hint) {
      hint.style.color = '#FCA5A5';
      hint.textContent = errorMessage(err, 'No pudimos guardar los datos.');
    }
  } finally {
    if (submit) submit.disabled = false;
  }
}

// ── Acciones de la tarjeta ──────────────────────────────────────────────────

export async function toggleStaffActive(id) {
  const person = findStaff(id);
  if (!person || busyIds.has(id)) return;
  const deactivating = person.active !== false;
  if (deactivating) {
    const confirmed = await showConfirmDialog({
      icon: '⏸',
      title: `¿Desactivar a ${person.name}?`,
      message:
        'Se cierran sus turnos abiertos y su QR deja de servir hasta que la reactives. Las mesas asignadas se conservan.',
      confirmText: 'Sí, desactivar',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
  }
  busyIds.add(id);
  try {
    await apiFetch(`/api/studio/staff/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !deactivating })
    });
    await loadStaff({ silent: true });
    setStatus(
      'staffBanner',
      deactivating
        ? `${person.name} quedó desactivado. Sus turnos se cerraron.`
        : `${person.name} vuelve a estar activo. Ya puede escanear su QR.`,
      'ok'
    );
  } catch (err) {
    setStatus('staffBanner', errorMessage(err, 'No pudimos cambiar el estado.'), 'error');
  } finally {
    busyIds.delete(id);
    renderStaff();
  }
}

export async function revokeStaffSessions(id) {
  const person = findStaff(id);
  if (!person || busyIds.has(id)) return;
  const confirmed = await showConfirmDialog({
    icon: '⏹',
    title: `¿Cerrar los turnos de ${person.name}?`,
    message:
      'Se cierran todos sus turnos abiertos en este momento. El QR sigue sirviendo para que vuelva a entrar cuando quiera.',
    confirmText: 'Sí, cerrar turnos',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;
  busyIds.add(id);
  try {
    const payload = await apiFetch(`/api/studio/staff/${encodeURIComponent(id)}/sessions`, {
      method: 'DELETE'
    });
    await loadStaff({ silent: true });
    const revoked = Number(payload.revoked) || 0;
    setStatus(
      'staffBanner',
      revoked === 1 ? 'Se cerró 1 turno abierto.' : `Se cerraron ${revoked} turnos abiertos.`,
      'ok'
    );
  } catch (err) {
    setStatus('staffBanner', errorMessage(err, 'No pudimos cerrar los turnos.'), 'error');
  } finally {
    busyIds.delete(id);
    renderStaff();
  }
}

export async function deleteStaffMember(id) {
  const person = findStaff(id);
  if (!person || busyIds.has(id)) return;
  const confirmed = await showConfirmDialog({
    icon: '🗑',
    title: `¿Eliminar a ${person.name} del equipo?`,
    message:
      'Se borra la persona, su QR de turno, sus turnos abiertos y sus mesas asignadas. No se puede deshacer.',
    confirmText: 'Sí, eliminar',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;
  busyIds.add(id);
  try {
    await apiFetch(`/api/studio/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadStaff({ silent: true });
    setStatus('staffBanner', `${person.name} salió del equipo.`, 'ok');
  } catch (err) {
    setStatus('staffBanner', errorMessage(err, 'No pudimos eliminar a la persona.'), 'error');
  } finally {
    busyIds.delete(id);
    renderStaff();
  }
}

// ── QR de turno (secreto visible UNA vez) ───────────────────────────────────

export async function rotateStaffCredential(id) {
  const person = findStaff(id);
  if (!person || busyIds.has(id)) return;
  if (person.active === false) {
    setStatus('staffBanner', 'Reactivá a la persona antes de generarle un QR.', 'error');
    return;
  }
  const confirmed = await showConfirmDialog({
    icon: '📱',
    title: `Generar un QR nuevo para ${person.name}`,
    message:
      'El QR anterior deja de servir al instante y se cierran sus turnos abiertos. El nuevo también se muestra una sola vez.',
    confirmText: 'Generar QR nuevo',
    confirmClass: 'btn-gold'
  });
  if (!confirmed) return;
  busyIds.add(id);
  setStatus('staffBanner', 'Generando QR de turno…');
  try {
    const payload = await apiFetch(`/api/studio/staff/${encodeURIComponent(id)}/credential`, {
      method: 'POST'
    });
    await loadStaff({ silent: true });
    setStatus('staffBanner', 'QR regenerado. El anterior ya no sirve.', 'ok');
    if (payload.credential && payload.enrollmentUrl) {
      showStaffQrModal(payload.staff || person, payload.enrollmentUrl);
    } else {
      setStatus('staffBanner', 'El servidor no devolvió el QR. Probá de nuevo.', 'error');
    }
  } catch (err) {
    setStatus('staffBanner', errorMessage(err, 'No pudimos generar el QR.'), 'error');
  } finally {
    busyIds.delete(id);
    renderStaff();
  }
}

export function showStaffQrModal(person, enrollmentUrl) {
  const modal = document.getElementById('staffQrModal');
  const holder = document.getElementById('staffQrCanvas');
  const name = document.getElementById('staffQrName');
  const status = document.getElementById('staffQrStatus');
  if (!modal || !holder) return;

  qrState = {
    link: String(enrollmentUrl || ''),
    staffId: (person && person.id) || '',
    name: (person && person.name) || ''
  };
  if (name) {
    const label = person && (person.roleLabel || roleLabel(person.role));
    name.textContent = `${qrState.name}${label ? ` · ${label}` : ''}`;
  }
  if (status) {
    status.style.color = '';
    status.textContent = 'Este QR ya está activo. Mostralo ahora.';
  }
  holder.replaceChildren();
  holder.setAttribute('aria-label', `Código QR de turno de ${qrState.name || 'el integrante'}`);
  modal.classList.add('active');

  if (!qrState.link) {
    if (status) {
      status.style.color = '#FCA5A5';
      status.textContent = 'No recibimos el link del QR. Probá regenerarlo.';
    }
    return;
  }
  if (!window.QRCode) {
    if (status) {
      status.style.color = '#FCA5A5';
      status.textContent = 'No se cargó el generador de QR. Copiá el link y pasalo igual.';
    }
    return;
  }

  try {
    new window.QRCode(holder, {
      text: qrState.link,
      width: 220,
      height: 220,
      colorDark: '#101614',
      colorLight: '#FFFFFF',
      correctLevel: window.QRCode.CorrectLevel.M
    });
    waitForQrSource(holder).then((source) => {
      if (!source && status) {
        status.style.color = '#FCA5A5';
        status.textContent = 'No pudimos dibujar el QR. Copiá el link y pasalo igual.';
      }
    });
  } catch (err) {
    if (status) {
      status.style.color = '#FCA5A5';
      status.textContent = 'No pudimos dibujar el QR. Copiá el link y pasalo igual.';
    }
  }
}

export function closeStaffQrModal() {
  const modal = document.getElementById('staffQrModal');
  const holder = document.getElementById('staffQrCanvas');
  const name = document.getElementById('staffQrName');
  const status = document.getElementById('staffQrStatus');
  if (modal) modal.classList.remove('active');
  // El secreto vive en el DOM y en `qrState`; al cerrar se borra de ambos.
  if (holder) {
    holder.replaceChildren();
    holder.removeAttribute('aria-label');
  }
  if (name) name.textContent = '';
  if (status) {
    status.textContent = '';
    status.style.color = '';
  }
  qrState = { link: '', staffId: '', name: '' };
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (e) {
    copied = false;
  }
  area.remove();
  return copied;
}

export async function copyStaffQrLink() {
  const status = document.getElementById('staffQrStatus');
  if (!qrState.link) {
    if (status) {
      status.style.color = '#FCA5A5';
      status.textContent = 'No hay un link de QR para copiar.';
    }
    return;
  }
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(qrState.link);
      if (status) {
        status.style.color = '';
        status.textContent = 'Link copiado. Pasáselo solo a la persona del turno.';
      }
      return;
    }
  } catch (e) {
    // Sigue el fallback.
  }
  const copied = fallbackCopy(qrState.link);
  if (status) {
    status.style.color = copied ? '' : '#FCA5A5';
    status.textContent = copied
      ? 'Link copiado. Pasáselo solo a la persona del turno.'
      : 'No pudimos copiar. Seleccioná el link desde el QR o regeneralo.';
  }
}

// ── Ciclo de vida ───────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', closeStaffQrModal);
}
