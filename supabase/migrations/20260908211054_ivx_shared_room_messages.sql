create table if not exists public.ivx_shared_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null check (length(room_id) between 1 and 128),
  username text not null,
  text text not null,
  source text not null check (source in ('user','assistant','system')),
  created_at timestamptz not null default now()
);
create index if not exists ivx_shared_room_messages_room_time on public.ivx_shared_room_messages(room_id,created_at desc,id);
alter table public.ivx_shared_room_messages enable row level security;
revoke all on public.ivx_shared_room_messages from public,anon,authenticated;
grant select,insert on public.ivx_shared_room_messages to service_role;
comment on table public.ivx_shared_room_messages is 'Server-side public room history shared across API replicas. Private sessions use the separate public_chat session store.';
notify pgrst,'reload schema';
