import { handleAutonomousProofRequest } from '../api/ivx-autonomous-proof';

async function runTests() {
  console.log('Running proof_verifier tests...');

  try {
    const fakeRequest = new Request('https://fakeurl.com', { method: 'GET' });
    const response = await handleAutonomousProofRequest(fakeRequest);

    if (!response.ok) {
      console.error('FAIL: Request did not succeed');
    } else {
      console.log('PASS: Request succeeded');
    }

    const data = await response.json();
    if (typeof data !== 'object' || data.verified !== false) {
      console.error('FAIL: Data does not meet expected conditions');
    } else {
      console.log('PASS: Data is correctly formed');
    }
  } catch (err) {
    console.error('ERROR in running tests', err);
  }
}

runTests();