-- Checkpoint C: RPC write paths, immutable evidence, collaboration and export gate.
-- Historical migrations are unchanged. No reset or destructive schema operation.
create table public.workspace_drafts (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 scope text not null check (char_length(scope) between 1 and 180), payload jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
 unique(user_id, project_id, scope), check (octet_length(payload::text) <= 1000000)
);
alter table public.workspace_drafts enable row level security;
revoke all on public.workspace_drafts from anon, authenticated;
grant select, delete on public.workspace_drafts to authenticated;
grant insert(project_id,scope,payload), update(payload) on public.workspace_drafts to authenticated;
create policy drafts_own on public.workspace_drafts for all to authenticated
 using(user_id=auth.uid() and app.can_access_project(project_id))
 with check(user_id=auth.uid() and app.can_access_project(project_id));
create trigger drafts_touch before insert or update on public.workspace_drafts for each row execute function app.touch();

create table public.export_receipts (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null default auth.uid(), version_hashes jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.export_receipts enable row level security;
revoke all on public.export_receipts from anon, authenticated;
grant select on public.export_receipts to authenticated;
create policy receipts_owner on public.export_receipts for select to authenticated using(app.is_project_owner(project_id));

-- A deletion intent serializes approval against new comments/finding evidence.
create table public.version_deletion_requests (
 version_id uuid primary key references public.versions(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 requested_by uuid not null, created_at timestamptz not null default now()
);
alter table public.version_deletion_requests enable row level security;
revoke all on public.version_deletion_requests from anon,authenticated;
grant select on public.version_deletion_requests to authenticated;
create policy deletion_requests_owner on public.version_deletion_requests for select to authenticated using(app.is_project_owner(project_id));
create function app.reject_pending_deletion_reference() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.version_id is not null then
  perform 1 from public.versions where id=new.version_id for update;
  if exists(select 1 from public.version_deletion_requests where version_id=new.version_id) then raise exception 'version_deletion_pending' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function app.reject_pending_deletion_reference() from public,anon,authenticated;
create trigger comments_no_deleted_reference before insert on public.comments for each row execute function app.reject_pending_deletion_reference();
create trigger findings_no_deleted_reference before insert on public.findings for each row execute function app.reject_pending_deletion_reference();
create function app.valid_https(v text) returns boolean language sql immutable as $$
 select v is null or (v ~ '^https://[^/@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$' and char_length(v)<=2000)
$$;
alter table public.resources add constraint resources_safe_url check(app.valid_https(https_url));
alter table public.meetings add constraint meetings_safe_url check(app.valid_https(meeting_url));

-- Keep reservations until an upload has demonstrably failed. No expiry-based quota bypass.
create or replace function app.project_storage_bytes(pid uuid) returns bigint
 language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select sum(file_size) from public.versions where project_id=pid and status<>'upload_failed'),0)
 + coalesce((select sum(file_size) from public.resources where project_id=pid and optional_file_path is not null),0)
$$;
create or replace function app.global_storage_bytes() returns bigint
 language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select sum(file_size) from public.versions where status<>'upload_failed'),0)
 + coalesce((select sum(file_size) from public.resources where optional_file_path is not null),0)
$$;
create or replace function app.versions_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare cfg record; lim bigint;
begin
 if tg_op='INSERT' then
  -- All allocations acquire the same global lock, then the project lock.
  perform pg_advisory_xact_lock(190746101);
  select * into cfg from public.app_config where id;
  select storage_limit_bytes into lim from public.projects where id=new.project_id for update;
  new.sequence:=coalesce((select max(sequence) from public.versions where project_id=new.project_id),0)+1;
  new.file_path:=new.project_id::text||'/'||new.id::text||'.pdf';
  if app.is_client() then
   new.submitted_by:=auth.uid(); new.status:='uploading'; new.file_hash:=null; new.extraction_hash:=null;
   new.page_count:=null; new.confirmed_at:=null; new.confirmed_by:=null; new.visuals_status:='not_assessed';
  end if;
  if new.file_size>cfg.max_file_bytes then raise exception 'file_too_large' using errcode='22023'; end if;
  if app.project_storage_bytes(new.project_id)+new.file_size>lim then raise exception 'project_quota_exceeded' using errcode='22023'; end if;
  if app.global_storage_bytes()+new.file_size>cfg.global_storage_limit_bytes then raise exception 'global_storage_guard' using errcode='22023'; end if;
 elsif tg_op='UPDATE' then
  if old.status='confirmed' then raise exception 'version_sealed' using errcode='42501'; end if;
  if (new.project_id,new.sequence,new.file_path,new.submitted_by,new.file_size,new.file_name,new.mime_type)
    is distinct from (old.project_id,old.sequence,old.file_path,old.submitted_by,old.file_size,old.file_name,old.mime_type)
  then raise exception 'immutable_field' using errcode='42501'; end if;
 end if;
 return new;
