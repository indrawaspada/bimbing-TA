-- BimbingTA Copilot — 0004 comments/discussion, findings (revision tracker), meetings, resources, notifications

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid references public.versions(id) on delete restrict,
  run_id uuid,
  rule_id text check (rule_id ~ '^B[1-5]-R[0-9]{2}$'),
  chapter text check (chapter in ('B1', 'B2', 'B3', 'B4', 'B5', 'UMUM')),
  title text not null check (char_length(btrim(title)) between 2 and 300),
  severity text not null default 'Major' check (severity in ('Critical', 'Major', 'Minor', 'Review')),
  confidence text check (confidence in ('high', 'medium', 'low')),
  rule_status text check (rule_status in ('Pass', 'Partial', 'Fail', 'Not assessed', 'N/A')),
  evidence_type text check (evidence_type in ('quote', 'gap', 'paraphrase', 'manual')),
  locator jsonb not null default '{}'::jsonb,
  quote text check (char_length(quote) <= 4000),
  quote_validation text not null default 'not_applicable'
    check (quote_validation in ('verified', 'unverified', 'gap_scope', 'not_applicable')),
  reason text not null default '' check (char_length(reason) <= 8000),
  impact text not null default '' check (char_length(impact) <= 4000),
  recommendation text not null default '' check (char_length(recommendation) <= 8000),
  acceptance_criterion text not null default '' check (char_length(acceptance_criterion) <= 4000),
  source text not null default 'manual' check (source in ('manual', 'ai')),
  approval_state text not null default 'draft' check (approval_state in ('draft', 'accepted', 'rejected')),
  reject_reason text check (char_length(reject_reason) <= 4000),
  original_ai jsonb,
  workflow_status text check (workflow_status in ('open', 'in_progress', 'submitted', 'verified_closed', 'reopened')),
  revision_proof jsonb,
  due_at timestamptz,
  created_by uuid,
  approved_by uuid, approved_at timestamptz,
  closed_by uuid, closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  check ((approval_state = 'accepted') = (workflow_status is not null))
);
create index findings_project_idx on public.findings (project_id, workflow_status);

create or replace function app.findings_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then
      if not app.is_project_owner(new.project_id) then raise exception 'owner_only' using errcode = '42501'; end if;
      -- owner manual finding: accepted immediately as Open revision
      new.created_by := auth.uid(); new.source := 'manual'; new.run_id := null; new.original_ai := null;
      new.approval_state := 'accepted'; new.workflow_status := 'open';
      new.approved_by := auth.uid(); new.approved_at := now();
      new.closed_by := null; new.closed_at := null; new.revision_proof := null;
      new.quote_validation := case when new.quote is null then 'not_applicable' else 'unverified' end;
    end if;
    if new.version_id is not null and app.version_project(new.version_id) is distinct from new.project_id then
      raise exception 'version_not_in_project' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.version_id is distinct from old.version_id
     or new.run_id is distinct from old.run_id or new.created_by is distinct from old.created_by
     or new.original_ai is distinct from old.original_ai or new.source is distinct from old.source then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  if app.is_client() then
    -- direct UPDATE: owner content edits only; workflow/approval only through RPCs
    if not app.is_project_owner(old.project_id) then raise exception 'owner_only' using errcode = '42501'; end if;
    if new.approval_state is distinct from old.approval_state or new.workflow_status is distinct from old.workflow_status
       or new.revision_proof is distinct from old.revision_proof or new.closed_by is distinct from old.closed_by
       or new.closed_at is distinct from old.closed_at or new.approved_by is distinct from old.approved_by
       or new.quote_validation is distinct from old.quote_validation then
      raise exception 'use_transition_rpc' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger findings_guard before insert or update on public.findings for each row execute function app.findings_guard();
