import { runRecoveryDrill } from '../services/ivx-recovery-drill';
runRecoveryDrill().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.overallPassed ? 0 : 1);
}).catch((err) => {
    console.error('Drill crashed:', err);
    process.exit(1);
});