end $$;

-- Supporting resources in this checkpoint are HTTPS links. Attachment uploads are deferred;
-- revoke the old unused write path so it cannot bypass allocation limits.
revoke insert(optional_file_path,file_size) on public.resources from authenticated;
create or replace function app.can_upload_resource_object(p_name text) returns boolean language sql stable as $$ select false $$;
create or replace function app.can_read_object(p_name text) returns boolean
 language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.versions v where v.file_path=p_name and app.can_access_project(v.project_id))
 or exists(select 1 from public.resources r where r.optional_file_path=p_name and app.can_access_project(r.project_id))
$$;
create or replace function app.valid_upload_metadata(p_name text, p_metadata jsonb) returns boolean
 language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.versions v where v.file_path=p_name
  and (p_metadata->>'size' is null or p_metadata->>'size'=v.file_size::text)
  and (p_metadata->>'contentLength' is null or p_metadata->>'contentLength'=v.file_size::text)
  and coalesce(p_metadata->>'mimetype','application/pdf')='application/pdf')
$$;
drop policy bt_files_insert on storage.objects;
create policy bt_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='thesis-files' and app.can_upload_object(name) and app.valid_upload_metadata(name,metadata));

-- Storage performs an RLS preflight with contentLength before the final object has size.
-- Its backend commits as a privileged role: validate final metadata in a trigger too.
create function app.storage_version_size_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 if new.bucket_id<>'thesis-files' then return new; end if;
 select * into v from public.versions where file_path=new.name for update;
 if not found then raise exception 'unregistered_file_path' using errcode='42501'; end if;
 if v.status<>'uploading' then raise exception 'version_not_uploading' using errcode='42501'; end if;
 if new.metadata->>'size' is not null and not app.valid_upload_metadata(new.name,new.metadata) then
  raise exception 'uploaded_size_mismatch' using errcode='22023';
 end if;
 -- Metadata without size is allowed only for Storage's rolled-back permission check.
 -- Actual final commits include size; RPC finalization refuses a missing size.
 return new;
end $$;
revoke all on function app.storage_version_size_guard() from public,anon,authenticated;
create trigger bt_storage_size before insert or update on storage.objects for each row execute function app.storage_version_size_guard();

create or replace function app.version_child_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare state text; n integer; vid uuid:=coalesce(new.version_id,old.version_id);
begin
 select status,page_count into state,n from public.versions where id=vid;
 if not found then return coalesce(new,old); end if;
 if state='confirmed' then raise exception 'version_sealed' using errcode='42501'; end if;
 if tg_op='UPDATE' then if new.version_id is distinct from old.version_id then raise exception 'immutable_field' using errcode='42501'; end if; end if;
 if tg_op<>'DELETE' then
  if tg_table_name='chapter_ranges' then
   if n is not null and new.end_page>n then raise exception 'range_outside_pdf' using errcode='22023'; end if;
  elsif tg_table_name='pages' then
   new.text_hash:=encode(sha256(convert_to(new.text,'UTF8')),'hex');new.char_count:=char_length(new.text);
   if n is not null and new.pdf_page>n then raise exception 'page_outside_pdf' using errcode='22023'; end if;
  end if;
 end if;
 return coalesce(new,old);
end $$;

