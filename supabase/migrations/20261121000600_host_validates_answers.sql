-- Hosts can correct a false-negative lyric verification while answers are
-- visible between rounds. Keep the awarded amount on each answer so retries
-- are idempotent and a shared track always receives the intended total.

alter table lyricmatch.player_answers
  add column if not exists points_awarded integer not null default 0
  check (points_awarded >= 0);

-- Previous scored answers were awarded ten points by the former scorer.
update lyricmatch.player_answers
set points_awarded = 10
where scored_at is not null and points_awarded = 0;

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
  if not found or v_room.status <> 'playing' or v_room.round_ends_at > p_now then
    return false;
  end if;

  select * into v_round from lyricmatch.rounds
  where room_id = p_room_id
    and game_number = v_room.game_number
    and number = v_room.current_round
  for update;
  if not found then raise exception 'Round not found'; end if;

  with scored_answers as (
    update lyricmatch.player_answers a
    set scored_at = p_now, points_awarded = 10
    where a.round_id = v_round.id and a.is_correct and a.scored_at is null
    returning a.player_id
  )
  update lyricmatch.players p
  set score = p.score + 10
  from scored_answers a
  where p.id = a.player_id;

  update lyricmatch.rounds set completed_at = p_now where id = v_round.id;
  update lyricmatch.rooms
  set status = 'analyzing', analysis_ends_at = null
  where id = p_room_id;
  return true;
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
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;
  select * into v_player from lyricmatch.players where user_id = p_user_id;
  if not found then return false; end if;
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
    set scored_at = clock_timestamp(), points_awarded = 10
    where id = v_answer.id and scored_at is null;
    if found then
      update lyricmatch.players set score = score + 10 where id = v_player.id;
    end if;
  end if;

  return true;
end;
$$;

create or replace function lyricmatch.validate_answer(p_answer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_host lyricmatch.players;
  v_room lyricmatch.rooms;
  v_round lyricmatch.rounds;
  v_answer lyricmatch.player_answers;
  v_matching_attempts integer;
  v_points integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_host
  from lyricmatch.players
  where user_id = auth.uid()
  for update;
  if not found or not v_host.is_host then
    raise exception 'Only the host can validate an answer' using errcode = '42501';
  end if;

  select * into v_room from lyricmatch.rooms where id = v_host.room_id for update;
  if not found or v_room.status <> 'analyzing' then
    raise exception 'Answers can only be validated between rounds' using errcode = '22023';
  end if;
  select * into v_round from lyricmatch.rounds
  where room_id = v_room.id
    and game_number = v_room.game_number
    and number = v_room.current_round
  for update;
  if not found then raise exception 'Round not found'; end if;
  select * into v_answer from lyricmatch.player_answers
  where id = p_answer_id and room_id = v_room.id and round_id = v_round.id
  for update;
  if not found then raise exception 'Answer not found in this round' using errcode = '22023'; end if;

  select count(*) into v_matching_attempts
  from lyricmatch.player_answers
  where round_id = v_round.id and track_id = v_answer.track_id;
  v_points := case when v_matching_attempts = 1 then 10 else 5 end;

  with matching_answers as (
    select id, player_id, v_points - points_awarded as score_delta
    from lyricmatch.player_answers
    where round_id = v_round.id and track_id = v_answer.track_id
    for update
  ), updated_answers as (
    update lyricmatch.player_answers a
    set is_correct = true,
        scored_at = coalesce(a.scored_at, clock_timestamp()),
        points_awarded = v_points
    from matching_answers m
    where a.id = m.id
    returning m.player_id, m.score_delta
  )
  update lyricmatch.players p
  set score = p.score + u.score_delta
  from updated_answers u
  where p.id = u.player_id;

  return jsonb_build_object('attempts', v_matching_attempts, 'pointsPerPlayer', v_points);
end;
$$;

revoke all on function lyricmatch.validate_answer(uuid) from public, anon;
grant execute on function lyricmatch.validate_answer(uuid) to authenticated;
