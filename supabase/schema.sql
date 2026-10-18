-- ============================================================
-- Chocoro Shower — esquema para Supabase (varios eventos + super admin)
-- Pégalo completo en Supabase > SQL Editor > New query > Run.
--
-- ¿Ya habías ejecutado una versión anterior? Ejecuta primero esto
-- (borra los datos de prueba anteriores):
--   drop table if exists public.selections, public.items, public.guests,
--     public.event_hosts, public.hosts, public.events, public.admins, public.super_admins cascade;
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tablas ----------

-- Super administradores: crean eventos, editan sus datos y asignan anfitriones.
create table if not exists public.super_admins (
  email text primary key
);

-- Cada Chocoro Shower es un evento.
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),   -- nombre interno, ej. "Casa de Ana y Luis"
  hosts_display text not null default '',                       -- como aparece en la invitación
  event_date    date,
  event_time    time,
  place         text not null default '',
  maps_url      text,
  deadline      date,
  created_at    timestamptz not null default now()
);

-- Anfitriones: personas que pueden entrar al panel. Su contraseña la pone el
-- super admin desde el panel (función manage-hosts).
create table if not exists public.hosts (
  email      text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  name       text not null default '',
  created_at timestamptz not null default now()
);

-- Qué anfitriones administran cada evento.
create table if not exists public.event_hosts (
  event_id uuid not null references public.events(id) on delete cascade,
  email    text not null references public.hosts(email) on delete cascade on update cascade,
  primary key (event_id, email)
);

create table if not exists public.guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  phone        text,
  code         text not null unique default substr(encode(gen_random_bytes(6), 'hex'), 1, 8),
  status       text not null default 'pendiente'
               check (status in ('pendiente', 'confirmado', 'no_asiste')),
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists guests_event_idx on public.guests(event_id);

create table if not exists public.items (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  category   text not null default 'Cocina',
  capacity   int  not null default 1 check (capacity between 1 and 50),
  created_at timestamptz not null default now()
);
create index if not exists items_event_idx on public.items(event_id);

-- guest_id es la llave primaria: cada invitado puede tener UN solo chócoro.
create table if not exists public.selections (
  guest_id   uuid primary key references public.guests(id) on delete cascade,
  item_id    bigint not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists selections_item_idx on public.selections(item_id);

-- ---------- Reglas de cupos ----------

-- Impide apartar un chócoro sin cupos o de otro evento. Bloquea la fila del
-- chócoro, así dos personas eligiendo al mismo tiempo nunca pasan el límite.
create or replace function public.check_item_capacity()
returns trigger language plpgsql as $$
declare
  v_item  public.items;
  v_taken int;
begin
  select * into v_item from public.items where id = new.item_id for update;
  if not found then
    raise exception 'item_not_found';
  end if;
  if v_item.event_id <> (select event_id from public.guests where id = new.guest_id) then
    raise exception 'item_not_found';
  end if;
  select count(*) into v_taken from public.selections
   where item_id = new.item_id and guest_id <> new.guest_id;
  if v_taken >= v_item.capacity then
    raise exception 'item_full';
  end if;
  return new;
end $$;

drop trigger if exists selections_capacity on public.selections;
create trigger selections_capacity
  before insert or update on public.selections
  for each row execute function public.check_item_capacity();

-- Impide bajar los cupos por debajo de los ya apartados.
create or replace function public.check_capacity_change()
returns trigger language plpgsql as $$
declare v_taken int;
begin
  select count(*) into v_taken from public.selections where item_id = new.id;
  if new.capacity < v_taken then
    raise exception 'capacity_below_taken';
  end if;
  return new;
end $$;

drop trigger if exists items_capacity_change on public.items;
create trigger items_capacity_change
  before update of capacity on public.items
  for each row execute function public.check_capacity_change();

-- ---------- Permisos ----------

create or replace function public.my_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins where lower(email) = public.my_email());
$$;

