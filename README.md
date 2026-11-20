# LyricMatch

LyricMatch is a multiplayer song-association game. The browser is a React/Vite
application; Supabase is the complete backend: Auth provides an anonymous
player identity, PostgreSQL stores and authorizes game state, Realtime sends
room changes, and Edge Functions isolate music-provider and lyric-validation
requests. The production frontend is designed for Vercel.

## Architecture

```
Vercel (front/) ── publishable key ──> Supabase Auth + Realtime
       │                                      │
       ├─ protected RPCs ─────────────────────> lyricmatch PostgreSQL schema
       └─ Edge Functions ─────────────────────> Deezer / lyric providers
                                               │
                               scheduled advance-rounds function
```

All game resources live in the `lyricmatch` schema. No table, policy, trigger,
or function in `public` or another application's schema is changed.

### Multiplayer model

- A visitor signs in anonymously once; the Supabase user id is the player
  identity and survives a reconnect in the same browser.
- `create_room`, `join_room`, `start_game`, host changes, kick, leave, chat,
  reset, and next round are PostgreSQL RPCs. The database validates membership
  and host status for every sensitive operation.
- A room snapshot is the client state source of truth. The app subscribes to
  Postgres Changes for its room and reloads that authorized snapshot after a
  change. `Presence` heartbeats track recent activity without controlling game
  authority.
- `round_ends_at` is the authoritative server timestamp. `advance_due_rooms`
  atomically ends a round, scores answers once, and starts/finishes following
  rounds. A client can request a due-state check as a fallback, but a scheduled
  Edge Function advances games when no browser remains open.
- Answer correctness is computed only in `submit-answer`: it resolves the
  selected Deezer track, retrieves lyrics server-side, then invokes a
  service-role-only SQL function. Browsers cannot submit a score or correctness
  flag.

## Required configuration

Copy the example files; never commit a real `.env`.

```powershell
Copy-Item .env.example .env
Copy-Item front/.env.example front/.env.local
```

`front/.env.local` and Vercel need only:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | public/publishable key |

The root `.env` is for Supabase CLI/server-side operations. `SUPABASE_SECRET_KEY`
is privileged: do not put it in Vercel frontend variables, client code, or a
checked-in file. Supabase Edge Functions receive `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from their runtime. Set
the optional Edge secret `ALLOWED_ORIGIN` to the final Vercel origin (for
example `https://your-project.vercel.app`) after deployment.

## Supabase setup and migrations

Prerequisites: Supabase CLI, Docker for local development if desired, and a
project access token for CLI login. The supplied project credentials are not a
management access token and are intentionally not used to mutate the cloud
database.

1. In **Authentication → Providers**, enable **Anonymous sign-ins**.
2. In **Settings → API → Exposed schemas**, add `lyricmatch` without removing
   existing schemas. This is required for PostgREST RPC and Realtime on a
   custom schema and is the only dashboard setting that cannot be expressed in
   a regular SQL migration without touching global project configuration.
3. Link the CLI to the intended shared project, then review and apply the
   versioned migrations:

   ```powershell
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   The repository includes a comment-only marker for the remote
   `20261114000000` migration owned by the other shared project. It is not
   executed or modified; this prevents the CLI from asking for a migration
   history repair. Only the two `20261119...` LyricMatch migrations are new.

   The migration creates the `lyricmatch` schema, RLS policies, RPCs, indexes,
   Realtime publication membership, the complete game model, rate-limit table,
   and imports the original 850 words. It does not drop or alter any resource
   outside `lyricmatch`.

4. Deploy the Edge Functions:

   ```powershell
   supabase functions deploy search-music
   supabase functions deploy submit-answer
   supabase functions deploy advance-rounds
   supabase secrets set ALLOWED_ORIGIN=https://your-vercel-domain.example
   ```

5. Schedule a `POST` to `https://<project-ref>.supabase.co/functions/v1/advance-rounds`
   at least once per minute with the service-role bearer token. Use Supabase
   Cron/pg_net plus Vault, or a protected external scheduler. Do not hard-code
   that token in SQL, source code, or Vercel. This scheduling step is required
   for automatic progression when every player has left the page.

For an administrator to see the aggregate dashboard, give that user's JWT
`app_metadata` the boolean claim `lyricmatch_admin: true` through a trusted
server-side Supabase Admin API call. Normal players cannot query aggregate
location or operational metrics. Location storage is opt-in at the client
integration level and deliberately never stores IP addresses.

## Local frontend development

```powershell
cd front
npm ci
npm run dev
```

Run `npm run build` before deployment. The app requires a real migrated
Supabase project; it has no mock or fallback backend.

## Deploy to Vercel

1. Import this repository in Vercel.
2. Set **Root Directory** to `front`.
3. Let Vercel detect **Vite** (build command `npm run build`, output `dist`).
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production,
   Preview, and Development as appropriate. Do not add a service-role/secret
   key.
5. Deploy. `front/vercel.json` provides the SPA history fallback.
6. Update `ALLOWED_ORIGIN` in Supabase to the deployed frontend origin, then
   create/join a room from two browsers to validate Realtime.

## Security notes

- RLS permits direct reads only to room members. Browser roles receive no table
  insert/update/delete permissions; all writes happen through narrow RPCs.
- Passwords are hashed with `pgcrypto`; snapshots never contain a password hash.
- The service-role-only answer-verification and rate-limit functions cannot be
  executed by `authenticated` browser users.
- `search-music` and `submit-answer` require a valid user token, apply database
  backed per-minute limits, bound inputs, and use outbound timeouts/fallbacks.
- If any prior deployment or git history contained a real key, rotate it in
  Supabase before using this migration. The currently ignored local `.env` is
  not a substitute for rotation of previously exposed credentials.

## Validation checklist

After deployment, validate with at least two anonymous browser sessions:

1. Create a password-protected room and join it with its code.
2. Verify live player/chat/host/kick updates, then refresh one browser and
   confirm it reconnects to the same player.
3. Start a round, submit simultaneous answers, and confirm the clock and score
   agree across sessions.
4. Wait for the scheduled `advance-rounds` invocation with all game tabs
   closed, reopen a session, and confirm its authoritative state is current.
5. Confirm a non-host cannot call host RPCs or write table data using the
   browser console, and a non-admin cannot access dashboard aggregates.
