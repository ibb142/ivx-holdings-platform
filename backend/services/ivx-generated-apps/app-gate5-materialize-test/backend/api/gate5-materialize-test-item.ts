import { listItems, createItem } from '../services/gate5-materialize-test-item-store';

export async function handleItemList(): Promise<Response> {
  const items = await listItems();
  return Response.json({ ok: true, items });
}

export async function handleItemCreate(request: Request): Promise<Response> {
  const body = await request.json();
  const created = await createItem(body);
  return Response.json({ ok: true, created }, { status: 201 });
}
