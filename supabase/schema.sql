-- Où est le Poulet: Supabase setup (v2, role-based access).
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Roles
--   Organiser  signed in with email + password, and that email is in public.admins. Sees and changes everything.
--   Player     anonymous sign-in on their phone, then joins a team by its number (1, 2, 3 …).
--              Sees only their own team's check-ins, evidence and clues.
--              Teams lock when the game goes live: a phone joining after that waits for an organiser to approve it.
--   Visitor    not joined yet. Sees rules, settings, team names and pub info only.
--
-- Before running: Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins".

-- Remove the v1 single-table design if it exists.
drop table if exists public.docs cascade;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table if not exists public.admins (email text primary key);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id          text primary key,
  num         int unique,                       -- the team's login number; null for the chicken
  name        text not null,
  color       text not null default '#888888',
  is_chicken  boolean not null default false,
  sort        int not null default 0
);

create table if not exists public.team_rosters (  -- member names, visible to that team and organisers
  team_id text primary key references public.teams(id) on delete cascade,
  names   text[] not null default '{}'
);

create table if not exists public.team_members (  -- which phone (anonymous user) is on which team
  user_id      uuid primary key references auth.users(id) on delete cascade,
  team_id      text not null references public.teams(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  approved     boolean not null default true      -- false = asked to join after the game went live; no access until an organiser approves
);
alter table public.team_members add column if not exists approved boolean not null default true;

create table if not exists public.pub_info (pub_id text primary key, price text, hours text, note text);
create table if not exists public.challenges (pub_id text primary key, title text, body text);  -- '_all' = default

create table if not exists public.secret (
  id      int primary key default 1 check (id = 1),
  hideout text,
  clues   text[] not null default '{}'
);

create table if not exists public.visits (
  team_id text not null references public.teams(id) on delete cascade,
  pub_id  text not null,
  at      timestamptz not null default now(),
  by_user uuid default auth.uid(),
  primary key (team_id, pub_id)
);

create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references public.teams(id) on delete cascade,
  pub_id      text not null,
  stop        int not null,
  media       jsonb not null default '[]'::jsonb,   -- [{path, type}] in the private evidence bucket
  note        text,
  at          timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  clue_no     int,
  reviewed_at timestamptz,
  by_user     uuid default auth.uid()
);
create index if not exists submissions_team_idx on public.submissions(team_id, pub_id, at desc);

-- One team selfie per pub visited. Removing the check-in removes its selfie row.
create table if not exists public.selfies (
  team_id text not null,
  pub_id  text not null,
  path    text not null,                        -- file in the private selfies bucket
  at      timestamptz not null default now(),
  by_user uuid default auth.uid(),
  primary key (team_id, pub_id),
  foreign key (team_id, pub_id) references public.visits(team_id, pub_id) on delete cascade
);

-- The kitty: organisers log each round they buy. The total is settings.data.budget. Everyone can see both.
-- Deliberately no pub column, so the spend log can't give away where the chicken is hiding.
create table if not exists public.spends (
  id      uuid primary key default gen_random_uuid(),
  amount  numeric(8,2) not null check (amount > 0 and amount < 10000),
  note    text,
  at      timestamptz not null default now(),
  by_user uuid default auth.uid()
);

create table if not exists public.unlocked (
  team_id text not null references public.teams(id) on delete cascade,
  n       int not null,
  body    text not null,
  pub_id  text,
  at      timestamptz not null default now(),
  primary key (team_id, n)
);

