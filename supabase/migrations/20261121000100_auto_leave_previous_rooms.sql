-- A remembered anonymous identity may still be a member of a room after a
-- browser close or an interrupted session.  Starting a new room journey must
-- be able to replace that old membership without asking the player to recover
-- an inaccessible room code first.
create or replace function lyricmatch.leave_user_rooms(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_player lyricmatch.players;
  v_next_player_id uuid;
begin
  for v_player in
    select *
    from lyricmatch.players
    where user_id = p_user_id
    order by room_id
    for update
  loop
    delete from lyricmatch.players where id = v_player.id;

    if v_player.is_host then
      select id into v_next_player_id
      from lyricmatch.players
      where room_id = v_player.room_id
      order by created_at asc
      limit 1
      for update;

      if v_next_player_id is not null then
        update lyricmatch.players set is_host = true where id = v_next_player_id;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function lyricmatch.leave_user_rooms(uuid) from public, anon, authenticated;

create or replace function lyricmatch.create_room(
  p_name text,
  p_avatar text,
  p_password text,
  p_max_players integer,
  p_max_rounds integer,
  p_language text,
  p_round_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_room lyricmatch.rooms;
  v_player lyricmatch.players;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Invalid player name'; end if;
  if p_max_players not between 1 and 100 or p_max_rounds not between 1 and 50 then raise exception 'Invalid room limits'; end if;
  if p_language not in ('EN', 'PT', 'ES') then raise exception 'Invalid language'; end if;
  if p_round_seconds not between 10 and 300 then raise exception 'Invalid round duration'; end if;

  -- Prevent two tabs with the same anonymous account from creating/joining
  -- different rooms at the same time and violating the one-room invariant.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  perform lyricmatch.leave_user_rooms(auth.uid());

  insert into lyricmatch.rooms (code, password_hash, max_players, max_rounds, language, round_seconds)
  values (
    lyricmatch.new_room_code(),
    case when nullif(p_password, '') is null then null else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
    p_max_players, p_max_rounds, p_language, p_round_seconds
  ) returning * into v_room;

  insert into lyricmatch.players (room_id, user_id, name, avatar, is_host)
  values (v_room.id, auth.uid(), trim(p_name), nullif(p_avatar, ''), true)
  returning * into v_player;

  return jsonb_build_object('roomId', v_room.id, 'playerId', v_player.id);
end;
$$;

create or replace function lyricmatch.join_room(
  p_code text,
  p_name text,
  p_avatar text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_room lyricmatch.rooms;
  v_player lyricmatch.players;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Invalid player name'; end if;

  -- Validate first: a typo, expired room, or wrong password never removes the
  -- player from their current room.
  select * into v_room from lyricmatch.rooms where code = upper(trim(p_code));
  if not found then raise exception 'Room not found'; end if;
  if v_room.status = 'finished' then raise exception 'This room has finished'; end if;
  if v_room.password_hash is not null and extensions.crypt(coalesce(p_password, ''), v_room.password_hash) <> v_room.password_hash then
    raise exception 'Invalid room password';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  -- Re-entering the same room is a reconnect, not a leave-and-rejoin.
  select * into v_player from lyricmatch.players
  where room_id = v_room.id and user_id = auth.uid()
  for update;
  if found then
    update lyricmatch.players
    set name = trim(p_name), avatar = nullif(p_avatar, ''), last_seen_at = now()
    where id = v_player.id returning * into v_player;
    return jsonb_build_object('roomId', v_room.id, 'playerId', v_player.id);
  end if;

  perform lyricmatch.leave_user_rooms(auth.uid());

  -- Lock and check the target again after leaving.  Capacity and room status
  -- may have changed while this user was being removed from an old room.
  select * into v_room from lyricmatch.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status = 'finished' then raise exception 'This room has finished'; end if;
  if v_room.password_hash is not null and extensions.crypt(coalesce(p_password, ''), v_room.password_hash) <> v_room.password_hash then
    raise exception 'Invalid room password';
  end if;
  if (select count(*) from lyricmatch.players where room_id = v_room.id) >= v_room.max_players then
    raise exception 'Room is full';
  end if;

  insert into lyricmatch.players (room_id, user_id, name, avatar)
  values (v_room.id, auth.uid(), trim(p_name), nullif(p_avatar, ''))
  returning * into v_player;

  return jsonb_build_object('roomId', v_room.id, 'playerId', v_player.id);
end;
$$;
