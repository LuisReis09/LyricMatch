-- Compatibility path for browser builds that predate record_answer_selection.
-- The Edge Function may persist the same narrow selection on their behalf,
-- but only for the authenticated user identified by its verified JWT.
create or replace function lyricmatch.record_answer_selection_for_user(
  p_user_id uuid,
  p_track_id text
)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_room lyricmatch.rooms; v_round lyricmatch.rounds;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;
  if p_track_id !~ '^\d{1,20}$' then raise exception 'Invalid track' using errcode = '22023'; end if;

  select * into v_player from lyricmatch.players where user_id = p_user_id;
  if not found then raise exception 'Player is not in a room' using errcode = '42501'; end if;
  select * into v_room from lyricmatch.rooms where id = v_player.room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'playing' or v_room.round_ends_at <= clock_timestamp() then
    raise exception 'The round is closed' using errcode = '22023';
  end if;
  select * into v_player from lyricmatch.players
  where id = v_player.id and room_id = v_room.id
  for update;
  if not found then raise exception 'Player is not in a room' using errcode = '42501'; end if;
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

revoke all on function lyricmatch.record_answer_selection_for_user(uuid, text) from public, anon, authenticated;
grant execute on function lyricmatch.record_answer_selection_for_user(uuid, text) to service_role;