create table if not exists public.found (
  team_id text primary key references public.teams(id) on delete cascade,
  at      timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Seed data (only fills empty tables)
-- ---------------------------------------------------------------
insert into public.settings (id, data) values
  (1, '{"interval":2,"maxChallenges":3,"state":"setup","showOthers":false,"showBoard":false,"buyIn":"£15","start":""}')
on conflict (id) do nothing;
insert into public.secret (id) values (1) on conflict (id) do nothing;

insert into public.teams (id, num, name, color, is_chicken, sort)
select * from (values
  ('poulet',  null::int, 'Le Poulet',    '#E0A100', true,  0),
  ('coqs',    1,         'Les Coqs',     '#E5484D', false, 1),
  ('nuggets', 2,         'The Nuggets',  '#3E63DD', false, 2),
  ('rangers', 3,         'Free Rangers', '#12A594', false, 3),
  ('hens',    4,         'Hen Party',    '#8E4EC6', false, 4)
) v where not exists (select 1 from public.teams);
-- Hunting teams start empty: their members are the players who join (see roster()). Only the chicken has a fixed roster.
insert into public.team_rosters (team_id, names)
select 'poulet', array['Dom','Josh'] where not exists (select 1 from public.team_rosters);

-- ---------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------
-- Organiser = a real (non-anonymous) account with a confirmed email listed in admins.
-- Organiser code: phones that entered the right code become organisers. Only the bcrypt hash is stored,
-- and only the definer functions below touch these tables (RLS on, no policies).
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.admin_code     (id int primary key default 1 check (id = 1), hash text);
create table if not exists public.admin_devices  (user_id uuid primary key references auth.users(id) on delete cascade, at timestamptz not null default now());
create table if not exists public.admin_attempts (user_id uuid not null, at timestamptz not null default now());
alter table public.admin_code     enable row level security;
alter table public.admin_devices  enable row level security;
alter table public.admin_attempts enable row level security;

-- Organiser = a phone that entered the organiser code, or a confirmed email account listed in admins.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_devices d where d.user_id = auth.uid())
      or exists (
    select 1 from auth.users u join public.admins a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null and coalesce(u.is_anonymous, false) = false
  );
$$;

