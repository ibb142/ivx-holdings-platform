import { describe, expect, it } from 'bun:test';
import {
  classifyMutationRisk,
  isAutonomousMutationTool,
  isOwnerGatedCodePath,
  isProtectedAutonomousBranch,
} from './ivx-agent-autonomous-mutation-tools';

describe('IVX autonomous low-risk mutation policy', () => {
  it('allows normal application source writes without a human gate', () => {
    expect(classifyMutationRisk('code_write', {
      path: 'expo/components/HomeCard.tsx',
      content: 'export const HomeCard = () => null;',
    })).toEqual({
      autonomous: true,
      risk: 'low',
      reason: 'low_risk_application_code',
      sensitivePaths: [],
    });
  });

  it('keeps auth, payments, migrations, CI, infrastructure and security owner-gated', () => {
    const paths = [
      'backend/auth/session.ts',
      'backend/services/payments.ts',
      'supabase/migrations/20260823_change_rls.sql',
      '.github/workflows/deploy.yml',
      'backend/security/permissions.ts',
      'infra/terraform/main.tf',
      'server.ts',
      'backend/services/ivx-agent-real-tools.ts',
    ];
    for (const path of paths) {
      expect(isOwnerGatedCodePath(path)).toBe(true);
      expect(classifyMutationRisk('code_write', { path, content: 'x' }).autonomous).toBe(false);
    }
  });

  it('allows commit only when every requested path is low-risk', () => {
    expect(classifyMutationRisk('git_commit', {
      files: ['expo/components/HomeCard.tsx', 'expo/lib/home-feed.ts'],
    }).autonomous).toBe(true);

    const blocked = classifyMutationRisk('git_commit', {
      files: ['expo/components/HomeCard.tsx', 'backend/auth/session.ts'],
    });
    expect(blocked.autonomous).toBe(false);
    expect(blocked.sensitivePaths).toContain('backend/auth/session.ts');
  });

  it('allows autonomous push to work branches but never protected branches', () => {
    expect(isProtectedAutonomousBranch('main')).toBe(true);
    expect(isProtectedAutonomousBranch('production')).toBe(true);
    expect(isProtectedAutonomousBranch('release/v1.2.3')).toBe(true);
    expect(isProtectedAutonomousBranch('autonomous/fix-home-black-screen')).toBe(false);

    expect(classifyMutationRisk('git_push', {
      branch: 'autonomous/fix-home-black-screen',
    }).autonomous).toBe(true);
    expect(classifyMutationRisk('git_push', { branch: 'main' }).autonomous).toBe(false);
  });

  it('never autonomously deploys production', () => {
    expect(classifyMutationRisk('deploy', { mode: 'trigger' }).autonomous).toBe(false);
    expect(classifyMutationRisk('deploy_to_production', {}).autonomous).toBe(false);
  });

  it('exposes only the four non-production autonomous mutation tools', () => {
    expect(isAutonomousMutationTool('code_write')).toBe(true);
    expect(isAutonomousMutationTool('code_patch_proposal')).toBe(true);
    expect(isAutonomousMutationTool('git_commit')).toBe(true);
    expect(isAutonomousMutationTool('git_push')).toBe(true);
    expect(isAutonomousMutationTool('deploy')).toBe(false);
  });
});
