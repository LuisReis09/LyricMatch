-- LyricMatch is deliberately isolated from other applications that share this
-- Supabase project. This migration creates only objects in the lyricmatch schema.

create schema if not exists lyricmatch;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type lyricmatch.room_status as enum ('waiting', 'playing', 'analyzing', 'finished');
exception
  when duplicate_object then null;
end $$;

create table if not exists lyricmatch.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  password_hash text,
  max_rounds integer not null default 10 check (max_rounds between 1 and 50),
  max_players integer not null default 4 check (max_players between 1 and 100),
  language text not null default 'EN' check (language in ('EN', 'PT', 'ES')),
  status lyricmatch.room_status not null default 'waiting',
  current_round integer not null default 0 check (current_round >= 0),
  game_number integer not null default 0 check (game_number >= 0),
  current_word text,
  round_seconds integer not null default 30 check (round_seconds between 10 and 300),
  analysis_seconds integer not null default 12 check (analysis_seconds between 5 and 120),
  round_started_at timestamptz,
  round_ends_at timestamptz,
  analysis_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lyricmatch.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references lyricmatch.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  avatar text,
  score integer not null default 0 check (score >= 0),
  is_host boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create unique index if not exists players_one_host_per_room
  on lyricmatch.players (room_id) where is_host;
create unique index if not exists players_one_room_per_user
  on lyricmatch.players (user_id);
create index if not exists players_room_id_idx on lyricmatch.players(room_id);
create index if not exists players_user_id_idx on lyricmatch.players(user_id);

create table if not exists lyricmatch.words (
  id bigint generated always as identity primary key,
  language text not null check (language in ('EN', 'PT', 'ES')),
  word text not null check (char_length(trim(word)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (language, word)
);

create table if not exists lyricmatch.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references lyricmatch.rooms(id) on delete cascade,
  game_number integer not null,
  number integer not null check (number > 0),
  word text not null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  completed_at timestamptz,
  unique (room_id, game_number, number)
);
create index if not exists rounds_room_game_idx on lyricmatch.rounds(room_id, game_number, number);

create table if not exists lyricmatch.player_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references lyricmatch.rooms(id) on delete cascade,
  round_id uuid not null references lyricmatch.rounds(id) on delete cascade,
  player_id uuid not null references lyricmatch.players(id) on delete cascade,
  track_id text not null,
  track text not null,
  artist text not null,
  album_image text,
  preview text,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);
create index if not exists player_answers_room_round_idx on lyricmatch.player_answers(room_id, round_id);

create table if not exists lyricmatch.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references lyricmatch.rooms(id) on delete cascade,
  player_id uuid not null references lyricmatch.players(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_created_idx on lyricmatch.messages(room_id, created_at);

-- The old implementation stored an IP address. The replacement keeps only an
-- optional, rounded location supplied by the player and never stores an IP.
create table if not exists lyricmatch.player_locations (
  player_id uuid primary key references lyricmatch.players(id) on delete cascade,
  city text,
  latitude numeric(5,2),
  longitude numeric(5,2),
  updated_at timestamptz not null default now(),
  check (latitude between -90 and 90),
  check (longitude between -180 and 180)
);

-- Fixed one-minute buckets are sufficient protection for the public music
-- providers and do not depend on an Edge Function instance staying warm.
create table if not exists lyricmatch.request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  bucket timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, action, bucket)
);

create or replace function lyricmatch.set_updated_at()
returns trigger
language plpgsql
set search_path = lyricmatch, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on lyricmatch.rooms;
create trigger rooms_set_updated_at before update on lyricmatch.rooms
for each row execute function lyricmatch.set_updated_at();
drop trigger if exists players_set_updated_at on lyricmatch.players;
create trigger players_set_updated_at before update on lyricmatch.players
for each row execute function lyricmatch.set_updated_at();

