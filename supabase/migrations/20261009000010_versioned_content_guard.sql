-- Preserve immutable rubric/prompt snapshots while allowing owner weight/activation updates.
-- Separate branches prevent PL/pgSQL from resolving a field absent from the current row type.
-- CREATE OR REPLACE preserves the existing trigger bindings and function ACL.
create or replace function app.versioned_content_guard() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'rubric_versions' then
    if new.content_json is distinct from old.content_json
       or new.source_sha256 is distinct from old.source_sha256
       or new.version is distinct from old.version then
      raise exception 'rubric_snapshot_immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'prompt_versions' then
    if new.content is distinct from old.content
       or new.source_sha256 is distinct from old.source_sha256
       or new.version is distinct from old.version then
      raise exception 'prompt_snapshot_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
