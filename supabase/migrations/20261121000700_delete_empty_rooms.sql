-- A room is useful only while it has at least one member.  Keep this rule in
-- the database so every player-removal path (leave, expiry, expulsion, or a
-- future administrative deletion) behaves consistently.
create or replace function lyricmatch.delete_room_when_empty()
returns trigger
language plpgsql
security definer
set search_path = lyricmatch, public
as $$
begin
  -- Serialize cleanup for a room.  The row lock also coordinates with joins,
  -- which lock the room before inserting a player, so a room cannot be
  -- deleted while another transaction is joining it.
  perform pg_advisory_xact_lock(hashtextextended(old.room_id::text, 0));
  perform 1
  from lyricmatch.rooms
  where id = old.room_id
  for update;

  if not exists (
    select 1
    from lyricmatch.players
    where room_id = old.room_id
  ) then
    delete from lyricmatch.rooms where id = old.room_id;
  end if;

  return null;
end;
$$;

drop trigger if exists lyricmatch_delete_empty_room on lyricmatch.players;
create trigger lyricmatch_delete_empty_room
after delete on lyricmatch.players
for each row execute function lyricmatch.delete_room_when_empty();

-- Also remove rooms left empty before this migration was installed.  Deleting
-- a room releases its unique code and cascades to its related game data.
delete from lyricmatch.rooms r
where not exists (
  select 1
  from lyricmatch.players p
  where p.room_id = r.id
);