create function app.editable_version(vid uuid, expected integer) returns public.versions
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 select * into v from public.versions where id=vid for update;
 if not found or not app.can_access_project(v.project_id) then raise exception 'not_found' using errcode='42501'; end if;
 if v.submitted_by is distinct from auth.uid() and not app.is_project_owner(v.project_id) then raise exception 'owner_only' using errcode='42501'; end if;
 if v.status='confirmed' then raise exception 'version_sealed' using errcode='42501'; end if;
 if v.row_version<>expected then raise exception 'edit_conflict' using errcode='40001'; end if;
 return v;
end $$;
revoke all on function app.editable_version(uuid,integer) from public,anon,authenticated;

create function public.version_upload_result(p_version uuid,p_expected integer,p_hash text default null,p_error text default null)
 returns public.versions language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions; sz bigint;
begin
 v:=app.editable_version(p_version,p_expected);
 if v.status not in ('uploading','upload_failed') then raise exception 'invalid_transition' using errcode='22023'; end if;
 select (metadata->>'size')::bigint into sz from storage.objects where bucket_id='thesis-files' and name=v.file_path;
 if found then
  if sz is distinct from v.file_size then raise exception 'uploaded_size_mismatch' using errcode='22023'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'file_hash_required' using errcode='22023'; end if;
  update public.versions set status='uploaded',file_hash=p_hash,error_message=null where id=v.id returning * into v;
 else
  if p_error is null then raise exception 'upload_not_found' using errcode='22023'; end if;
  update public.versions set status='upload_failed',error_message=left(p_error,1000) where id=v.id returning * into v;
 end if;
 return v;
end $$;
create function public.version_retry_upload(p_version uuid,p_expected integer) returns public.versions
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions; cfg record; lim bigint;
begin
 perform pg_advisory_xact_lock(190746101);
  select * into cfg from public.app_config where id;
 v:=app.editable_version(p_version,p_expected);
 if v.status<>'upload_failed' then raise exception 'invalid_transition' using errcode='22023'; end if;
 select storage_limit_bytes into lim from public.projects where id=v.project_id for update;
 if app.project_storage_bytes(v.project_id)+v.file_size>lim then raise exception 'project_quota_exceeded' using errcode='22023'; end if;
 if app.global_storage_bytes()+v.file_size>cfg.global_storage_limit_bytes then raise exception 'global_storage_guard' using errcode='22023'; end if;
 update public.versions set status='uploading',error_message=null where id=v.id returning * into v; return v;
end $$;
create function public.version_extraction_failed(p_version uuid,p_expected integer,p_error text) returns public.versions
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 v:=app.editable_version(p_version,p_expected);
 if v.status not in ('uploaded','extracting','extracted','extraction_failed') then raise exception 'invalid_transition' using errcode='22023'; end if;
 update public.versions set status='extraction_failed',error_message=left(p_error,1000) where id=v.id returning * into v; return v;
end $$;
create function public.version_save_pages(p_version uuid,p_expected integer,p_page_count integer,p_pages jsonb)
 returns public.versions language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions; p jsonb; n integer;
begin
 v:=app.editable_version(p_version,p_expected);
 if v.status not in ('uploaded','extracting','extracted','extraction_failed') then raise exception 'invalid_transition' using errcode='22023'; end if;
 if p_page_count not between 1 and 2000 or jsonb_typeof(p_pages)<>'array' or jsonb_array_length(p_pages) not between 1 and 25 then raise exception 'invalid_pages' using errcode='22023'; end if;
 if v.page_count is not null and v.page_count<>p_page_count then raise exception 'page_count_changed' using errcode='22023'; end if;
 update public.versions set page_count=p_page_count,status='extracting',error_message=null where id=v.id;
 for p in select value from jsonb_array_elements(p_pages) loop
  if (p->>'pdf_page')::integer not between 1 and p_page_count then raise exception 'page_outside_pdf' using errcode='22023'; end if;
  insert into public.pages(version_id,pdf_page,printed_label,text,text_hash,source)
   values(v.id,(p->>'pdf_page')::integer,nullif(p->>'printed_label',''),coalesce(p->>'text',''),'pending',coalesce(p->>'source','pdfjs'))
   on conflict(version_id,pdf_page) do update set printed_label=excluded.printed_label,text=excluded.text,source=excluded.source;
 end loop;
 select count(*) into n from public.pages where version_id=v.id;
 update public.versions set status=case when n=p_page_count then 'extracted' else 'extracting' end,
 extraction_method=case when not exists(select 1 from public.pages where version_id=v.id and source='pasted') then 'pdfjs'
 when not exists(select 1 from public.pages where version_id=v.id and source='pdfjs') then 'pasted' else 'mixed' end
 where id=v.id returning * into v; return v;
