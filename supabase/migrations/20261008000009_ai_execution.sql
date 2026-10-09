-- Checkpoint D: additive execution ledger. AI remains OFF; no provider keys or live calls.
alter table public.model_settings add column last_tested_hash text;
alter table public.ai_messages add column message_order bigint generated always as identity;
grant select on public.model_settings to authenticated;
create or replace function app.model_settings_guard() returns trigger language plpgsql as $$
declare h text;
begin
 h:=encode(sha256(convert_to(concat_ws('|',new.provider,new.model_id,new.max_input_tokens,new.max_output_tokens,new.capability::text,new.input_usd_per_million,new.output_usd_per_million),'UTF8')),'hex');
 if app.is_client() and tg_op='UPDATE' and (new.last_tested_at,new.last_test_status,new.last_tested_hash,new.last_test_detail) is distinct from (old.last_tested_at,old.last_test_status,old.last_tested_hash,old.last_test_detail) then raise exception 'server_only_field' using errcode='42501'; end if;
 if tg_op='UPDATE' and (new.provider,new.model_id) is distinct from (old.provider,old.model_id) then raise exception 'immutable_field' using errcode='42501'; end if;
 if tg_op='UPDATE' and h is distinct from old.config_hash then new.enabled:=false; new.last_test_status:=null; new.last_tested_hash:=null; end if;
 new.config_hash:=h;
 if new.enabled and (new.last_test_status is distinct from 'ok' or new.last_tested_hash is distinct from h) then raise exception 'model_not_live_tested' using errcode='22023'; end if;
 return new;
end $$;

create table public.ai_rating_reviews (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 run_id uuid not null unique references public.ai_runs(id) on delete cascade,
 chapter text not null, dimensions jsonb not null, approved_dimensions jsonb, approval_state text not null default 'draft' check(approval_state in('draft','accepted','rejected')),
 approved_by uuid, approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1
);
alter table public.ai_rating_reviews enable row level security;
revoke all on public.ai_rating_reviews from anon,authenticated;
grant select on public.ai_rating_reviews to authenticated;
create policy rating_read on public.ai_rating_reviews for select to authenticated using(app.is_project_owner(project_id) or (app.is_project_student(project_id) and exists(select 1 from public.ai_runs r where r.id=run_id and r.requester_uid=auth.uid())));
create trigger rating_touch before update on public.ai_rating_reviews for each row execute function app.touch();

