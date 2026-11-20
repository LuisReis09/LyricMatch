import { jsonHeaders, requireUser, respond } from "../_shared/http.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const text = (value: unknown, maxLength = 120) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders(origin) });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);

  const user = await requireUser(request);
  if (!user) return respond({ error: "Unauthorized" }, 401, origin);

  let payload: { artist?: unknown; track?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Invalid JSON" }, 400, origin);
  }

  const artist = text(payload.artist);
  const track = text(payload.track);
  if (!artist && !track) return respond({ error: "Enter an artist or track" }, 400, origin);

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { db: { schema: "lyricmatch" } },
  );
  const { data: allowed, error: limitError } = await service.rpc("consume_rate_limit", {
    p_user_id: user.id,
    p_action: "search_music",
    p_max_requests: 20,
  });
  if (limitError) return respond({ error: "Could not validate request limit" }, 503, origin);
  if (!allowed) return respond({ error: "Search limit reached. Try again in a minute." }, 429, origin);

  try {
    const query = encodeURIComponent(`${artist} ${track}`.trim());
    const result = await fetch(`https://api.deezer.com/search?q=${query}&limit=5`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) throw new Error(`Deezer returned ${result.status}`);
    const body = await result.json();
    const tracks = Array.isArray(body.data)
      ? body.data.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ""),
          track_name: String(item.title ?? ""),
          artist: String((item.artist as Record<string, unknown> | undefined)?.name ?? ""),
          album_image: String((item.album as Record<string, unknown> | undefined)?.cover_xl ?? ""),
          preview: String(item.preview ?? ""),
        })).filter((item: { id: string; track_name: string }) => item.id && item.track_name)
      : [];
    return respond(tracks, 200, origin);
  } catch {
    return respond({ error: "Music search is temporarily unavailable" }, 503, origin);
  }
});
