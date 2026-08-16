import { describe, it, expect } from 'vitest';
import { handleRoomsGet, handleMessagesGet, handleUploadPost } from '../api/owner-routes';

// Mock implementations and context here


describe('Owner Routes', () => {
  it('should handle rooms GET correctly', async () => {
    // Mock the request and context here
    const request = new Request('https://example.com/rooms');
    const response = await handleRoomsGet(request);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.rooms).toHaveLength(1);
  });

  it('should handle messages GET with limits', async () => {
    const request = new Request('https://example.com/messages?limit=10');
    const response = await handleMessagesGet(request);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.messages).toHaveLength(10);
  });

  it('should handle upload POST correctly', async () => {
    const request = new Request('https://example.com/upload', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'testfile.txt', mimeType: 'text/plain' }),
    });
    const response = await handleUploadPost(request);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.signedUploadUrl).toBeDefined();
  });
});
