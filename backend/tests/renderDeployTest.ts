import { handleIVXRenderDeployLatestRequest } from '../api/ivx-render-deploy-latest';

async function testRenderDeployment() {
  const mockRequest = new Request('https://example.com/deploy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'DEPLOY_IVX_LANDING_FULL' })
  });

  const response = await handleIVXRenderDeployLatestRequest(mockRequest);
  const result = await response.json();
  console.log('Test Result:', result);
}

testRenderDeployment().catch(console.error);
