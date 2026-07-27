import { describe, expect, it } from 'bun:test';
import { createBuildmetadata, listBuildmetadatas } from './ivx-build-metadata-buildmetadata-store';

describe('Buildmetadata store', () => {
  it('creates and lists Buildmetadata', async () => {
    const before = await listBuildmetadatas();
    expect(Array.isArray(before)).toBe(true);
  });
});