export const jsonHeaders = (origin: string | null) => {
  const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const allowedOrigin = configuredOrigin
    ? origin === configuredOrigin
      ? origin
      : "null"
    : "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
};

export const respond = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });

export const requireUser = async (request: Request) => {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
};
