import { handleDeveloperProofV3 } from './ivx-developer-proof-v3';

describe('handleDeveloperProofV3', () => {
  it('should return the correct proof data', async () => {
    const mockContext = {
      json: jest.fn().mockReturnValue({}),
    };
    const response = await handleDeveloperProofV3(mockContext as any);
    expect(mockContext.json).toHaveBeenCalledWith({
      sha: process.env.RENDER_GIT_COMMIT ?? 'unknown',
      workerVersion: 'v6.16',
      deployStatus: 'live',
      timestamp: expect.any(String),
    });
  });
});
