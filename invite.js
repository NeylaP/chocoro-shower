(function () {
  let E = {};             // datos del evento (vienen con la invitación)
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  let code = (params.get('c') || '').trim();
  let inv = null;          // datos de la invitación
  let picked = null;       // id del chócoro marcado en la pantalla de elegir
  let busy = false;

  if (api.demo) {
    const codes = api.demoCodes();
    if (!code) code = codes[0];
    const b = document.getElementById('demo');
    b.hidden = false;
    b.innerHTML = 'Modo demo · prueba otros invitados: ' +
      codes.map((c) => '<a href="?c=' + c + '">' + c + '</a>').join(' · ');
  }

  const svg = (d, size, sw) => '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2.2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>'
  };
  const HOUSE = '<svg role="img" aria-label="Casa nueva" width="128" height="120" viewBox="0 0 128 120" style="flex-shrink:0;margin:4px -6px 0 0">' +
    '<path d="M30 40 C40 14 90 10 112 30 C130 48 122 86 100 98 C76 110 34 104 22 84 C14 70 22 54 30 40 Z" fill="#f5e9df"/>' +
    '<path d="M84 12 C84 8 89 7 90.5 10.5 C92 7 97 8 97 12 C97 16 90.5 20 90.5 20 C90.5 20 84 16 84 12 Z" fill="#7b94c4"/>' +
    '<g fill="none" stroke="#1e2d4d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 56 L62 22 L106 56"/><path d="M86 40 V27 H95 V47"/><path d="M28 49 V100 M96 49 V100"/><path d="M54 100 V80 H70 V100"/><path d="M12 102 C40 100 90 100 120 103"/></g>' +
    '<path d="M55 55 C55 50.5 60.5 49.5 62 53.5 C63.5 49.5 69 50.5 69 55 C69 60 62 64 62 64 C62 64 55 60 55 55 Z" fill="#7b94c4"/>' +
    '<path d="M104 100 C106 88 110 80 118 72" fill="none" stroke="#5f7a68" stroke-width="2" stroke-linecap="round"/><path d="M118 72 C110 72 104 80 104 90 C112 88 118 82 118 72 Z" fill="#8fa596"/><path d="M108 90 C114 86 122 86 126 90 C120 96 112 96 108 90 Z" fill="#a9bbad"/></svg>';

  function setView(html) {
    const old = app.querySelector('.view');
    const v = document.createElement('div');
    v.className = 'view';
    v.innerHTML = html;
    old.replaceWith(v);
    window.scrollTo(0, 0);
    return v;
  }
  const myItem = () => inv && inv.items.find((i) => i.id === inv.item_id);
  function setEvent(ev) {
    ev = ev || {};
    const d = fmtDate(ev.date);
    E = { day: d.day, month: d.month, dateLong: d.long, time: fmtTime(ev.time), place: ev.place || 'Lugar por confirmar',
          mapsUrl: ev.maps_url || '', hosts: ev.hosts || '', deadline: ev.deadline ? fmtDate(ev.deadline).short : '' };
  }

  // ---------- Vistas ----------
  function viewMessage(title, text) {
    setView('<div class="center"><div class="icon-circle" style="width:64px;height:64px;background:var(--accent-soft);color:var(--accent)">' + svg(I.home, 28) + '</div>' +
      '<h1 style="margin:0;font-size:26px;font-weight:800">' + esc(title) + '</h1><p style="margin:0;color:var(--body);line-height:1.5">' + esc(text) + '</p></div>');
  }

  function viewInvite() {
    const name = esc(inv.name);
    const place = E.mapsUrl ? '<a href="' + esc(E.mapsUrl) + '" target="_blank" rel="noopener">' + esc(E.place) + '</a>' : esc(E.place);
    let actions;
    if (inv.status === 'no_asiste') {
      actions = '<div class="card status-box">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="#7b94c4"/></svg>' +
        '<b>Gracias por avisarnos, ' + name + '</b><p>Te vamos a extrañar. Si cambias de planes, puedes volver a este enlace.</p>' +
        '<button class="btn btn-outline" data-act="reset" style="margin-top:4px;min-height:44px">Cambiar mi respuesta</button></div>';
    } else if (inv.status === 'confirmado' && myItem()) {
      actions = '<div class="card status-box"><b>Ya confirmaste tu asistencia</b>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center"><span style="font-size:14px;color:var(--muted)">Llevarás</span><span class="chip">' + esc(myItem().name) + '</span></div>' +
        '<button class="btn btn-outline" data-act="choose" style="margin-top:4px;min-height:44px">Cambiar mi chócoro</button></div>' +
        '<button class="btn btn-link" data-act="decline">Ya no podré asistir</button>';
    } else {
      actions = '<button class="btn btn-primary btn-block" data-act="choose">Confirmar y elegir mi chócoro ' + svg(I.arrow, 18, 2.4) + '</button>' +
        '<button class="btn btn-link" data-act="decline">No podré asistir</button>' +
        (E.deadline ? '<small>Confirma antes del ' + esc(E.deadline) + '</small>' : '');
    }
    setView(
      '<section class="hero"><div class="hero-top"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">' +
      '<span class="pill" style="align-self:flex-start">Para ' + name + '</span>' +
      '<h1 class="title">Chocoro<br>Shower</h1></div>' + HOUSE + '</div>' +
      '<p class="lead">' + name + ', estrenamos casa y queremos que seas parte de este nuevo comienzo.</p></section>' +
      '<section class="card event" aria-label="Detalles del evento"><div class="event-row">' +
      '<div class="date-tile" aria-label="' + esc(E.dateLong) + '"><span style="color:var(--accent)">' + svg(I.cal, 20, 2) + '</span><b>' + esc(E.day) + '</b><span>' + esc(E.month) + '</span></div>' +
      '<div class="vline"></div><div class="meta">' +
      '<div><span style="color:var(--accent)">' + svg(I.clock) + '</span><span>' + esc(E.dateLong) + (E.time ? ' · ' + esc(E.time) : '') + '</span></div>' +
      '<div><span style="color:var(--accent)">' + svg(I.pin) + '</span><span>' + place + '</span></div></div></div>' +
      (E.hosts ? '<div class="hosts"><span class="label-caps">Te esperan</span><span>' + esc(E.hosts) + '</span></div>' : '') + '</section>' +
      '<section class="note"><span class="icon-circle">' + svg(I.home, 22) + '</span><div><b>Tu chócoro para la casa</b>' +
      '<p>Elige una sola cosa de nuestra lista. Queda apartada a tu nombre y nadie más la podrá escoger.</p></div></section>' +
      '<div class="actions">' + actions + '</div>'
    );
  }

  function viewChoose(error) {
    const available = inv.items.filter((i) => i.taken < i.capacity || i.id === inv.item_id).length;
    const tiles = inv.items.map((i) => {
      const wasMine = i.id === inv.item_id;
      const left = i.capacity - i.taken + (wasMine ? 1 : 0);
      const full = left <= 0;
      const sel = i.id === picked;
      const sub = full ? 'Ya lo eligieron' : sel ? 'Elegido por ti'
        : i.capacity > 1 ? esc(i.category) + ' · ' + (left === 1 ? 'queda 1 cupo' : 'quedan ' + left + ' cupos') : esc(i.category);
      return '<button type="button" class="tile" data-id="' + i.id + '" aria-pressed="' + sel + '"' + (full ? ' disabled' : '') + '>' +
        catIcon(i.category) + '<b>' + esc(i.name) + '</b><small>' + sub + '</small>' +
        '<span class="check">' + svg(I.check, 13, 3.2) + '</span></button>';
    }).join('');
    const chosen = inv.items.find((i) => i.id === picked);
    const v = setView(
      '<div class="topbar"><button class="round-btn" data-act="back" aria-label="Volver a la invitación">' + svg(I.back, 20, 2.4) + '</button></div>' +
      '<div class="choose-head"><span class="pill" style="align-self:flex-start">Para ' + esc(inv.name) + '</span>' +
      '<h2>Elige tu chócoro</h2><p>Solo uno por invitado. Lo que elijas queda apartado a tu nombre.</p></div>' +
      '<div class="list-head"><span class="label-caps">Lista de chócoros</span><span class="label-caps">Quedan ' + available + '</span></div>' +
      (inv.items.length ? '<div class="grid">' + tiles + '</div>' : '<p style="padding:0 24px;color:var(--muted)">Aún no hay chócoros en la lista.</p>') +
      '<div class="footer">' +
      (chosen ? '<div class="row">Llevarás <span class="chip" style="color:var(--ink)">' + esc(chosen.name) + '</span></div>' : '') +
      (error ? '<span class="error" role="alert">' + esc(error) + '</span>' : '') +
      '<button class="btn btn-primary btn-block" data-act="confirm">Confirmar asistencia</button></div>'
    );
    v.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', () => {
      const id = Number(t.dataset.id);
      picked = picked === id ? null : id;
      const y = window.scrollY;
      viewChoose();
      window.scrollTo(0, y);
    }));
  }

  function viewDone() {
    setView(
      '<div class="choose-head" style="padding-top:28px"><span class="pill" style="align-self:flex-start">Para ' + esc(inv.name) + '</span>' +
      '<h2>¡Te esperamos!</h2><p>Gracias por ayudarnos a llenar la casa.</p></div>' +
      '<div class="done"><div class="card"><div class="big-check">' + svg(I.check, 34, 2.6) + '</div>' +
      '<p style="margin:0;font-size:15px;line-height:1.45;color:var(--body)">Tu asistencia quedó confirmada y tu chócoro ya está apartado a tu nombre.</p>' +
      '<div class="mine"><span class="label-caps">Tu chócoro</span><b>' + esc(myItem() ? myItem().name : '') + '</b></div>' +
      '<p style="margin:0;font-size:14px;color:var(--muted)">' + esc(E.dateLong) + (E.time ? ' · ' + esc(E.time) : '') + '<br>' + esc(E.place) + '</p></div>' +
      '<button class="btn btn-outline" data-act="choose">Cambiar mi chócoro</button>' +
      '<button class="btn btn-link" data-act="home">Ver invitación</button></div>'
    );
  }

  // ---------- Acciones ----------
  async function run(fn, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message); } finally { busy = false; if (btn && btn.isConnected) btn.disabled = false; }
  }

  app.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'choose') { picked = inv.item_id || null; viewChoose(); }
    else if (act === 'back' || act === 'home') viewInvite();
    else if (act === 'decline') run(async () => { inv = await api.decline(code); viewInvite(); }, btn);
    else if (act === 'reset') run(async () => { inv = await api.resetResponse(code); viewInvite(); }, btn);
    else if (act === 'confirm') {
      if (picked == null) { viewChoose('Elige tu chócoro para confirmar.'); return; }
      run(async () => {
        try {
          inv = await api.chooseItem(code, picked);
          viewDone();
        } catch (e) {
          inv = (await api.getInvitation(code)) || inv;   // refresca cupos
          picked = null;
          viewChoose(e.message);
        }
      }, btn);
    }
  });

  // ---------- Inicio ----------
  (async function init() {
    if (!code) { viewMessage('Falta tu enlace', 'Abre el enlace personal que te enviaron por WhatsApp.'); return; }
    try {
      inv = await api.getInvitation(code);
      if (!inv) { viewMessage('Enlace no válido', 'Revisa que hayas abierto el enlace completo que te enviaron.'); return; }
      setEvent(inv.event);
      document.title = 'Chocoro Shower · ' + inv.name;
      viewInvite();
    } catch (e) {
      viewMessage('No pudimos cargar tu invitación', e.message);
    }
  })();
})();
