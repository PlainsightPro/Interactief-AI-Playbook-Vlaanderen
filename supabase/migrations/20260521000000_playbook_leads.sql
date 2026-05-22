create table if not exists public.playbook_leads (
  email      text primary key,
  profile    text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

alter table public.playbook_leads enable row level security;

drop policy if exists "service-role only" on public.playbook_leads;
create policy "service-role only" on public.playbook_leads
  for all using (false);

create or replace function public.bump_last_seen() returns trigger language plpgsql as $$
begin new.last_seen := now(); return new; end; $$;

drop trigger if exists bump_playbook_leads_last_seen on public.playbook_leads;
create trigger bump_playbook_leads_last_seen
  before update on public.playbook_leads
  for each row execute function public.bump_last_seen();
