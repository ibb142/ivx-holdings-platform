import { getMissionSchedulerStatus, type MissionSchedulerState } from '../services/ivx-autonomous-intelligence-mission-scheduler';

export function autonomousIntelligenceMissionSchedulerOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function handleAutonomousIntelligenceMissionSchedulerGet(_request: Request): Promise<Response> {
  const status = await getMissionSchedulerStatus();
  const state: MissionSchedulerState = status.state;

  return new Response(
    JSON.stringify({
      ok: status.ok,
      marker: status.marker,
      schedulerJobId: status.schedulerJobId,
      missionJobId: status.missionJobId,
      startedAt: state.startedAt,
      deploySha: state.deploySha,
      status: state.status,
      stage: state.stage,
      progressPercent: state.progressPercent,
      stageDetail: state.stageDetail,
      inspectedFiles: state.inspectedFiles.slice(0, 50),
      changedFiles: state.changedFiles.slice(0, 50),
      commitSha: state.commitSha,
      prNumber: state.prNumber,
      prUrl: state.prUrl,
      prMerged: state.prMerged,
      prMergeCommitSha: state.prMergeCommitSha,
      deployId: state.deployId,
      liveCommit: state.liveCommit,
      healthOk: state.healthOk,
      completedAt: state.completedAt,
      error: state.error,
      workerResult: status.workerResult
        ? {
            jobId: status.workerResult.jobId,
            goal: status.workerResult.goal,
            ok: status.workerResult.ok,
            testsRun: status.workerResult.testsRun,
            testsPassed: status.workerResult.testsPassed,
            typecheckRun: status.workerResult.typecheckRun,
            typecheckPassed: status.workerResult.typecheckPassed,
            commitCreated: status.workerResult.commitCreated,
            commitSha: status.workerResult.commitSha,
            prNumber: status.workerResult.prNumber,
            prUrl: status.workerResult.prUrl,
            prMerged: status.workerResult.prMerged,
            prMergeCommitSha: status.workerResult.prMergeCommitSha,
            deployId: status.workerResult.deployId,
            deployVerified: status.workerResult.deployVerified,
            liveCommit: status.workerResult.liveCommit,
            healthOk: status.workerResult.healthOk,
            finalStatus: status.workerResult.finalStatus,
            filesInspected: (status.workerResult.filesInspected ?? []).slice(0, 50),
            changedFiles: status.workerResult.changedFiles.slice(0, 50),
            generatedAt: status.workerResult.generatedAt,
            evidenceFingerprint: status.workerResult.evidenceFingerprint,
          }
        : null,
      updatedAt: state.updatedAt,
      secretValuesReturned: false,
    }, null, 2),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
