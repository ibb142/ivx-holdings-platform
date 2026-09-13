-- New private backend store. Refuse an unexpected existing schema instead of
-- silently retaining an older cascade, constraint or privilege definition.
set local lock_timeout = '1s';

create table public.ivx_candidate_leases (
  event_id varchar(255) primary key check (event_id ~ '[^[:space:]]'),
  owner_id varchar(255) not null check (owner_id ~ '[^[:space:]]'),
  version integer not null check (version >= 0),
  token uuid not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

-- Evidence has an independent lifetime. There is deliberately no FK to a lease.
create table public.ivx_candidate_lessons (
  event_id varchar(255) primary key check (event_id ~ '[^[:space:]]'),
  agent_id varchar(255) not null check (agent_id ~ '[^[:space:]]'),
  task_type varchar(255) not null check (task_type ~ '[^[:space:]]'),
  root_cause text not null check (root_cause ~ '[^[:space:]]' and length(root_cause) <= 16000),
  hypothesis text not null check (hypothesis ~ '[^[:space:]]' and length(hypothesis) <= 16000),
  git_sha varchar(40) not null check (git_sha ~ '^[0-9a-f]{40}$'),
  version integer not null check (version >= 0),
  status varchar(20) not null default 'CANDIDATE' check (status = 'CANDIDATE'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.ivx_candidate_phase_failures (
  id bigint generated always as identity primary key,
  event_id varchar(255) not null check (event_id ~ '[^[:space:]]'),
  phase varchar(100) not null check (phase ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  reason varchar(100) not null check (reason ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  attempt integer not null check (attempt >= 0),
  timestamp timestamptz not null default clock_timestamp()
);
create index ivx_candidate_failures_event_time_idx
  on public.ivx_candidate_phase_failures(event_id,timestamp desc,id desc);
-- The event_id primary key already covers every lease lookup and row lock.

alter table public.ivx_candidate_leases enable row level security;
alter table public.ivx_candidate_lessons enable row level security;
alter table public.ivx_candidate_phase_failures enable row level security;
revoke all on public.ivx_candidate_leases,public.ivx_candidate_lessons,
  public.ivx_candidate_phase_failures from public,anon,authenticated,service_role;
revoke all on sequence public.ivx_candidate_phase_failures_id_seq from public,anon,authenticated,service_role;
grant select,insert,update on public.ivx_candidate_leases to service_role;
grant select,insert on public.ivx_candidate_lessons,public.ivx_candidate_phase_failures to service_role;
grant usage,select on sequence public.ivx_candidate_phase_failures_id_seq to service_role;
create policy candidate_backend_leases on public.ivx_candidate_leases
  for all to service_role using (true) with check (true);
create policy candidate_backend_lessons_read on public.ivx_candidate_lessons
  for select to service_role using (true);
create policy candidate_backend_lessons_insert on public.ivx_candidate_lessons
  for insert to service_role with check (true);
create policy candidate_backend_failures_read on public.ivx_candidate_phase_failures
  for select to service_role using (true);
create policy candidate_backend_failures_insert on public.ivx_candidate_phase_failures
  for insert to service_role with check (true);

create function public.ivx_candidate_acquire(
  p_event_id text,p_owner_id text,p_version integer,p_token uuid,p_ttl_ms integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  lease public.ivx_candidate_leases%rowtype;
begin
  if p_event_id is null or length(p_event_id)>255 or p_event_id !~ '[^[:space:]]'
      or p_owner_id is null or length(p_owner_id)>255 or p_owner_id !~ '[^[:space:]]'
      or p_token is null then
    return jsonb_build_object('acquired',false,'errorType','INVALID_IDENTITY');
  end if;
  if p_version is null or p_version<0 then
    return jsonb_build_object('acquired',false,'errorType','INVALID_VERSION');
  end if;
  if p_ttl_ms is null or p_ttl_ms<1 or p_ttl_ms>300000 then
    return jsonb_build_object('acquired',false,'errorType','INVALID_TTL');
  end if;
  -- A retained candidate stays terminal even if an administrator prunes its lease.
  if exists(select 1 from public.ivx_candidate_lessons where event_id=p_event_id) then
    return jsonb_build_object('acquired',false,'errorType','EVENT_ALREADY_COMPLETED_IMMUTABLE');
  end if;
  insert into public.ivx_candidate_leases as current
    (event_id,owner_id,version,token,expires_at)
    values(p_event_id,p_owner_id,p_version,p_token,clock_timestamp()+p_ttl_ms*interval '1 millisecond')
  on conflict(event_id) do update set
    owner_id=excluded.owner_id,version=excluded.version,token=excluded.token,
    expires_at=clock_timestamp()+p_ttl_ms*interval '1 millisecond'
  where current.completed_at is null and current.version<=p_version
    and (current.expires_at<=clock_timestamp() or current.version<p_version)
  returning * into lease;
  if found then
    return jsonb_build_object('acquired',true,'token',lease.token,
      'version',lease.version,'expiresAt',lease.expires_at);
  end if;
  select * into lease from public.ivx_candidate_leases where event_id=p_event_id;
  return jsonb_build_object('acquired',false,'errorType',case
    when lease.completed_at is not null then 'EVENT_ALREADY_COMPLETED_IMMUTABLE'
    when lease.version>p_version then 'STALE_VERSION'
    else 'LEASE_HELD_BY_ANOTHER_ACTIVE_WORKER' end);
end;
$$;

create function public.ivx_candidate_save(p_candidate jsonb,p_owner_id text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  lease public.ivx_candidate_leases%rowtype;
  saved public.ivx_candidate_lessons%rowtype;
  field text;
  candidate_version integer;
  root_text text;
  hypothesis_text text;
  candidate_sha text;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' then
    return jsonb_build_object('success',false,'errorType','INVALID_CANDIDATE');
  end if;
  if (p_candidate-array['eventId','agentId','taskType','rootCause','hypothesis','gitSha','version'])<>'{}'::jsonb then
    return jsonb_build_object('success',false,'errorType','INVALID_CANDIDATE');
  end if;
  foreach field in array array['eventId','agentId','taskType','rootCause','hypothesis','gitSha'] loop
    if jsonb_typeof(p_candidate->field) is distinct from 'string'
        or (p_candidate->>field) !~ '[^[:space:]]'
        or length(p_candidate->>field)>(case when field in ('rootCause','hypothesis') then 16000 else 255 end) then
      return jsonb_build_object('success',false,'errorType','INVALID_CANDIDATE');
    end if;
  end loop;
  if jsonb_typeof(p_candidate->'version') is distinct from 'number'
      or (p_candidate->>'version') !~ '^(0|[1-9][0-9]{0,9})$' then
    return jsonb_build_object('success',false,'errorType','INVALID_VERSION');
  end if;
  if (p_candidate->>'version')::numeric>2147483647 then
    return jsonb_build_object('success',false,'errorType','INVALID_VERSION');
  end if;
  candidate_version := (p_candidate->>'version')::integer;
  candidate_sha := lower(p_candidate->>'gitSha');
  if candidate_sha !~ '^[0-9a-f]{40}$' then
    return jsonb_build_object('success',false,'errorType','INVALID_GIT_SHA_FORMAT');
  end if;
  if p_owner_id is null or length(p_owner_id)>255 or p_owner_id !~ '[^[:space:]]' or p_token is null then
    return jsonb_build_object('success',false,'errorType','INVALID_IDENTITY');
  end if;
  root_text := btrim(p_candidate->>'rootCause',E' \t\n\r');
  hypothesis_text := btrim(p_candidate->>'hypothesis',E' \t\n\r');
  select * into lease from public.ivx_candidate_leases
    where event_id=p_candidate->>'eventId' for update;
  if not found then
    return jsonb_build_object('success',false,'errorType','LEASE_NOT_FOUND');
  end if;
  if lease.owner_id<>p_owner_id or lease.token<>p_token or lease.version<>candidate_version then
    return jsonb_build_object('success',false,'errorType','AUTHORIZATION_OR_VERSION_MISMATCH');
  end if;
  select * into saved from public.ivx_candidate_lessons where event_id=lease.event_id;
  if found then
    if lease.completed_at is not null and saved.agent_id=p_candidate->>'agentId'
        and saved.task_type=p_candidate->>'taskType' and saved.root_cause=root_text
        and saved.hypothesis=hypothesis_text and saved.git_sha=candidate_sha
        and saved.version=candidate_version then
      return jsonb_build_object('success',true,'duplicate',true);
    end if;
    return jsonb_build_object('success',false,'errorType','CANDIDATE_ALREADY_COMMITTED_IMMUTABLE');
  end if;
  if lease.completed_at is not null then
    return jsonb_build_object('success',false,'errorType','COMPLETED_EVIDENCE_MISSING');
  end if;
  if lease.expires_at<=clock_timestamp() then
    return jsonb_build_object('success',false,'errorType','LEASE_EXPIRED');
  end if;
  begin
    insert into public.ivx_candidate_lessons
      (event_id,agent_id,task_type,root_cause,hypothesis,git_sha,version)
      values(lease.event_id,p_candidate->>'agentId',p_candidate->>'taskType',
        root_text,hypothesis_text,candidate_sha,candidate_version)
      on conflict(event_id) do nothing;
    if not found then
      return jsonb_build_object('success',false,'errorType','CANDIDATE_ALREADY_COMMITTED_IMMUTABLE');
    end if;
    -- Recheck the DB clock after any insert/index/trigger wait. Raising here
    -- rolls back the insert in this subtransaction before returning a failure.
    update public.ivx_candidate_leases set completed_at=clock_timestamp()
      where event_id=lease.event_id and owner_id=p_owner_id and token=p_token
        and version=candidate_version and completed_at is null and expires_at>clock_timestamp();
    if not found then raise exception 'LEASE_EXPIRED_BEFORE_COMMIT' using errcode='P0001'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm='LEASE_EXPIRED_BEFORE_COMMIT' then
      return jsonb_build_object('success',false,'errorType','LEASE_EXPIRED');
    end if;
    raise;
  end;
  return jsonb_build_object('success',true,'duplicate',false);
end;
$$;

create function public.ivx_candidate_record_failure(p_event_id text,p_phase text,p_reason text,p_attempt integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare failure_id bigint;
begin
  if p_event_id is null or length(p_event_id)>255 or p_event_id !~ '[^[:space:]]'
      or p_phase is null or p_phase !~ '^[A-Z][A-Z0-9_]{0,99}$'
      or p_reason is null or p_reason !~ '^[A-Z][A-Z0-9_]{0,99}$'
      or p_attempt is null or p_attempt<0 then
    return jsonb_build_object('success',false,'errorType','INVALID_FAILURE');
  end if;
  insert into public.ivx_candidate_phase_failures(event_id,phase,reason,attempt)
    values(p_event_id,p_phase,p_reason,p_attempt) returning id into failure_id;
  return jsonb_build_object('success',true,'failureId',failure_id::text);
end;
$$;
revoke all on function public.ivx_candidate_acquire(text,text,integer,uuid,integer),
  public.ivx_candidate_save(jsonb,text,uuid),public.ivx_candidate_record_failure(text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.ivx_candidate_acquire(text,text,integer,uuid,integer),
  public.ivx_candidate_save(jsonb,text,uuid),public.ivx_candidate_record_failure(text,text,text,integer)
  to service_role;