create or replace function lyricmatch.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = lyricmatch, public
as $$
  select exists (
    select 1 from lyricmatch.players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function lyricmatch.require_player(p_room_id uuid)
returns lyricmatch.players
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_player lyricmatch.players;
begin
  select * into v_player
  from lyricmatch.players
  where room_id = p_room_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'You are not a member of this room' using errcode = '42501';
  end if;

  return v_player;
end;
$$;

create or replace function lyricmatch.can_read_answer(p_room_id uuid, p_player_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = lyricmatch, public
as $$
declare v_my_player_id uuid; v_status lyricmatch.room_status;
begin
  select id into v_my_player_id from lyricmatch.players
  where room_id = p_room_id and user_id = auth.uid();
  if v_my_player_id is null then return false; end if;
  select status into v_status from lyricmatch.rooms where id = p_room_id;
  return v_status <> 'playing' or v_my_player_id = p_player_id;
end;
$$;

create or replace function lyricmatch.new_room_code()
returns text
language plpgsql
volatile
security definer
set search_path = lyricmatch, public
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 6));
    exit when not exists (select 1 from lyricmatch.rooms where code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function lyricmatch.start_next_round(p_room_id uuid, p_now timestamptz default clock_timestamp())
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_room lyricmatch.rooms;
  v_word text;
  v_round integer;
begin
  select * into v_room from lyricmatch.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;

  v_round := v_room.current_round + 1;
  select w.word into v_word
  from lyricmatch.words w
  where w.language = v_room.language
    and not exists (
      select 1 from lyricmatch.rounds r
      where r.room_id = v_room.id and r.game_number = v_room.game_number and r.word = w.word
    )
  order by random()
  limit 1;

  if v_word is null then
    raise exception 'There are no unused words for this room language';
  end if;

  insert into lyricmatch.rounds (room_id, game_number, number, word, started_at, ends_at)
  values (v_room.id, v_room.game_number, v_round, v_word, p_now, p_now + make_interval(secs => v_room.round_seconds));

  update lyricmatch.rooms
  set current_round = v_round,
      current_word = v_word,
      status = 'playing',
      round_started_at = p_now,
      round_ends_at = p_now + make_interval(secs => v_room.round_seconds),
      analysis_ends_at = null
  where id = v_room.id;
end;
$$;

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
  if exists (select 1 from lyricmatch.players where user_id = auth.uid()) then
    raise exception 'Leave your current room before creating another room';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Invalid player name'; end if;
  if p_max_players not between 1 and 100 or p_max_rounds not between 1 and 50 then raise exception 'Invalid room limits'; end if;
  if p_language not in ('EN', 'PT', 'ES') then raise exception 'Invalid language'; end if;
  if p_round_seconds not between 10 and 300 then raise exception 'Invalid round duration'; end if;

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

  select * into v_room from lyricmatch.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status = 'finished' then raise exception 'This room has finished'; end if;
  if v_room.password_hash is not null and extensions.crypt(coalesce(p_password, ''), v_room.password_hash) <> v_room.password_hash then
    raise exception 'Invalid room password';
  end if;

  select * into v_player from lyricmatch.players
  where room_id = v_room.id and user_id = auth.uid() for update;

  if found then
    update lyricmatch.players
    set name = trim(p_name), avatar = nullif(p_avatar, ''), last_seen_at = now()
    where id = v_player.id returning * into v_player;
  else
    if exists (select 1 from lyricmatch.players where user_id = auth.uid()) then
      raise exception 'Leave your current room before joining another room';
    end if;
    if (select count(*) from lyricmatch.players where room_id = v_room.id) >= v_room.max_players then
      raise exception 'Room is full';
    end if;
    insert into lyricmatch.players (room_id, user_id, name, avatar)
    values (v_room.id, auth.uid(), trim(p_name), nullif(p_avatar, '')) returning * into v_player;
  end if;

  return jsonb_build_object('roomId', v_room.id, 'playerId', v_player.id);
end;
$$;

create or replace function lyricmatch.room_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare
  v_room lyricmatch.rooms;
  v_player lyricmatch.players;
  v_round_id uuid;
begin
  v_player := lyricmatch.require_player(p_room_id);
  select * into v_room from lyricmatch.rooms where id = p_room_id;
  if not found then raise exception 'Room not found'; end if;

  select id into v_round_id from lyricmatch.rounds
  where room_id = v_room.id and game_number = v_room.game_number and number = v_room.current_round;

  return jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'maxPlayers', v_room.max_players,
    'maxRounds', v_room.max_rounds,
    'language', v_room.language,
    'status', v_room.status,
    'currentRound', v_room.current_round,
    'currentWord', v_room.current_word,
    'roundTimer', v_room.round_seconds,
    'roundStartedAt', v_room.round_started_at,
    'roundEndsAt', v_room.round_ends_at,
    'analysisEndsAt', v_room.analysis_ends_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'userId', p.user_id, 'name', p.name, 'avatar', p.avatar,
        'score', p.score, 'isHost', p.is_host, 'lastSeenAt', p.last_seen_at
      ) order by p.is_host desc, p.created_at asc)
      from lyricmatch.players p where p.room_id = v_room.id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'playerId', m.player_id, 'message', m.message, 'createdAt', m.created_at
      ) order by m.created_at asc)
      from (
        select * from lyricmatch.messages where room_id = v_room.id order by created_at desc limit 100
      ) m
    ), '[]'::jsonb),
    'answers', case when v_round_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'playerId', a.player_id, 'track', a.track, 'artist', a.artist,
        'albumImage', a.album_image, 'preview', a.preview, 'isCorrect', a.is_correct
      ) order by a.created_at asc)
      from lyricmatch.player_answers a
      where a.round_id = v_round_id
        and (v_room.status <> 'playing' or a.player_id = v_player.id)
    ), '[]'::jsonb) end
  );
