-- BimbingTA Copilot — 0005 rubric/prompt versions, model settings, budgets, AI runs, traceability
-- AI output is DRAFT only. Server (Edge Function, service role) writes runs/reservations; clients read.

create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  content_json jsonb not null,           -- rule_engine.json stored verbatim
  source_sha256 text not null,           -- sha256 of the original file bytes
  rule_count integer not null,
  dimension_weights jsonb not null default '{}'::jsonb,
  weights_provisional boolean not null default true,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create unique index rubric_single_active on public.rubric_versions ((is_active)) where is_active;

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  content text not null,
  source_sha256 text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create unique index prompt_single_active on public.prompt_versions ((is_active)) where is_active;

-- reviewed snapshots are immutable: only is_active / dimension_weights (owner) may change
create or replace function app.versioned_content_guard() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'rubric_versions' and (new.content_json is distinct from old.content_json or new.source_sha256 is distinct from old.source_sha256 or new.version is distinct from old.version) then
    raise exception 'rubric_snapshot_immutable' using errcode = '42501';
  end if;
  if tg_table_name = 'prompt_versions' and (new.content is distinct from old.content or new.source_sha256 is distinct from old.source_sha256 or new.version is distinct from old.version) then
    raise exception 'prompt_snapshot_immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger rubric_guard before update on public.rubric_versions for each row execute function app.versioned_content_guard();
create trigger rubric_touch before insert or update on public.rubric_versions for each row execute function app.touch();
create trigger prompt_guard before update on public.prompt_versions for each row execute function app.versioned_content_guard();
create trigger prompt_touch before insert or update on public.prompt_versions for each row execute function app.touch();

create table public.model_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai', 'anthropic', 'gemini')),
  model_id text not null check (model_id ~ '^[A-Za-z0-9._:-]{2,120}$'),
  label text not null default '',
  tier text not null default 'balanced' check (tier in ('balanced', 'frontier', 'economy')),
  input_usd_per_million numeric(12, 4),
  output_usd_per_million numeric(12, 4),
  price_scope text,
  capability jsonb not null default '{}'::jsonb,
  max_input_tokens integer not null default 18000 check (max_input_tokens between 1000 and 2000000),
  max_output_tokens integer not null default 4000 check (max_output_tokens between 100 and 64000),
  enabled boolean not null default false,
  roles_allowed text[] not null default '{owner}',
  config_hash text,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('ok', 'failed')),
  last_test_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  unique (provider, model_id)
);
create or replace function app.model_settings_guard() returns trigger
language plpgsql as $$
begin
  new.config_hash := encode(sha256(convert_to(concat_ws('|', new.provider, new.model_id, new.max_input_tokens,
                       new.max_output_tokens, new.capability::text, new.input_usd_per_million, new.output_usd_per_million), 'UTF8')), 'hex');
  if app.is_client() then
    if tg_op = 'UPDATE' and (new.last_tested_at is distinct from old.last_tested_at or new.last_test_status is distinct from old.last_test_status) then
      raise exception 'server_only_field' using errcode = '42501';
    end if;
    -- cannot enable a model that never passed a live test
    if new.enabled and (case when tg_op = 'UPDATE' then old.last_test_status else null end) is distinct from 'ok' then
      raise exception 'model_not_live_tested' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.provider is distinct from old.provider or new.model_id is distinct from old.model_id) then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger model_settings_guard before insert or update on public.model_settings for each row execute function app.model_settings_guard();
create trigger model_settings_touch before insert or update on public.model_settings for each row execute function app.touch();

