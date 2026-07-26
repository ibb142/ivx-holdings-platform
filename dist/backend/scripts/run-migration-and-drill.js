/**
 * IVX Zero Data Loss — Local Migration + Drill Runner
 *
 * Runs the SQL migration directly against Supabase using the pg package,
 * then runs the recovery drill, and outputs a final proof JSON.
 *
 * Usage: bun run backend/scripts/run-migration-and-drill.ts
 */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
// ── Extract clean credentials from expo/.env ─────────────────────────────────
function extractFromEnv() {
    const envContent = readFileSync(path.resolve(process.cwd(), 'expo', '.env'), 'utf8');
    const supaUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co';
    // Service role key — extract the JWT that starts with eyJ
    const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=.*?(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    const supaKey = keyMatch ? keyMatch[1] : '';
    // Owner token — extract 64-char hex
    const tokenMatch = envContent.match(/IVX_OWNER_TOKEN=.*?([a-f0-9]{64})/);
    const ownerToken = tokenMatch ? tokenMatch[1] : '';
    return { supaUrl, supaKey, ownerToken };
}
async function main() {
    const { supaUrl, supaKey, ownerToken } = extractFromEnv();
    if (!supaKey) {
        console.error('ERROR: Could not extract SUPABASE_SERVICE_ROLE_KEY from expo/.env');
        process.exit(1);
    }
    console.log('=== IVX Zero Data Loss — Migration + Drill ===');
    console.log(`Supabase URL: ${supaUrl}`);
    console.log(`Key length: ${supaKey.length}`);
    console.log(`Owner token: ${ownerToken ? 'found' : 'missing'}`);
    console.log('');
    // ── Step 1: Run SQL migration via pg ─────────────────────────────────────
    console.log('Step 1: Running SQL migration...');
    // We need the DB password. Try to get it from the Supabase dashboard API
    // or use the direct connection. Since we don't have the DB password directly,
    // we'll use the REST API to create the data_vault table via a workaround.
    // Actually, let's try using the pg module with the pool connection string
    // built from the project ref.
    const projectRef = 'kvclcdjmjghndxsngfzb';
    const dbHost = `db.${projectRef}.supabase.co`;
    const dbPort = '5432';
    // Check if we have SUPABASE_DB_PASSWORD
    const envContent2 = readFileSync(path.resolve(process.cwd(), 'expo', '.env'), 'utf8');
    const dbPasswordMatch = envContent2.match(/SUPABASE_DB_PASSWORD=(.+?)(\n|$)/);
    const dbPassword = dbPasswordMatch ? dbPasswordMatch[1].trim() : '';
    if (dbPassword) {
        console.log(`  DB password found (length: ${dbPassword.length})`);
        const connStr = `postgres://postgres:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/postgres?sslmode=require`;
        try {
            const pg = (await import('pg'));
            const pool = new pg.Pool({
                connectionString: connStr,
                ssl: { rejectUnauthorized: false },
                max: 1,
                connectionTimeoutMillis: 15000,
            });
            const sqlPath = path.resolve(process.cwd(), 'expo', 'supabase', 'ivx-zero-data-loss-migration.sql');
            const sql = readFileSync(sqlPath, 'utf8');
            const client = await pool.connect();
            try {
                await client.query(sql);
                console.log('  ✓ Migration SQL executed successfully');
            }
            finally {
                client.release();
            }
            await pool.end();
        }
        catch (err) {
            console.error(`  ✗ Migration via pg failed: ${err instanceof Error ? err.message : 'unknown'}`);
            console.log('  Falling back to REST API method...');
        }
    }
    else {
        console.log('  No SUPABASE_DB_PASSWORD found, trying REST API...');
    }
    // ── Fallback: Create data_vault table via REST API (insert first row) ────
    // We can't do DDL via REST, but we can check if the table exists
    console.log('');
    console.log('Step 2: Verifying data_vault table exists...');
    const checkRes = await fetch(`${supaUrl}/rest/v1/data_vault?limit=1`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    if (checkRes.status === 404) {
        console.log('  data_vault table does NOT exist — cannot create via REST API.');
        console.log('  The migration endpoint must be deployed to Render first.');
        console.log('  Alternatively, run the SQL in the Supabase Dashboard SQL Editor.');
        console.log('');
        console.log('  SQL file: expo/supabase/ivx-zero-data-loss-migration.sql');
    }
    else if (checkRes.ok) {
        console.log('  ✓ data_vault table exists!');
    }
    else {
        console.log(`  data_vault check: HTTP ${checkRes.status}`);
    }
    // ── Step 3: Check soft-delete columns on members ─────────────────────────
    console.log('');
    console.log('Step 3: Checking soft-delete columns on members...');
    const colRes = await fetch(`${supaUrl}/rest/v1/members?select=member_id,deleted_at,deleted_by,delete_reason&limit=1`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    if (colRes.ok) {
        console.log('  ✓ members table has deleted_at, deleted_by, delete_reason columns');
    }
    else {
        const body = await colRes.text().catch(() => '');
        console.log(`  ✗ members soft-delete columns missing: HTTP ${colRes.status}`);
        console.log(`  ${body.slice(0, 200)}`);
    }
    // ── Step 4: Run recovery drill via live API (if deployed) ────────────────
    console.log('');
    console.log('Step 4: Running recovery drill...');
    if (ownerToken) {
        const drillRes = await fetch('https://api.ivxholding.com/api/ivx/restore-center/drill', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ownerToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (drillRes.ok) {
            const drillData = await drillRes.json();
            console.log(`  ✓ Drill passed: ${drillData.report.overallPassed}`);
            console.log(`  Steps: ${drillData.report.summary.passed}/${drillData.report.summary.total} passed`);
            for (const step of drillData.report.steps) {
                console.log(`    ${step.passed ? '✓' : '✗'} ${step.step}: ${step.detail}`);
            }
        }
        else if (drillRes.status === 404) {
            console.log('  Drill endpoint not deployed yet (404). Running drill locally...');
            // Run drill locally
            const { runRecoveryDrill } = await import('../services/ivx-recovery-drill');
            process.env.EXPO_PUBLIC_SUPABASE_URL = supaUrl;
            process.env.SUPABASE_SERVICE_ROLE_KEY = supaKey;
            const drillReport = await runRecoveryDrill();
            console.log(`  Drill overallPassed: ${drillReport.overallPassed}`);
            console.log(`  Steps: ${drillReport.summary.passed}/${drillReport.summary.total} passed`);
            for (const step of drillReport.steps) {
                console.log(`    ${step.passed ? '✓' : '✗'} ${step.step}: ${step.detail}`);
            }
            // Save drill report
            const drillPath = path.resolve(process.cwd(), 'backend', 'verification-proof', 'ivx-recovery-drill-live-2026-07-06.json');
            await writeFile(drillPath, JSON.stringify(drillReport, null, 2), 'utf8');
            console.log(`  Drill report saved to: ${drillPath}`);
        }
        else {
            console.log(`  Drill failed: HTTP ${drillRes.status}`);
            const body = await drillRes.text().catch(() => '');
            console.log(`  ${body.slice(0, 300)}`);
        }
    }
    else {
        console.log('  No owner token — skipping drill');
    }
    // ── Step 5: Generate final report ────────────────────────────────────────
    console.log('');
    console.log('Step 5: Generating final report...');
    process.env.EXPO_PUBLIC_SUPABASE_URL = supaUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = supaKey;
    const { generateDailyReport } = await import('../services/ivx-recovery-report');
    const report = await generateDailyReport();
    const reportPath = path.resolve(process.cwd(), 'backend', 'verification-proof', 'ivx-zero-data-loss-final-report-2026-07-06.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  Report saved to: ${reportPath}`);
    console.log(`  Recovery risk: ${report.recoveryRisk}`);
    console.log(`  Row counts:`);
    for (const rc of report.rowCounts) {
        console.log(`    ${rc.table}: ${rc.count ?? 'N/A'} ${rc.error ? `(${rc.error})` : ''}`);
    }
    console.log('');
    console.log('=== Done ===');
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
