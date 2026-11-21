-- Realtime notifications carry no game data.  They only tell an already
-- authorised room member to reload its room_snapshot.  This avoids leaking
-- a password hash or another player's in-round answer over a channel.
create or replace function lyricmatch.can_receive_room_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = lyricmatch, public
as $$
declare v_room_id uuid;
begin
  if p_topic !~ '^lyricmatch:room:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;

  v_room_id := right(p_topic, 36)::uuid;
  return exists (
    select 1
    from lyricmatch.players
    where room_id = v_room_id and user_id = auth.uid()
  );
end;
$$;

revoke all on function lyricmatch.can_receive_room_broadcast(text) from public, anon;
grant execute on function lyricmatch.can_receive_room_broadcast(text) to authenticated;

drop policy if exists lyricmatch_members_receive_room_broadcasts on realtime.messages;
create policy lyricmatch_members_receive_room_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and lyricmatch.can_receive_room_broadcast(realtime.topic())
);

create or replace function lyricmatch.broadcast_room_refresh()
returns trigger
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_row jsonb;
  v_room_id uuid;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_room_id := coalesce((v_row ->> 'room_id')::uuid, (v_row ->> 'id')::uuid);

  if v_room_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('entity', TG_TABLE_NAME, 'operation', TG_OP),
        'room_updated',
        'lyricmatch:room:' || v_room_id::text,
        true
      );
    exception when others then
      -- Realtime may not yet have a partition for a new UTC day.  A failed
      -- notification must never roll back a game action or scheduled round.
      raise warning 'LyricMatch Realtime notification skipped: %', sqlerrm;
    end;
  end if;

  return null;
end;
$$;

drop trigger if exists lyricmatch_room_refresh_rooms on lyricmatch.rooms;
create trigger lyricmatch_room_refresh_rooms
after insert or update or delete on lyricmatch.rooms
for each row execute function lyricmatch.broadcast_room_refresh();

drop trigger if exists lyricmatch_room_refresh_players on lyricmatch.players;
create trigger lyricmatch_room_refresh_players
after insert or update or delete on lyricmatch.players
for each row execute function lyricmatch.broadcast_room_refresh();

drop trigger if exists lyricmatch_room_refresh_rounds on lyricmatch.rounds;
create trigger lyricmatch_room_refresh_rounds
after insert or update or delete on lyricmatch.rounds
for each row execute function lyricmatch.broadcast_room_refresh();

drop trigger if exists lyricmatch_room_refresh_answers on lyricmatch.player_answers;
create trigger lyricmatch_room_refresh_answers
after insert or update or delete on lyricmatch.player_answers
for each row execute function lyricmatch.broadcast_room_refresh();

drop trigger if exists lyricmatch_room_refresh_messages on lyricmatch.messages;
create trigger lyricmatch_room_refresh_messages
after insert or update or delete on lyricmatch.messages
for each row execute function lyricmatch.broadcast_room_refresh();

-- A completed lyric lookup can arrive just after the clock has ended.  Keep
-- an explicit scoring marker so the answer is still credited exactly once.
alter table lyricmatch.player_answers
  add column if not exists scored_at timestamptz;

