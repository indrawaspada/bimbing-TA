-- BimbingTA Copilot — 0003 thesis versions, pages, chapter ranges, private storage
-- Write paths for versions/pages/ranges are RPCs (added in workspace checkpoint); B grants read + draft insert only.

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence integer not null,
  file_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255 and lower(file_name) like '%.pdf'),
  file_size bigint not null check (file_size > 0),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  file_hash text check (file_hash ~ '^[0-9a-f]{64}$'),
  extraction_hash text check (extraction_hash ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count between 1 and 2000),
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'upload_failed', 'extracting', 'extracted', 'extraction_failed', 'confirmed')),
  extraction_method text check (extraction_method in ('pdfjs', 'pasted', 'mixed')),
  visuals_status text not null default 'not_assessed' check (visuals_status in ('not_assessed', 'owner_checked')),
  change_summary text not null default '' check (char_length(change_summary) <= 4000),
  error_message text check (char_length(error_message) <= 1000),
  submitted_by uuid,
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  unique (project_id, sequence)
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.versions(id) on delete cascade,
  pdf_page integer not null check (pdf_page >= 1),            -- original 1-based PDF page index
  printed_label text check (char_length(printed_label) <= 40), -- e.g. 'iv', '23' (manual)
  text text not null default '' check (char_length(text) <= 200000),
  text_hash text not null,
  char_count integer not null default 0,
  source text not null default 'pdfjs' check (source in ('pdfjs', 'pasted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  unique (version_id, pdf_page)
);

create table public.chapter_ranges (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.versions(id) on delete cascade,
  chapter text not null check (chapter in ('B1', 'B2', 'B3', 'B4', 'B5')),
  start_page integer not null check (start_page >= 1),
  end_page integer not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  unique (version_id, chapter),
  check (end_page >= start_page)
);

-- storage bytes counted for quota: everything except failed uploads and abandoned (>2h) 'uploading' rows
create or replace function app.project_storage_bytes(pid uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(file_size), 0)::bigint from public.versions
  where project_id = pid and status <> 'upload_failed'
    and not (status = 'uploading' and created_at < now() - interval '2 hours')
$$;
create or replace function app.global_storage_bytes() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(file_size), 0)::bigint from public.versions
  where status <> 'upload_failed' and not (status = 'uploading' and created_at < now() - interval '2 hours')
$$;

create or replace function app.versions_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_cfg record; v_limit bigint;
begin
  if tg_op = 'INSERT' then
    perform 1 from public.projects where id = new.project_id for update;  -- serialize sequence + quota
    select * into v_cfg from public.app_config where id;
    select storage_limit_bytes into v_limit from public.projects where id = new.project_id;
    new.sequence := coalesce((select max(sequence) from public.versions where project_id = new.project_id), 0) + 1;
    new.file_path := new.project_id::text || '/' || new.id::text || '.pdf';
    if app.is_client() then
      new.submitted_by := auth.uid();
      new.status := 'uploading';
      new.file_hash := null; new.extraction_hash := null; new.page_count := null;
      new.confirmed_at := null; new.confirmed_by := null; new.visuals_status := 'not_assessed';
    end if;
    if new.file_size > v_cfg.max_file_bytes then
      raise exception 'file_too_large' using errcode = '22023', detail = 'max_file_bytes=' || v_cfg.max_file_bytes;
    end if;
    if app.project_storage_bytes(new.project_id) + new.file_size > v_limit then
      raise exception 'project_quota_exceeded' using errcode = '22023', detail = 'limit=' || v_limit;
    end if;
    if app.global_storage_bytes() + new.file_size > v_cfg.global_storage_limit_bytes then
      raise exception 'global_storage_guard' using errcode = '22023';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'confirmed' then raise exception 'version_sealed' using errcode = '42501'; end if;
    if new.project_id is distinct from old.project_id or new.sequence is distinct from old.sequence
       or new.file_path is distinct from old.file_path or new.submitted_by is distinct from old.submitted_by then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end $$;
create trigger versions_guard before insert or update on public.versions for each row execute function app.versions_guard();
create trigger versions_touch before insert or update on public.versions for each row execute function app.touch();

