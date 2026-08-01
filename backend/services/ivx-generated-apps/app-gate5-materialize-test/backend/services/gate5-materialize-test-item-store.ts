import type { Item } from '../types/gate5-materialize-test-item';

export async function listItems(): Promise<Item[]> {
  return [];
}

export async function createItem(input: Omit<Item, 'id'>): Promise<Item> {
  return { id: crypto.randomUUID(), ...input } as Item;
}
