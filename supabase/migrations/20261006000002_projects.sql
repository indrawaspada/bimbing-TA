-- BimbingTA Copilot — 0002 projects, milestones, owner-private notes, membership claim/bootstrap

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_uid uuid not null references auth.users(id),
  student_uid uuid references auth.users(id),
  invitation_id uuid unique references public.invitations(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 300),
  research_profile text not null default 'software_si'
    check (research_profile in ('ml', 'software_si', 'hci', 'iot', 'ir_rag', 'process_mining', 'lainnya')),
  stage text not null default 'proposal' check (stage in ('proposal', 'final')),
  status text not null default 'aktif' check (status in ('aktif', 'selesai', 'arsip')),
  summary text not null default '' check (char_length(summary) <= 5000),
  student_label text check (char_length(student_label) <= 200),
  storage_limit_bytes bigint not null default 36700160 check (storage_limit_bytes > 0 and storage_limit_bytes <= 262144000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index projects_student_idx on public.projects (student_uid);

-- ---------- access helpers (used by every RLS policy) ----------
create or replace function app.can_access_project(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.memberships m on m.auth_user_id = auth.uid() and m.active
    where p.id = pid
      and ((m.role = 'owner' and p.owner_uid = m.auth_user_id)
        or (m.role = 'student' and p.student_uid = m.auth_user_id)))
$$;

create or replace function app.is_project_owner(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.memberships m on m.auth_user_id = auth.uid() and m.active and m.role = 'owner'
    where p.id = pid and p.owner_uid = m.auth_user_id)
$$;

create or replace function app.is_project_student(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.memberships m on m.auth_user_id = auth.uid() and m.active and m.role = 'student'
    where p.id = pid and p.student_uid = m.auth_user_id)
$$;

create or replace function app.project_row_access(p_owner uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m
                 where m.auth_user_id = auth.uid() and m.active
                   and ((m.role = 'owner' and p_owner = m.auth_user_id) or (m.role = 'student' and p_student = m.auth_user_id)))
$$;

create or replace function app.projects_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then
      if not app.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
      new.owner_uid := auth.uid();
    end if;
    new.student_uid := (select i.claimed_uid from public.invitations i where i.id = new.invitation_id);
    return new;
  end if;
  -- UPDATE
  if new.owner_uid is distinct from old.owner_uid then
    raise exception 'owner_uid_immutable' using errcode = '42501';
  end if;
  if app.is_client() and not app.is_owner() then
    if new.research_profile is distinct from old.research_profile
       or new.stage is distinct from old.stage
       or new.status is distinct from old.status
       or new.storage_limit_bytes is distinct from old.storage_limit_bytes
       or new.invitation_id is distinct from old.invitation_id
       or new.student_label is distinct from old.student_label
       or new.student_uid is distinct from old.student_uid then
      raise exception 'owner_only_field' using errcode = '42501';
    end if;
  end if;
  if new.invitation_id is distinct from old.invitation_id then
    if old.student_uid is not null then
      raise exception 'assignment_transfer_not_supported' using errcode = '42501';
    end if;
    new.student_uid := (select i.claimed_uid from public.invitations i where i.id = new.invitation_id);
  elsif app.is_client() then
    new.student_uid := old.student_uid;
  end if;
  return new;
end $$;
create trigger projects_guard before insert or update on public.projects for each row execute function app.projects_guard();
create trigger projects_touch before insert or update on public.projects for each row execute function app.touch();

-- ---------- milestones ----------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  due_at timestamptz,
  sort_order integer not null default 0,
  status text not null default 'belum' check (status in ('belum', 'berjalan', 'diajukan', 'selesai')),
  progress_note text not null default '' check (char_length(progress_note) <= 4000),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index milestones_project_idx on public.milestones (project_id, sort_order);

create or replace function app.milestones_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.created_by := auth.uid(); end if;
  elsif new.project_id is distinct from old.project_id then
    raise exception 'project_id_immutable' using errcode = '42501';
  end if;
  if app.is_client() and not app.is_owner() then
    -- student: only progress note and status up to 'diajukan'; owner approves completion
    if tg_op = 'INSERT' then raise exception 'owner_only' using errcode = '42501'; end if;
    if new.name is distinct from old.name or new.description is distinct from old.description
       or new.due_at is distinct from old.due_at or new.sort_order is distinct from old.sort_order
       or new.completed_at is distinct from old.completed_at then
      raise exception 'owner_only_field' using errcode = '42501';
    end if;
    if new.status = 'selesai' or old.status = 'selesai' and new.status is distinct from old.status then
      raise exception 'owner_approves_completion' using errcode = '42501';
    end if;
  end if;
  if new.status = 'selesai' and (tg_op = 'INSERT' or old.status <> 'selesai') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'selesai' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger milestones_guard before insert or update on public.milestones for each row execute function app.milestones_guard();
create trigger milestones_touch before insert or update on public.milestones for each row execute function app.touch();

-- ---------- owner-private notes (separate table; never shared) ----------
create table public.private_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_uid uuid not null default auth.uid() references auth.users(id),
  body text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index private_notes_project_idx on public.private_notes (project_id);
create or replace function app.private_notes_guard() returns trigger
language plpgsql as $$
begin
  if app.is_client() then
    if tg_op = 'INSERT' then new.owner_uid := auth.uid();
    elsif new.owner_uid is distinct from old.owner_uid or new.project_id is distinct from old.project_id then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger private_notes_guard before insert or update on public.private_notes for each row execute function app.private_notes_guard();
create trigger private_notes_touch before insert or update on public.private_notes for each row execute function app.touch();

-- ---------- RLS + grants ----------
alter table public.projects enable row level security;
alter table public.milestones enable row level security;
alter table public.private_notes enable row level security;
revoke all on public.projects, public.milestones, public.private_notes from anon, authenticated;

grant select, delete on public.projects to authenticated;
grant insert (invitation_id, title, research_profile, stage, summary, student_label, storage_limit_bytes) on public.projects to authenticated;
grant update (invitation_id, title, research_profile, stage, status, summary, student_label, storage_limit_bytes) on public.projects to authenticated;
create policy projects_read on public.projects for select to authenticated using (app.project_row_access(owner_uid, student_uid));
create policy projects_insert on public.projects for insert to authenticated with check (app.is_owner());
create policy projects_update on public.projects for update to authenticated
  using (app.project_row_access(owner_uid, student_uid)) with check (app.project_row_access(owner_uid, student_uid));
create policy projects_delete on public.projects for delete to authenticated using (app.is_owner() and owner_uid = auth.uid());

grant select, delete on public.milestones to authenticated;
grant insert (project_id, name, description, due_at, sort_order, status, progress_note) on public.milestones to authenticated;
grant update (name, description, due_at, sort_order, status, progress_note, completed_at) on public.milestones to authenticated;
create policy milestones_read on public.milestones for select to authenticated using (app.can_access_project(project_id));
create policy milestones_insert on public.milestones for insert to authenticated with check (app.is_project_owner(project_id));
create policy milestones_update on public.milestones for update to authenticated
  using (app.can_access_project(project_id)) with check (app.can_access_project(project_id));
create policy milestones_delete on public.milestones for delete to authenticated using (app.is_project_owner(project_id));

grant select, delete on public.private_notes to authenticated;
grant insert (project_id, body) on public.private_notes to authenticated;
grant update (body) on public.private_notes to authenticated;
create policy private_notes_owner_all on public.private_notes for all to authenticated
  using (app.is_project_owner(project_id) and owner_uid = auth.uid())
  with check (app.is_project_owner(project_id) and owner_uid = auth.uid());

-- ---------- RPC: claim membership from VERIFIED auth identity ----------
create or replace function public.claim_membership() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_user record; v_inv record; v_m record; v_cfg record; v_provider_ok boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_m from public.memberships where auth_user_id = v_uid;
  if found then
    return jsonb_build_object('status', case when v_m.active then 'active' else 'inactive' end,
      'role', case when v_m.active then v_m.role end, 'email', v_m.verified_email, 'display_name', v_m.display_name);
  end if;

  -- identity is read from auth.users (server-side), never from client-provided fields or user_metadata
  select u.id, u.email, u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data
    into v_user from auth.users u where u.id = v_uid;
  if not found or v_user.email is null or v_user.email_confirmed_at is null then
    return jsonb_build_object('status', 'pending', 'reason', 'email_unverified');
  end if;

  select * into v_cfg from public.app_config where id;
  v_provider_ok := coalesce(v_user.raw_app_meta_data ->> 'provider', '') = any (v_cfg.allowed_providers)
    or exists (select 1 from jsonb_array_elements_text(
                 case when jsonb_typeof(v_user.raw_app_meta_data -> 'providers') = 'array'
                      then v_user.raw_app_meta_data -> 'providers' else '[]'::jsonb end) p
               where p = any (v_cfg.allowed_providers));
  if not v_provider_ok then
    return jsonb_build_object('status', 'pending', 'reason', 'provider_not_allowed', 'email', lower(v_user.email));
  end if;

  select * into v_inv from public.invitations
   where normalized_email = lower(btrim(v_user.email)) and active and claimed_uid is null
   for update;
  if not found then
    return jsonb_build_object('status', 'pending', 'reason', 'not_invited', 'email', lower(v_user.email));
  end if;
  if v_inv.role = 'owner' and exists (select 1 from public.memberships where role = 'owner') then
    return jsonb_build_object('status', 'pending', 'reason', 'owner_exists');
  end if;

  insert into public.memberships (auth_user_id, verified_email, display_name, role)
  values (v_uid, lower(v_user.email),
          coalesce(v_inv.display_name, v_user.raw_user_meta_data ->> 'full_name', v_user.raw_user_meta_data ->> 'name'),
          v_inv.role)
  returning * into v_m;
  update public.invitations set claimed_uid = v_uid, claimed_at = now() where id = v_inv.id;
  if v_inv.role = 'student' then
    update public.projects set student_uid = v_uid where invitation_id = v_inv.id and student_uid is null;
  end if;
  perform app.audit(null, 'membership.claimed', 'membership', v_m.id, 1, jsonb_build_object('role', v_m.role));
  return jsonb_build_object('status', 'active', 'role', v_m.role, 'email', v_m.verified_email, 'display_name', v_m.display_name);
end $$;
revoke all on function public.claim_membership() from public, anon;
grant execute on function public.claim_membership() to authenticated;

-- ---------- one-time owner bootstrap (run in SQL editor as postgres; NOT callable by API roles) ----------
create or replace function public.bootstrap_owner(p_email text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(p_email)); v_user record;
begin
  if exists (select 1 from public.memberships where role = 'owner') then
    raise exception 'owner_already_bootstrapped';
  end if;
  insert into public.invitations (normalized_email, role, active, display_name)
  values (v_email, 'owner', true, 'Pembimbing (owner)')
  on conflict (normalized_email) do update set role = 'owner', active = true
    where public.invitations.claimed_uid is null;
  select id, email_confirmed_at into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
  if found then
    insert into public.memberships (auth_user_id, verified_email, role) values (v_user.id, v_email, 'owner');
    update public.invitations set claimed_uid = v_user.id, claimed_at = now() where normalized_email = v_email;
    return 'owner_membership_created';
  end if;
  return 'owner_invitation_created_login_with_google_to_claim';
end $$;
revoke all on function public.bootstrap_owner(text) from public, anon, authenticated;

-- ---------- RPC: owner (de)activates a student membership ----------
create or replace function public.owner_set_member_active(p_member uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m record;
begin
  if not app.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = p_member for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_m.role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;
  update public.memberships set active = p_active where id = p_member;
  perform app.audit(null, case when p_active then 'membership.activated' else 'membership.deactivated' end, 'membership', p_member, v_m.row_version + 1, '{}');
end $$;
revoke all on function public.owner_set_member_active(uuid, boolean) from public, anon;
grant execute on function public.owner_set_member_active(uuid, boolean) to authenticated;
