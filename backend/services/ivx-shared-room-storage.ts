import type { ChatStorage } from '../chat-storage';
import type { ChatRoomMessage } from '../chat-types';

export function requireSharedState(): boolean { return process.env.IVX_REQUIRE_SHARED_STATE === 'true'; }
type Row = { id: string; room_id: string; username: string; text: string; source: ChatRoomMessage['source']; created_at: string };
const message = (r: Row): ChatRoomMessage => ({ id: r.id, roomId: r.room_id, username: r.username, text: r.text, source: r.source, createdAt: r.created_at });
export class SharedRoomStorage {
  constructor(private readonly local: ChatStorage, private readonly fetcher: typeof fetch = fetch) {}
  private async request(query: string, init: RequestInit = {}) {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Shared room history is unavailable');
    const response = await this.fetcher(`${url}/rest/v1/ivx_shared_room_messages?${query}`, { ...init, signal: AbortSignal.timeout(5000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation,count=exact' } });
    if (!response.ok) throw new Error(`Shared room history unavailable (HTTP ${response.status})`);
    return response;
  }
  async listMessages(roomId: string, limit: number): Promise<ChatRoomMessage[]> {
    if (!requireSharedState()) return this.local.listMessages(roomId, limit);
    const query = new URLSearchParams({ room_id: `eq.${roomId}`, select: '*', order: 'created_at.desc,id.desc', limit: String(Math.max(1, Math.min(200, limit))) });
    const rows = await (await this.request(query.toString())).json() as Row[];
    if (!Array.isArray(rows)) throw new Error('Invalid shared room history');
    return rows.reverse().map(message);
  }
  async createMessage(input: Pick<ChatRoomMessage, 'roomId' | 'username' | 'text' | 'source'>): Promise<ChatRoomMessage> {
    if (!requireSharedState()) return this.local.createMessage(input);
    const rows = await (await this.request('select=*', { method: 'POST', body: JSON.stringify({ room_id: input.roomId, username: input.username, text: input.text, source: input.source }) })).json() as Row[];
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Shared message persistence not confirmed');
    return message(rows[0]);
  }
  async getRoomMessageCount(roomId: string): Promise<number> {
    if (!requireSharedState()) return this.local.getRoomMessageCount(roomId);
    const response = await this.request(new URLSearchParams({ room_id: `eq.${roomId}`, select: 'id', limit: '1' }).toString(), { method: 'HEAD' });
    const raw = response.headers.get('content-range')?.split('/')[1];
    if (!raw || !/^\d+$/.test(raw)) throw new Error('Shared room count unavailable');
    return Number(raw);
  }
}
