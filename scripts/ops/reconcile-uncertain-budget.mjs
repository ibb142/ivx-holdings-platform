import { runBudgetReconciliationCli } from './reconcile-uncertain-budget-cli.mjs';

// Manual operation only: no cron, task-state rewrite, or public HTTP endpoint.
process.exitCode = await runBudgetReconciliationCli();