end $$;
create function public.version_save_ranges(p_version uuid,p_expected integer,p_ranges jsonb)
 returns public.versions language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions; r jsonb;
begin
 v:=app.editable_version(p_version,p_expected);
 if v.status not in ('extracted','extraction_failed') or v.page_count is null then raise exception 'extraction_required' using errcode='22023'; end if;
 if jsonb_typeof(p_ranges)<>'array' or jsonb_array_length(p_ranges) not between 1 and 5 then raise exception 'invalid_ranges' using errcode='22023'; end if;
 delete from public.chapter_ranges where version_id=v.id;
 for r in select value from jsonb_array_elements(p_ranges) loop
  insert into public.chapter_ranges(version_id,chapter,start_page,end_page) values(v.id,r->>'chapter',(r->>'start_page')::integer,(r->>'end_page')::integer);
 end loop;
 if exists(select 1 from public.chapter_ranges a join public.chapter_ranges b on a.version_id=b.version_id and a.id<b.id
  and int4range(a.start_page,a.end_page,'[]') && int4range(b.start_page,b.end_page,'[]') where a.version_id=v.id)
 then raise exception 'chapter_ranges_overlap' using errcode='22023'; end if;
 update public.versions set error_message=null where id=v.id returning * into v; return v;
end $$;
create function public.version_confirm(p_version uuid,p_expected integer) returns public.versions
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions; digest text;
begin
 v:=app.editable_version(p_version,p_expected);
 if v.status<>'extracted' or v.file_hash is null or not exists(select 1 from storage.objects where bucket_id='thesis-files' and name=v.file_path)
  then raise exception 'extraction_required' using errcode='22023'; end if;
 -- Do not seal a different text than the caller's visible, persisted editor draft.
 if exists(select 1 from public.pages p join public.workspace_drafts d on d.scope='page:'||p.id::text
  where p.version_id=v.id and d.user_id=auth.uid() and d.project_id=v.project_id
  and (d.payload->>'text' is distinct from p.text or coalesce(d.payload->>'printed_label','')<>coalesce(p.printed_label,'')))
 then raise exception 'unapplied_drafts' using errcode='22023'; end if;
 if exists(select 1 from public.workspace_drafts d where d.scope='ranges:'||v.id::text and d.user_id=auth.uid() and d.project_id=v.project_id
  and coalesce((select jsonb_object_agg(e.key,jsonb_build_array(nullif(e.value->>'start','')::integer,nullif(e.value->>'end','')::integer))
   from jsonb_each(d.payload) e where coalesce(e.value->>'start','')<>'' or coalesce(e.value->>'end','')<>''),'{}')
   is distinct from coalesce((select jsonb_object_agg(r.chapter,jsonb_build_array(r.start_page,r.end_page)) from public.chapter_ranges r where r.version_id=v.id),'{}'))
 then raise exception 'unapplied_drafts' using errcode='22023'; end if;
 if (select count(*) from public.pages where version_id=v.id)<>v.page_count
  or not exists(select 1 from public.chapter_ranges where version_id=v.id)
  or exists(select 1 from public.chapter_ranges r where r.version_id=v.id and not exists
   (select 1 from public.pages p where p.version_id=v.id and p.pdf_page between r.start_page and r.end_page and length(btrim(p.text))>0))
 then raise exception 'text_confirmation_required' using errcode='22023'; end if;
 select encode(sha256(convert_to(jsonb_build_object('pages',(select jsonb_agg(jsonb_build_array(pdf_page,printed_label,text_hash,source) order by pdf_page) from public.pages where version_id=v.id),
 'ranges',(select jsonb_agg(jsonb_build_array(chapter,start_page,end_page) order by chapter) from public.chapter_ranges where version_id=v.id))::text,'UTF8')),'hex') into digest;
 update public.chapter_ranges set confirmed=true where version_id=v.id;
 update public.versions set status='confirmed',confirmed_at=now(),confirmed_by=auth.uid(),extraction_hash=digest,visuals_status='not_assessed' where id=v.id returning * into v;
 perform app.audit(v.project_id,'version_confirmed','versions',v.id,v.row_version,jsonb_build_object('file_hash',v.file_hash,'extraction_hash',digest));
 return v;