create trigger findings_touch before insert or update on public.findings for each row execute function app.touch();

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid references public.versions(id) on delete cascade,
  pdf_page integer check (pdf_page >= 1),
  finding_id uuid references public.findings(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  author_uid uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index comments_project_idx on public.comments (project_id, created_at);

create or replace function app.comments_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.author_uid := auth.uid(); new.edited_at := null; end if;
    if new.parent_id is not null and (select project_id from public.comments where id = new.parent_id) is distinct from new.project_id then
      raise exception 'parent_not_in_project' using errcode = '22023';
    end if;
    if new.version_id is not null and app.version_project(new.version_id) is distinct from new.project_id then
      raise exception 'version_not_in_project' using errcode = '22023';
    end if;
    if new.finding_id is not null and (select project_id from public.findings where id = new.finding_id) is distinct from new.project_id then
      raise exception 'finding_not_in_project' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.parent_id is distinct from old.parent_id
     or new.author_uid is distinct from old.author_uid or new.version_id is distinct from old.version_id
     or new.finding_id is distinct from old.finding_id or new.pdf_page is distinct from old.pdf_page then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  if new.body is distinct from old.body then new.edited_at := now(); end if;
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments for each row execute function app.comments_guard();
create trigger comments_touch before insert or update on public.comments for each row execute function app.touch();

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  meeting_at timestamptz not null,
  duration_min integer not null default 60 check (duration_min between 5 and 600),
  title text not null default 'Bimbingan' check (char_length(title) <= 200),
  agenda text not null default '' check (char_length(agenda) <= 8000),
  decisions text not null default '' check (char_length(decisions) <= 8000),
  next_targets text not null default '' check (char_length(next_targets) <= 8000),
  next_due_at timestamptz,
  meeting_url text check (meeting_url ~ '^https://[^\s]+$' and char_length(meeting_url) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create or replace function app.owner_rows_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.created_by := auth.uid(); end if;
  elsif new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger meetings_guard before insert or update on public.meetings for each row execute function app.owner_rows_guard();
create trigger meetings_touch before insert or update on public.meetings for each row execute function app.touch();

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('paper', 'repo', 'demo', 'video', 'lainnya')),
  title text not null check (char_length(btrim(title)) between 2 and 300),
  https_url text check (https_url ~ '^https://[^\s]+$' and char_length(https_url) <= 2000),
  note text not null default '' check (char_length(note) <= 4000),
  optional_file_path text unique,
  file_size bigint check (file_size > 0 and file_size <= 26214400),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  check (https_url is not null or optional_file_path is not null)
);
create or replace function app.resources_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.created_by := auth.uid(); end if;
    if new.optional_file_path is not null then
      new.optional_file_path := new.project_id::text || '/res/' || new.id::text || '.pdf';
    end if;
  elsif new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by
     or new.optional_file_path is distinct from old.optional_file_path then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger resources_guard before insert or update on public.resources for each row execute function app.resources_guard();
create trigger resources_touch before insert or update on public.resources for each row execute function app.touch();

create or replace function app.can_upload_resource_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.resources r
                 where r.optional_file_path = p_name and r.created_by = auth.uid()
                   and app.can_access_project(r.project_id))
$$;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  type text not null,
  entity_id uuid,
  title text not null default '',
  event_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ---------- RLS + grants ----------
alter table public.findings enable row level security;
alter table public.comments enable row level security;
alter table public.meetings enable row level security;
alter table public.resources enable row level security;
alter table public.notifications enable row level security;
revoke all on public.findings, public.comments, public.meetings, public.resources, public.notifications from anon, authenticated;

-- findings: owner sees all of own projects; student sees accepted ones + own self-review drafts
grant select on public.findings to authenticated;
grant insert (project_id, version_id, rule_id, chapter, title, severity, confidence, rule_status, evidence_type, locator, quote,
              reason, impact, recommendation, acceptance_criterion, due_at) on public.findings to authenticated;
grant update (title, severity, confidence, rule_status, evidence_type, locator, quote, reason, impact, recommendation,
              acceptance_criterion, due_at, chapter, rule_id) on public.findings to authenticated;
create policy findings_read on public.findings for select to authenticated using (
  app.is_project_owner(project_id)
  or (app.is_project_student(project_id) and (approval_state = 'accepted' or created_by = auth.uid())));
create policy findings_insert on public.findings for insert to authenticated with check (app.is_project_owner(project_id));
create policy findings_update on public.findings for update to authenticated
  using (app.is_project_owner(project_id)) with check (app.is_project_owner(project_id));

grant select on public.comments to authenticated;
grant insert (project_id, version_id, pdf_page, finding_id, parent_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;
create policy comments_read on public.comments for select to authenticated using (app.can_access_project(project_id));
create policy comments_insert on public.comments for insert to authenticated with check (app.can_access_project(project_id));
create policy comments_update on public.comments for update to authenticated
  using (author_uid = auth.uid() and app.can_access_project(project_id))
  with check (author_uid = auth.uid() and app.can_access_project(project_id));
create policy comments_delete on public.comments for delete to authenticated using (app.is_project_owner(project_id));

grant select, delete on public.meetings to authenticated;
grant insert (project_id, meeting_at, duration_min, title, agenda, decisions, next_targets, next_due_at, meeting_url) on public.meetings to authenticated;
grant update (meeting_at, duration_min, title, agenda, decisions, next_targets, next_due_at, meeting_url) on public.meetings to authenticated;
create policy meetings_read on public.meetings for select to authenticated using (app.can_access_project(project_id));
create policy meetings_owner_write on public.meetings for insert to authenticated with check (app.is_project_owner(project_id));
create policy meetings_owner_update on public.meetings for update to authenticated
  using (app.is_project_owner(project_id)) with check (app.is_project_owner(project_id));
create policy meetings_owner_delete on public.meetings for delete to authenticated using (app.is_project_owner(project_id));

grant select, delete on public.resources to authenticated;
grant insert (project_id, kind, title, https_url, note, optional_file_path, file_size) on public.resources to authenticated;
grant update (kind, title, https_url, note) on public.resources to authenticated;
create policy resources_read on public.resources for select to authenticated using (app.can_access_project(project_id));
create policy resources_insert on public.resources for insert to authenticated with check (app.can_access_project(project_id));
create policy resources_update on public.resources for update to authenticated
  using (app.can_access_project(project_id) and (created_by = auth.uid() or app.is_project_owner(project_id)))
  with check (app.can_access_project(project_id));
create policy resources_delete on public.resources for delete to authenticated
  using (app.can_access_project(project_id) and (created_by = auth.uid() or app.is_project_owner(project_id)));

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
