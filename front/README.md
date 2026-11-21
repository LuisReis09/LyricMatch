# LyricMatch frontend

The Vite application is deployed from this directory on Vercel. Its only
runtime configuration is `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`; copy `.env.example` to `.env.local` for local
development.

```powershell
npm ci
npm run dev
npm run lint
npm run build
npm run simulate:room
```

The client uses anonymous Supabase Auth, database RPCs, private Realtime
Broadcast room notifications (with a temporary Postgres Changes compatibility
subscription), and Edge Functions. `simulate:room` needs valid local Supabase
environment variables and exercises three concurrent anonymous clients against
a temporary room. It does not require or connect to a NestJS, Prisma,
Socket.IO, Docker, or locally running backend service. See the root
[README](../README.md) for migrations, Edge Functions, security constraints,
and Vercel deployment.
