import { performRealCertification } from './certification-utils';

export async function executeWorkerCertification(): Promise<void> {
  try {
    await performRealCertification('112-worker-certification');
    console.log('Certification executed successfully');
  } catch (error) {
    console.error('Certification execution failed', error);
    throw error;
  }
}
