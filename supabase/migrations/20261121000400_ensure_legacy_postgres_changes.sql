-- The currently published Vercel bundle still listens to Postgres Changes.
-- Keep this compatibility transport enabled while the private Broadcast path
-- is rolled out.  The checks make this safe if the original publication setup
-- already ran.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'lyricmatch' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table lyricmatch.rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'lyricmatch' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table lyricmatch.players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'lyricmatch' and tablename = 'rounds'
  ) then
    alter publication supabase_realtime add table lyricmatch.rounds;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'lyricmatch' and tablename = 'player_answers'
  ) then
    alter publication supabase_realtime add table lyricmatch.player_answers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'lyricmatch' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table lyricmatch.messages;
  end if;
end;
$$;
