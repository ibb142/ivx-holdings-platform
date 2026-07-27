import type { Buildmetadata } from '../types/ivx-build-metadata-buildmetadata';

export async function listBuildmetadatas(): Promise<Buildmetadata[]> {
  return [];
}

export async function createBuildmetadata(input: Omit<Buildmetadata, 'id'>): Promise<Buildmetadata> {
  return { id: crypto.randomUUID(), ...input } as Buildmetadata;
}