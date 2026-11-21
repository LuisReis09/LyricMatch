-- A round's answer phase ends on the server clock, but its results remain
-- visible until the host explicitly advances. In particular, the final
-- ranking is never opened by a scheduler timeout.

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
    where status = 'playing' and round_ends_at <= v_now
    for update skip locked
  loop
    if lyricmatch.finish_current_round(v_room.id, v_now) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

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
  if not found then
    raise exception 'Round not found';
  end if;

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
  set status = 'analyzing', analysis_ends_at = null
  where id = p_room_id;
  return true;
end;
$$;
