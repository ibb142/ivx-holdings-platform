/**
 * IVX Enterprise Master AI API (owner-only).
 *
 * Exposes the 112-agent enterprise registry, 2-hour reports, and
 * Enterprise Master AI governance endpoints.
 *
 *   GET /api/ivx/enterprise-master             → full enterprise overview
 *   GET /api/ivx/enterprise-master/agents      → all 112 agent summaries
 *   GET /api/ivx/enterprise-master/agents/:num → single agent detail
 *   GET /api/ivx/enterprise-master/division/:d → agents by division (A or B)
 *   GET /api/ivx/enterprise-master/company/:c  → agents by company
 *   GET /api/ivx/enterprise-master/report      → latest 2-hour report
 *   GET /api/ivx/enterprise-master/report/history → report history
 *   GET /api/ivx/enterprise-master/report/:id  → specific report
 *   GET /api/ivx/enterprise-master/validate    → registry validation
 *   POST /api/ivx/enterprise-master/report/generate → manually trigger report
 *
 * Owner-only. Every figure is derived from real registry/report data.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  ALL_ENTERPRISE_AGENTS,
  ENTERPRISE_COMPANIES,
  getAgentById,
  getAgentByNumber,
  getAgentsByCompany,
  getAgentsByDivision,
  getEnterpriseAgentSummaries,
  generateEnterpriseMasterReport,
  validateEnterpriseMasterRegistry,
  type CompanyId,
  type DivisionId,
} from '../services/ivx-enterprise-master-registry';
import {
  generateEnterpriseReport,
  getLatestEnterpriseReport,
  getEnterpriseReportHistory,
  getEnterpriseReportById,
  getReportSchedulerStatus,
} from '../services/ivx-enterprise-reporting';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<Response | null> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
    const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
}

type RouteMatch = {
  handler: (request: Request, params: Record<string, string>) => Promise<Response>;
  params: Record<string, string>;
};

function matchRoute(pathname: string): RouteMatch | null {
  const segments = pathname.replace(/^\/api\/ivx\/enterprise-master\/?/, '').split('/').filter(Boolean);

  // GET /api/ivx/enterprise-master
  if (segments.length === 0) {
    return { handler: handleOverview, params: {} };
  }

  const [first, second, third] = segments;

  if (first === 'agents' && !second) {
    return { handler: handleAllAgents, params: {} };
  }

  if (first === 'agents' && second) {
    const num = parseInt(second, 10);
    if (!isNaN(num)) {
      return { handler: handleAgentByNumber, params: { num: second } };
    }
    return { handler: handleAgentById, params: { id: second } };
  }

  if (first === 'division' && second) {
    return { handler: handleAgentsByDivision, params: { division: second } };
  }

  if (first === 'company' && second) {
    return { handler: handleAgentsByCompany, params: { company: second } };
  }

  if (first === 'report' && !second) {
    return { handler: handleLatestReport, params: {} };
  }

  if (first === 'report' && second === 'history' && !third) {
    return { handler: handleReportHistory, params: {} };
  }

  if (first === 'report' && second === 'generate' && !third) {
    return { handler: handleGenerateReport, params: {} };
  }

  if (first === 'report' && second) {
    return { handler: handleReportById, params: { reportId: second } };
  }

  if (first === 'validate' && !second) {
    return { handler: handleValidate, params: {} };
  }

  if (first === 'scheduler' && !second) {
    return { handler: handleSchedulerStatus, params: {} };
  }

  if (first === 'companies' && !second) {
    return { handler: handleAllCompanies, params: {} };
  }

  return null;
}

export async function handleEnterpriseMasterRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const match = matchRoute(url.pathname);
  if (!match) {
    return ownerOnlyJson({ ok: false, error: 'Enterprise master route not found.' }, 404);
  }

  return match.handler(request, match.params);
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleOverview(_request: Request, _params: Record<string, string>): Promise<Response> {
  const validation = validateEnterpriseMasterRegistry();
  const report = await getLatestEnterpriseReport();
  const schedulerStatus = getReportSchedulerStatus();
  const divisionA = getAgentsByDivision('A');
  const divisionB = getAgentsByDivision('B');

  const companies = (Object.keys(ENTERPRISE_COMPANIES) as CompanyId[]).map((id) => {
    const c = ENTERPRISE_COMPANIES[id];
    const agents = getAgentsByCompany(id);
    return {
      id: c.id,
      name: c.name,
      division: c.division,
      description: c.description,
      agentCount: agents.length,
      repositoryPattern: c.repositoryPattern,
      independentInfrastructure: c.independentInfrastructure,
    };
  });

  return ownerOnlyJson({
    ok: true,
    enterprise: {
      totalAgents: ALL_ENTERPRISE_AGENTS.length,
      divisionA: { id: 'A' as DivisionId, name: 'IVX Holdings', agentCount: divisionA.length },
      divisionB: { id: 'B' as DivisionId, name: 'New Enterprises', agentCount: divisionB.length },
      companies,
      validation: {
        valid: validation.valid,
        totalAgents: validation.totalAgents,
        issues: validation.issues,
      },
      latestReport: report
        ? {
            reportId: report.reportId,
            generatedAt: report.generatedAt,
            executiveSummary: report.executiveSummary,
            agentCoverage: report.agentCoverage,
          }
        : null,
      reportScheduler: schedulerStatus,
    },
  });
}

async function handleAllAgents(_request: Request, _params: Record<string, string>): Promise<Response> {
  const summaries = getEnterpriseAgentSummaries();
  return ownerOnlyJson({
    ok: true,
    totalAgents: summaries.length,
    agents: summaries,
  });
}

async function handleAgentByNumber(_request: Request, params: Record<string, string>): Promise<Response> {
  const num = parseInt(params.num, 10);
  const agent = getAgentByNumber(num);
  if (!agent) {
    return ownerOnlyJson({ ok: false, error: `Agent #${num} not found.` }, 404);
  }
  return ownerOnlyJson({ ok: true, agent });
}

async function handleAgentById(_request: Request, params: Record<string, string>): Promise<Response> {
  const agent = getAgentById(params.id);
  if (!agent) {
    return ownerOnlyJson({ ok: false, error: `Agent '${params.id}' not found.` }, 404);
  }
  return ownerOnlyJson({ ok: true, agent });
}

async function handleAgentsByDivision(_request: Request, params: Record<string, string>): Promise<Response> {
  const div = params.division.toUpperCase() as DivisionId;
  if (div !== 'A' && div !== 'B') {
    return ownerOnlyJson({ ok: false, error: 'Division must be A or B.' }, 400);
  }
  const agents = getAgentsByDivision(div);
  return ownerOnlyJson({
    ok: true,
    division: div,
    name: div === 'A' ? 'IVX Holdings' : 'New Enterprises',
    totalAgents: agents.length,
    agents,
  });
}

async function handleAgentsByCompany(_request: Request, params: Record<string, string>): Promise<Response> {
  const companyId = params.company as CompanyId;
  if (!ENTERPRISE_COMPANIES[companyId]) {
    return ownerOnlyJson({ ok: false, error: `Company '${companyId}' not found.` }, 404);
  }
  const agents = getAgentsByCompany(companyId);
  const company = ENTERPRISE_COMPANIES[companyId];
  return ownerOnlyJson({
    ok: true,
    company: {
      id: company.id,
      name: company.name,
      division: company.division,
      description: company.description,
      repositoryPattern: company.repositoryPattern,
      independentInfrastructure: company.independentInfrastructure,
    },
    totalAgents: agents.length,
    agents,
  });
}

async function handleLatestReport(_request: Request, _params: Record<string, string>): Promise<Response> {
  const report = await getLatestEnterpriseReport();
  if (!report) {
    return ownerOnlyJson({
      ok: true,
      report: null,
      message: 'No enterprise report generated yet. Use POST /report/generate to create one.',
    });
  }
  return ownerOnlyJson({ ok: true, report });
}

async function handleReportHistory(_request: Request, _params: Record<string, string>): Promise<Response> {
  const history = await getEnterpriseReportHistory(50);
  return ownerOnlyJson({ ok: true, history });
}

async function handleReportById(_request: Request, params: Record<string, string>): Promise<Response> {
  const report = await getEnterpriseReportById(params.reportId);
  if (!report) {
    return ownerOnlyJson({ ok: false, error: `Report '${params.reportId}' not found.` }, 404);
  }
  return ownerOnlyJson({ ok: true, report });
}

async function handleGenerateReport(_request: Request, _params: Record<string, string>): Promise<Response> {
  const report = await generateEnterpriseReport();
  return ownerOnlyJson({
    ok: true,
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    executiveSummary: report.executiveSummary,
    report,
  });
}

async function handleValidate(_request: Request, _params: Record<string, string>): Promise<Response> {
  const validation = validateEnterpriseMasterRegistry();
  return ownerOnlyJson({
    ok: true,
    valid: validation.valid,
    totalAgents: validation.totalAgents,
    issues: validation.issues,
    divisionA: getAgentsByDivision('A').length,
    divisionB: getAgentsByDivision('B').length,
    companies: (Object.keys(ENTERPRISE_COMPANIES) as CompanyId[]).length,
  });
}

async function handleSchedulerStatus(_request: Request, _params: Record<string, string>): Promise<Response> {
  const status = getReportSchedulerStatus();
  return ownerOnlyJson({ ok: true, scheduler: status });
}

async function handleAllCompanies(_request: Request, _params: Record<string, string>): Promise<Response> {
  const companies = (Object.keys(ENTERPRISE_COMPANIES) as CompanyId[]).map((id) => {
    const c = ENTERPRISE_COMPANIES[id];
    const agents = getAgentsByCompany(id);
    return {
      id: c.id,
      name: c.name,
      division: c.division,
      description: c.description,
      agentCount: agents.length,
      repositoryPattern: c.repositoryPattern,
      independentInfrastructure: c.independentInfrastructure,
    };
  });
  return ownerOnlyJson({ ok: true, totalCompanies: companies.length, companies });
}
