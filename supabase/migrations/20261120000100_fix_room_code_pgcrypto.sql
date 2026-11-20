-- Supabase installs pgcrypto functions in the extensions schema. Keep the
-- reference explicit because lyricmatch functions intentionally use a narrow
-- search_path for security.
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
    v_code := upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 6));
    exit when not exists (select 1 from lyricmatch.rooms where code = v_code);
  end loop;
  return v_code;
end;
$$;