-- Service-only claim serializes all monthly reservations BEFORE any provider call.
create function public.ai_claim(p_requester uuid,p_project uuid,p_version uuid,p_model uuid,p_operation text,p_chapter text,p_scope jsonb,p_key text,p_cache text,p_hashes jsonb)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.budget_settings; m public.model_settings; r public.ai_runs; cached public.ai_runs; member public.memberships; proj public.projects; reserved numeric; n integer; student_n integer; worst numeric; month_key text:=to_char(now() at time zone 'UTC','YYYY-MM');
begin
 select * into member from public.memberships where auth_user_id=p_requester and active;
 select * into proj from public.projects where id=p_project;
 if member.id is null or proj.id is null or (member.role='owner' and proj.owner_uid<>p_requester) or (member.role='student' and proj.student_uid is distinct from p_requester) then raise exception 'not_authorized' using errcode='42501'; end if;
 if p_operation not in('review','chat','traceability','test') then raise exception 'invalid_operation' using errcode='22023'; end if;
 select * into m from public.model_settings where id=p_model;
 if m.id is null or (p_operation='test' and member.role<>'owner') or (p_operation<>'test' and (not m.enabled or m.last_test_status is distinct from 'ok' or m.last_tested_hash is distinct from m.config_hash or not(member.role=any(m.roles_allowed)))) then raise exception 'model_not_allowed' using errcode='42501'; end if;
 if m.config_hash is distinct from p_hashes->>'model' then raise exception 'model_config_changed' using errcode='PT409'; end if;
 if p_operation<>'test' and not exists(select 1 from public.versions where id=p_version and project_id=p_project and status='confirmed') then raise exception 'sealed_version_required' using errcode='42501'; end if;
 if p_operation<>'test' and not exists(select 1 from public.ai_consents where project_id=p_project and user_id=p_requester and revoked_at is null and provider_terms_ack and allowed_data->'providers' ? m.provider and allowed_data->>'chapter_text'='true' and (p_operation<>'chat' or allowed_data->>'chat'='true')) then raise exception 'consent_required' using errcode='42501'; end if;
 select * into b from public.budget_settings where month=month_key for update;
 if b.id is null or not b.ai_enabled or (member.role='student' and not b.student_ai_enabled) then raise exception 'ai_disabled' using errcode='42501'; end if;
 -- Never retry a worker which may already have incurred a charge. Keep its reservation.
 update public.usage_reservations set status='unknown' where run_id in(select id from public.ai_runs where project_id=p_project and state in('pending','running') and created_at<now()-interval '110 seconds');
 update public.ai_runs set state='unknown',error_code='worker_interrupted',finished_at=now() where project_id=p_project and state in('pending','running') and created_at<now()-interval '110 seconds';
 select * into r from public.ai_runs where idempotency_key=p_key;
 if found then
  if (r.project_id,r.requester_uid,r.cache_key) is distinct from (p_project,p_requester,p_cache) then raise exception 'idempotency_conflict' using errcode='PT409'; end if;
  return jsonb_build_object('dispatch',false,'run',to_jsonb(r));
 end if;
 if p_operation<>'test' then
  select * into cached from public.ai_runs where project_id=p_project and requester_uid=p_requester and cache_key=p_cache and state='succeeded' order by created_at desc limit 1;
  if found then
   insert into public.ai_runs(project_id,version_id,requester_uid,model_setting_id,provider,model_id,operation,chapter,scope,idempotency_key,cache_key,state,cached_from,normalized_result,validation,usage,finished_at)
   values(p_project,p_version,p_requester,m.id,m.provider,m.model_id,p_operation,p_chapter,p_scope,p_key,p_cache,'succeeded',cached.id,cached.normalized_result,cached.validation,jsonb_build_object('cached',true,'new_cost_usd',0),now()) returning * into r;
   return jsonb_build_object('dispatch',false,'run',to_jsonb(r));
  end if;
 end if;
 if m.input_usd_per_million is null or m.output_usd_per_million is null or m.input_usd_per_million<0 or m.output_usd_per_million<0 then raise exception 'price_not_configured' using errcode='22023'; end if;
 worst:=ceil((m.max_input_tokens*m.input_usd_per_million+least(m.max_output_tokens,4000)*m.output_usd_per_million))/1000000;
 select coalesce(sum(case when status='reconciled' then actual_cost else max_cost end),0),count(*) into reserved,n from public.usage_reservations where month=month_key and status<>'released';
 select count(*) into student_n from public.usage_reservations where month=month_key and requester_uid=p_requester and status<>'released';
 if worst>b.per_call_max_usd or reserved+worst>b.max_cost_usd or n>=b.max_calls or (member.role='student' and student_n>=b.per_student_calls) then raise exception 'budget_exceeded' using errcode='22023'; end if;
 if exists(select 1 from public.ai_runs where project_id=p_project and state in('pending','running')) then raise exception 'project_busy' using errcode='PT409'; end if;
 insert into public.ai_runs(project_id,version_id,requester_uid,model_setting_id,provider,model_id,operation,chapter,scope,scope_hash,rubric_hash,model_hash,prompt_version,idempotency_key,cache_key,state,started_at)
 values(p_project,p_version,p_requester,m.id,m.provider,m.model_id,p_operation,p_chapter,p_scope,p_hashes->>'scope',p_hashes->>'rubric',p_hashes->>'model',p_hashes->>'prompt',p_key,p_cache,'running',now()) returning * into r;
 insert into public.usage_reservations(run_id,project_id,requester_uid,month,max_cost) values(r.id,p_project,p_requester,month_key,worst);
 return jsonb_build_object('dispatch',true,'run',to_jsonb(r));
end $$;

create function public.ai_finish(p_run uuid,p_state text,p_result jsonb,p_validation jsonb,p_usage jsonb,p_actual numeric,p_error text,p_request_id text,p_dimensions jsonb,p_question text)
 returns public.ai_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.ai_runs; f jsonb; m public.model_settings;
