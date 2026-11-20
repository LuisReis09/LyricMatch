import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || request.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
    db: { schema: "lyricmatch" },
  });
  const { data, error } = await service.rpc("advance_due_rooms");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ advanced: data });
});