-- ¿Puede el usuario actual administrar este evento?
create or replace function public.is_host(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (select 1 from public.event_hosts where event_id = p_event and email = public.my_email());
$$;

alter table public.super_admins enable row level security;
alter table public.events       enable row level security;
alter table public.hosts        enable row level security;
alter table public.event_hosts  enable row level security;
alter table public.guests       enable row level security;
alter table public.items        enable row level security;
alter table public.selections   enable row level security;

drop policy if exists super_read on public.super_admins;
create policy super_read on public.super_admins for select to authenticated using (public.is_super_admin());

-- Eventos: los anfitriones ven los suyos; solo el super admin crea, edita o borra.
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (public.is_host(id));
drop policy if exists events_write on public.events;
create policy events_write on public.events for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists hosts_self on public.hosts;
create policy hosts_self on public.hosts for select to authenticated
  using (public.is_super_admin() or email = public.my_email());
drop policy if exists hosts_admin on public.hosts;
create policy hosts_admin on public.hosts for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists hosts_read on public.event_hosts;
create policy hosts_read on public.event_hosts for select to authenticated using (public.is_host(event_id));
drop policy if exists hosts_write on public.event_hosts;
create policy hosts_write on public.event_hosts for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Invitados, chócoros y apartados: anfitriones del evento (y super admin).
drop policy if exists guests_host on public.guests;
create policy guests_host on public.guests for all to authenticated
  using (public.is_host(event_id)) with check (public.is_host(event_id));

drop policy if exists items_host on public.items;
create policy items_host on public.items for all to authenticated
  using (public.is_host(event_id)) with check (public.is_host(event_id));

drop policy if exists selections_host on public.selections;
create policy selections_host on public.selections for all to authenticated
  using (exists (select 1 from public.guests g where g.id = guest_id and public.is_host(g.event_id)))
  with check (exists (select 1 from public.guests g where g.id = guest_id and public.is_host(g.event_id)));

-- Los invitados (anon) NO tocan las tablas: solo usan las funciones de abajo.
revoke all on public.super_admins, public.events, public.hosts, public.event_hosts,
              public.guests, public.items, public.selections from anon;
grant select on public.super_admins to authenticated;
grant select, insert, update, delete on public.events, public.hosts, public.event_hosts,
      public.guests, public.items, public.selections to authenticated;

-- Quién soy en el panel: si soy super admin y qué eventos puedo administrar.
create or replace function public.whoami()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'email', public.my_email(),
    'name', (select name from public.hosts where email = public.my_email()),
    'is_super', public.is_super_admin(),
    'events', coalesce((
      select json_agg(json_build_object('id', e.id, 'name', e.name) order by e.event_date nulls last, e.name)
        from public.events e where public.is_host(e.id)), '[]'::json)
  );
$$;

-- ---------- Funciones para el invitado (entra con su código) ----------

-- Devuelve el invitado, los datos del evento y la lista de chócoros con cupos.
-- No expone los nombres de los demás invitados.
create or replace function public.get_invitation(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  g public.guests;
  e public.events;
begin
  select * into g from public.guests where code = p_code;
  if not found then
    return null;
  end if;
  select * into e from public.events where id = g.event_id;
  return json_build_object(
    'name',    g.name,
    'status',  g.status,
    'item_id', (select item_id from public.selections where guest_id = g.id),
    'event',   json_build_object(
                 'hosts', e.hosts_display, 'date', e.event_date, 'time', to_char(e.event_time, 'HH24:MI'),
                 'place', e.place, 'maps_url', e.maps_url, 'deadline', e.deadline),
    'items',   coalesce((
      select json_agg(json_build_object(
               'id', i.id, 'name', i.name, 'category', i.category,
               'capacity', i.capacity,
               'taken', (select count(*) from public.selections s where s.item_id = i.id)
             ) order by i.category, i.name)
        from public.items i where i.event_id = g.event_id), '[]'::json)
  );
end $$;

-- Aparta (o cambia) el chócoro del invitado y confirma su asistencia.
create or replace function public.choose_item(p_code text, p_item_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare g public.guests;
begin
  select * into g from public.guests where code = p_code;
  if not found then
    raise exception 'invalid_code';
  end if;
  insert into public.selections (guest_id, item_id) values (g.id, p_item_id)
    on conflict (guest_id) do update set item_id = excluded.item_id, created_at = now();
  update public.guests set status = 'confirmado', responded_at = now() where id = g.id;
  return public.get_invitation(p_code);
end $$;

-- El invitado avisa que no podrá ir: libera su chócoro.
create or replace function public.decline_invitation(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.guests;
begin
  select * into g from public.guests where code = p_code;
  if not found then
    raise exception 'invalid_code';
  end if;
  delete from public.selections where guest_id = g.id;
  update public.guests set status = 'no_asiste', responded_at = now() where id = g.id;
  return public.get_invitation(p_code);
end $$;

-- El invitado cambia de opinión después de decir que no.
create or replace function public.reset_response(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.guests;
begin
  select * into g from public.guests where code = p_code;
  if not found then
    raise exception 'invalid_code';
  end if;
  update public.guests set status = 'pendiente', responded_at = null
   where id = g.id and status = 'no_asiste';
  return public.get_invitation(p_code);
end $$;

revoke all on function public.get_invitation(text)         from public;
revoke all on function public.choose_item(text, bigint)    from public;
revoke all on function public.decline_invitation(text)     from public;
revoke all on function public.reset_response(text)         from public;
revoke all on function public.whoami()                     from public;
grant execute on function public.get_invitation(text)      to anon, authenticated;
grant execute on function public.choose_item(text, bigint) to anon, authenticated;
grant execute on function public.decline_invitation(text)  to anon, authenticated;
grant execute on function public.reset_response(text)      to anon, authenticated;
grant execute on function public.whoami()                  to authenticated;

-- ---------- Tu correo de super admin ----------
-- Cambia el correo y ejecuta esta línea:
-- insert into public.super_admins (email) values ('tu-correo@ejemplo.com');