end $$;

alter table public.comments add column chapter text check(chapter in ('B1','B2','B3','B4','B5'));
grant insert(chapter) on public.comments to authenticated;
create or replace function app.comments_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare parent public.comments; f public.findings;
begin
 if tg_op='INSERT' then
  if app.is_client() then new.author_uid:=auth.uid(); new.edited_at:=null; end if;
  if new.version_id is not null and app.version_project(new.version_id) is distinct from new.project_id then raise exception 'version_not_in_project' using errcode='22023'; end if;
  if new.pdf_page is not null and (new.version_id is null or not exists(select 1 from public.versions where id=new.version_id and new.pdf_page<=page_count)) then raise exception 'page_outside_pdf' using errcode='22023'; end if;
  if new.chapter is not null and (new.version_id is null or not exists(select 1 from public.chapter_ranges where version_id=new.version_id and chapter=new.chapter)) then raise exception 'chapter_not_in_version' using errcode='22023'; end if;
  if new.finding_id is not null then
   select * into f from public.findings where id=new.finding_id;
   if not found or f.project_id<>new.project_id or not(app.is_project_owner(f.project_id) or f.approval_state='accepted' or f.created_by=auth.uid()) then raise exception 'finding_not_in_project' using errcode='22023'; end if;
  end if;
  if new.parent_id is not null then
   select * into parent from public.comments where id=new.parent_id;
   if not found or (parent.project_id,parent.version_id,parent.pdf_page,parent.chapter,parent.finding_id)
     is distinct from (new.project_id,new.version_id,new.pdf_page,new.chapter,new.finding_id)
   then raise exception 'parent_scope_mismatch' using errcode='22023'; end if;
  end if;
 elsif (new.project_id,new.version_id,new.pdf_page,new.chapter,new.finding_id,new.parent_id,new.author_uid)
  is distinct from (old.project_id,old.version_id,old.pdf_page,old.chapter,old.finding_id,old.parent_id,old.author_uid) then raise exception 'immutable_field' using errcode='42501';
 elsif new.body is distinct from old.body then new.edited_at:=now(); end if;
 return new;
end $$;

create function public.finding_transition(p_finding uuid,p_expected integer,p_status text,p_proof jsonb default null,p_reason text default null)
 returns public.findings language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.findings; v public.versions; base_seq integer; owner boolean; old_status text;
