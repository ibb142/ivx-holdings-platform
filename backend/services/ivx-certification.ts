import { performIdentityTest } from '../utils/identity-tester';

export async function p3ControlTowerIdentityTest(): Promise<boolean> {
  try {
    const result = await performIdentityTest();
    return result === 'success';
  } catch (error) {
    console.error('Identity test failed:', error);
    return false;
  }
}
