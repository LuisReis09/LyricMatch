-- Keep game time on the database, not on an open browser tab.  In particular,
-- never use a missed browser heartbeat as a reason to delete a player.

create or replace function lyricmatch.advance_due_rooms()
returns integer
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_room lyricmatch.rooms; v_now timestamptz := clock_timestamp(); v_count integer := 0;
begin
  for v_room in
    select * from lyricmatch.rooms
    where (status = 'playing' and round_ends_at <= v_now)
       or (status = 'analyzing' and analysis_ends_at <= v_now)
    for update skip locked
  loop
    if v_room.status = 'playing' then
      if lyricmatch.finish_current_round(v_room.id, v_now) then v_count := v_count + 1; end if;
    elsif v_room.current_round >= v_room.max_rounds then
      update lyricmatch.rooms set status = 'finished', analysis_ends_at = null where id = v_room.id;
      v_count := v_count + 1;
    else
      perform lyricmatch.start_next_round(v_room.id, v_now);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Selecting a search result is a durable, authorized game action.  Lyric
-- lookup happens afterwards and must not make the selection disappear.
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

  select * into v_player from lyricmatch.players where user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of a room' using errcode = '42501'; end if;
  select * into v_room from lyricmatch.rooms where id = v_player.room_id for update;
  if v_room.status <> 'playing' or v_room.round_ends_at <= clock_timestamp() then
    raise exception 'The round is closed' using errcode = '22023';
  end if;
  select * into v_round from lyricmatch.rounds
  where room_id = v_room.id and game_number = v_room.game_number and number = v_room.current_round;
  if not found then raise exception 'Round not found'; end if;

  insert into lyricmatch.player_answers (room_id, round_id, player_id, track_id, track, artist, is_correct)
  values (v_room.id, v_round.id, v_player.id, p_track_id, 'Verifying selection…', 'Verification pending', false)
  on conflict (round_id, player_id) do update
  set track_id = excluded.track_id, track = excluded.track, artist = excluded.artist,
      album_image = null, preview = null, is_correct = false, created_at = now();

  return jsonb_build_object('roundId', v_round.id, 'word', v_round.word);
end;
$$;

create or replace function lyricmatch.answer_verification_context(p_user_id uuid, p_track_id text)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_result jsonb;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;
  select jsonb_build_object('roundId', a.round_id, 'word', r.word)
  into v_result
  from lyricmatch.players p
  join lyricmatch.player_answers a on a.player_id = p.id
  join lyricmatch.rounds r on r.id = a.round_id
  where p.user_id = p_user_id and a.track_id = p_track_id
  order by a.created_at desc
  limit 1;
  if v_result is null then raise exception 'No selection exists for this track'; end if;
  return v_result;
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
declare v_player lyricmatch.players;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;
  select * into v_player from lyricmatch.players where user_id = p_user_id;
  if not found then return false; end if;
  update lyricmatch.player_answers
  set track = trim(p_track), artist = trim(p_artist), album_image = p_album_image,
      preview = p_preview, is_correct = p_is_correct
  where round_id = p_round_id and player_id = v_player.id and track_id = p_track_id;
  return found;
end;
$$;

revoke all on function lyricmatch.record_answer_selection(text) from public, anon;
grant execute on function lyricmatch.record_answer_selection(text) to authenticated;
revoke all on function lyricmatch.answer_verification_context(uuid, text) from public, anon, authenticated;
revoke all on function lyricmatch.complete_answer_verification(uuid, uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function lyricmatch.answer_verification_context(uuid, text) to service_role;
grant execute on function lyricmatch.complete_answer_verification(uuid, uuid, text, text, text, text, text, boolean) to service_role;

-- Supabase Cron owns progression even when every browser is idle.  The job is
-- intentionally idempotent: the row locks in advance_due_rooms permit many
-- invocations without double-scoring a round.
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lyricmatch-advance-due-rooms';
  perform cron.schedule('lyricmatch-advance-due-rooms', '5 seconds', 'select lyricmatch.advance_due_rooms()');
end;
$$;
