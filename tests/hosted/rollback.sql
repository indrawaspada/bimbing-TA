-- Hosted SQL checks for checkpoint C. Run the WHOLE file in the Supabase SQL Editor.
-- Dedicated empty DEV project only. All fixtures/helpers are rolled back; no config changes.
-- Actual PostgreSQL RLS/grants/triggers/RPCs, but simulated identity claims and Storage rows.
-- This is NOT an Auth/JWT, PostgREST, PDF transfer or Storage HTTP acceptance test.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
do $$ begin
  if exists(select 1 from auth.users) or exists(select 1 from public.projects)
     or exists(select 1 from public.memberships) then
    raise exception 'rollback_checks_require_empty_dev_project';
  end if;
  if not exists(select 1 from public.app_config where id and allowed_providers=array['google']) then
    raise exception 'google_only_config_required';
  end if;
end $$;
create temporary table bt_ids(k text primary key, id uuid not null);
create temporary table bt_checks(n integer generated always as identity, check_name text, passed boolean);
create temporary table bt_config as select to_jsonb(c) value from public.app_config c where id;
grant select,insert,update on bt_ids to authenticated;
grant select on bt_ids to anon;
grant select,insert on bt_checks to authenticated,anon;
grant usage on sequence bt_checks_n_seq to authenticated,anon;
create function pg_temp.bt_id(k text) returns uuid language sql as
$$ select id from pg_temp.bt_ids where bt_ids.k=$1 $$;
create function pg_temp.bt_check(label text, result boolean) returns void language plpgsql as $$
begin
  if result is distinct from true then raise exception 'assertion_failed: %',label; end if;
  insert into pg_temp.bt_checks(check_name,passed) values(label,true);
end $$;
create function pg_temp.bt_denied(label text, statement text, expected_code text, expected_message text default null)
returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin execute statement;
  exception when others then
    if sqlstate<>expected_code or (expected_message is not null and position(expected_message in sqlerrm)=0) then
      raise exception 'wrong_rejection_for_%: [%] %',label,sqlstate,sqlerrm;
    end if;
    rejected:=true;
  end;
  perform pg_temp.bt_check(label,rejected);