create table public.budget_settings (
  id uuid primary key default gen_random_uuid(),
  month text not null unique check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  ai_enabled boolean not null default false,
  student_ai_enabled boolean not null default false,
  max_cost_usd numeric(10, 4) not null default 5 check (max_cost_usd >= 0),
  per_call_max_usd numeric(10, 4) not null default 0.25 check (per_call_max_usd >= 0),
  max_calls integer not null default 40 check (max_calls >= 0),
  per_student_calls integer not null default 0 check (per_student_calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create trigger budget_touch before insert or update on public.budget_settings for each row execute function app.touch();

create table public.ai_consents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  allowed_data jsonb not null default '{}'::jsonb,
  provider_terms_ack boolean not null default false,
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  unique (project_id, user_id)
);
create or replace function app.user_rows_guard() returns trigger
language plpgsql as $$
begin
  if app.is_client() then
    if tg_op = 'INSERT' then new.user_id := auth.uid();
    elsif new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger ai_consents_guard before insert or update on public.ai_consents for each row execute function app.user_rows_guard();
create trigger ai_consents_touch before insert or update on public.ai_consents for each row execute function app.touch();

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid references public.versions(id) on delete restrict,
  operation text not null check (operation in ('review', 'chat', 'traceability', 'test')),
  chapter text check (chapter in ('B1', 'B2', 'B3', 'B4', 'B5')),
  scope jsonb not null default '{}'::jsonb,
  scope_hash text,
  rubric_hash text,
  model_hash text,
  prompt_version text,
  cache_key text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  state text not null default 'pending' check (state in ('pending', 'running', 'succeeded', 'failed', 'unknown')),
  requester_uid uuid not null,
  model_setting_id uuid references public.model_settings(id),
  provider text,
  model_id text,
  cached_from uuid references public.ai_runs(id),
  normalized_result jsonb,
  validation jsonb,
  usage jsonb,
  error_code text,
  error_message text,
  provider_request_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
-- atomic single active run per project
create unique index ai_runs_one_active on public.ai_runs (project_id) where state in ('pending', 'running');
create index ai_runs_cache on public.ai_runs (project_id, cache_key) where state = 'succeeded';
create trigger ai_runs_touch before insert or update on public.ai_runs for each row execute function app.touch();

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_key text not null,
  run_id uuid references public.ai_runs(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  requester_uid uuid not null,
  created_at timestamptz not null default now()
);
create index ai_messages_thread_idx on public.ai_messages (project_id, thread_key, created_at);

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.ai_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requester_uid uuid not null,
  month text not null,
  max_cost numeric(10, 6) not null,
  actual_cost numeric(10, 6),
  status text not null default 'held' check (status in ('held', 'reconciled', 'unknown', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index usage_month_idx on public.usage_reservations (month, status);
create trigger usage_touch before insert or update on public.usage_reservations for each row execute function app.touch();

create table public.traceability_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  objective_code text not null default 'T1' check (char_length(objective_code) <= 20),
  problem text not null default '' check (char_length(problem) <= 4000),
  objective text not null default '' check (char_length(objective) <= 4000),
  theory_locator jsonb not null default '{}'::jsonb,
  method_locator jsonb not null default '{}'::jsonb,
  evaluation text not null default '' check (char_length(evaluation) <= 4000),
  result_locator jsonb not null default '{}'::jsonb,
  conclusion_locator jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'proposed', 'verified', 'needs_revision')),
  source text not null default 'manual' check (source in ('manual', 'ai_suggestion')),
  owner_note text not null default '' check (char_length(owner_note) <= 4000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create or replace function app.traceability_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.created_by := auth.uid(); new.source := 'manual'; end if;
  elsif new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by or new.source is distinct from old.source then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  if app.is_client() and not app.is_owner() then
    if new.status in ('verified', 'needs_revision') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'owner_verifies' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.owner_note is distinct from old.owner_note then
      raise exception 'owner_only_field' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger traceability_guard before insert or update on public.traceability_rows for each row execute function app.traceability_guard();
create trigger traceability_touch before insert or update on public.traceability_rows for each row execute function app.touch();

-- ---------- RLS + grants ----------
alter table public.rubric_versions enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.model_settings enable row level security;
alter table public.budget_settings enable row level security;
alter table public.ai_consents enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_messages enable row level security;
alter table public.usage_reservations enable row level security;
alter table public.traceability_rows enable row level security;
revoke all on public.rubric_versions, public.prompt_versions, public.model_settings, public.budget_settings, public.ai_consents,
  public.ai_runs, public.ai_messages, public.usage_reservations, public.traceability_rows from anon, authenticated;

grant select on public.rubric_versions, public.prompt_versions to authenticated;
grant update (is_active, dimension_weights, weights_provisional) on public.rubric_versions to authenticated;
grant update (is_active) on public.prompt_versions to authenticated;
create policy rubric_read on public.rubric_versions for select to authenticated using (app.is_active_member());
create policy rubric_owner_update on public.rubric_versions for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy prompt_read on public.prompt_versions for select to authenticated using (app.is_owner());
create policy prompt_owner_update on public.prompt_versions for update to authenticated using (app.is_owner()) with check (app.is_owner());

grant select, delete on public.model_settings to authenticated;
grant insert (provider, model_id, label, tier, input_usd_per_million, output_usd_per_million, price_scope, capability, max_input_tokens, max_output_tokens, roles_allowed) on public.model_settings to authenticated;
grant update (label, tier, input_usd_per_million, output_usd_per_million, price_scope, capability, max_input_tokens, max_output_tokens, enabled, roles_allowed) on public.model_settings to authenticated;
create policy models_owner_all on public.model_settings for all to authenticated using (app.is_owner()) with check (app.is_owner());
create policy models_student_read on public.model_settings for select to authenticated
  using (app.is_active_member() and enabled and 'student' = any (roles_allowed));

grant select, insert, update on public.budget_settings to authenticated;
create policy budget_owner_all on public.budget_settings for all to authenticated using (app.is_owner()) with check (app.is_owner());

grant select on public.ai_consents to authenticated;
grant insert (project_id, allowed_data, provider_terms_ack) on public.ai_consents to authenticated;
grant update (allowed_data, provider_terms_ack, revoked_at) on public.ai_consents to authenticated;
create policy consents_read on public.ai_consents for select to authenticated using (app.can_access_project(project_id));
create policy consents_write on public.ai_consents for insert to authenticated with check (app.can_access_project(project_id));
create policy consents_update on public.ai_consents for update to authenticated
  using (user_id = auth.uid() and app.can_access_project(project_id)) with check (user_id = auth.uid());

grant select on public.ai_runs, public.ai_messages, public.usage_reservations to authenticated;
create policy ai_runs_read on public.ai_runs for select to authenticated
  using (app.is_project_owner(project_id) or (app.is_project_student(project_id) and requester_uid = auth.uid()));
create policy ai_messages_read on public.ai_messages for select to authenticated
  using (app.is_project_owner(project_id) or (app.is_project_student(project_id) and requester_uid = auth.uid()));
create policy usage_read on public.usage_reservations for select to authenticated
  using (app.is_owner() or (requester_uid = auth.uid() and app.can_access_project(project_id)));

grant select, delete on public.traceability_rows to authenticated;
grant insert (project_id, objective_code, problem, objective, theory_locator, method_locator, evaluation, result_locator, conclusion_locator, status) on public.traceability_rows to authenticated;
grant update (objective_code, problem, objective, theory_locator, method_locator, evaluation, result_locator, conclusion_locator, status, owner_note) on public.traceability_rows to authenticated;
create policy trace_read on public.traceability_rows for select to authenticated using (app.can_access_project(project_id));
create policy trace_insert on public.traceability_rows for insert to authenticated with check (app.can_access_project(project_id));
create policy trace_update on public.traceability_rows for update to authenticated
  using (app.can_access_project(project_id)) with check (app.can_access_project(project_id));
create policy trace_delete on public.traceability_rows for delete to authenticated using (app.is_project_owner(project_id));
