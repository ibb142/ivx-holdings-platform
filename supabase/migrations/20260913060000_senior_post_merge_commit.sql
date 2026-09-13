-- Additive RPC: never alter owner approvals, task states, budget or media data.
set local lock_timeout = '2s';
set local statement_timeout = '8s';
create or replace function public.ivx_senior_post_merge_commit(p_expected jsonb, p_next jsonb)
returns void language plpgsql security invoker set search_path = '' set lock_timeout = '1s' as $$
declare
  v_checkpoint jsonb := p_expected->'result'->'postMergeVerification';
begin
  if p_expected is null or p_next is null
    or p_expected->>'status' is distinct from 'completed'
    or p_expected->'input'->>'executionMode' is distinct from 'code_change'
    or p_expected->'input'->>'ownerApproved' is distinct from 'true'
    or p_expected->'result'->>'prMerged' is distinct from 'true'
    or coalesce(p_expected->'result'->>'prMergeCommitSha','') !~ '^[a-fA-F0-9]{40}$'
    or (p_next - 'result') is distinct from (p_expected - 'result')
    or p_next->'result'->>'jobId' is distinct from p_expected->>'jobId'
    or p_next->'result'->>'prMergeCommitSha' is distinct from p_expected->'result'->>'prMergeCommitSha'
    or v_checkpoint->>'expectedSha' is distinct from p_expected->'result'->>'prMergeCommitSha'
    or nullif(v_checkpoint->>'leaseToken','') is null
    or coalesce((v_checkpoint->>'leaseExpiresAt')::timestamptz,'-infinity') <= clock_timestamp()
  then raise exception using errcode='55000', message='Post-merge observation lost its terminal job lease'; end if;

  -- Exact preimage CAS and canonical ledger update share this transaction.
  -- A timeout, stale replica, cancellation or ledger failure cannot seal one side.
  perform public.ivx_senior_queue_patch(jsonb_build_array(jsonb_build_object(
    'expected',p_expected,'next',p_next,'workerInstanceId',null)));
  perform public.ivx_senior_ledger_put(p_next->'result');
end;
$$;
revoke execute on function public.ivx_senior_post_merge_commit(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ivx_senior_post_merge_commit(jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
