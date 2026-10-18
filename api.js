// Capa de datos: usa Supabase si está configurado; si no, un modo demo local.
(function () {
  const ERRORS = {
    item_full: 'Alguien acaba de elegir ese chócoro y ya no quedan cupos. Escoge otro.',
    invalid_code: 'Este enlace de invitación no es válido.',
    capacity_below_taken: 'No puedes dejar menos cupos de los que ya están apartados.',
    item_not_found: 'Ese chócoro ya no existe.',
    event_hosts_email_check: 'Uno de los correos de anfitrión no es válido.',
    hosts_email_check: 'Ese correo no es válido.',
    hosts_pkey: 'Ya existe un anfitrión con ese correo.',
    weak_password: 'La contraseña debe tener al menos 8 caracteres.',
    invalid_email: 'Ese correo no es válido.',
    not_super_admin: 'Solo el super admin puede hacer esto.',
    cannot_delete_super_admin: 'No puedes eliminar la cuenta de un super admin.',
    function_missing: 'Falta crear la función "manage-hosts" en Supabase (mira el README, paso 2).'
  };
  function friendly(err) {
    const msg = (err && (err.message || err.error_description)) || String(err);
    for (const key in ERRORS) if (msg.indexOf(key) >= 0) return new Error(ERRORS[key]);
    if (/Invalid login credentials/i.test(msg)) return new Error('Correo o contraseña incorrectos.');
    if (/Email not confirmed/i.test(msg)) return new Error('Primero confirma tu correo con el enlace que te llegó.');
    if (/already registered/i.test(msg)) return new Error('Ese correo ya tiene cuenta. Ingresa con tu contraseña.');
    if (/Password should be/i.test(msg)) return new Error('La contraseña debe tener al menos 6 caracteres.');
    if (/Failed to fetch|NetworkError/i.test(msg)) return new Error('Sin conexión. Revisa tu internet e intenta de nuevo.');
    return new Error(msg);
  }
  const normEmails = (list) => Array.from(new Set((list || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)));

  // ---------------- Supabase ----------------
  function supabaseApi() {
    const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    async function rpc(name, args) {
      const { data, error } = await sb.rpc(name, args);
      if (error) throw friendly(error);
      return data;
    }
    async function q(promise) {
      const { data, error } = await promise;
      if (error) throw friendly(error);
      return data;
    }
    const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
    async function manageHosts(body) {
      const { data, error } = await sb.functions.invoke('manage-hosts', { body });
      if (error) {
        let msg = error.message || '';
        try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (e) { /* sin cuerpo */ }
        if (/Failed to send|FunctionsFetchError|not found|404/i.test(msg + ' ' + (error.name || ''))) msg = 'function_missing';
        throw friendly(msg);
      }
      if (data && data.error) throw friendly(data.error);
      return data;
    }
    const eventRow = (e) => ({
      id: e.id, name: e.name, hosts_display: e.hosts_display, event_date: e.event_date,
      event_time: e.event_time ? String(e.event_time).slice(0, 5) : '', place: e.place,
      maps_url: e.maps_url || '', deadline: e.deadline,
      hosts: (e.event_hosts || []).map((h) => h.email),
      guestCount: e.guests && e.guests[0] ? e.guests[0].count : 0,
      itemCount: e.items && e.items[0] ? e.items[0].count : 0
    });

    return {
      demo: false,
      getInvitation: (code) => rpc('get_invitation', { p_code: code }),
      chooseItem: (code, itemId) => rpc('choose_item', { p_code: code, p_item_id: itemId }),
      decline: (code) => rpc('decline_invitation', { p_code: code }),
      resetResponse: (code) => rpc('reset_response', { p_code: code }),

      async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw friendly(error);
      },
      async signOut() { await sb.auth.signOut(); },
      whoami: () => rpc('whoami'),

      async listEvents() {
        const rows = await q(sb.from('events').select('*, event_hosts(email), guests(count), items(count)')
          .order('event_date', { ascending: true, nullsFirst: false }).order('name'));
        return rows.map(eventRow);
      },
      async getEvent(id) {
        return eventRow(await q(sb.from('events').select('*, event_hosts(email)').eq('id', id).single()));
      },
      async saveEvent(ev) {
        const fields = {
          name: ev.name, hosts_display: ev.hosts_display, event_date: ev.event_date || null,
          event_time: ev.event_time || null, place: ev.place, maps_url: ev.maps_url || null, deadline: ev.deadline || null
        };
        const saved = ev.id
          ? await q(sb.from('events').update(fields).eq('id', ev.id).select('id').single())
          : await q(sb.from('events').insert(fields).select('id').single());
        const emails = normEmails(ev.hosts);
        const current = await q(sb.from('event_hosts').select('email').eq('event_id', saved.id));
        const toDelete = current.map((h) => h.email).filter((e) => emails.indexOf(e) < 0);
        if (toDelete.length) await q(sb.from('event_hosts').delete().eq('event_id', saved.id).in('email', toDelete));
        const toAdd = emails.filter((e) => !current.some((h) => h.email === e));
        if (toAdd.length) await q(sb.from('event_hosts').insert(toAdd.map((email) => ({ event_id: saved.id, email }))));
        return saved.id;
      },
      deleteEvent: (id) => q(sb.from('events').delete().eq('id', id)),

      async listHosts() {
        const rows = await q(sb.from('hosts').select('email,name,event_hosts(event_id)').order('name'));
        return rows.map((h) => ({ email: h.email, name: h.name, eventIds: (h.event_hosts || []).map((x) => x.event_id) }));
      },
      async saveHost(h) {
        const email = String(h.email).trim().toLowerCase();
        if (h.password) await manageHosts({ action: 'set_password', email, password: h.password });
        await q(sb.from('hosts').upsert({ email, name: h.name }, { onConflict: 'email' }));
        const current = (await q(sb.from('event_hosts').select('event_id').eq('email', email))).map((x) => x.event_id);
        const want = h.eventIds || [];
        const toDelete = current.filter((id) => want.indexOf(id) < 0);
        if (toDelete.length) await q(sb.from('event_hosts').delete().eq('email', email).in('event_id', toDelete));
        const toAdd = want.filter((id) => current.indexOf(id) < 0);
        if (toAdd.length) await q(sb.from('event_hosts').insert(toAdd.map((event_id) => ({ event_id, email }))));
      },
      async deleteHost(email) {
        await manageHosts({ action: 'delete_user', email });
        await q(sb.from('hosts').delete().eq('email', email));
      },

      async listGuests(eventId) {
        const rows = await q(sb.from('guests')
          .select('id,name,phone,code,status,selections(item_id,items(name))')
          .eq('event_id', eventId).order('created_at'));
        return rows.map((g) => {
          const s = one(g.selections);
          return { id: g.id, name: g.name, phone: g.phone, code: g.code, status: g.status,
                   itemName: s && s.items ? one(s.items).name : null };
        });
      },
      addGuest: (eventId, g) => q(sb.from('guests').insert({ event_id: eventId, name: g.name, phone: g.phone || null }).select().single()),
      deleteGuest: (id) => q(sb.from('guests').delete().eq('id', id)),
      async listItems(eventId) {
        const rows = await q(sb.from('items')
          .select('id,name,category,capacity,selections(guests(name))')
          .eq('event_id', eventId).order('category').order('name'));
        return rows.map((i) => ({
          id: i.id, name: i.name, category: i.category, capacity: i.capacity,
          takenBy: (i.selections || []).map((s) => one(s.guests)).filter(Boolean).map((g) => g.name)
        }));
      },
      addItem: (eventId, i) => q(sb.from('items').insert({ event_id: eventId, name: i.name, category: i.category, capacity: i.capacity })),
      updateCapacity: (id, capacity) => q(sb.from('items').update({ capacity }).eq('id', id)),
      deleteItem: (id) => q(sb.from('items').delete().eq('id', id))
    };
  }

  // ---------------- Demo (sin Supabase) ----------------
  function demoApi() {
    const KEY = 'chocoro-demo-v3';
    const E1 = 'ev1', E2 = 'ev2';
    const seed = () => ({
      nextItem: 20,
      supers: ['super@demo.com'],
      hosts: [{ email: 'ana@demo.com', name: 'Ana' }, { email: 'sofia@demo.com', name: 'Sofía' }],
      events: [
        { id: E1, name: 'Casa de Ana y Luis', hosts_display: 'Ana y Luis', event_date: '2026-11-15', event_time: '16:00',
          place: 'Cra 50 # 80-12, El Prado', maps_url: '', deadline: '2026-11-08', hosts: ['ana@demo.com'] },
        { id: E2, name: 'Apto de Sofía', hosts_display: 'Sofía', event_date: '2026-12-06', event_time: '15:00',
          place: 'Calle 84 # 45-20, Alto Prado', maps_url: '', deadline: '2026-11-30', hosts: ['sofia@demo.com'] }
      ],
      guests: [
        { id: 'g1', event_id: E1, name: 'Mariana', phone: '3001234567', code: 'demo1', status: 'pendiente' },
        { id: 'g2', event_id: E1, name: 'Carlos', phone: '', code: 'demo2', status: 'confirmado' },
        { id: 'g3', event_id: E1, name: 'Valentina', phone: '', code: 'demo3', status: 'confirmado' },
        { id: 'g4', event_id: E1, name: 'Andrés', phone: '', code: 'demo4', status: 'no_asiste' },
        { id: 'g5', event_id: E2, name: 'Pedro', phone: '', code: 'demo5', status: 'pendiente' }
      ],
      items: [
        { id: 1, event_id: E1, name: 'Juego de ollas', category: 'Cocina', capacity: 1 },
        { id: 2, event_id: E1, name: 'Sartén antiadherente', category: 'Cocina', capacity: 1 },
        { id: 3, event_id: E1, name: 'Licuadora', category: 'Cocina', capacity: 1 },
        { id: 4, event_id: E1, name: 'Vasos de vidrio (x6)', category: 'Comedor', capacity: 2 },
        { id: 5, event_id: E1, name: 'Platos hondos (x6)', category: 'Comedor', capacity: 2 },
        { id: 6, event_id: E1, name: 'Toallas de baño', category: 'Baño', capacity: 3 },
        { id: 7, event_id: E1, name: 'Juego de sábanas doble', category: 'Habitación', capacity: 2 },
        { id: 8, event_id: E1, name: 'Escoba y trapero', category: 'Aseo', capacity: 1 },
        { id: 9, event_id: E2, name: 'Cafetera', category: 'Cocina', capacity: 1 },
        { id: 10, event_id: E2, name: 'Cojines (x2)', category: 'Habitación', capacity: 2 }
      ],
      selections: { g2: 1, g3: 5 }
    });
    let mem = null;
    function load() {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { mem = seed(); }
      return mem;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* sin almacenamiento */ } }
    const wait = (v) => new Promise((r) => setTimeout(() => r(v), 200));
    const taken = (db, itemId) => Object.keys(db.selections).filter((g) => db.selections[g] === itemId);
    const sortItems = (a, b) => (a.category + a.name).localeCompare(b.category + b.name);
    function invitation(code) {
      const db = load();
      const g = db.guests.find((x) => x.code === code);
      if (!g) return null;
      const e = db.events.find((x) => x.id === g.event_id) || {};
      return {
        name: g.name, status: g.status, item_id: db.selections[g.id] || null,
        event: { hosts: e.hosts_display, date: e.event_date, time: e.event_time, place: e.place, maps_url: e.maps_url, deadline: e.deadline },
        items: db.items.filter((i) => i.event_id === g.event_id).sort(sortItems)
          .map((i) => ({ id: i.id, name: i.name, category: i.category, capacity: i.capacity, taken: taken(db, i.id).length }))
      };
    }
    function guestByCode(code) {
      const g = load().guests.find((x) => x.code === code);
      if (!g) throw friendly('invalid_code');
      return g;
    }
    let session = null;
    try { session = sessionStorage.getItem('chocoro-demo-session'); } catch (e) { /* nada */ }
    const isSuper = () => load().supers.indexOf(session) >= 0;
    const myEvents = () => load().events.filter((e) => isSuper() || e.hosts.indexOf(session) >= 0);

    return {
      demo: true,
      demoCodes: () => load().guests.map((g) => g.code),
      getInvitation: (code) => wait(invitation(code)),
      async chooseItem(code, itemId) {
        const db = load(); const g = guestByCode(code);
        const item = db.items.find((i) => i.id === itemId && i.event_id === g.event_id);
        if (!item) throw friendly('item_not_found');
        if (taken(db, itemId).filter((x) => x !== g.id).length >= item.capacity) throw friendly('item_full');
        db.selections[g.id] = itemId; g.status = 'confirmado'; save();
        return wait(invitation(code));
      },
      async decline(code) {
        const db = load(); const g = guestByCode(code);
        delete db.selections[g.id]; g.status = 'no_asiste'; save();
        return wait(invitation(code));
      },
      async resetResponse(code) {
        const g = guestByCode(code);
        if (g.status === 'no_asiste') g.status = 'pendiente';
        save(); return wait(invitation(code));
      },

      getSession: async () => (session ? { user: { email: session } } : null),
      async signIn(email) {
        session = email.trim().toLowerCase();
        try { sessionStorage.setItem('chocoro-demo-session', session); } catch (e) { /* nada */ }
        return wait();
      },
      async signOut() {
        session = null;
        try { sessionStorage.removeItem('chocoro-demo-session'); } catch (e) { /* nada */ }
      },
      whoami: async () => wait({ email: session, name: ((load().hosts.find((h) => h.email === session)) || {}).name || null, is_super: isSuper(), events: myEvents().map((e) => ({ id: e.id, name: e.name })) }),

      async listEvents() {
        const db = load();
        return wait(myEvents().map((e) => Object.assign({}, e, {
          hosts: e.hosts.slice(),
          guestCount: db.guests.filter((g) => g.event_id === e.id).length,
          itemCount: db.items.filter((i) => i.event_id === e.id).length
        })));
      },
      getEvent: async (id) => wait(Object.assign({}, load().events.find((e) => e.id === id))),
      async saveEvent(ev) {
        if (!isSuper()) throw new Error('Solo el super admin puede editar eventos.');
        const db = load();
        const fields = { name: ev.name, hosts_display: ev.hosts_display, event_date: ev.event_date, event_time: ev.event_time,
          place: ev.place, maps_url: ev.maps_url, deadline: ev.deadline, hosts: normEmails(ev.hosts) };
        let id = ev.id;
        if (id) Object.assign(db.events.find((e) => e.id === id), fields);
        else { id = 'ev' + Date.now(); db.events.push(Object.assign({ id }, fields)); }
        save(); return wait(id);
      },
      async deleteEvent(id) {
        const db = load();
        const gids = db.guests.filter((g) => g.event_id === id).map((g) => g.id);
        gids.forEach((g) => delete db.selections[g]);
        db.events = db.events.filter((e) => e.id !== id);
        db.guests = db.guests.filter((g) => g.event_id !== id);
        db.items = db.items.filter((i) => i.event_id !== id);
        save(); return wait();
      },

      async listHosts() {
        const db = load();
        return wait(db.hosts.slice().sort((a, b) => a.name.localeCompare(b.name)).map((h) => ({
          email: h.email, name: h.name, eventIds: db.events.filter((e) => e.hosts.indexOf(h.email) >= 0).map((e) => e.id)
        })));
      },
      async saveHost(h) {
        if (!isSuper()) throw friendly('not_super_admin');
        const db = load();
        const email = String(h.email).trim().toLowerCase();
        if (h.password && h.password.length < 8) throw friendly('weak_password');
        const row = db.hosts.find((x) => x.email === email);
        if (row) row.name = h.name; else db.hosts.push({ email, name: h.name });
        db.events.forEach((e) => {
          const on = (h.eventIds || []).indexOf(e.id) >= 0, has = e.hosts.indexOf(email) >= 0;
          if (on && !has) e.hosts.push(email);
          if (!on && has) e.hosts = e.hosts.filter((x) => x !== email);
        });
        save(); return wait();
      },
      async deleteHost(email) {
        const db = load();
        db.hosts = db.hosts.filter((h) => h.email !== email);
        db.events.forEach((e) => { e.hosts = e.hosts.filter((x) => x !== email); });
        save(); return wait();
      },

      async listGuests(eventId) {
        const db = load();
        return wait(db.guests.filter((g) => g.event_id === eventId).map((g) => {
          const it = db.items.find((i) => i.id === db.selections[g.id]);
          return Object.assign({}, g, { itemName: it ? it.name : null });
        }));
      },
      async addGuest(eventId, g) {
        const db = load();
        const row = { id: 'g' + Date.now(), event_id: eventId, name: g.name, phone: g.phone || '', code: Math.random().toString(36).slice(2, 10), status: 'pendiente' };
        db.guests.push(row); save(); return wait(row);
      },
      async deleteGuest(id) {
        const db = load();
        db.guests = db.guests.filter((g) => g.id !== id); delete db.selections[id]; save(); return wait();
      },
      async listItems(eventId) {
        const db = load();
        return wait(db.items.filter((i) => i.event_id === eventId).sort(sortItems).map((i) => ({
          id: i.id, name: i.name, category: i.category, capacity: i.capacity,
          takenBy: taken(db, i.id).map((gid) => (db.guests.find((g) => g.id === gid) || {}).name).filter(Boolean)
        })));
      },
      async addItem(eventId, i) {
        const db = load();
        db.items.push({ id: db.nextItem++, event_id: eventId, name: i.name, category: i.category, capacity: i.capacity }); save(); return wait();
      },
      async updateCapacity(id, capacity) {
        const db = load();
        if (capacity < taken(db, id).length) throw friendly('capacity_below_taken');
        db.items.find((i) => i.id === id).capacity = capacity; save(); return wait();
      },
      async deleteItem(id) {
        const db = load();
        db.items = db.items.filter((i) => i.id !== id);
        Object.keys(db.selections).forEach((g) => { if (db.selections[g] === id) delete db.selections[g]; });
        save(); return wait();
      }
    };
  }

  const configured = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase);
  window.api = configured ? supabaseApi() : demoApi();

  // ---------- Utilidades compartidas ----------
  window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.toast = (msg) => {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 2800);
  };
  // Fechas en español: "2026-11-15" → { day: '15', month: 'NOV', long: 'Sábado 15 de noviembre' }
  window.fmtDate = (iso) => {
    if (!iso) return { day: '--', month: '', long: 'Fecha por confirmar', short: 'Por confirmar' };
    const d = new Date(iso + 'T12:00:00');
    const long = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
    return {
      day: String(d.getDate()),
      month: d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '').toUpperCase(),
      long: long.charAt(0).toUpperCase() + long.slice(1),
      short: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
    };
  };
  // "16:00" → "4:00 p. m."
  window.fmtTime = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.');
  };
  window.ICONS = {
    Cocina: '<path d="M4 10h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2 10h20M9 6V4M15 6V4"/>',
    Comedor: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 6h3v12"/>',
    'Baño': '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    'Habitación': '<path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-8v3"/><circle cx="7" cy="10.5" r="1.5"/>',
    Aseo: '<path d="M14 3l-4 9M6 12h8l2 9H4z"/>',
    Otro: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'
  };
  window.catIcon = (cat, size) => {
    const c = window.ICONS[cat] ? cat : 'Otro';
    return '<span class="icon-circle cat-' + c + '"><svg width="' + (size || 20) + '" height="' + (size || 20) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      window.ICONS[c] + '</svg></span>';
  };
})();
