-- Access tests for schema.sql. Run in Supabase → SQL Editor after schema.sql.
-- Everything runs inside a transaction that is rolled back, so it leaves no trace.
-- Success: the final row says "ALL ACCESS TESTS PASSED". Any failure stops with an error naming the check.

begin;

-- fake people
insert into auth.users (id, email, email_confirmed_at, is_anonymous, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', null, null, true, 'authenticated', 'authenticated'),   -- organiser phone using the code
  ('00000000-0000-0000-0000-0000000000a1', 'test-organiser@poulet.test', now(), false, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', null, null, true, 'authenticated', 'authenticated'),   -- player on team 1
  ('00000000-0000-0000-0000-0000000000b2', null, null, true, 'authenticated', 'authenticated'),   -- player on team 2
  ('00000000-0000-0000-0000-0000000000c1', 'imposter@poulet.test', null, false, 'authenticated', 'authenticated'), -- unconfirmed
  ('00000000-0000-0000-0000-0000000000d1', null, null, true, 'authenticated', 'authenticated');   -- turns up after the game is live
insert into public.admins (email) values ('test-organiser@poulet.test'), ('imposter@poulet.test');
update public.settings set data = data || '{"state":"setup","showOthers":false,"showBoard":false,"interval":2,"maxChallenges":2}' where id = 1;
update public.secret set hideout = 'p_hide', clues = array['first clue', '', 'third clue'] where id = 1;
insert into public.challenges (pub_id, title, body) values
  ('p2', 'Secret task', 'Do the thing'), ('c1', 'Numbered one', 'First challenge'), ('c2', 'Numbered two', 'Second challenge')
on conflict (pub_id) do update set title = excluded.title, body = excluded.body;

create function pg_temp.act_as(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin_db() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

-- ---------- before the game: player 1 joins team 1, player 2 joins team 2 ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert public.join_team(2) is not null, 'player 2 joins team 2'; end $$;
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
do $$ begin assert public.join_team(1, 'Pat') = (select id from public.teams where num = 1), 'player 1 joins team 1'; end $$;
do $$ begin assert public.my_team() = (select id from public.teams where num = 1), 'joining before the game is approved straight away'; end $$;
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

-- the game goes live
select pg_temp.as_admin_db();
update public.settings set data = data || '{"state":"live"}' where id = 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  begin perform public.join_team(2); raise exception 'FAIL: player switched team during the game';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- player 1 checks in twice; second pub is a challenge stop
insert into public.visits (team_id, pub_id, at) values (public.my_team(), 'p1', now() - interval '1 hour'), (public.my_team(), 'p2', now());
do $$ begin assert public.get_challenge('p1') is null, 'stop 1 is not a challenge pub'; end $$;
do $$ begin assert public.get_challenge('p2') ->> 'title' = 'Numbered one', 'pub 2 reveals challenge 1 (numbered beats pub-specific)'; end $$;
insert into public.visits (team_id, pub_id, at) values (public.my_team(), 'p3', now() + interval '1 minute'), (public.my_team(), 'p4', now() + interval '2 minutes');
do $$ begin assert public.get_challenge('p3') is null, 'pub 3 is not a challenge pub'; end $$;
do $$ begin assert public.get_challenge('p4') ->> 'title' = 'Numbered two', 'pub 4 reveals challenge 2'; end $$;
insert into public.visits (team_id, pub_id, at) values (public.my_team(), 'p5', now() + interval '3 minutes'), (public.my_team(), 'p6', now() + interval '4 minutes');
do $$ begin assert public.get_challenge('p6') is null, 'no challenge after the last one (maxChallenges = 2)'; end $$;
delete from public.visits where team_id = public.my_team() and pub_id in ('p3','p4','p5','p6');
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

-- selfies: only at a pub the team has checked in to, only for its own team
insert into public.selfies (team_id, pub_id, path) values (public.my_team(), 'p1', 'team1/p1/a.jpg');
insert into public.selfies (team_id, pub_id, path) values (public.my_team(), 'p2', 'team1/p2/a.jpg')
  on conflict (team_id, pub_id) do update set path = excluded.path;
update public.selfies set path = 'team1/p2/b.jpg' where pub_id = 'p2';
do $$ begin assert (select path from public.selfies where pub_id = 'p2') = 'team1/p2/b.jpg', 'team can retake its own selfie'; end $$;
do $$ begin
  begin insert into public.selfies (team_id, pub_id, path) values (public.my_team(), 'p9', 'x.jpg');
        raise exception 'FAIL: selfie added for a pub the team never checked in to';
  exception when foreign_key_violation then null; end;
end $$;
do $$ begin
  begin insert into public.selfies (team_id, pub_id, path) values ((select id from public.teams where num = 2), 'p1', 'x.jpg');
        raise exception 'FAIL: selfie added for another team';
  exception when insufficient_privilege then null; end;
end $$;
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
do $$ begin assert public.my_team() = (select id from public.teams where num = 2), 'player 2 is on team 2'; end $$;
do $$ begin assert (select count(*) from public.visits) = 0, 'other team visits hidden'; end $$;
do $$ begin assert (select count(*) from public.submissions) = 0, 'other team evidence hidden'; end $$;
do $$ begin assert (select count(*) from public.team_rosters r join public.teams t on t.id = r.team_id
                    where r.team_id <> public.my_team() and not t.is_chicken) = 0, 'other hunting teams'' typed rosters stay hidden'; end $$;
do $$ begin assert exists (select 1 from public.team_rosters r join public.teams t on t.id = r.team_id where t.is_chicken), 'the chicken''s names are visible'; end $$;
do $$ begin assert (select count(*) from public.team_members) = 1, 'only own team members visible'; end $$;
do $$ begin assert (select count(*) from public.roster()) >= 2, 'everyone sees team rosters (names only)'; end $$;
do $$ begin assert exists (select 1 from public.roster() where name = 'Pat'), 'a joined player''s name appears in the roster'; end $$;
do $$ begin assert (select count(*) from public.team_positions()) = 0, 'other team positions hidden while showOthers is off'; end $$;
do $$ begin assert (select count(*) from public.leaderboard()) = 1, 'leaderboard shows own team only while hidden'; end $$;
do $$ begin assert public.get_challenge('p2') is null, 'cannot read another team''s challenge pub'; end $$;
do $$ begin
  begin insert into public.spends (amount, note) values (5, 'fake round'); raise exception 'FAIL: player logged a kitty spend';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert (select count(*) from public.selfies) = 0, 'other team selfies hidden during the game'; end $$;
do $$ begin assert not public.can_see_selfies((select id from public.teams where num = 1)), 'other team selfie files hidden during the game'; end $$;
delete from public.selfies;                                  -- silently affects 0 rows under RLS

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
do $$ begin assert (select count(*) from public.selfies) = 2, 'organiser sees every selfie, and other teams could not delete them'; end $$;
do $$ begin assert (select count(*) from public.team_positions()) = 1, 'organiser sees every team position'; end $$;
insert into public.spends (amount, note) values (42.50, 'Round 1');
do $$ begin assert (select count(*) from public.spends) = 1, 'organiser logs a kitty spend'; end $$;
do $$ begin assert public.approve_submission((select id from public.submissions limit 1), 'auto text') = 1, 'approve unlocks clue 1'; end $$;
do $$ begin assert (select body from public.unlocked where n = 1) = 'first clue', 'clue 1 comes from the clue list'; end $$;
do $$ begin assert public.unlock_clue((select id from public.teams where num = 1), 'auto two') = 2, 'manual unlock gives clue 2'; end $$;
do $$ begin assert (select body from public.unlocked where n = 2) = 'auto two', 'blank clue 2 falls back to auto text'; end $$;
update public.settings set data = data || '{"showOthers":true}' where id = 1;

-- ---------- teams are locked once the game is live ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin assert public.join_team(1, 'Late') = (select id from public.teams where num = 1), 'late phone can ask to join team 1'; end $$;
do $$ begin assert public.my_team() is null, 'a join request during the game gives no team access'; end $$;
do $$ begin assert (select approved from public.team_members where user_id = auth.uid()) = false, 'late join is waiting for approval'; end $$;
do $$ begin assert (select count(*) from public.visits) = 0, 'waiting phone sees no check-ins'; end $$;
do $$ begin assert (select count(*) from public.unlocked) = 0, 'waiting phone sees no clues'; end $$;
do $$ begin
  begin insert into public.visits (team_id, pub_id) values ((select id from public.teams where num = 1), 'p8');
        raise exception 'FAIL: waiting phone checked in';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform public.join_team(2); raise exception 'FAIL: waiting phone switched its request to another team';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
update public.team_members set approved = true where user_id = auth.uid();   -- silently affects 0 rows under RLS
do $$ begin assert public.my_team() is null, 'waiting phone cannot approve itself'; end $$;
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
update public.team_members set approved = true where user_id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin assert public.my_team() = (select id from public.teams where num = 1), 'organiser approval lets the late phone in'; end $$;
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

-- ---------- visibility switch ----------
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select count(*) from public.team_positions()) = 0, 'other team positions stay hidden even with the old showOthers switch on'; end $$;
do $$ begin assert (select count(*) from public.unlocked) = 0, 'other team clues still hidden'; end $$;
do $$ begin assert (select sum(amount) from public.spends) = 42.50, 'players see the kitty spends'; end $$;
update public.spends set amount = 1;                         -- silently affects 0 rows under RLS
delete from public.spends;
do $$ begin assert (select sum(amount) from public.spends) = 42.50, 'players cannot change or delete kitty spends'; end $$;

-- ---------- game not live: no check-ins ----------
select pg_temp.as_admin_db();
update public.settings set data = data || '{"state":"setup"}' where id = 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  begin insert into public.visits (team_id, pub_id) values (public.my_team(), 'p7'); raise exception 'FAIL: checked in before the game started';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- game finished: selfie gallery opens to joined players ----------
select pg_temp.as_admin_db();
update public.settings set data = data || '{"state":"finished"}' where id = 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select count(*) from public.selfies) = 2, 'finished game shows every team''s selfies'; end $$;
do $$ begin assert public.can_see_selfies((select id from public.teams where num = 1)), 'finished game opens other team selfie files'; end $$;
do $$ begin assert (select count(*) from public.visits) = 0, 'other team check-ins stay hidden after the game'; end $$;
do $$ begin
  begin insert into public.selfies (team_id, pub_id, path) values (public.my_team(), 'p1', 'x.jpg');
        raise exception 'FAIL: selfie added after the game finished';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;

-- player 1 removes a check-in: its selfie goes with it
select pg_temp.as_admin_db();
update public.settings set data = data || '{"state":"live"}' where id = 1;
delete from public.submissions;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
delete from public.visits where pub_id = 'p2';
do $$ begin assert (select count(*) from public.selfies) = 1, 'undoing a check-in removes its selfie'; end $$;

-- a joined player who isn't an organiser can't see selfies before the end, even with no team of their own
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin assert (select count(*) from public.selfies) = 0, 'account with no team sees no selfies'; end $$;

-- ---------- organiser code ----------
select pg_temp.as_admin_db();
select public.set_admin_code('test-code-123');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  begin perform public.set_admin_code('hijack'); raise exception 'FAIL: player could change the organiser code';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert (select count(*) from public.admin_code) = 0, 'players cannot read the code hash'; end $$;
do $$ begin assert not public.claim_admin('wrong'), 'wrong code is refused'; end $$;
do $$ begin assert not public.is_admin(), 'wrong code does not make an organiser'; end $$;
do $$ begin assert public.claim_admin('  TEST-code-123 '), 'right code (any case, spaces trimmed) is accepted'; end $$;
do $$ begin assert public.is_admin(), 'code phone is an organiser'; end $$;
do $$ begin assert (select count(*) from public.secret) = 1, 'code organiser reads the secret'; end $$;
select public.release_admin();
do $$ begin assert not public.is_admin(), 'locking HQ removes organiser access'; end $$;
-- a player who unlocks HQ comes off their team; leave_team works for anyone
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  begin perform public.reset_game(); raise exception 'FAIL: player reset the game';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
do $$ begin assert public.my_team() is not null, 'player 2 is on a team before unlocking'; end $$;
do $$ begin assert public.claim_admin('test-code-123'), 'player 2 unlocks HQ'; end $$;
do $$ begin assert public.my_team() is null, 'unlocking HQ takes the phone off its team'; end $$;
select public.release_admin();
select pg_temp.as_admin_db();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select public.leave_team();
do $$ begin assert public.my_team() is null, 'leave_team takes a player off their team'; end $$;
do $$ begin perform public.claim_admin('x'); perform public.claim_admin('x'); perform public.claim_admin('x'); perform public.claim_admin('x'); perform public.claim_admin('x'); end $$;
do $$ begin
  begin perform public.claim_admin('test-code-123'); raise exception 'FAIL: no lockout after 5 wrong tries';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- ---------- visitor (not signed in) ----------
select pg_temp.as_admin_db();
set local role anon;
do $$ begin assert (select count(*) from public.teams) > 0, 'visitor sees team names'; end $$;
do $$ begin assert (select count(*) from public.spends) = 1, 'visitor sees the kitty'; end $$;
do $$ begin
  begin perform count(*) from public.visits; raise exception 'FAIL: visitor read visits';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform count(*) from public.selfies; raise exception 'FAIL: visitor read selfies';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform public.reset_game(); raise exception 'FAIL: visitor could call reset_game';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform public.claim_admin('x'); raise exception 'FAIL: visitor could try the organiser code';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert (select count(*) from public.roster()) >= 0, 'visitor can read the roster'; end $$;
do $$ begin
  begin truncate public.visits; raise exception 'FAIL: visitor could truncate a table';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
-- ---------- organiser resets the game ----------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.reset_game();
do $$ begin assert (select count(*) from public.visits) = 0 and (select count(*) from public.submissions) = 0
             and (select count(*) from public.unlocked) = 0 and (select count(*) from public.team_members) = 0, 'reset clears play data and teams'; end $$;
do $$ begin assert (select data ->> 'state' from public.settings where id = 1) = 'setup', 'reset puts the game back to not started'; end $$;
do $$ begin assert (select count(*) from public.teams) > 0 and (select count(*) from public.secret) = 1, 'reset keeps teams and the secret'; end $$;
select pg_temp.as_admin_db();
rollback;
select 'ALL ACCESS TESTS PASSED' as result;   -- only reached if every check above passed