begin
 select * into r from public.ai_runs where id=p_run for update;
 if r.id is null or r.state not in('running','unknown') or p_state not in('succeeded','failed','unknown') then raise exception 'invalid_transition' using errcode='22023'; end if;
 update public.usage_reservations set actual_cost=p_actual,status=case when p_actual is null then 'unknown' else 'reconciled' end where run_id=r.id;
 update public.ai_runs set state=p_state,normalized_result=p_result,validation=p_validation,usage=p_usage,error_code=p_error,provider_request_id=p_request_id,finished_at=now() where id=r.id returning * into r;
 if p_state='succeeded' and r.operation='review' then
  for f in select * from jsonb_array_elements(p_result->'findings') loop
   if f->>'rule_status' in('Partial','Fail') then
    insert into public.findings(project_id,version_id,run_id,chapter,rule_id,title,severity,confidence,rule_status,evidence_type,locator,quote,quote_validation,reason,recommendation,acceptance_criterion,source,approval_state,created_by,original_ai)
    values(r.project_id,r.version_id,r.id,r.chapter,f->>'rule_id',f->>'title',f->>'severity',f->>'confidence',f->>'rule_status',f->>'evidence_type',f->'locator',nullif(f->>'quote',''),f->>'quote_validation',f->>'reason',f->>'recommendation',f->>'acceptance_criterion','ai','draft',r.requester_uid,f);
   end if;
  end loop;
  if jsonb_array_length(p_dimensions)>0 then insert into public.ai_rating_reviews(project_id,run_id,chapter,dimensions) values(r.project_id,r.id,r.chapter,p_dimensions); end if;
 end if;
 if p_state='succeeded' and r.operation='traceability' then
  for f in select * from jsonb_array_elements(p_result->'traceability') loop
   insert into public.traceability_rows(project_id,objective_code,problem,objective,theory_locator,method_locator,evaluation,result_locator,conclusion_locator,status,source,created_by)
   values(r.project_id,left(f->>'objective_code',20),left(f->>'problem',4000),left(f->>'objective',4000),jsonb_build_object('version_id',r.version_id,'scope',r.scope,'note',left(f->>'theory',4000)),jsonb_build_object('version_id',r.version_id,'scope',r.scope,'note',left(f->>'method',4000)),left(f->>'evaluation',4000),jsonb_build_object('version_id',r.version_id,'scope',r.scope,'note',left(f->>'result',4000)),jsonb_build_object('version_id',r.version_id,'scope',r.scope,'note',left(f->>'conclusion',4000)),'draft','ai_suggestion',r.requester_uid);
  end loop;
 end if;
 if p_state='succeeded' and r.operation='chat' then
  insert into public.ai_messages(project_id,thread_key,run_id,role,content,requester_uid) values(r.project_id,r.scope->>'thread_key',r.id,'user',p_question,r.requester_uid),(r.project_id,r.scope->>'thread_key',r.id,'assistant',left(p_result->>'answer',20000),r.requester_uid);
 end if;
 if r.operation='test' then
  select * into m from public.model_settings where id=r.model_setting_id;
  if m.config_hash=r.model_hash then update public.model_settings set last_tested_at=now(),last_test_status=case when p_state='succeeded' then 'ok' else 'failed' end,last_test_detail=case when p_state='succeeded' then 'Live structured-output smoke test' else p_error end,last_tested_hash=case when p_state='succeeded' then m.config_hash else null end,enabled=false where id=m.id; end if;
 end if;
 return r;
end $$;
revoke all on function public.ai_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,jsonb),public.ai_finish(uuid,text,jsonb,jsonb,jsonb,numeric,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,jsonb),public.ai_finish(uuid,text,jsonb,jsonb,jsonb,numeric,text,text,jsonb,text) to service_role;