begin
 select * into f from public.findings where id=p_finding for update;
 if not found or not app.can_access_project(f.project_id) or f.approval_state<>'accepted' then raise exception 'not_found' using errcode='42501'; end if;
 if f.row_version<>p_expected then raise exception 'edit_conflict' using errcode='40001'; end if;
 owner:=app.is_project_owner(f.project_id); old_status:=f.workflow_status;
 if p_status in ('verified_closed','reopened') and not owner then raise exception 'owner_only' using errcode='42501'; end if;
 if not ((p_status='in_progress' and old_status in ('open','reopened'))
  or (p_status='submitted' and old_status in ('open','in_progress','reopened'))
  or (p_status='verified_closed' and old_status='submitted')
  or (p_status='reopened' and old_status in ('submitted','verified_closed'))) then raise exception 'invalid_transition' using errcode='22023'; end if;
 if p_status='submitted' then
  select * into v from public.versions where id=(p_proof->>'version_id')::uuid for update;
  if exists(select 1 from public.version_deletion_requests where version_id=v.id) then raise exception 'version_deletion_pending' using errcode='42501'; end if;
  select sequence into base_seq from public.versions where id=f.version_id;
  if not found and f.version_id is not null then raise exception 'proof_version_invalid' using errcode='22023'; end if;
  if v.id is null or v.project_id<>f.project_id or v.status<>'confirmed' or (base_seq is not null and v.sequence<=base_seq)
   or (base_seq is null and v.confirmed_at<=f.created_at)
   or coalesce(length(btrim(p_proof->>'description')),0) not between 1 and 4000
   or (p_proof->>'start_page')::integer not between 1 and v.page_count
   or (p_proof->>'end_page')::integer not between (p_proof->>'start_page')::integer and v.page_count
   or p_proof->>'start_page' is null or p_proof->>'end_page' is null
  then raise exception 'proof_version_invalid' using errcode='22023'; end if;
  f.revision_proof:=jsonb_build_object('version_id',v.id,'start_page',(p_proof->>'start_page')::integer,'end_page',(p_proof->>'end_page')::integer,
    'description',p_proof->>'description','file_hash',v.file_hash,'extraction_hash',v.extraction_hash,'submitted_by',auth.uid(),'submitted_at',now());
 elsif p_status='reopened' and coalesce(length(btrim(p_reason)),0) not between 1 and 4000 then raise exception 'reopen_reason_required' using errcode='22023'; end if;
 update public.findings set workflow_status=p_status,revision_proof=f.revision_proof,
 closed_by=case when p_status='verified_closed' then auth.uid() else null end,
 closed_at=case when p_status='verified_closed' then now() else null end where id=f.id returning * into f;
 perform app.audit(f.project_id,'revision_transition','findings',f.id,f.row_version,jsonb_build_object('from',old_status,'to',p_status,'reason',p_reason,'proof',f.revision_proof));
 return f;
end $$;

create function app.workspace_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.projects; recipient uuid; label text; kind text; entity uuid; rv integer;
begin
 select * into p from public.projects where id=new.project_id;
 kind:=tg_table_name; entity:=new.id; rv:=new.row_version;
 label:=case kind when 'comments' then 'Komentar baru' when 'findings' then 'Revisi diperbarui' when 'meetings' then 'Pertemuan diperbarui' when 'versions' then 'Naskah dikonfirmasi' else 'Tautan diperbarui' end;
 if kind='versions' then if new.status<>'confirmed' then return new; end if; end if;
 if kind='findings' then if new.approval_state<>'accepted' then return new; end if; end if;
 foreach recipient in array array[p.owner_uid,p.student_uid] loop
  if recipient is not null and recipient is distinct from auth.uid() then
   insert into public.notifications(user_id,project_id,type,entity_id,title,event_key)
   values(recipient,p.id,kind,entity,label,kind||':'||entity||':'||rv||':'||recipient) on conflict(event_key) do nothing;
  end if;
 end loop;
 if kind in ('findings','meetings') then perform app.audit(p.id,lower(tg_op),'workspace_'||kind,entity,rv,'{}'); end if;
 return new;
end $$;
revoke all on function app.workspace_event() from public,anon,authenticated;
create trigger comments_event after insert or update on public.comments for each row execute function app.workspace_event();
create trigger findings_event after insert or update on public.findings for each row execute function app.workspace_event();
create trigger meetings_event after insert or update on public.meetings for each row execute function app.workspace_event();
create trigger versions_event after update on public.versions for each row execute function app.workspace_event();
create trigger resources_event after insert or update on public.resources for each row execute function app.workspace_event();

-- A receipt records that the client assembled and verified original files, not that the
-- operating system saved them. The owner must also explicitly confirm a saved backup in UI.
create function public.record_file_export(p_project uuid,p_hashes jsonb) returns uuid
 language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; v public.versions;