end $$;
insert into bt_ids(k,id) values('owner',gen_random_uuid()),('a',gen_random_uuid()),('b',gen_random_uuid()),
 ('outsider',gen_random_uuid()),('email',gen_random_uuid()),('unverified',gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,'bt-rollback-'||k||'@example.test',case when k='unverified' then null else now() end,
 case when k='email' then '{"provider":"email","providers":["email"]}'::jsonb
 else '{"provider":"google","providers":["google"]}'::jsonb end,
 case when k in ('email','unverified','outsider') then '{"role":"owner"}'::jsonb else '{}'::jsonb end from bt_ids;
select public.bootstrap_owner('bt-rollback-owner@example.test');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Owner claim',(public.claim_membership()->>'role')='owner');
with r as (insert into public.invitations(normalized_email) values('bt-rollback-a@example.test') returning id)
 insert into bt_ids select 'invite_a',id from r;
with r as (insert into public.invitations(normalized_email) values('bt-rollback-b@example.test') returning id)
 insert into bt_ids select 'invite_b',id from r;
with r as (insert into public.projects(title,invitation_id) values('Rollback A',pg_temp.bt_id('invite_a')) returning id)
 insert into bt_ids select 'project_a',id from r;
with r as (insert into public.projects(title,invitation_id) values('Rollback B',pg_temp.bt_id('invite_b')) returning id)
 insert into bt_ids select 'project_b',id from r;
insert into public.private_notes(project_id,body) values(pg_temp.bt_id('project_a'),'Privat dosen');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('a'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Student A claim',(public.claim_membership()->>'role')='student');
select pg_temp.bt_check('Cross-project read isolation',not exists(select 1 from public.projects where id=pg_temp.bt_id('project_b')));
select pg_temp.bt_check('Private notes invisible',not exists(select 1 from public.private_notes));
select pg_temp.bt_denied('Student owner/stage grants',format('update public.projects set stage=''final'' where id=%L',pg_temp.bt_id('project_a')),'42501');
select pg_temp.bt_denied('Bootstrap API denied','select public.bootstrap_owner(''bt-rollback-a@example.test'')','42501');
with r as (insert into public.versions(project_id,file_name,file_size) values(pg_temp.bt_id('project_a'),'source.pdf',1000) returning id)
 insert into bt_ids select 'version',id from r;
select pg_temp.bt_check('Bound PDF path',(select file_path=project_id::text||'/'||id::text||'.pdf' from public.versions where id=pg_temp.bt_id('version')));
select pg_temp.bt_denied('Final size mismatch',format('insert into storage.objects(bucket_id,name,metadata) select ''thesis-files'',file_path,''{"size":2000,"mimetype":"application/pdf"}''::jsonb from public.versions where id=%L',pg_temp.bt_id('version')),'22023','uploaded_size_mismatch');
insert into storage.objects(bucket_id,name,metadata) select 'thesis-files',file_path,'{"size":1000,"mimetype":"application/pdf"}'::jsonb from public.versions where id=pg_temp.bt_id('version');
do $$ declare v public.versions;
begin
 select * into v from public.versions where id=pg_temp.bt_id('version');
 v:=public.version_upload_result(v.id,v.row_version,repeat('a',64));
 v:=public.version_save_pages(v.id,v.row_version,2,'[{"pdf_page":1,"printed_label":"iv","text":"Pendahuluan","source":"pdfjs"},{"pdf_page":2,"printed_label":"1","text":"Metode","source":"pdfjs"}]');
 perform pg_temp.bt_denied('Chapter overlap rejected',format('select public.version_save_ranges(%L,%s,%L::jsonb)',v.id,v.row_version,'[{"chapter":"B1","start_page":1,"end_page":2},{"chapter":"B3","start_page":2,"end_page":2}]'),'22023','chapter_ranges_overlap');
 v:=public.version_save_ranges(v.id,v.row_version,'[{"chapter":"B1","start_page":1,"end_page":1},{"chapter":"B3","start_page":2,"end_page":2}]');
 perform pg_temp.bt_denied('Stale extraction rejected',format('select public.version_save_pages(%L,%s,2,%L::jsonb)',v.id,v.row_version-1,'[{"pdf_page":1,"text":"stale"}]'),'40001','edit_conflict');
 v:=public.version_confirm(v.id,v.row_version);
 perform pg_temp.bt_check('Version sealed with hashes',v.status='confirmed' and v.extraction_hash~'^[a-f0-9]{64}$' and v.file_hash=repeat('a',64));
 perform pg_temp.bt_denied('Sealed text immutable',format('select public.version_save_pages(%L,%s,2,%L::jsonb)',v.id,v.row_version,'[{"pdf_page":1,"text":"tampered"}]'),'42501','version_sealed');
end $$;
select pg_temp.bt_check('Printed label separate from PDF page',(select printed_label='iv' and pdf_page=1 and char_count=11 from public.pages where version_id=pg_temp.bt_id('version') and pdf_page=1));
with r as (insert into public.workspace_drafts(project_id,scope,payload) values(pg_temp.bt_id('project_a'),'proof:test','{"text":"saved"}') returning id)
 insert into bt_ids select 'draft',id from r;
do $$ declare changed integer;
begin
 update public.workspace_drafts set payload='{"text":"new"}' where id=pg_temp.bt_id('draft') and row_version=1;
 get diagnostics changed=row_count;
 perform pg_temp.bt_check('Autosave first CAS succeeds',changed=1);
 update public.workspace_drafts set payload='{"text":"stale"}' where id=pg_temp.bt_id('draft') and row_version=1;
 get diagnostics changed=row_count;
 perform pg_temp.bt_check('Second session CAS rejected',changed=0 and (select payload->>'text'='new' from public.workspace_drafts where id=pg_temp.bt_id('draft')));
end $$;
with r as (insert into public.comments(project_id,version_id,pdf_page,body) values(pg_temp.bt_id('project_a'),pg_temp.bt_id('version'),1,'Pertanyaan') returning id)
 insert into bt_ids select 'comment',id from r;
select pg_temp.bt_denied('Comment reply scope',format('insert into public.comments(project_id,version_id,pdf_page,parent_id,body) values(%L,%L,2,%L,''Wrong page'')',pg_temp.bt_id('project_a'),pg_temp.bt_id('version'),pg_temp.bt_id('comment')),'22023','parent_scope_mismatch');
select pg_temp.bt_denied('Comment outside PDF',format('insert into public.comments(project_id,version_id,pdf_page,body) values(%L,%L,99,''Wrong page'')',pg_temp.bt_id('project_a'),pg_temp.bt_id('version')),'22023','page_outside_pdf');
select pg_temp.bt_denied('Export receipt owner-only',format('select public.record_file_export(%L,''{}''::jsonb)',pg_temp.bt_id('project_a')),'42501','owner_only');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('b'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Student B claim',(public.claim_membership()->>'role')='student');
select pg_temp.bt_check('B cannot read A pages/object',not exists(select 1 from public.pages where version_id=pg_temp.bt_id('version')) and not exists(select 1 from storage.objects where bucket_id='thesis-files'));
select pg_temp.bt_denied('Cross-project version RPC',format('select public.version_confirm(%L,1)',pg_temp.bt_id('version')),'42501','not_found');
select pg_temp.bt_denied('Cross-project drafts blocked',format('insert into public.workspace_drafts(project_id,scope,payload) values(%L,''foreign'',''{}'')',pg_temp.bt_id('project_a')),'42501');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('owner'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Student draft private from owner',not exists(select 1 from public.workspace_drafts where id=pg_temp.bt_id('draft')));
with r as (insert into public.findings(project_id,version_id,title,acceptance_criterion) values(pg_temp.bt_id('project_a'),pg_temp.bt_id('version'),'Perjelas metode','Sebutkan validasi') returning id)
 insert into bt_ids select 'finding',id from r;
with r as (insert into public.meetings(project_id,meeting_at,decisions,next_targets,meeting_url) values(pg_temp.bt_id('project_a'),'2026-10-20T03:00:00Z','Validasi 5-fold','Perbaiki Bab III','https://meet.example.test/a') returning id)
 insert into bt_ids select 'meeting',id from r;
select pg_temp.bt_denied('Unsafe reference URL',format('insert into public.resources(project_id,kind,title,https_url) values(%L,''repo'',''Unsafe'',''https://user@host.test'')',pg_temp.bt_id('project_a')),'23514','resources_safe_url');
select pg_temp.bt_denied('Incomplete export manifest',format('select public.record_file_export(%L,''{}''::jsonb)',pg_temp.bt_id('project_a')),'22023','export_missing_file');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare changed integer;
begin
 update public.meetings set decisions='Overwrite' where id=pg_temp.bt_id('meeting');
 get diagnostics changed=row_count;
 perform pg_temp.bt_check('Student cannot edit decisions',changed=0 and (select decisions='Validasi 5-fold' from public.meetings where id=pg_temp.bt_id('meeting')));
end $$;
select pg_temp.bt_check('Meeting notification persisted',exists(select 1 from public.notifications where entity_id=pg_temp.bt_id('meeting') and read_at is null));
with r as (insert into public.versions(project_id,file_name,file_size) values(pg_temp.bt_id('project_a'),'revision.pdf',1000) returning id)
 insert into bt_ids select 'proof',id from r;
insert into storage.objects(bucket_id,name,metadata) select 'thesis-files',file_path,'{"size":1000,"mimetype":"application/pdf"}'::jsonb from public.versions where id=pg_temp.bt_id('proof');
do $$ declare v public.versions; f public.findings; proof jsonb;
begin
 select * into v from public.versions where id=pg_temp.bt_id('proof');
 v:=public.version_upload_result(v.id,v.row_version,repeat('b',64));
 v:=public.version_save_pages(v.id,v.row_version,1,'[{"pdf_page":1,"text":"Validasi ditambahkan","source":"pasted"}]');
 v:=public.version_save_ranges(v.id,v.row_version,'[{"chapter":"B3","start_page":1,"end_page":1}]');
 v:=public.version_confirm(v.id,v.row_version);
 select * into f from public.findings where id=pg_temp.bt_id('finding');
 f:=public.finding_transition(f.id,f.row_version,'in_progress');
 proof:=jsonb_build_object('version_id',pg_temp.bt_id('version'),'start_page',1,'end_page',1,'description','Perbaikan');
 perform pg_temp.bt_denied('Old proof version rejected',format('select public.finding_transition(%L,%s,''submitted'',%L::jsonb)',f.id,f.row_version,proof),'22023','proof_version_invalid');
 proof:=jsonb_set(proof,'{version_id}',to_jsonb(v.id));
 f:=public.finding_transition(f.id,f.row_version,'submitted',proof);
 perform pg_temp.bt_check('New sealed revision proof accepted',f.workflow_status='submitted' and f.revision_proof->>'file_hash'=repeat('b',64));
 perform pg_temp.bt_denied('Student cannot close revision',format('select public.finding_transition(%L,%s,''verified_closed'')',f.id,f.row_version),'42501','owner_only');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare f public.findings;
begin
 select * into f from public.findings where id=pg_temp.bt_id('finding');
 f:=public.finding_transition(f.id,f.row_version,'verified_closed');
 perform pg_temp.bt_check('Owner closes revision',f.closed_by=pg_temp.bt_id('owner') and f.closed_at is not null);
 perform pg_temp.bt_denied('Reopen reason required',format('select public.finding_transition(%L,%s,''reopened'',null,'''')',f.id,f.row_version),'22023','reopen_reason_required');
 f:=public.finding_transition(f.id,f.row_version,'reopened',null,'Validasi belum jelas');
 perform pg_temp.bt_check('Reopen audit retained',f.closed_at is null and (select count(*)=4 from public.audit_events where entity_id=f.id and action='revision_transition') and exists(select 1 from public.audit_events where entity_id=f.id and detail->>'reason'='Validasi belum jelas'));
end $$;
select public.record_file_export(pg_temp.bt_id('project_a'),(select jsonb_object_agg(id::text,file_hash) from public.versions where project_id=pg_temp.bt_id('project_a') and status='confirmed'));
select pg_temp.bt_denied('Referenced evidence cannot be deleted',format('select public.begin_version_deletion(%L)',pg_temp.bt_id('version')),'42501','version_delete_blocked');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('email'),'role','authenticated','user_metadata',jsonb_build_object('role','owner'))::text,true);
set local role authenticated;
select pg_temp.bt_check('Email provider refused despite fake owner metadata',(public.claim_membership()->>'reason')='provider_not_allowed' and not exists(select 1 from public.projects));
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('unverified'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Unverified identity refused',(public.claim_membership()->>'reason')='email_unverified');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bt_id('outsider'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.bt_check('Outsider pending and no data',(public.claim_membership()->>'reason')='not_invited' and not exists(select 1 from public.projects));
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select pg_temp.bt_denied('Anonymous project access','select * from public.projects','42501');
select pg_temp.bt_denied('Anonymous version RPC',format('select public.version_confirm(%L,1)',(select id from pg_temp.bt_ids where k='version')),'42501','permission denied for function version_confirm');
reset role;
select pg_temp.bt_check('Google-only configuration unchanged',(select to_jsonb(c)=(select value from bt_config) from public.app_config c where id));
select n,check_name,passed,clock_timestamp() as checked_at from bt_checks order by n;
rollback;
-- After execution, separately confirm no fixtures remain: auth.users/memberships/projects counts = 0.
