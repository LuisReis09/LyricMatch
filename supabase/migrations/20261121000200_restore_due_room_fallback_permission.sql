-- Browser versions already in circulation use this idempotent RPC as a
-- fallback when a Realtime event is delayed.  It can only process rooms whose
-- database timestamps are already due; it cannot advance a live round early.
-- Keep anonymous callers blocked while restoring the authenticated fallback.
revoke all on function lyricmatch.advance_due_rooms() from public, anon;
grant execute on function lyricmatch.advance_due_rooms() to authenticated, service_role;
