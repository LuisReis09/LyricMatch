import { load } from "npm:cheerio@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonHeaders, requireUser, respond } from "../_shared/http.ts";

const slug = (value: string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/'/g, "")
  .replace(/['’]/g, "").replace(/[^a-zA-Z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "").toLowerCase();

const normalize = (value: string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

const fetchText = async (url: string) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "LyricMatch/2.0 (game validation)" },
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok ? await response.text() : null;
};

const findLyrics = async (track: string, artist: string): Promise<string | null> => {
  const artistSlug = slug(artist);
  const trackSlug = slug(track);
  const sources = [
    async () => {
      const html = await fetchText(`https://www.letras.mus.br/${artistSlug}/${trackSlug}/`);
      if (!html) return null;
      return load(html)(".lyric-original").text().trim() || null;
    },
    async () => {
      const html = await fetchText(`https://www.musixmatch.com/lyrics/${artistSlug}/${trackSlug}`);
      if (!html) return null;
      const $ = load(html);
      return $(".css-175oi2r.r-zd98yo .css-175oi2r.r-18u37iz.r-1w6e6rj")
        .not(".r-awgt0").map((_, element) => $(element).text().trim()).get().join("\n") || null;
    },
    async () => {
      const html = await fetchText(`https://www.vagalume.com.br/${artistSlug}/${trackSlug}.html`);
      if (!html) return null;
      return load(html)("#lyrics").text().trim() || null;
    },
  ];

  for (const source of sources) {
    try {
      const lyrics = await source();
      if (lyrics) return lyrics;
    } catch {
      // A failed provider is expected; continue with the next one.
    }
  }
  return null;
};

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders(origin) });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);

  const user = await requireUser(request);
  if (!user) return respond({ error: "Unauthorized" }, 401, origin);

  let body: { trackId?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid JSON" }, 400, origin);
  }
  const trackId = typeof body.trackId === "string" || typeof body.trackId === "number" ? String(body.trackId) : "";
  if (!/^\d{1,20}$/.test(trackId)) return respond({ error: "Invalid track" }, 400, origin);

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { db: { schema: "lyricmatch" } },
  );
  const { data: allowed, error: limitError } = await service.rpc("consume_rate_limit", {
    p_user_id: user.id,
    p_action: "submit_answer",
    p_max_requests: 10,
  });
  if (limitError) return respond({ error: "Could not validate request limit" }, 503, origin);
  if (!allowed) return respond({ error: "Answer limit reached. Try again in a minute." }, 429, origin);

  try {
    // The browser persists the selection first. Read that durable context
    // before doing any slow provider request, so a near-deadline selection is
    // never mistaken for an action outside the round.
    let { data: context, error: contextError } = await service.rpc("answer_verification_context", {
      p_user_id: user.id,
      p_track_id: trackId,
    });
    const selectionMissing = contextError?.message === "No selection exists for this track";
    if (contextError && !selectionMissing) {
      console.error("Could not load saved answer context", contextError);
      return respond({ error: `Could not load the saved selection: ${contextError.message}` }, 503, origin);
    }

    // Older deployed browsers call this function directly. Preserve their
    // clicks too, instead of returning an opaque selection error.
    if (selectionMissing || !context?.roundId || !context?.word) {
      const fallback = await service.rpc("record_answer_selection_for_user", {
        p_user_id: user.id,
        p_track_id: trackId,
      });
      context = fallback.data;
      contextError = fallback.error;
    }
    if (contextError) {
      return respond({ error: contextError.message }, contextError.code === "22023" ? 409 : 503, origin);
    }
    if (!context?.roundId || !context?.word) {
      return respond({ error: "Saved selection was not found. Please choose the song again." }, 409, origin);
    }

    const deezerResponse = await fetch(`https://api.deezer.com/track/${trackId}`, { signal: AbortSignal.timeout(8_000) });
    if (!deezerResponse.ok) throw new Error("Track lookup failed");
    const deezer = await deezerResponse.json();
    const track = String(deezer.title ?? "").trim();
    const artist = String(deezer.artist?.name ?? "").trim();
    if (!track || !artist) throw new Error("Incomplete track data");

    const lyrics = await findLyrics(track, artist);
    if (!lyrics) {
      return respond({ ok: true, verified: false, warning: "Lyrics were not found; your selection was saved." }, 200, origin);
    }
    const { data: completed, error: answerError } = await service.rpc("complete_answer_verification", {
      p_user_id: user.id,
      p_round_id: context.roundId,
      p_track_id: trackId,
      p_track: track,
      p_artist: artist,
      p_album_image: deezer.album?.cover_xl ? String(deezer.album.cover_xl) : null,
      p_preview: deezer.preview ? String(deezer.preview) : null,
      p_is_correct: normalize(lyrics).includes(normalize(String(context.word))),
    });
    if (answerError) throw answerError;
    return respond({ ok: true, verified: Boolean(completed) }, 200, origin);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Could not submit answer" }, 422, origin);
  }
});
