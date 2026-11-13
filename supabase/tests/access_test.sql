-- Access tests for schema.sql. Run in Supabase → SQL Editor after schema.sql.
-- Everything runs inside a transaction that is rolled back, so it leaves no trace.
-- Success: the final row says "ALL ACCESS TESTS PASSED". Any failure stops with an error naming the check.

begin;

-- fake people
insert into auth.users (id, email, email_confirmed_at, is_anonymous, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'test-organiser@poulet.test', now(), false, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', null, null, true, 'authenticated', 'authenticated'),   -- player on team 1
  ('00000000-0000-0000-0000-0000000000b2', null, null, true, 'authenticated', 'authenticated'),   -- player on team 2
  ('00000000-0000-0000-0000-0000000000c1', 'imposter@poulet.test', null, false, 'authenticated', 'authenticated'); -- unconfirmed
insert into public.admins (email) values ('test-organiser@poulet.test'), ('imposter@poulet.test');
update public.settings set data = data || '{"state":"live","showOthers":false,"showBoard":false,"interval":2}' where id = 1;
update public.secret set hideout = 'p_hide', clues = array['first clue', '', 'third clue'] where id = 1;
insert into public.challenges (pub_id, title, body) values ('p2', 'Secret task', 'Do the thing') on conflict (pub_id) do update set title = excluded.title, body = excluded.body;

create function pg_temp.act_as(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin_db() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

-- ---------- player 1 joins team 1, player 2 joins team 2 ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
do $$ begin assert public.join_team(1, 'Pat') = (select id from public.teams where num = 1), 'player 1 joins team 1'; end $$;
do $$ begin
  begin perform public.join_team(2); raise exception 'FAIL: player switched team on their own';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
do $$ begin
  begin insert into public.team_members (user_id, team_id) values (auth.uid(), (select id from public.teams where num = 2));
        raise exception 'FAIL: direct insert into team_members allowed';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert not public.is_admin(), 'anonymous player is not an organiser'; end $$;

-- player 1 checks in twice; second pub is a challenge stop
insert into public.visits (team_id, pub_id, at) values (public.my_team(), 'p1', now() - interval '1 hour'), (public.my_team(), 'p2', now());
do $$ begin assert public.get_challenge('p1') is null, 'stop 1 is not a challenge pub'; end $$;
do $$ begin assert public.get_challenge('p2') ->> 'title' = 'Secret task', 'stop 2 reveals its challenge'; end $$;
do $$ begin assert public.get_challenge('p9') is null, 'unvisited pub challenge stays hidden'; end $$;
do $$ begin assert (select count(*) from public.challenges) = 0, 'players cannot read the challenges table'; end $$;
do $$ begin assert (select count(*) from public.secret) = 0, 'players cannot read the secret'; end $$;

-- can't check in for another team, can't fake approval
do $$ begin
  begin insert into public.visits (team_id, pub_id) values ((select id from public.teams where num = 2), 'p5');
        raise exception 'FAIL: checked in for another team';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin insert into public.submissions (team_id, pub_id, stop, status) values (public.my_team(), 'p2', 2, 'approved');
        raise exception 'FAIL: player inserted an approved submission';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.submissions (team_id, pub_id, stop, note) values (public.my_team(), 'p2', 2, 'proof');
update public.submissions set status = 'approved';          -- silently affects 0 rows under RLS
do $$ begin assert (select count(*) from public.submissions where status = 'approved') = 0, 'player cannot approve own evidence'; end $$;
do $$ begin
  begin perform public.approve_submission((select id from public.submissions limit 1), 'x'); raise exception 'FAIL: player called approve';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
do $$ begin
  begin perform public.unlock_clue(public.my_team(), 'x'); raise exception 'FAIL: player unlocked a clue';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
do $$ begin
  begin update public.settings set data = '{}' where id = 1;
        assert (select data ->> 'state' from public.settings) = 'live', 'player cannot change settings';
  end;
end $$;

-- ---------- player 2 sees nothing of team 1 ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert public.join_team(2) is not null, 'player 2 joins team 2'; end $$;
do $$ begin assert (select count(*) from public.visits) = 0, 'other team visits hidden'; end $$;
do $$ begin assert (select count(*) from public.submissions) = 0, 'other team evidence hidden'; end $$;
do $$ begin assert (select count(*) from public.team_rosters) = 1, 'only own roster visible'; end $$;
do $$ begin assert (select count(*) from public.team_members) = 1, 'only own team members visible'; end $$;
do $$ begin assert (select count(*) from public.team_positions()) = 0, 'other team positions hidden while showOthers is off'; end $$;
do $$ begin assert (select count(*) from public.leaderboard()) = 1, 'leaderboard shows own team only while hidden'; end $$;
do $$ begin assert public.get_challenge('p2') is null, 'cannot read another team''s challenge pub'; end $$;

-- ---------- unconfirmed "organiser" email is not an organiser ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin assert not public.is_admin(), 'unconfirmed email is not an organiser'; end $$;
do $$ begin assert (select count(*) from public.secret) = 0, 'unconfirmed account cannot read secret'; end $$;

-- ---------- organiser ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin assert public.is_admin(), 'organiser recognised'; end $$;
do $$ begin assert (select count(*) from public.secret) = 1, 'organiser reads secret'; end $$;
do $$ begin assert (select count(*) from public.visits) = 2, 'organiser sees all visits'; end $$;
do $$ begin assert public.approve_submission((select id from public.submissions limit 1), 'auto text') = 1, 'approve unlocks clue 1'; end $$;
do $$ begin assert (select body from public.unlocked where n = 1) = 'first clue', 'clue 1 comes from the clue list'; end $$;
do $$ begin assert public.unlock_clue((select id from public.teams where num = 1), 'auto two') = 2, 'manual unlock gives clue 2'; end $$;
do $$ begin assert (select body from public.unlocked where n = 2) = 'auto two', 'blank clue 2 falls back to auto text'; end $$;
update public.settings set data = data || '{"showOthers":true}' where id = 1;

-- ---------- visibility switch ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select count(*) from public.team_positions()) = 1, 'showOthers reveals other team positions'; end $$;
do $$ begin assert (select count(*) from public.unlocked) = 0, 'other team clues still hidden'; end $$;

-- ---------- game not live: no check-ins ----------
select pg_temp.as_admin_db();
update public.settings set data = data || '{"state":"setup"}' where id = 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  begin insert into public.visits (team_id, pub_id) values (public.my_team(), 'p7'); raise exception 'FAIL: checked in before the game started';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- visitor (not signed in) ----------
select pg_temp.as_admin_db();
set local role anon;
do $$ begin assert (select count(*) from public.teams) > 0, 'visitor sees team names'; end $$;
do $$ begin
  begin perform count(*) from public.visits; raise exception 'FAIL: visitor read visits';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'ALL ACCESS TESTS PASSED' as result;
rollback;
