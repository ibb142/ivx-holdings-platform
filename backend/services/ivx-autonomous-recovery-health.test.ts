import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { observedBetweenPatrols, recentPatrolAgents, type PatrolObservation } from './ivx-autonomous-recovery-health';
const sha = 'a'.repeat(40), now = Date.now();
function observation(status = 'PASS'): PatrolObservation {
  const summary = 'LANDING_P0_RESULT ' + JSON.stringify({v:1,agent_number:1,production_sha:sha,status,completed_at:new Date(now-1000).toISOString()});
  return {task_id:'task-1',assigned_agent_number:1,evidence:{evidenceId:'e',evidenceType:'production_verification',source:'continuous-patrol:unit',summary,contentHash:createHash('sha256').update(summary).digest('hex'),createdAt:new Date(now-500).toISOString(),commitSha:sha,deploymentId:null}};
}
test('completed PASS, FAIL and BLOCKED observations prove recent activity only',()=>{
  for(const status of ['PASS','FAIL','BLOCKED']) expect(recentPatrolAgents([observation(status)],sha,now).has(1)).toBe(true);
  const recent=recentPatrolAgents([observation()],sha,now);
  expect(observedBetweenPatrols({agentNumber:1,status:'IDLE',paused:false,disabled:false},recent)).toBe(true);
  for(const status of ['STALE','BLOCKED','UNKNOWN']) expect(observedBetweenPatrols({agentNumber:1,status,paused:false,disabled:false},recent)).toBe(false);
  expect(observedBetweenPatrols({agentNumber:1,status:'IDLE',paused:true,disabled:false},recent)).toBe(false);
});
test('stale, future, tampered, different-agent and different-commit evidence cannot suppress recovery',()=>{
  expect(recentPatrolAgents([observation()],sha,now+121000).size).toBe(0);
  expect(recentPatrolAgents([observation()],sha,now-2000).size).toBe(0);
  const tampered=observation();tampered.evidence!.summary+=' ';
  expect(recentPatrolAgents([tampered],sha,now).size).toBe(0);
  const different=observation();different.assigned_agent_number=2;
  expect(recentPatrolAgents([different],sha,now).size).toBe(0);
  expect(recentPatrolAgents([observation()],'b'.repeat(40),now).size).toBe(0);
});
