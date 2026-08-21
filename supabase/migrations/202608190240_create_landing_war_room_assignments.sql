-- Durable role-aligned Landing War Room assignment ledger.
create table if not exists public.ivx_landing_war_room_assignments (
  item_number integer primary key check (item_number between 1 and 112),
  workstream text not null,
  priority text not null check (priority in ('P0','P1','QA')),
  assigned_agent_numbers integer[] not null,
  status text not null default 'assigned' check (status in ('assigned','running','blocked','passed','failed')),
  evidence jsonb not null default '{}'::jsonb,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ivx_landing_war_room_assignments enable row level security;
drop policy if exists ivx_landing_war_room_owner_all on public.ivx_landing_war_room_assignments;
create policy ivx_landing_war_room_owner_all on public.ivx_landing_war_room_assignments for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

insert into public.ivx_landing_war_room_assignments(item_number,workstream,priority,assigned_agent_numbers,status,evidence)
select n,
  case
    when n between 1 and 8 then 'Conversion Funnel'
    when n between 9 and 16 then 'Advertising Analytics'
    when n between 17 and 24 then 'SEO / Social / Discoverability'
    when n between 25 and 32 then 'Performance / Core Web Vitals'
    when n between 33 and 40 then 'Mobile / Responsive / Accessibility'
    when n between 41 and 48 then 'Security / Privacy / Browser Hardening'
    when n between 49 and 56 then 'Legal / Financial Advertising / Disclosures'
    when n between 57 and 64 then 'Trust / Content / Credibility'
    when n between 65 and 72 then 'Deals / Data / APIs'
    when n between 73 and 80 then 'Chat / Support / Realtime'
    when n between 81 and 88 then 'Lead Capture / CRM / Communications'
    when n between 89 and 96 then 'Android APK / Mobile Distribution'
    when n between 97 and 104 then 'AWS / Deploy / CDN / DNS'
    else 'Enterprise Adversarial QA'
  end,
  case when n between 1 and 8 or n between 41 and 48 or n between 97 and 104 then 'P0' when n between 105 and 112 then 'QA' else 'P1' end,
  case
    when n between 1 and 8 then array[9,10,17,18,19,20,21,41]
    when n between 9 and 16 then array[13,14,15,16,40,41,42,43]
    when n between 17 and 24 then array[15,16,34,35,41,43,61,103]
    when n between 25 and 32 then array[68,69,71,72,76,80,86,91]
    when n between 33 and 40 then array[66,67,68,78,79,80,87,88]
    when n between 41 and 48 then array[8,11,73,74,89,96,100,110]
    when n between 49 and 56 then array[8,12,31,44,52,61,96,108]
    when n between 57 and 64 then array[9,16,18,41,43,61,92,103]
    when n between 65 and 72 then array[3,5,22,28,31,41,45,69]
    when n between 73 and 80 then array[10,40,72,74,77,80,86,87]
    when n between 81 and 88 then array[17,18,19,20,21,27,41,76]
    when n between 89 and 96 then array[67,68,73,78,79,87,88,90]
    when n between 97 and 104 then array[10,40,69,71,73,86,90,91]
    else array[11,41,73,87,88,89,91,112]
  end,
  case when n=43 then 'passed' else 'assigned' end,
  case when n=43 then jsonb_build_object('evidenceFile','qa/evidence/landing-war-room/item-043-rls-live.json','verifiedLive',true) else '{}'::jsonb end
from generate_series(1,112) n
on conflict (item_number) do update set
  workstream=excluded.workstream,
  priority=excluded.priority,
  assigned_agent_numbers=excluded.assigned_agent_numbers,
  updated_at=now();
