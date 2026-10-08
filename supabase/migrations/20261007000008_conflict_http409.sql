-- Business CAS conflicts must return HTTP 409 without PostgREST serialization retries.
-- Keep the seven applied migrations immutable. Only replace these two functions;
-- their security-definer settings, ownership, ACLs and access checks are preserved.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

create or replace function app.editable_version(vid uuid, expected integer) returns public.versions
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.versions;
begin
 select * into v from public.versions where id=vid for update;
 if not found or not app.can_access_project(v.project_id) then raise exception 'not_found' using errcode='42501'; end if;
 if v.submitted_by is distinct from auth.uid() and not app.is_project_owner(v.project_id) then raise exception 'owner_only' using errcode='42501'; end if;
 if v.status='confirmed' then raise exception 'version_sealed' using errcode='42501'; end if;
 if v.row_version<>expected then raise exception 'edit_conflict' using errcode='PT409'; end if;
 return v;
end $$;

create or replace function public.finding_transition(p_finding uuid,p_expected integer,p_status text,p_proof jsonb default null,p_reason text default null)
 returns public.findings language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.findings; v public.versions; base_seq integer; owner boolean; old_status text;
begin
 select * into f from public.findings where id=p_finding for update;
 if not found or not app.can_access_project(f.project_id) or f.approval_state<>'accepted' then raise exception 'not_found' using errcode='42501'; end if;
 if f.row_version<>p_expected then raise exception 'edit_conflict' using errcode='PT409'; end if;
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
