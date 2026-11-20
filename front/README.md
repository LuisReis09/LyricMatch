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
```

The client uses anonymous Supabase Auth, database RPCs, Realtime Postgres
Changes, and Edge Functions. It does not require or connect to a NestJS,
Prisma, Socket.IO, Docker, or locally running backend service. See the root
[README](../README.md) for migrations, Edge Functions, security constraints,
and Vercel deployment.