begin
 if not app.is_project_owner(p_project) then raise exception 'owner_only' using errcode='42501'; end if;
 if jsonb_typeof(p_hashes)<>'object' or octet_length(p_hashes::text)>200000 then raise exception 'invalid_manifest' using errcode='22023'; end if;
 for v in select * from public.versions where project_id=p_project and status='confirmed' loop
  if p_hashes->>v.id::text is distinct from v.file_hash then raise exception 'export_missing_file' using errcode='22023'; end if;
 end loop;
 insert into public.export_receipts(project_id,user_id,version_hashes) values(p_project,auth.uid(),p_hashes) returning id into result;
 return result;
end $$;
create function app.may_delete_version(vid uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.versions v where v.id=vid and app.is_project_owner(v.project_id)
 and v.status='confirmed' and v.sequence<(select max(sequence) from public.versions where project_id=v.project_id and status='confirmed')
 and exists(select 1 from public.export_receipts r where r.project_id=v.project_id and r.user_id=auth.uid() and r.version_hashes->>v.id::text=v.file_hash)
 and not exists(select 1 from public.findings f where f.version_id=v.id or f.revision_proof->>'version_id'=v.id::text)
 and not exists(select 1 from public.comments c where c.version_id=v.id))
$$;
create function public.begin_version_deletion(p_version uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 select * into v from public.versions where id=p_version for update;
 if not app.may_delete_version(p_version) then raise exception 'version_delete_blocked' using errcode='42501'; end if;
 insert into public.version_deletion_requests(version_id,project_id,requested_by) values(v.id,v.project_id,auth.uid()) on conflict(version_id) do nothing;
end $$;
create or replace function app.can_delete_object(p_name text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.versions where file_path=p_name and app.may_delete_version(id) and exists(select 1 from public.version_deletion_requests r where r.version_id=versions.id and r.requested_by=auth.uid()))
$$;
revoke delete on public.versions from authenticated;
create function public.delete_exported_version(p_version uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 select * into v from public.versions where id=p_version for update;
 if not app.may_delete_version(p_version) or not exists(select 1 from public.version_deletion_requests where version_id=p_version and requested_by=auth.uid()) then raise exception 'version_delete_blocked' using errcode='42501'; end if;
 if exists(select 1 from storage.objects where bucket_id='thesis-files' and name=v.file_path) then raise exception 'remove_file_first' using errcode='22023'; end if;
 perform app.audit(v.project_id,'delete_after_export','versions',v.id,v.row_version,jsonb_build_object('file_hash',v.file_hash));
 delete from public.versions where id=v.id;
end $$;

-- Notifications lose access together with project membership, even through REST.
drop policy notifications_read on public.notifications;
drop policy notifications_mark_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
 using(user_id=auth.uid() and app.is_active_member() and (project_id is null or app.can_access_project(project_id)));
create policy notifications_mark_read on public.notifications for update to authenticated
 using(user_id=auth.uid() and app.is_active_member() and (project_id is null or app.can_access_project(project_id)))
 with check(user_id=auth.uid() and app.is_active_member() and (project_id is null or app.can_access_project(project_id)));

-- Every public write function is explicitly authenticated; helpers are not API endpoints.
revoke all on function public.version_upload_result(uuid,integer,text,text),public.version_retry_upload(uuid,integer),
 public.version_extraction_failed(uuid,integer,text),public.version_save_pages(uuid,integer,integer,jsonb),public.version_save_ranges(uuid,integer,jsonb),
 public.version_confirm(uuid,integer),public.finding_transition(uuid,integer,text,jsonb,text),public.record_file_export(uuid,jsonb),public.delete_exported_version(uuid),public.begin_version_deletion(uuid)
 from public,anon;
grant execute on function public.version_upload_result(uuid,integer,text,text),public.version_retry_upload(uuid,integer),
 public.version_extraction_failed(uuid,integer,text),public.version_save_pages(uuid,integer,integer,jsonb),public.version_save_ranges(uuid,integer,jsonb),
 public.version_confirm(uuid,integer),public.finding_transition(uuid,integer,text,jsonb,text),public.record_file_export(uuid,jsonb),public.delete_exported_version(uuid),public.begin_version_deletion(uuid)
 to authenticated;
-- Abort if a new public table escaped RLS.
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)
 then raise exception 'public_table_without_rls'; end if;
end $$;
