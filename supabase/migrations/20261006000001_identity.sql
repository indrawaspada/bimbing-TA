-- BimbingTA Copilot — 0001 identity, config, audit
-- Security model: deny-by-default RLS, column-level grants, SECURITY DEFINER RPC for role/state.
-- Role NEVER comes from user_metadata/app_metadata/JWT custom claims; only public.memberships.

create schema if not exists app;
grant usage on schema app to authenticated, anon, service_role;

-- ---------- generic helpers ----------
create or replace function app.touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.row_version := old.row_version + 1;
  end if;
  return new;
end $$;

-- true when the statement runs as an end-user API role (not inside a SECURITY DEFINER RPC / service role)
create or replace function app.is_client() returns boolean
language sql stable as $$ select current_user::text in ('authenticated', 'anon') $$;

-- ---------- workspace configuration (singleton) ----------
create table public.app_config (
  id boolean primary key default true check (id),
  allowed_providers text[] not null default '{google}',
  global_storage_limit_bytes bigint not null default 838860800,   -- 800 MB = 80% of Supabase Free 1 GB
  default_project_quota_bytes bigint not null default 36700160,   -- 35 MB
  max_file_bytes bigint not null default 26214400,                -- 25 MB
  suggested_file_bytes bigint not null default 5242880,           -- 5 MB
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
insert into public.app_config default values on conflict do nothing;
create trigger app_config_touch before update on public.app_config for each row execute function app.touch();

-- ---------- memberships ----------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  verified_email text not null,
  display_name text,
  role text not null check (role in ('owner', 'student')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create unique index memberships_single_owner on public.memberships ((role)) where role = 'owner';
create trigger memberships_touch before insert or update on public.memberships for each row execute function app.touch();

create or replace function app.is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m
                 where m.auth_user_id = auth.uid() and m.role = 'owner' and m.active)
$$;

create or replace function app.is_active_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.auth_user_id = auth.uid() and m.active)
$$;

-- ---------- invitations (email allowlist) ----------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null unique
    check (normalized_email = lower(btrim(normalized_email)) and normalized_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'student' check (role in ('owner', 'student')),
  display_name text check (char_length(display_name) <= 200),
  note text check (char_length(note) <= 1000),
  active boolean not null default true,
  claimed_uid uuid unique references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);

create or replace function app.invitations_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.normalized_email := lower(btrim(new.normalized_email));
    if app.is_client() then
      new.role := 'student';          -- owner invitation only via bootstrap_owner()
      new.claimed_uid := null; new.claimed_at := null;
      new.created_by := auth.uid();
    end if;
  elsif app.is_client() and new.normalized_email is distinct from old.normalized_email and old.claimed_uid is not null then
    raise exception 'invitation_claimed_email_immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invitations_guard before insert or update on public.invitations for each row execute function app.invitations_guard();
create trigger invitations_touch before insert or update on public.invitations for each row execute function app.touch();

-- ---------- audit ----------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_uid uuid,
  project_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  entity_version integer,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_project_idx on public.audit_events (project_id, created_at desc);

create or replace function app.audit(p_project uuid, p_action text, p_entity_type text, p_entity uuid, p_version integer, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_events (actor_uid, project_id, action, entity_type, entity_id, entity_version, detail)
  values (auth.uid(), p_project, p_action, p_entity_type, p_entity, p_version, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function app.audit(uuid, text, text, uuid, integer, jsonb) from public, anon, authenticated;

-- ---------- RLS + grants ----------
alter table public.app_config enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.app_config, public.memberships, public.invitations, public.audit_events from anon, authenticated;

grant select on public.app_config to authenticated;
create policy app_config_read on public.app_config for select to authenticated using (app.is_active_member());

grant select on public.memberships to authenticated;
create policy memberships_read on public.memberships for select to authenticated
  using (auth_user_id = auth.uid() or app.is_owner());

grant select, delete on public.invitations to authenticated;
grant insert (normalized_email, display_name, note, active) on public.invitations to authenticated;
grant update (normalized_email, display_name, note, active) on public.invitations to authenticated;
create policy invitations_owner_read on public.invitations for select to authenticated using (app.is_owner());
create policy invitations_owner_insert on public.invitations for insert to authenticated with check (app.is_owner());
create policy invitations_owner_update on public.invitations for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy invitations_owner_delete on public.invitations for delete to authenticated using (app.is_owner() and claimed_uid is null);

grant select on public.audit_events to authenticated;
create policy audit_owner_read on public.audit_events for select to authenticated using (app.is_owner());
