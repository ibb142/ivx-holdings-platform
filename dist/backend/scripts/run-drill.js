import 'node:process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
// Load env from expo/.env
const envText = await fs.readFile(path.resolve(process.cwd(), 'expo/.env'), 'utf8');
for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[2])
        process.env[m[1]] = m[2];
}
const { runRecoveryDrill } = await import(path.resolve(process.cwd(), 'backend/services/ivx-recovery-drill.ts'));
const report = await runRecoveryDrill();
console.log(JSON.stringify(report, null, 2));