create or replace function lyricmatch.finish_current_round(
  p_room_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_room lyricmatch.rooms; v_round lyricmatch.rounds;
begin
  select * into v_room from lyricmatch.rooms where id = p_room_id for update;
  if not found or v_room.status <> 'playing' or v_room.round_ends_at > p_now then return false; end if;

  select * into v_round from lyricmatch.rounds
  where room_id = p_room_id and game_number = v_room.game_number and number = v_room.current_round
  for update;
  if not found then raise exception 'Round not found'; end if;

  with scored_answers as (
    update lyricmatch.player_answers a
    set scored_at = p_now
    where a.round_id = v_round.id and a.is_correct and a.scored_at is null
    returning a.player_id
  )
  update lyricmatch.players p
  set score = p.score + 10
  from scored_answers a
  where p.id = a.player_id;

  update lyricmatch.rounds set completed_at = p_now where id = v_round.id;
  update lyricmatch.rooms
  set status = 'analyzing', analysis_ends_at = p_now + make_interval(secs => v_room.analysis_seconds)
  where id = p_room_id;
  return true;
end;
$$;

create or replace function lyricmatch.record_answer_selection(p_track_id text)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_room lyricmatch.rooms; v_round lyricmatch.rounds;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_track_id !~ '^\d{1,20}$' then raise exception 'Invalid track' using errcode = '22023'; end if;

  -- Lock the room before the player.  Round completion takes the same order,
  -- so a click in the final second cannot deadlock against scoring.
  select * into v_player from lyricmatch.players where user_id = auth.uid();
  if not found then raise exception 'You are not a member of a room' using errcode = '42501'; end if;
  select * into v_room from lyricmatch.rooms where id = v_player.room_id for update;
  if v_room.status <> 'playing' or v_room.round_ends_at <= clock_timestamp() then
    raise exception 'The round is closed' using errcode = '22023';
  end if;
  select * into v_player from lyricmatch.players
  where id = v_player.id and room_id = v_room.id and user_id = auth.uid()
  for update;
  if not found then raise exception 'You are not a member of a room' using errcode = '42501'; end if;
  select * into v_round from lyricmatch.rounds
  where room_id = v_room.id and game_number = v_room.game_number and number = v_room.current_round;
  if not found then raise exception 'Round not found'; end if;

  insert into lyricmatch.player_answers (room_id, round_id, player_id, track_id, track, artist, is_correct)
  values (v_room.id, v_round.id, v_player.id, p_track_id, 'Verifying selection…', 'Verification pending', false)
  on conflict (round_id, player_id) do update
  set track_id = excluded.track_id, track = excluded.track, artist = excluded.artist,
      album_image = null, preview = null, is_correct = false, scored_at = null, created_at = now();

  return jsonb_build_object('roundId', v_round.id, 'word', v_round.word);
end;
$$;

create or replace function lyricmatch.complete_answer_verification(
  p_user_id uuid, p_round_id uuid, p_track_id text, p_track text, p_artist text,
  p_album_image text, p_preview text, p_is_correct boolean
)
returns boolean
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_player lyricmatch.players;
  v_room lyricmatch.rooms;
  v_round lyricmatch.rounds;
  v_answer lyricmatch.player_answers;
  v_scored boolean := false;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;

  select * into v_player from lyricmatch.players where user_id = p_user_id;
  if not found then return false; end if;
  -- Serialise verification with round completion, avoiding a race where a
  -- correct answer is written between scoring and the status transition.
  select * into v_room from lyricmatch.rooms where id = v_player.room_id for update;
  if not found then return false; end if;
  select * into v_round from lyricmatch.rounds where id = p_round_id for update;
  if not found or v_round.room_id <> v_room.id then return false; end if;
  select * into v_answer from lyricmatch.player_answers
  where round_id = p_round_id and player_id = v_player.id and track_id = p_track_id
  for update;
  if not found then return false; end if;

  update lyricmatch.player_answers
  set track = trim(p_track), artist = trim(p_artist), album_image = p_album_image,
      preview = p_preview, is_correct = p_is_correct
  where id = v_answer.id;

  if p_is_correct and v_round.completed_at is not null and v_answer.scored_at is null then
    update lyricmatch.player_answers
    set scored_at = clock_timestamp()
    where id = v_answer.id and scored_at is null
    returning true into v_scored;
    if v_scored then
      update lyricmatch.players set score = score + 10 where id = v_player.id;
    end if;
  end if;

  return true;
end;
$$;

-- Round progression is a server/scheduler responsibility.  Browser clients
-- may request their snapshot but cannot force a room forward.
revoke all on function lyricmatch.advance_due_rooms() from authenticated, anon, public;
grant execute on function lyricmatch.advance_due_rooms() to service_role;

-- Project activity is recorded inside the LyricMatch schema every six days.
-- It is deliberately unrelated to player membership or game presence.
create table if not exists lyricmatch.service_heartbeats (
  service text primary key,
  last_beat_at timestamptz not null default now()
);

insert into lyricmatch.service_heartbeats (service)
values ('project-activity')
on conflict (service) do nothing;

create or replace function lyricmatch.record_project_heartbeat()
returns void
language sql
security definer
set search_path = lyricmatch, public
as $$
  insert into lyricmatch.service_heartbeats (service, last_beat_at)
  values ('project-activity', clock_timestamp())
  on conflict (service) do update set last_beat_at = excluded.last_beat_at;
$$;

revoke all on function lyricmatch.record_project_heartbeat() from public, anon, authenticated;
grant execute on function lyricmatch.record_project_heartbeat() to service_role;

create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lyricmatch-project-heartbeat';
  perform cron.schedule('lyricmatch-project-heartbeat', '0 4 */6 * *', 'select lyricmatch.record_project_heartbeat()');
end;
$$;
