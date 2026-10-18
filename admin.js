(function () {
  const $ = (s) => document.querySelector(s);
  const loginEl = $('#login'), panelEl = $('#panel');
  let me = null;               // { email, name, is_super, events: [{id, name}] }
  let eventId = null;          // evento seleccionado
  let events = [];             // eventos con detalle
  let hosts = [];              // anfitriones (solo super admin)
  let guests = [], items = [];
  let gFilter = 'todos', gQuery = '', iQuery = '', eQuery = '', hQuery = '';
  let editingEvent = null, editingHost = null;

  if (api.demo) {
    $('#demo').hidden = false;
    $('#demo').textContent = 'Modo demo: entra con super@demo.com (super admin), ana@demo.com o sofia@demo.com (anfitrionas), con cualquier contraseña.';
  }

  const STATUS = { pendiente: ['Pendiente', 's-peach'], confirmado: ['Confirmado', 's-green'], no_asiste: ['No asiste', 's-gray'] };
  const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const panelUrl = () => location.href.split('#')[0];

  const inviteLink = (code) => new URL('./', location.href).href + '?c=' + encodeURIComponent(code);
  function waLink(g) {
    let digits = (g.phone || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) digits = '57' + digits;   // número colombiano sin indicativo
    const text = 'Hola ' + g.name + ', te invitamos a nuestro Chocoro Shower. Esta es tu invitación personal: ' + inviteLink(g.code);
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
  }
  const whenText = (ev) => {
    const d = fmtDate(ev.event_date).long;
    return ev.event_time ? d + ' · ' + fmtTime(ev.event_time) : d;
  };
  async function copyText(text, btn, label) {
    try { await navigator.clipboard.writeText(text); if (btn) { btn.textContent = 'Copiado'; setTimeout(() => { btn.textContent = label; }, 1800); } }
    catch (err) { window.prompt('Copia este texto:', text); }
  }

  // ---------- Modales ----------
  function openModal(id) { const d = document.getElementById(id); d.showModal(); const f = d.querySelector('input:not([type=hidden]):not([readonly])'); if (f) f.focus(); }
  function closeModal(id) { document.getElementById(id).close(); }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { c.closest('dialog').close(); return; }
    const o = e.target.closest('[data-open]');
    if (o) {
      const id = o.dataset.open;
      if (id === 'dlgGuest') { $('#guestForm').reset(); $('#guestError').textContent = ''; }
      if (id === 'dlgItem') { $('#itemForm').reset(); capInput.value = 1; capHint(); $('#itemError').textContent = ''; }
      openModal(id);
    }
  });
  // Clic fuera del contenido cierra el modal
  document.querySelectorAll('dialog.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // ---------- Sesión ----------
  function showLogin() { loginEl.hidden = false; panelEl.hidden = true; }

  async function showPanel() {
    const session = await api.getSession();
    if (!session) { showLogin(); return; }
    try { me = await api.whoami(); } catch (err) { showLogin(); $('#loginError').textContent = err.message; return; }
    $('#who').textContent = me.name ? me.name + ' · ' + me.email : me.email;
    loginEl.hidden = true; panelEl.hidden = false;
    $('#roleBadge').hidden = !me.is_super;
    document.querySelectorAll('.super-only').forEach((el) => { el.hidden = !me.is_super; });
    let saved = null;
    try { saved = localStorage.getItem('chocoro-event'); } catch (e) { /* nada */ }
    const ids = me.events.map((e) => e.id);
    eventId = ids.indexOf(eventId) >= 0 ? eventId : ids.indexOf(saved) >= 0 ? saved : ids[0] || null;
    await loadAdmin();
    route();
    await reload();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#loginBtn');
    const email = f.email.value.trim(), password = f.password.value;
    $('#loginError').textContent = '';
    if (!email || !password) { $('#loginError').textContent = 'Escribe tu correo y contraseña.'; return; }
    btn.disabled = true;
    try { await api.signIn(email, password); f.password.value = ''; await showPanel(); }
    catch (err) { $('#loginError').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="logout"]')) {
      await api.signOut();
      me = null; location.hash = '';
      showLogin();
    }
  });

  // ---------- Carga de eventos / anfitriones ----------
  async function loadAdmin() {
    const [evs, hs] = await Promise.all([
      me.events.length ? api.listEvents() : Promise.resolve([]),
      me.is_super ? api.listHosts() : Promise.resolve([])
    ]);
    events = evs; hosts = hs;
    $('#cEvents').textContent = events.length;
    $('#cHosts').textContent = hosts.length;
    renderSwitcher(); renderEvents(); renderHosts();
  }

  function renderSwitcher() {
    $('#switcher').hidden = !events.length && !me.is_super;
    const sel = $('#eventSelect');
    sel.innerHTML = events.map((ev) => '<option value="' + esc(ev.id) + '"' + (ev.id === eventId ? ' selected' : '') + '>' + esc(ev.name) + '</option>').join('');
    sel.disabled = events.length < 2;
    sel.hidden = !events.length;
    const cur = events.find((ev) => ev.id === eventId);
    $('#eventSummary').textContent = cur ? whenText(cur) + (cur.place ? ' · ' + cur.place : '') : 'Crea tu primer evento en el módulo Eventos.';
  }

  function selectEvent(id) {
    eventId = id;
    try { localStorage.setItem('chocoro-event', eventId); } catch (err) { /* nada */ }
    gFilter = 'todos'; gQuery = ''; iQuery = ''; $('#gSearch').value = ''; $('#iSearch').value = '';
    renderSwitcher(); renderEvents();
  }
  $('#eventSelect').addEventListener('change', async (e) => { selectEvent(e.target.value); await reload(); });

  // ---------- Navegación ----------
  const MODS = ['invitados', 'chocoros', 'eventos', 'anfitriones'];
  function route() {
    let mod = (location.hash || '').replace('#', '') || 'invitados';
    if (MODS.indexOf(mod) < 0) mod = 'invitados';
    if ((mod === 'eventos' || mod === 'anfitriones') && !me.is_super) mod = 'invitados';
    if (!eventId && (mod === 'invitados' || mod === 'chocoros')) mod = me.is_super ? 'eventos' : 'none';
    MODS.concat('none').forEach((m) => { $('#mod-' + m).hidden = m !== mod; });
    document.querySelectorAll('.nav-btn').forEach((a) => {
      if (a.dataset.mod === mod) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', () => { if (me) route(); });

  async function reload() {
    if (!eventId) { guests = []; items = []; renderGuests(); renderItems(); return; }
    try {
      [guests, items] = await Promise.all([api.listGuests(eventId), api.listItems(eventId)]);
      renderGuests(); renderItems();
    } catch (err) { toast(err.message); }
  }

  // ---------- Invitados ----------
  function renderGuests() {
    $('#cGuests').textContent = guests.length;
    const count = (s) => guests.filter((g) => g.status === s).length;
    $('#gStats').innerHTML =
      '<span class="stat s-green">' + plural(count('confirmado'), 'confirmado', 'confirmados') + '</span>' +
      '<span class="stat s-peach">' + plural(count('pendiente'), 'pendiente', 'pendientes') + '</span>' +
      '<span class="stat s-gray">' + plural(count('no_asiste'), 'no asiste', 'no asisten') + '</span>';
    const filters = [['todos', 'Todos'], ['confirmado', 'Confirmados'], ['pendiente', 'Pendientes'], ['no_asiste', 'No asisten']];
    $('#gFilters').innerHTML = filters.map((f) =>
      '<button type="button" class="filter" data-filter="' + f[0] + '" aria-pressed="' + (gFilter === f[0]) + '">' + f[1] + '</button>').join('');

    const q = norm(gQuery);
    const rows = guests.filter((g) => (gFilter === 'todos' || g.status === gFilter) && (!q || norm(g.name).includes(q)));
    let html = '<div class="trow th g-cols"><span>INVITADO</span><span>ESTADO</span><span>SU CHÓCORO</span><span>ENLACE</span><span></span></div>';
    html += rows.map((g) => {
      const st = STATUS[g.status] || STATUS.pendiente;
      const wa = waLink(g);
      const choco = g.itemName ? esc(g.itemName) : '<span class="muted">' + (g.status === 'no_asiste' ? '—' : 'Aún no elige') + '</span>';
      return '<div class="trow g-cols">' +
        '<div class="who c-who"><span class="avatar">' + esc(g.name.charAt(0).toUpperCase()) + '</span><div style="min-width:0"><b>' + esc(g.name) + '</b><small>' + esc(g.phone || 'Sin WhatsApp') + '</small></div></div>' +
        '<span class="status c-status ' + st[1] + '">' + st[0] + '</span>' +
        '<span class="c-choco" style="font-size:14px">' + choco + '</span>' +
        '<div class="linkbox c-link">' +
        '<button type="button" class="mini" data-copy="' + esc(g.code) + '" title="' + esc(inviteLink(g.code)) + '" aria-label="Copiar enlace de ' + esc(g.name) + '">Copiar</button>' +
        (wa ? '<a class="mini wa" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</div>' +
        '<button type="button" class="trash c-del" data-del-guest="' + esc(g.id) + '" aria-label="Eliminar a ' + esc(g.name) + '">' + TRASH + '</button>' +
        '</div>';
    }).join('');
    if (!rows.length) html += '<div class="empty">' + (guests.length ? 'No hay invitados con ese filtro.' : 'Aún no has agregado invitados. Usa "+ Agregar invitado".') + '</div>';
    $('#gTable').innerHTML = html;
  }

  $('#gSearch').addEventListener('input', (e) => { gQuery = e.target.value.trim(); renderGuests(); });
  $('#gFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (b) { gFilter = b.dataset.filter; renderGuests(); }
  });

  $('#guestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    const name = f.name.value.trim().replace(/\s+/g, ' ');
    $('#guestError').textContent = '';
    if (!name) { $('#guestError').textContent = 'Escribe el nombre del invitado.'; f.name.focus(); return; }
    if (guests.some((g) => norm(g.name) === norm(name))) { $('#guestError').textContent = 'Ya existe un invitado con ese nombre.'; return; }
    btn.disabled = true;
    try {
      await api.addGuest(eventId, { name, phone: f.phone.value.trim() });
      closeModal('dlgGuest');
      toast(name + ' agregado. Ya puedes copiar su enlace.');
      await reload();
    } catch (err) { $('#guestError').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  $('#gTable').addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { copyText(inviteLink(copy.dataset.copy), copy, 'Copiar'); return; }
    const del = e.target.closest('[data-del-guest]');
    if (del) {
      const g = guests.find((x) => String(x.id) === del.dataset.delGuest);
      if (!g || !confirm('¿Eliminar a ' + g.name + '? Su enlace dejará de funcionar y su chócoro quedará libre.')) return;
      try { await api.deleteGuest(g.id); await reload(); } catch (err) { toast(err.message); }
    }
  });

  // ---------- Chócoros ----------
  function renderItems() {
    $('#cItems').textContent = items.length;
    const total = items.reduce((a, i) => a + i.capacity, 0);
    const used = items.reduce((a, i) => a + i.takenBy.length, 0);
    const full = items.filter((i) => i.takenBy.length >= i.capacity).length;
    $('#iStats').innerHTML = '<span class="stat s-blue">' + used + ' de ' + total + ' cupos apartados</span><span class="stat s-green">' + plural(full, 'completo', 'completos') + '</span>';
    const q = norm(iQuery);
    const rows = items.filter((i) => !q || norm(i.name + ' ' + i.category).includes(q));
    let html = '<div class="trow th i-cols"><span>CHÓCORO</span><span>APARTADOS</span><span>LO LLEVAN</span><span>CUPOS</span><span></span></div>';
    html += rows.map((i) => {
      const n = i.takenBy.length, isFull = n >= i.capacity;
      return '<div class="trow i-cols">' +
        '<div class="who c-who">' + catIcon(i.category, 18) + '<div style="min-width:0"><b>' + esc(i.name) + '</b><small>' + esc(i.category) + '</small></div></div>' +
        '<div class="c-bar" style="display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:700;color:' + (isFull ? '#3d5a46' : 'var(--ink)') + '">' + (isFull ? 'Completo · ' : '') + n + ' de ' + i.capacity + '</span>' +
        '<div class="bar' + (isFull ? ' full' : '') + '"><i style="width:' + Math.round(n / i.capacity * 100) + '%"></i></div></div>' +
        '<span class="c-names" style="font-size:13px;line-height:1.35;color:' + (n ? 'var(--ink)' : '#8b8780') + '">' + (n ? esc(i.takenBy.join(', ')) : 'Nadie aún') + '</span>' +
        '<div class="stepper c-step"><button type="button" class="step" data-step="-1" data-id="' + i.id + '" aria-label="Quitar un cupo a ' + esc(i.name) + '"' + (i.capacity <= Math.max(1, n) ? ' disabled' : '') + '>−</button>' +
        '<span style="width:32px;text-align:center;font-size:16px;font-weight:800">' + i.capacity + '</span>' +
        '<button type="button" class="step" data-step="1" data-id="' + i.id + '" aria-label="Agregar un cupo a ' + esc(i.name) + '"' + (i.capacity >= 50 ? ' disabled' : '') + '>+</button></div>' +
        '<button type="button" class="trash c-del" data-del-item="' + i.id + '" aria-label="Eliminar ' + esc(i.name) + '">' + TRASH + '</button>' +
        '</div>';
    }).join('');
    if (!rows.length) html += '<div class="empty">' + (items.length ? 'Ningún chócoro coincide con la búsqueda.' : 'Aún no has agregado chócoros. Usa "+ Agregar chócoro".') + '</div>';
    $('#iTable').innerHTML = html;
  }
  $('#iSearch').addEventListener('input', (e) => { iQuery = e.target.value.trim(); renderItems(); });

  const capInput = $('#itemForm').capacity;
  const clampCap = (v) => Math.max(1, Math.min(50, parseInt(v, 10) || 1));
  function capHint() {
    const n = clampCap(capInput.value);
    $('#capHint').textContent = n === 1 ? 'Solo una persona lo podrá elegir.' : 'Hasta ' + n + ' personas lo podrán elegir.';
  }
  $('#itemForm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cap]');
    if (b) { capInput.value = clampCap(clampCap(capInput.value) + Number(b.dataset.cap)); capHint(); }
  });
  capInput.addEventListener('input', capHint);
  capInput.addEventListener('blur', () => { capInput.value = clampCap(capInput.value); capHint(); });

  $('#itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    const name = f.name.value.trim().replace(/\s+/g, ' ');
    $('#itemError').textContent = '';
    if (!name) { $('#itemError').textContent = 'Escribe el nombre del chócoro.'; f.name.focus(); return; }
    btn.disabled = true;
    try {
      await api.addItem(eventId, { name, category: f.category.value, capacity: clampCap(capInput.value) });
      closeModal('dlgItem');
      toast(name + ' agregado a la lista.');
      await reload();
    } catch (err) { $('#itemError').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  $('#iTable').addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const it = items.find((x) => String(x.id) === step.dataset.id);
      step.disabled = true;
      try { await api.updateCapacity(it.id, it.capacity + Number(step.dataset.step)); } catch (err) { toast(err.message); }
      await reload();
      return;
    }
    const del = e.target.closest('[data-del-item]');
    if (del) {
      const it = items.find((x) => String(x.id) === del.dataset.delItem);
      const warn = it.takenBy.length ? ' Lo tienen apartado: ' + it.takenBy.join(', ') + '. Tendrán que elegir otro.' : '';
      if (!confirm('¿Eliminar "' + it.name + '"?' + warn)) return;
      try { await api.deleteItem(it.id); await reload(); } catch (err) { toast(err.message); }
    }
  });

  // ---------- Eventos (super admin) ----------
  const hostName = (email) => { const h = hosts.find((x) => x.email === email); return h && h.name ? h.name : email; };

  function renderEvents() {
    if (!me || !me.is_super) return;
    const q = norm(eQuery);
    const rows = events.filter((ev) => !q || norm(ev.name + ' ' + ev.place + ' ' + ev.hosts_display).includes(q));
    let html = '<div class="trow th e-cols"><span>EVENTO</span><span>FECHA Y HORA</span><span>DIRECCIÓN</span><span>ANFITRIONES</span><span>INVITADOS</span><span></span></div>';
    html += rows.map((ev) =>
      '<div class="trow e-cols">' +
      '<div class="c-who" style="min-width:0"><b class="t">' + esc(ev.name) + '</b>' +
      (ev.id === eventId ? '<span class="stat s-blue" style="padding:2px 8px;font-size:11px">Seleccionado</span>' : '<small class="t">' + esc(ev.hosts_display || '') + '</small>') + '</div>' +
      '<span class="c-when" style="font-size:14px">' + esc(whenText(ev)) + '</span>' +
      '<span class="c-place" style="font-size:14px">' + (ev.place ? esc(ev.place) : '<span class="muted">Sin dirección</span>') + '</span>' +
      '<div class="chips c-hosts">' + (ev.hosts.length ? ev.hosts.map((h) => '<span class="chip-mail" title="' + esc(h) + '"><span>' + esc(hostName(h)) + '</span></span>').join('') : '<span class="muted" style="font-size:13px">Sin anfitriones</span>') + '</div>' +
      '<span class="c-count" style="font-size:14px;font-weight:700">' + (ev.guestCount || 0) + '</span>' +
      '<div class="acts c-acts">' +
      '<button type="button" class="mini" data-edit-ev="' + esc(ev.id) + '">Editar</button>' +
      '<button type="button" class="mini" data-open-ev="' + esc(ev.id) + '">Invitados</button>' +
      '<button type="button" class="trash" data-del-ev="' + esc(ev.id) + '" aria-label="Eliminar ' + esc(ev.name) + '">' + TRASH + '</button>' +
      '</div></div>').join('');
    if (!rows.length) html += '<div class="empty">' + (events.length ? 'Ningún evento coincide con la búsqueda.' : 'Aún no hay eventos. Crea el primero con "+ Nuevo evento".') + '</div>';
    $('#eTable').innerHTML = html;
  }
  $('#eSearch').addEventListener('input', (e) => { eQuery = e.target.value.trim(); renderEvents(); });

  function openEventModal(ev) {
    const f = $('#eventForm');
    editingEvent = ev ? ev.id : null;
    f.evname.value = ev ? ev.name : '';
    f.hosts_display.value = ev ? ev.hosts_display || '' : '';
    f.event_date.value = ev ? ev.event_date || '' : '';
    f.event_time.value = ev ? ev.event_time || '' : '';
    f.place.value = ev ? ev.place || '' : '';
    f.maps_url.value = ev ? ev.maps_url || '' : '';
    f.deadline.value = ev ? ev.deadline || '' : '';
    const sel = ev ? ev.hosts : [];
    $('#evHostChecks').innerHTML = hosts.length
      ? hosts.map((h) => '<label><input type="checkbox" value="' + esc(h.email) + '"' + (sel.indexOf(h.email) >= 0 ? ' checked' : '') + '>' +
          esc(h.name || h.email) + '<small>' + esc(h.email) + '</small></label>').join('')
      : '<span style="padding:10px;font-size:13px;color:var(--muted)">Aún no hay anfitriones. Créalos en el módulo Anfitriones.</span>';
    $('#eventError').textContent = '';
    $('#dlgEventTitle').textContent = ev ? 'Editar evento' : 'Nuevo evento';
    $('#eventSave').textContent = ev ? 'Guardar cambios' : 'Crear evento';
    openModal('dlgEvent');
  }
  $('#newEventBtn').addEventListener('click', () => openEventModal(null));

  $('#eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#eventSave');
    $('#eventError').textContent = '';
    const name = f.evname.value.trim();
    if (!name) { $('#eventError').textContent = 'Escribe el nombre del evento.'; f.evname.focus(); return; }
    if (f.maps_url.value && !/^https?:\/\//.test(f.maps_url.value.trim())) { $('#eventError').textContent = 'El enlace de Maps debe empezar por https://'; return; }
    const hostsSel = Array.from(document.querySelectorAll('#evHostChecks input:checked')).map((i) => i.value);
    btn.disabled = true;
    try {
      const wasEditing = editingEvent;
      const id = await api.saveEvent({
        id: editingEvent, name, hosts_display: f.hosts_display.value.trim(), event_date: f.event_date.value,
        event_time: f.event_time.value, place: f.place.value.trim(), maps_url: f.maps_url.value.trim(),
        deadline: f.deadline.value, hosts: hostsSel
      });
      closeModal('dlgEvent');
      toast(wasEditing ? 'Cambios guardados.' : 'Evento creado.');
      me = await api.whoami();
      if (!eventId) eventId = id;
      await loadAdmin(); route(); await reload();
    } catch (err) { $('#eventError').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  $('#eTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-ev]');
    if (edit) { openEventModal(events.find((x) => x.id === edit.dataset.editEv)); return; }
    const open = e.target.closest('[data-open-ev]');
    if (open) { selectEvent(open.dataset.openEv); location.hash = '#invitados'; await reload(); return; }
    const del = e.target.closest('[data-del-ev]');
    if (del) {
      const ev = events.find((x) => x.id === del.dataset.delEv);
      if (!confirm('¿Eliminar el evento "' + ev.name + '"? Se borrarán sus ' + plural(ev.guestCount || 0, 'invitado', 'invitados') + ' y chócoros. No se puede deshacer.')) return;
      try {
        await api.deleteEvent(ev.id);
        me = await api.whoami();
        if (eventId === ev.id) eventId = me.events[0] ? me.events[0].id : null;
        await loadAdmin(); route(); await reload();
        toast('Evento eliminado.');
      } catch (err) { toast(err.message); }
    }
  });

  // ---------- Anfitriones (super admin) ----------
  function renderHosts() {
    if (!me || !me.is_super) return;
    const q = norm(hQuery);
    const rows = hosts.filter((h) => !q || norm(h.name + ' ' + h.email).includes(q));
    const evName = (id) => (events.find((e) => e.id === id) || {}).name;
    let html = '<div class="trow th h-cols"><span>ANFITRIÓN</span><span>EVENTOS</span><span></span></div>';
    html += rows.map((h) => {
      const evs = h.eventIds.map(evName).filter(Boolean);
      return '<div class="trow h-cols">' +
        '<div class="who c-who"><span class="avatar">' + esc((h.name || h.email).charAt(0).toUpperCase()) + '</span><div style="min-width:0"><b>' + esc(h.name || '—') + '</b><small>' + esc(h.email) + '</small></div></div>' +
        '<div class="chips c-evs">' + (evs.length ? evs.map((n) => '<span class="chip-mail"><span>' + esc(n) + '</span></span>').join('') : '<span class="muted" style="font-size:13px">Sin eventos</span>') + '</div>' +
        '<div class="acts c-acts">' +
        '<button type="button" class="mini" data-edit-host="' + esc(h.email) + '">Editar</button>' +
        '<button type="button" class="mini" data-pass-host="' + esc(h.email) + '">Contraseña</button>' +
        '<button type="button" class="trash" data-del-host="' + esc(h.email) + '" aria-label="Eliminar a ' + esc(h.name || h.email) + '">' + TRASH + '</button>' +
        '</div></div>';
    }).join('');
    if (!rows.length) html += '<div class="empty">' + (hosts.length ? 'Ningún anfitrión coincide con la búsqueda.' : 'Aún no hay anfitriones. Crea el primero con "+ Nuevo anfitrión".') + '</div>';
    $('#hTable').innerHTML = html;
  }
  $('#hSearch').addEventListener('input', (e) => { hQuery = e.target.value.trim(); renderHosts(); });

  function genPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const arr = new Uint32Array(10);
    crypto.getRandomValues(arr);
    return Array.from(arr, (n) => chars[n % chars.length]).join('');
  }

  function openHostModal(h, focusPassword) {
    const f = $('#hostForm');
    editingHost = h ? h.email : null;
    f.hname.value = h ? h.name : '';
    f.hemail.value = h ? h.email : '';
    f.hemail.readOnly = !!h;
    $('#emailHint').textContent = h ? 'El correo no se puede cambiar' : 'Con este correo entrará al panel';
    f.hpass.value = '';
    f.hpass.type = 'password'; $('#pwShow').textContent = 'Ver';
    $('#pwLabel').textContent = h ? 'Nueva contraseña' : 'Contraseña';
    $('#pwHint').textContent = h ? 'Déjala vacía para no cambiarla. Mínimo 8 caracteres.' : 'Mínimo 8 caracteres. Usa "Generar" para crear una segura.';
    const sel = h ? h.eventIds : (eventId ? [eventId] : []);
    $('#hostEventChecks').innerHTML = events.length
      ? events.map((ev) => '<label><input type="checkbox" value="' + esc(ev.id) + '"' + (sel.indexOf(ev.id) >= 0 ? ' checked' : '') + '>' +
          esc(ev.name) + '<small>' + esc(fmtDate(ev.event_date).short) + '</small></label>').join('')
      : '<span style="padding:10px;font-size:13px;color:var(--muted)">Aún no hay eventos. Créalos en el módulo Eventos.</span>';
    $('#hostError').textContent = '';
    $('#dlgHostTitle').textContent = h ? 'Editar anfitrión' : 'Nuevo anfitrión';
    $('#hostSave').textContent = h ? 'Guardar cambios' : 'Crear anfitrión';
    $('#hostBody').hidden = false; $('#hostFooter').hidden = false;
    $('#hostDone').hidden = true; $('#hostDoneFooter').hidden = true;
    openModal('dlgHost');
    if (focusPassword) f.hpass.focus(); else if (h) f.hname.focus();
  }
  $('#newHostBtn').addEventListener('click', () => openHostModal(null));
  $('#pwShow').addEventListener('click', () => {
    const inp = $('#hostForm').hpass;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#pwShow').textContent = inp.type === 'password' ? 'Ver' : 'Ocultar';
  });
  $('#pwGen').addEventListener('click', () => {
    const inp = $('#hostForm').hpass;
    inp.value = genPassword(); inp.type = 'text'; $('#pwShow').textContent = 'Ocultar';
  });

  let lastCreds = '';
  $('#hostForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#hostSave');
    $('#hostError').textContent = '';
    const name = f.hname.value.trim().replace(/\s+/g, ' ');
    const email = f.hemail.value.trim().toLowerCase();
    const password = f.hpass.value;
    if (!name) { $('#hostError').textContent = 'Escribe el nombre del anfitrión.'; f.hname.focus(); return; }
    if (!isEmail(email)) { $('#hostError').textContent = 'Escribe un correo válido.'; f.hemail.focus(); return; }
    if (!editingHost && hosts.some((h) => h.email === email)) { $('#hostError').textContent = 'Ya existe un anfitrión con ese correo.'; return; }
    if (!editingHost && !password) { $('#hostError').textContent = 'Ponle una contraseña (o usa "Generar").'; f.hpass.focus(); return; }
    if (password && password.length < 8) { $('#hostError').textContent = 'La contraseña debe tener al menos 8 caracteres.'; f.hpass.focus(); return; }
    const eventIds = Array.from(document.querySelectorAll('#hostEventChecks input:checked')).map((i) => i.value);
    btn.disabled = true;
    try {
      await api.saveHost({ email, name, password, eventIds });
      await loadAdmin();
      if (password) {
        lastCreds = 'Panel: ' + panelUrl() + '\nCorreo: ' + email + '\nContraseña: ' + password;
        $('#credsText').innerHTML = esc(lastCreds).replace(/\n/g, '<br>');
        $('#hostBody').hidden = true; $('#hostFooter').hidden = true;
        $('#hostDone').hidden = false; $('#hostDoneFooter').hidden = false;
        $('#dlgHostTitle').textContent = editingHost ? 'Contraseña actualizada' : 'Anfitrión creado';
        $('#copyCreds').focus();
      } else {
        closeModal('dlgHost');
        toast('Cambios guardados.');
      }
    } catch (err) { $('#hostError').textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $('#copyCreds').addEventListener('click', (e) => copyText(lastCreds, e.currentTarget, 'Copiar datos de acceso'));

  $('#hTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-host]');
    if (edit) { openHostModal(hosts.find((h) => h.email === edit.dataset.editHost)); return; }
    const pass = e.target.closest('[data-pass-host]');
    if (pass) { openHostModal(hosts.find((h) => h.email === pass.dataset.passHost), true); return; }
    const del = e.target.closest('[data-del-host]');
    if (del) {
      const h = hosts.find((x) => x.email === del.dataset.delHost);
      if (!confirm('¿Eliminar a ' + (h.name || h.email) + '? Ya no podrá entrar al panel. Sus eventos no se borran.')) return;
      try { await api.deleteHost(h.email); await loadAdmin(); toast('Anfitrión eliminado.'); } catch (err) { toast(err.message); }
    }
  });

  showPanel();
})();