end;
$$;

create or replace function lyricmatch.touch_presence(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
begin
  update lyricmatch.players set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
end;
$$;

create or replace function lyricmatch.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_room lyricmatch.rooms;
begin
  v_player := lyricmatch.require_player(p_room_id);
  if not v_player.is_host then raise exception 'Only the host can start the game' using errcode = '42501'; end if;
  select * into v_room from lyricmatch.rooms where id = p_room_id for update;
  if v_room.status not in ('waiting', 'finished') then raise exception 'The game has already started'; end if;
  update lyricmatch.rooms
  set game_number = v_room.game_number + 1, current_round = 0, current_word = null,
      round_started_at = null, round_ends_at = null, analysis_ends_at = null, status = 'waiting'
  where id = p_room_id;
  update lyricmatch.players set score = 0 where room_id = p_room_id;
  perform lyricmatch.start_next_round(p_room_id);
end;
$$;

create or replace function lyricmatch.finish_current_round(p_room_id uuid, p_now timestamptz default clock_timestamp())
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
  where room_id = p_room_id and game_number = v_room.game_number and number = v_room.current_round for update;
  update lyricmatch.players p
  set score = p.score + 10
  from lyricmatch.player_answers a
  where a.round_id = v_round.id and a.player_id = p.id and a.is_correct;
  update lyricmatch.rounds set completed_at = p_now where id = v_round.id;
  update lyricmatch.rooms
  set status = 'analyzing', analysis_ends_at = p_now + make_interval(secs => v_room.analysis_seconds)
  where id = p_room_id;
  return true;
end;
$$;

create or replace function lyricmatch.cleanup_stale_players()
returns integer
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_next_id uuid; v_removed integer := 0;
begin
  for v_player in
    select * from lyricmatch.players
    where last_seen_at < clock_timestamp() - interval '120 seconds'
    for update skip locked
  loop
    delete from lyricmatch.players where id = v_player.id;
    if v_player.is_host then
      select id into v_next_id from lyricmatch.players
      where room_id = v_player.room_id order by created_at asc limit 1;
      if v_next_id is not null then
        update lyricmatch.players set is_host = true where id = v_next_id;
      end if;
    end if;
    v_removed := v_removed + 1;
  end loop;
  return v_removed;
end;
$$;

create or replace function lyricmatch.advance_due_rooms()
returns integer
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_room lyricmatch.rooms; v_now timestamptz := clock_timestamp(); v_count integer := 0;
begin
  perform lyricmatch.cleanup_stale_players();
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

create or replace function lyricmatch.next_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_room lyricmatch.rooms;
begin
  v_player := lyricmatch.require_player(p_room_id);
  if not v_player.is_host then raise exception 'Only the host can advance the round' using errcode = '42501'; end if;
  select * into v_room from lyricmatch.rooms where id = p_room_id for update;
  if v_room.status <> 'analyzing' then raise exception 'The round is not ready to advance'; end if;
  if v_room.current_round >= v_room.max_rounds then
    update lyricmatch.rooms set status = 'finished', analysis_ends_at = null where id = p_room_id;
  else
    perform lyricmatch.start_next_round(p_room_id);
  end if;
end;
$$;

create or replace function lyricmatch.send_message(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players;
begin
  v_player := lyricmatch.require_player(p_room_id);
  insert into lyricmatch.messages (room_id, player_id, message)
  values (p_room_id, v_player.id, trim(p_message));
end;
$$;

create or replace function lyricmatch.expel_player(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_host lyricmatch.players;
begin
  v_host := lyricmatch.require_player(p_room_id);
  if not v_host.is_host then raise exception 'Only the host can expel players' using errcode = '42501'; end if;
  if v_host.id = p_player_id then raise exception 'The host cannot expel themselves'; end if;
  delete from lyricmatch.players where id = p_player_id and room_id = p_room_id;
  if not found then raise exception 'Player not found'; end if;
end;
$$;

create or replace function lyricmatch.change_host(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_host lyricmatch.players;
begin
  v_host := lyricmatch.require_player(p_room_id);
  if not v_host.is_host then raise exception 'Only the host can change host' using errcode = '42501'; end if;
  if not exists (select 1 from lyricmatch.players where id = p_player_id and room_id = p_room_id) then
    raise exception 'Player not found';
  end if;
  update lyricmatch.players set is_host = false where id = v_host.id;
  update lyricmatch.players set is_host = true where id = p_player_id;
end;
$$;

create or replace function lyricmatch.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_next_id uuid;
begin
  v_player := lyricmatch.require_player(p_room_id);
  delete from lyricmatch.players where id = v_player.id;
  if v_player.is_host then
    select id into v_next_id from lyricmatch.players where room_id = p_room_id order by created_at asc limit 1;
    if v_next_id is not null then update lyricmatch.players set is_host = true where id = v_next_id; end if;
  end if;
end;
$$;

create or replace function lyricmatch.reset_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players;
begin
  v_player := lyricmatch.require_player(p_room_id);
  if not v_player.is_host then raise exception 'Only the host can reset the room' using errcode = '42501'; end if;
  update lyricmatch.rooms
  set status = 'waiting', current_round = 0, current_word = null, round_started_at = null,
      round_ends_at = null, analysis_ends_at = null
  where id = p_room_id;
  update lyricmatch.players set score = 0 where room_id = p_room_id;
end;
$$;

-- Only an Edge Function with the service-role key may call this function. It
-- records server-validated results; a browser can never set is_correct itself.
create or replace function lyricmatch.record_verified_answer(
  p_user_id uuid,
  p_track_id text,
  p_track text,
  p_artist text,
  p_album_image text,
  p_preview text,
  p_is_correct boolean
)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players; v_room lyricmatch.rooms; v_round lyricmatch.rounds;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to the verifier' using errcode = '42501';
  end if;
  select * into v_player from lyricmatch.players where user_id = p_user_id order by updated_at desc limit 1;
  if not found then raise exception 'Player is not in a room'; end if;
  select * into v_room from lyricmatch.rooms where id = v_player.room_id for update;
  if v_room.status <> 'playing' or v_room.round_ends_at <= clock_timestamp() then raise exception 'The round is closed'; end if;
  select * into v_round from lyricmatch.rounds
  where room_id = v_room.id and game_number = v_room.game_number and number = v_room.current_round;
  if not found then raise exception 'Round not found'; end if;
  if char_length(trim(p_track)) = 0 or char_length(trim(p_artist)) = 0 then raise exception 'Invalid track'; end if;
  insert into lyricmatch.player_answers (room_id, round_id, player_id, track_id, track, artist, album_image, preview, is_correct)
  values (v_room.id, v_round.id, v_player.id, p_track_id, trim(p_track), trim(p_artist), p_album_image, p_preview, p_is_correct)
  on conflict (round_id, player_id) do update
  set track_id = excluded.track_id, track = excluded.track, artist = excluded.artist,
      album_image = excluded.album_image, preview = excluded.preview, is_correct = excluded.is_correct,
      created_at = now();
end;
$$;

create or replace function lyricmatch.consume_rate_limit(p_user_id uuid, p_action text, p_max_requests integer)
returns boolean
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_bucket timestamptz := date_trunc('minute', clock_timestamp()); v_count integer;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'This operation is restricted to server-side callers' using errcode = '42501';
  end if;
  insert into lyricmatch.request_limits (user_id, action, bucket, request_count)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket) do update
  set request_count = lyricmatch.request_limits.request_count + 1
  where lyricmatch.request_limits.request_count < p_max_requests
  returning request_count into v_count;
  return v_count is not null;
end;
$$;

create or replace function lyricmatch.record_location(p_room_id uuid, p_city text, p_latitude numeric, p_longitude numeric)
returns void
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_player lyricmatch.players;
begin
  v_player := lyricmatch.require_player(p_room_id);
  insert into lyricmatch.player_locations (player_id, city, latitude, longitude)
  values (v_player.id, nullif(trim(p_city), ''), round(p_latitude, 2), round(p_longitude, 2))
  on conflict (player_id) do update
  set city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now();
end;
$$;

create or replace function lyricmatch.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = lyricmatch, public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'lyricmatch_admin', 'false') <> 'true' then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function lyricmatch.admin_metrics()
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
declare v_rooms integer; v_players integer; v_connected integer;
begin
  perform lyricmatch.require_admin();
  select count(*) into v_rooms from lyricmatch.rooms where status in ('waiting', 'playing', 'analyzing');
  select count(*) into v_players from lyricmatch.players p join lyricmatch.rooms r on r.id = p.room_id where r.status in ('waiting', 'playing', 'analyzing');
  select count(*) into v_connected from lyricmatch.players where last_seen_at >= now() - interval '60 seconds';
  return jsonb_build_object('activeRoomCount', v_rooms, 'activePlayerCount', v_players,
    'connectedWebSocketClientCount', v_connected,
    'averageClients', case when v_rooms = 0 then 0 else round(v_players::numeric / v_rooms, 2) end);
end;
$$;

create or replace function lyricmatch.admin_location_aggregates()
returns jsonb
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
begin
  perform lyricmatch.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('city', city, 'latitude', latitude, 'longitude', longitude, 'count', count))
    from (
      select l.city, l.latitude, l.longitude, count(*)::integer as count
      from lyricmatch.player_locations l
      join lyricmatch.players p on p.id = l.player_id
      join lyricmatch.rooms r on r.id = p.room_id
      where r.status in ('waiting', 'playing', 'analyzing')
      group by l.city, l.latitude, l.longitude
    ) grouped
  ), '[]'::jsonb);
