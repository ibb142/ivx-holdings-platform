import { randomUUID } from 'node:crypto';
import { getWorkerPool } from './ivx-database-pools';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';

export interface CandidateLesson {
  eventId: string;
  agentId: string;
  taskType: string;
  rootCause: string;
  hypothesis: string;
  gitSha: string;
  version: number;
}

type DatabaseFailure = { errorType: string; sqlState?: string; outcomeUnknown?: boolean };
export type CandidateAcquisition = { acquired: true; token: string; version: number; expiresAt: string }
  | ({ acquired: false } & DatabaseFailure);
export type CandidateSave = { success: true; duplicate: boolean } | ({ success: false } & DatabaseFailure);
export type CandidateFailureRecord = { success: true; failureId: string } | ({ success: false } & DatabaseFailure);
export type CandidateQuery = (sql: string, values: unknown[]) => Promise<{ rows: Array<{ result: unknown }> }>;

const MAX_TTL_MS = 300_000;
const validInt = (v: unknown): v is number => Number.isInteger(v) && Number(v)>=0 && Number(v)<=2_147_483_647;
const validText = (v: unknown, max=255): v is string => typeof v==='string' && v.trim().length>0 && v.length<=max && !v.includes('\0');
const validToken = (v: unknown): v is string => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const validCode = (v: unknown): v is string => typeof v==='string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(v);

const productionQuery: CandidateQuery = (sql, values) =>
  queryWithPostgresDeadline<{result: unknown}>(getWorkerPool(process.env,'repair'),sql,values,'assignment');

function databaseFailure(error: unknown): DatabaseFailure {
  // Never return provider error messages, bound values, SQL, or credentials.
  if (error instanceof Error && error.message==='direct_postgres_not_configured') {
    return {errorType:'CANDIDATE_DATABASE_NOT_CONFIGURED',outcomeUnknown:false};
  }
  const code=error && typeof error==='object' && 'code' in error ? error.code : undefined;
  const sqlState=typeof code==='string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  const transportFailure=!sqlState || sqlState.startsWith('08') || ['57P01','57P02','57P03'].includes(sqlState);
  return {errorType:transportFailure?'CANDIDATE_DATABASE_OUTCOME_UNKNOWN':'CANDIDATE_DATABASE_REJECTED',
    ...(sqlState?{sqlState}:{}),outcomeUnknown:transportFailure};
}

/** Direct pg adapter. A shared bounded worker pool owns connection lifecycle;
 * PostgreSQL owns row locks, its clock, and the complete atomic mutation.
 * No automatic retry follows a possibly committed operation. */
export function createCandidateStore(query: CandidateQuery = productionQuery) {
  async function rpc<T>(sql: string, values: unknown[], flag: 'acquired'|'success'): Promise<T> {
    const result=(await query(sql,values)).rows[0]?.result;
    if (!result || typeof result!=='object' || typeof (result as Record<string,unknown>)[flag]!=='boolean') {
      throw new Error('CANDIDATE_DATABASE_RESPONSE_INVALID');
    }
    const r=result as Record<string,unknown>;
    if (r[flag]===false && !validCode(r.errorType)) throw new Error('CANDIDATE_DATABASE_RESPONSE_INVALID');
    if (r[flag]===true && (flag==='acquired'
      ? !validToken(r.token)||!validInt(r.version)||typeof r.expiresAt!=='string'||!Number.isFinite(Date.parse(r.expiresAt))
      : typeof r.duplicate!=='boolean' && !(typeof r.failureId==='string' && /^[0-9]+$/.test(r.failureId)))) {
      throw new Error('CANDIDATE_DATABASE_RESPONSE_INVALID');
    }
    return result as T;
  }
  return {
    async acquireLock(eventId: string, ownerId: string, currentVersion: number, ttlMs: number): Promise<CandidateAcquisition> {
      if (!validText(eventId)||!validText(ownerId)) return {acquired:false,errorType:'INVALID_IDENTITY'};
      if (!validInt(currentVersion)) return {acquired:false,errorType:'INVALID_VERSION'};
      if (!validInt(ttlMs)||ttlMs<1||ttlMs>MAX_TTL_MS) return {acquired:false,errorType:'INVALID_TTL'};
      try {
        return await rpc<CandidateAcquisition>('select public.ivx_candidate_acquire($1,$2,$3,$4::uuid,$5) as result',
          [eventId,ownerId,currentVersion,randomUUID(),ttlMs],'acquired');
      } catch(error) { return {acquired:false,...databaseFailure(error)}; }
    },
    async saveCandidateWithLease(candidate: CandidateLesson, ownerId: string, token: string): Promise<CandidateSave> {
      if (!candidate || !validText(candidate.eventId)||!validText(candidate.agentId)||!validText(candidate.taskType)
          ||!validText(candidate.rootCause,16000)||!validText(candidate.hypothesis,16000)) {
        return {success:false,errorType:'INVALID_CANDIDATE'};
      }
      if (!validInt(candidate.version)) return {success:false,errorType:'INVALID_VERSION'};
      if (typeof candidate.gitSha!=='string'||!/^[a-f0-9]{40}$/i.test(candidate.gitSha)) {
        return {success:false,errorType:'INVALID_GIT_SHA_FORMAT'};
      }
      if (!validText(ownerId)||!validToken(token)) return {success:false,errorType:'INVALID_IDENTITY'};
      const normalized: CandidateLesson={eventId:candidate.eventId,agentId:candidate.agentId,taskType:candidate.taskType,
        rootCause:candidate.rootCause.trim(),hypothesis:candidate.hypothesis.trim(),gitSha:candidate.gitSha.toLowerCase(),version:candidate.version};
      try {
        return await rpc<CandidateSave>('select public.ivx_candidate_save($1::jsonb,$2,$3::uuid) as result',
          [JSON.stringify(normalized),ownerId,token],'success');
      } catch(error) { return {success:false,...databaseFailure(error)}; }
    },
    async recordPhaseFailure(eventId: string, phase: string, reason: string, attempt: number): Promise<CandidateFailureRecord> {
      if (!validText(eventId)||!validCode(phase)||!validCode(reason)||!validInt(attempt)) {
        return {success:false,errorType:'INVALID_FAILURE'};
      }
      try {
        return await rpc<CandidateFailureRecord>('select public.ivx_candidate_record_failure($1,$2,$3,$4) as result',
          [eventId,phase,reason,attempt],'success');
      } catch(error) { return {success:false,...databaseFailure(error)}; }
    },
  };
}

const productionStore=createCandidateStore();
export class CandidateStore {
  static acquireLock=productionStore.acquireLock;
  static saveCandidateWithLease=productionStore.saveCandidateWithLease;
  static recordPhaseFailure=productionStore.recordPhaseFailure;
}