-- pages / ranges are frozen once the parent version is sealed
create or replace function app.version_child_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_status text; v_pages integer; v_vid uuid := coalesce(new.version_id, old.version_id);
begin
  select status, page_count into v_status, v_pages from public.versions where id = v_vid;
  if not found then return coalesce(new, old); end if;          -- cascade delete of parent
  if v_status = 'confirmed' then raise exception 'version_sealed' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and new.version_id is distinct from old.version_id then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  if tg_table_name = 'chapter_ranges' and tg_op <> 'DELETE' and v_pages is not null and new.end_page > v_pages then
    raise exception 'range_outside_pdf' using errcode = '22023';
  end if;
  if tg_table_name = 'pages' and tg_op <> 'DELETE' then
    new.text_hash := encode(sha256(convert_to(new.text, 'UTF8')), 'hex');
    new.char_count := char_length(new.text);
    if v_pages is not null and new.pdf_page > v_pages then
      raise exception 'page_outside_pdf' using errcode = '22023';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger pages_guard before insert or update or delete on public.pages for each row execute function app.version_child_guard();
create trigger pages_touch before insert or update on public.pages for each row execute function app.touch();
create trigger ranges_guard before insert or update or delete on public.chapter_ranges for each row execute function app.version_child_guard();
create trigger ranges_touch before insert or update on public.chapter_ranges for each row execute function app.touch();

create or replace function app.version_project(vid uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select project_id from public.versions where id = vid
$$;

alter table public.versions enable row level security;
alter table public.pages enable row level security;
alter table public.chapter_ranges enable row level security;
revoke all on public.versions, public.pages, public.chapter_ranges from anon, authenticated;

grant select on public.versions to authenticated;
grant insert (project_id, file_name, file_size, mime_type, change_summary) on public.versions to authenticated;
grant delete on public.versions to authenticated;
create policy versions_read on public.versions for select to authenticated using (app.can_access_project(project_id));
create policy versions_insert on public.versions for insert to authenticated with check (app.can_access_project(project_id));
-- legacy deletion: owner only, explicit (UI requires export confirmation)
create policy versions_delete on public.versions for delete to authenticated using (app.is_project_owner(project_id));

grant select on public.pages, public.chapter_ranges to authenticated;
create policy pages_read on public.pages for select to authenticated using (app.can_access_project(app.version_project(version_id)));
create policy ranges_read on public.chapter_ranges for select to authenticated using (app.can_access_project(app.version_project(version_id)));

-- ---------- private storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thesis-files', 'thesis-files', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

create or replace function app.object_project(p_name text) returns uuid
language sql immutable as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
              then split_part(p_name, '/', 1)::uuid end
$$;

create or replace function app.can_read_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.object_project(p_name) is not null and app.can_access_project(app.object_project(p_name))
$$;

-- upload allowed ONLY to the exact path of a version row the caller created and that is still 'uploading'
-- (resources attachments path '{project}/res/{resource}.pdf' is enabled in 0004)
create or replace function app.can_upload_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.versions v
             where v.file_path = p_name and v.status = 'uploading' and v.submitted_by = auth.uid()
               and app.can_access_project(v.project_id)) then
    return true;
  end if;
  return app.can_upload_resource_object(p_name);
end $$;

create or replace function app.can_upload_resource_object(p_name text) returns boolean
language sql stable as $$ select false $$;  -- replaced in 0004

create or replace function app.can_delete_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.object_project(p_name) is not null and app.is_project_owner(app.object_project(p_name))
$$;

drop policy if exists bt_files_read on storage.objects;
drop policy if exists bt_files_insert on storage.objects;
drop policy if exists bt_files_delete on storage.objects;
create policy bt_files_read on storage.objects for select to authenticated
  using (bucket_id = 'thesis-files' and app.can_read_object(name));
create policy bt_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'thesis-files' and app.can_upload_object(name));
create policy bt_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'thesis-files' and app.can_delete_object(name));
-- no UPDATE policy: objects can never be overwritten (upsert denied)