-- Run once in the SQL Editor to set or change the code:  select public.set_admin_code('your code');
-- Not callable from the app.
create or replace function public.set_admin_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_code, ''))) < 4 then raise exception 'code_too_short'; end if;
  insert into public.admin_code (id, hash) values (1, extensions.crypt(lower(trim(p_code)), extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash;
  delete from public.admin_devices;   -- a new code signs every organiser phone out
end $$;
revoke execute on function public.set_admin_code(text) from public, anon, authenticated;

-- The app calls this with what the organiser typed. Five wrong tries locks that phone out for 10 minutes.
create or replace function public.claim_admin(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.admin_attempts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'too_many_tries';
  end if;
  select hash into v_hash from public.admin_code where id = 1;
  if v_hash is null then raise exception 'no_code_set'; end if;
  if extensions.crypt(lower(trim(coalesce(p_code, ''))), v_hash) = v_hash then
    insert into public.admin_devices (user_id) values (auth.uid()) on conflict do nothing;
    delete from public.admin_attempts where user_id = auth.uid();
    delete from public.team_members where user_id = auth.uid();   -- organisers aren't on a team
    return true;
  end if;
  insert into public.admin_attempts (user_id) values (auth.uid());
  return false;
end $$;

-- Who is on each team: the names players typed when they joined (approved members only). Names only, no ids.
create or replace function public.roster() returns table (team_id text, name text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.team_id, coalesce(nullif(trim(m.display_name), ''), 'Player'), m.joined_at
  from public.team_members m where m.approved order by m.joined_at;
$$;
grant execute on function public.roster() to anon, authenticated;

create or replace function public.release_admin() returns void
language sql security definer set search_path = public as $$
  delete from public.admin_devices where user_id = auth.uid();
$$;

-- "Log out" on a phone: leave its team (or cancel a join request).
create or replace function public.leave_team() returns void
language sql security definer set search_path = public as $$
  delete from public.team_members where user_id = auth.uid();
$$;

-- Organisers: start the game again from scratch. Clears every check-in, piece of evidence, selfie, clue,
-- found mark, kitty spend and team membership, and puts the game back to Not started.
-- Keeps teams, challenges, clues, hideout, pub info, rules, settings and the organiser code.
-- (Uploaded photo files stay in storage; delete them in Storage if you want the space back.)
create or replace function public.reset_game() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins_only'; end if;
  delete from public.unlocked    where true;
  delete from public.submissions where true;
  delete from public.selfies     where true;
  delete from public.visits      where true;
  delete from public.found       where true;
  delete from public.spends      where true;
  delete from public.team_members where true;
  delete from public.admin_attempts where true;
  update public.settings set data = data || '{"state":"setup"}', updated_at = now() where id = 1;
end $$;

-- A phone's team, once approved. A pending join request gives no access to anything.
create or replace function public.my_team() returns text
language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid() and approved;
$$;

create or replace function public.setting(k text) returns text
language sql stable security definer set search_path = public as $$
  select data ->> k from public.settings where id = 1;
$$;

-- ---------------------------------------------------------------
-- Player functions
-- ---------------------------------------------------------------
-- Before the game: join straight away. Once it's live (or finished) teams are locked, so a new phone's
-- join becomes a request (approved = false) that an organiser approves in Chicken HQ.
-- Players can never switch team themselves; organisers move or remove them.
create or replace function public.join_team(p_num int, p_name text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_team text; v_cur text; v_open boolean := coalesce(nullif(public.setting('state'), ''), 'setup') = 'setup';
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select id into v_team from public.teams where num = p_num and not is_chicken;
  if v_team is null then raise exception 'no_such_team'; end if;
  select team_id into v_cur from public.team_members where user_id = auth.uid();
  if v_cur is not null and v_cur <> v_team then raise exception 'already_in_team'; end if;
  insert into public.team_members (user_id, team_id, display_name, approved)
  values (auth.uid(), v_team, nullif(trim(p_name), ''), v_open)
  on conflict (user_id) do update set display_name = coalesce(excluded.display_name, public.team_members.display_name);
  return v_team;
end $$;

-- A team only sees a challenge once it checks in at one of its challenge pubs (every `interval`-th pub,
-- up to `maxChallenges` of them; 0 = no limit). Challenges go by number: 'c1', 'c2' … in public.challenges,
-- then a pub's own challenge, then the '_all' default.
create or replace function public.get_challenge(p_pub text) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_team text := public.my_team(); v_k int; v_max int; v_rn int; v_num int; v_title text; v_body text;
begin
  if not public.is_admin() then
    if v_team is null then return null; end if;
    v_k   := greatest(1, coalesce(nullif(public.setting('interval'), '')::int, 2));
    v_max := greatest(0, coalesce(nullif(public.setting('maxChallenges'), '')::int, 3));
    select r into v_rn from (
      select pub_id, row_number() over (order by at, pub_id) as r from public.visits where team_id = v_team
    ) v where v.pub_id = p_pub;
    if v_rn is null or v_rn % v_k <> 0 then return null; end if;
    v_num := v_rn / v_k;
    if v_max > 0 and v_num > v_max then return null; end if;
    select title, body into v_title, v_body from public.challenges
     where pub_id = 'c' || v_num and (coalesce(title, '') <> '' or coalesce(body, '') <> '');
    if found then return json_build_object('title', v_title, 'body', v_body, 'num', v_num); end if;
  end if;
  select title, body into v_title, v_body from public.challenges
   where pub_id = p_pub and (coalesce(title, '') <> '' or coalesce(body, '') <> '');
  if not found then
    select title, body into v_title, v_body from public.challenges where pub_id = '_all';
  end if;
  return json_build_object('title', v_title, 'body', v_body, 'num', v_num);
end $$;

-- Where teams were last seen: your own team only. Organisers see every team.
create or replace function public.team_positions() returns table (team_id text, pub_id text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (v.team_id) v.team_id, v.pub_id, v.at
  from public.visits v
  where public.is_admin() or v.team_id = public.my_team()
  order by v.team_id, v.at desc;
$$;

-- Selfies: your own team during the game; every team once the game has finished (players who joined a team only).
create or replace function public.can_see_selfies(p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or p_team = public.my_team()
      or (public.setting('state') = 'finished' and public.my_team() is not null);
$$;

-- Scores: your own team always; every team if showBoard is on or the game has finished.
create or replace function public.leaderboard() returns table (team_id text, pubs int, clues int, found_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id,
         (select count(*) from public.visits v where v.team_id = t.id)::int,
         (select count(*) from public.unlocked u where u.team_id = t.id)::int,
         f.at
  from public.teams t left join public.found f on f.team_id = t.id
  where not t.is_chicken
    and (public.is_admin() or t.id = public.my_team()
         or public.setting('showBoard') = 'true' or public.setting('state') = 'finished');
$$;

-- ---------------------------------------------------------------
-- Organiser functions
-- ---------------------------------------------------------------
create or replace function public.approve_submission(p_id uuid, p_auto_text text) returns int
language plpgsql security definer set search_path = public as $$
declare v_sub public.submissions; v_n int; v_txt text;
begin
  if not public.is_admin() then raise exception 'admins_only'; end if;
  select * into v_sub from public.submissions where id = p_id for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'approved' then return v_sub.clue_no; end if;
  perform 1 from public.teams where id = v_sub.team_id for update;   -- one unlock at a time per team
  select coalesce(max(u.n), 0) + 1 into v_n from public.unlocked u where u.team_id = v_sub.team_id;
  select nullif(trim(s.clues[v_n]), '') into v_txt from public.secret s where s.id = 1;
  insert into public.unlocked (team_id, n, body, pub_id)
  values (v_sub.team_id, v_n, coalesce(v_txt, nullif(trim(p_auto_text), ''), 'Ask the chicken for a hint.'), v_sub.pub_id);
  update public.submissions set status = 'approved', clue_no = v_n, reviewed_at = now(), review_note = null where id = p_id;
  return v_n;
end $$;

create or replace function public.reject_submission(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins_only'; end if;
  update public.submissions set status = 'rejected', review_note = nullif(trim(p_note), ''), reviewed_at = now()
   where id = p_id and status = 'pending';
end $$;

create or replace function public.unlock_clue(p_team text, p_auto_text text, p_pub text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_txt text;
begin
  if not public.is_admin() then raise exception 'admins_only'; end if;
  perform 1 from public.teams where id = p_team for update;
  select coalesce(max(u.n), 0) + 1 into v_n from public.unlocked u where u.team_id = p_team;
  select nullif(trim(s.clues[v_n]), '') into v_txt from public.secret s where s.id = 1;
  insert into public.unlocked (team_id, n, body, pub_id)
  values (p_team, v_n, coalesce(v_txt, nullif(trim(p_auto_text), ''), 'Ask the chicken for a hint.'), p_pub);
  return v_n;
end $$;

create or replace function public.relock_clue(p_team text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins_only'; end if;
  delete from public.unlocked u where u.team_id = p_team and u.n = (select max(n) from public.unlocked where team_id = p_team);
end $$;

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['admins','settings','teams','team_rosters','team_members','pub_info','challenges','secret','visits','submissions','selfies','spends','unlocked','found'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- drop old policies so this file can be re-run
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- everyone (even before joining)
create policy settings_read  on public.settings for select to anon, authenticated using (true);
create policy teams_read     on public.teams    for select to anon, authenticated using (true);
create policy pub_info_read  on public.pub_info for select to anon, authenticated using (true);
create policy spends_read    on public.spends   for select to anon, authenticated using (true);

-- organisers write the shared setup
create policy settings_admin   on public.settings     for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teams_admin      on public.teams        for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pub_info_admin   on public.pub_info     for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy spends_admin     on public.spends       for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy challenges_admin on public.challenges   for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy secret_admin     on public.secret       for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admins_admin     on public.admins       for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- own team only
create policy rosters_read   on public.team_rosters for select to anon, authenticated
  using (team_id = public.my_team() or public.is_admin() or team_id in (select id from public.teams where is_chicken));   -- the chicken's names are public
create policy rosters_admin  on public.team_rosters for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_read   on public.team_members for select to authenticated using (user_id = auth.uid() or team_id = public.my_team() or public.is_admin());
create policy members_admin  on public.team_members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy visits_read    on public.visits for select to authenticated using (team_id = public.my_team() or public.is_admin());
create policy visits_insert  on public.visits for insert to authenticated
  with check ((team_id = public.my_team() and public.setting('state') = 'live') or public.is_admin());
create policy visits_delete  on public.visits for delete to authenticated
  using ((team_id = public.my_team() and not exists (
            select 1 from public.submissions s where s.team_id = visits.team_id and s.pub_id = visits.pub_id and s.status = 'approved'))
         or public.is_admin());

create policy subs_read      on public.submissions for select to authenticated using (team_id = public.my_team() or public.is_admin());
create policy subs_insert    on public.submissions for insert to authenticated
  with check (public.is_admin() or (team_id = public.my_team() and status = 'pending' and clue_no is null
              and reviewed_at is null and review_note is null and public.setting('state') = 'live'));
create policy subs_admin     on public.submissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy subs_delete    on public.submissions for delete to authenticated using (public.is_admin());

create policy selfies_read   on public.selfies for select to authenticated using (public.can_see_selfies(team_id));
create policy selfies_insert on public.selfies for insert to authenticated
  with check (public.is_admin() or (team_id = public.my_team() and public.setting('state') = 'live'));
create policy selfies_update on public.selfies for update to authenticated
  using (public.is_admin() or (team_id = public.my_team() and public.setting('state') = 'live'))
  with check (public.is_admin() or (team_id = public.my_team() and public.setting('state') = 'live'));
create policy selfies_delete on public.selfies for delete to authenticated
  using (public.is_admin() or (team_id = public.my_team() and public.setting('state') = 'live'));

create policy unlocked_read  on public.unlocked for select to authenticated using (team_id = public.my_team() or public.is_admin());
create policy unlocked_admin on public.unlocked for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy found_read     on public.found for select to authenticated
  using (team_id = public.my_team() or public.is_admin() or public.setting('showBoard') = 'true' or public.setting('state') = 'finished');
create policy found_admin    on public.found for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- table privileges (row-level security above decides which rows)
grant usage on schema public to anon, authenticated;
grant select on public.settings, public.teams, public.pub_info, public.spends, public.team_rosters to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert on public.team_members from authenticated;   -- joining only through join_team()
grant execute on function public.is_admin(), public.my_team(), public.setting(text), public.can_see_selfies(text), public.join_team(int, text),
  public.get_challenge(text), public.team_positions(), public.leaderboard(),
  public.approve_submission(uuid, text), public.reject_submission(uuid, text),
  public.unlock_clue(text, text, text), public.relock_clue(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Live updates (row-level security still applies to what each phone receives)
-- ---------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['settings','teams','team_rosters','team_members','pub_info','challenges','secret','visits','submissions','selfies','spends','unlocked','found'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Evidence: private bucket, one folder per team, 20 MB per file
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 20971520, array['image/*', 'video/*'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['image/*', 'video/*'];

drop policy if exists evidence_upload on storage.objects;
drop policy if exists evidence_read   on storage.objects;
drop policy if exists evidence_delete on storage.objects;
create policy evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = public.my_team());
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and ((storage.foldername(name))[1] = public.my_team() or public.is_admin()));
create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and public.is_admin());

-- ---------------------------------------------------------------
-- Selfies: private bucket, one folder per team, images only, 5 MB per file.
-- Readable by the team and organisers during the game, and by every joined player once it has finished.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 5242880, array['image/*'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/*'];

drop policy if exists selfies_upload on storage.objects;
drop policy if exists selfies_read   on storage.objects;
drop policy if exists selfies_delete on storage.objects;
create policy selfies_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'selfies' and (storage.foldername(name))[1] = public.my_team() and public.setting('state') = 'live');
create policy selfies_read on storage.objects for select to authenticated
  using (bucket_id = 'selfies' and public.can_see_selfies((storage.foldername(name))[1]));
create policy selfies_delete on storage.objects for delete to authenticated
  using (bucket_id = 'selfies' and (public.is_admin()
         or ((storage.foldername(name))[1] = public.my_team() and public.setting('state') = 'live')));

grant execute on function public.claim_admin(text), public.release_admin(), public.leave_team(), public.reset_game() to authenticated;

-- ---------------------------------------------------------------
-- Organiser code: set it once here (never commit it to the repo). Un-comment, put your code in, run:
-- select public.set_admin_code('your code here');
-- Organisers then tap the account button in the app → "Organiser code".
-- ---------------------------------------------------------------
