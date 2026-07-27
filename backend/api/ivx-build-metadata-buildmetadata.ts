import { listBuildmetadatas, createBuildmetadata } from '../services/ivx-build-metadata-buildmetadata-store';

export async function handleBuildmetadataList(): Promise<Response> {
  const buildmetadatas = await listBuildmetadatas();
  return Response.json({ ok: true, buildmetadatas });
}

export async function handleBuildmetadataCreate(request: Request): Promise<Response> {
  const body = await request.json();
  const created = await createBuildmetadata(body);
  return Response.json({ ok: true, created }, { status: 201 });
}