end;
$$;

alter table lyricmatch.rooms enable row level security;
alter table lyricmatch.players enable row level security;
alter table lyricmatch.rounds enable row level security;
alter table lyricmatch.player_answers enable row level security;
alter table lyricmatch.messages enable row level security;
alter table lyricmatch.words enable row level security;
alter table lyricmatch.player_locations enable row level security;

create policy rooms_members_can_read on lyricmatch.rooms for select to authenticated using (lyricmatch.is_room_member(id));
create policy players_members_can_read on lyricmatch.players for select to authenticated using (lyricmatch.is_room_member(room_id));
create policy rounds_members_can_read on lyricmatch.rounds for select to authenticated using (lyricmatch.is_room_member(room_id));
create policy answers_members_can_read on lyricmatch.player_answers for select to authenticated using (lyricmatch.can_read_answer(room_id, player_id));
create policy messages_members_can_read on lyricmatch.messages for select to authenticated using (lyricmatch.is_room_member(room_id));

grant usage on schema lyricmatch to authenticated, service_role;
grant select on lyricmatch.rooms, lyricmatch.players, lyricmatch.rounds, lyricmatch.player_answers, lyricmatch.messages to authenticated;
revoke all on all tables in schema lyricmatch from anon, authenticated;
grant select on lyricmatch.rooms, lyricmatch.players, lyricmatch.rounds, lyricmatch.player_answers, lyricmatch.messages to authenticated;
revoke all on all functions in schema lyricmatch from public, anon, authenticated;
grant execute on function lyricmatch.create_room(text, text, text, integer, integer, text, integer) to authenticated;
grant execute on function lyricmatch.join_room(text, text, text, text) to authenticated;
grant execute on function lyricmatch.room_snapshot(uuid) to authenticated;
grant execute on function lyricmatch.touch_presence(uuid) to authenticated;
grant execute on function lyricmatch.start_game(uuid) to authenticated;
grant execute on function lyricmatch.advance_due_rooms() to authenticated;
grant execute on function lyricmatch.next_round(uuid) to authenticated;
grant execute on function lyricmatch.send_message(uuid, text) to authenticated;
grant execute on function lyricmatch.expel_player(uuid, uuid) to authenticated;
grant execute on function lyricmatch.change_host(uuid, uuid) to authenticated;
grant execute on function lyricmatch.leave_room(uuid) to authenticated;
grant execute on function lyricmatch.reset_room(uuid) to authenticated;
grant execute on function lyricmatch.record_location(uuid, text, numeric, numeric) to authenticated;
grant execute on function lyricmatch.admin_metrics() to authenticated;
grant execute on function lyricmatch.admin_location_aggregates() to authenticated;
grant execute on function lyricmatch.record_verified_answer(uuid, text, text, text, text, text, boolean) to service_role;
grant execute on function lyricmatch.consume_rate_limit(uuid, text, integer) to service_role;

alter publication supabase_realtime add table lyricmatch.rooms, lyricmatch.players, lyricmatch.rounds, lyricmatch.player_answers, lyricmatch.messages;