create function public.finding_decide(p_finding uuid,p_expected integer,p_accept boolean,p_reason text default '') returns public.findings language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.findings; p public.pages;
begin
 select * into f from public.findings where id=p_finding for update;
 if f.id is null or not app.is_project_owner(f.project_id) or f.source<>'ai' or f.approval_state<>'draft' then raise exception 'owner_draft_required' using errcode='42501'; end if;
 if f.row_version<>p_expected then raise exception 'edit_conflict' using errcode='PT409'; end if;
 if p_accept then
  if f.original_ai->>'ready_to_approve' is distinct from 'true' then raise exception 'evidence_unverified' using errcode='22023'; end if;
  if f.evidence_type='quote' then
   select * into p from public.pages where version_id=f.version_id and pdf_page=(f.locator->>'pdf_page')::integer;
   if p.id is null or coalesce(length(btrim(f.quote)),0)=0 or position(regexp_replace(btrim(f.quote),'\s+',' ','g') in regexp_replace(btrim(p.text),'\s+',' ','g'))=0 then raise exception 'evidence_unverified' using errcode='22023'; end if;
  elsif f.evidence_type<>'gap' or f.quote is not null or f.locator->'inspected_scope' is distinct from f.original_ai->'locator'->'inspected_scope' then raise exception 'evidence_unverified' using errcode='22023'; end if;
  if length(btrim(f.acceptance_criterion))=0 then raise exception 'acceptance_criterion_required' using errcode='22023'; end if;
 elsif coalesce(length(btrim(p_reason)),0) not between 1 and 4000 then raise exception 'reject_reason_required' using errcode='22023'; end if;
 update public.findings set approval_state=case when p_accept then 'accepted' else 'rejected' end,workflow_status=case when p_accept then 'open' else null end,approved_by=auth.uid(),approved_at=now(),reject_reason=case when p_accept then null else p_reason end,quote_validation=case when p_accept and evidence_type='quote' then 'verified' else quote_validation end where id=f.id returning * into f;
 perform app.audit(f.project_id,'ai_finding_decision','findings',f.id,f.row_version,jsonb_build_object('accepted',p_accept,'reason',p_reason));
 return f;
end $$;
create function public.rating_decide(p_rating uuid,p_expected integer,p_dimensions jsonb,p_accept boolean) returns public.ai_rating_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.ai_rating_reviews; d jsonb; original jsonb; seen text[]:='{}';
begin
 select * into r from public.ai_rating_reviews where id=p_rating for update;
 if r.id is null or not app.is_project_owner(r.project_id) or r.approval_state<>'draft' then raise exception 'owner_draft_required' using errcode='42501'; end if;
 if r.row_version<>p_expected then raise exception 'edit_conflict' using errcode='PT409'; end if;
 if p_accept then
  if jsonb_typeof(p_dimensions)<>'array' or jsonb_array_length(p_dimensions)<>jsonb_array_length(r.dimensions) then raise exception 'invalid_dimensions' using errcode='22023'; end if;
  for d in select * from jsonb_array_elements(p_dimensions) loop
   select value into original from jsonb_array_elements(r.dimensions) where value->>'id'=d->>'id';
   if original is null or d->>'id'=any(seen) or (d->'weight') is distinct from original->'weight' or d->>'status' not in('Assessed','Not assessed','N/A') or d->>'status' is null or (d->>'status'='Assessed' and ((d->>'rating') is null or (d->>'rating')::numeric not between 0 and 3 or (d->>'rating')::numeric<>trunc((d->>'rating')::numeric))) or (d->>'status'<>'Assessed' and d->>'rating' is not null) then raise exception 'invalid_dimensions' using errcode='22023'; end if;
   seen:=array_append(seen,d->>'id');
  end loop;
 end if;
 update public.ai_rating_reviews set approved_dimensions=case when p_accept then p_dimensions else null end,approval_state=case when p_accept then 'accepted' else 'rejected' end,approved_by=auth.uid(),approved_at=now() where id=r.id returning * into r;
 perform app.audit(r.project_id,'ai_rating_decision','ai_rating_reviews',r.id,r.row_version,jsonb_build_object('accepted',p_accept)); return r;
end $$;
revoke all on function public.finding_decide(uuid,integer,boolean,text),public.rating_decide(uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.finding_decide(uuid,integer,boolean,text),public.rating_decide(uuid,integer,jsonb,boolean) to authenticated;

-- Manual/AI traceability changes are audited; only owner may verify (existing guard).
create function app.traceability_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform app.audit(new.project_id,'traceability_saved','traceability_rows',new.id,new.row_version,jsonb_build_object('status',new.status,'source',new.source)); return new; end $$;
create trigger traceability_audit after insert or update on public.traceability_rows for each row execute function app.traceability_audit();
-- No negative tariffs, including direct REST configuration.
alter table public.model_settings add constraint model_prices_nonnegative check((input_usd_per_million is null or input_usd_per_million>=0) and (output_usd_per_million is null or output_usd_per_million>=0));
