import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontDirectory = resolve(scriptDirectory, "..");
const skipAnswerVerification = process.argv.includes("--skip-submit-answer");
const legacySubmitAnswer = process.argv.includes("--legacy-submit-answer");

const loadLocalEnvironment = async () => {
  for (const envFile of [resolve(frontDirectory, ".env.local"), resolve(frontDirectory, "..", ".env")]) {
    if (!existsSync(envFile)) continue;
    const contents = await readFile(envFile, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
};

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const waitFor = async (description, predicate, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`${description} did not happen before the timeout${lastError ? `: ${lastError.message}` : ""}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

await loadLocalEnvironment();
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in front/.env.local before running this simulation.");
}

const newClient = () => createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  db: { schema: "lyricmatch" },
});

const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};

const snapshot = (client, roomId) => rpc(client, "room_snapshot", { p_room_id: roomId });

const subscribe = (channel) => new Promise((resolveSubscription, rejectSubscription) => {
  const timeout = setTimeout(() => rejectSubscription(new Error("Realtime subscription timed out")), 10_000);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timeout);
      resolveSubscription();
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      clearTimeout(timeout);
      rejectSubscription(new Error(`Realtime subscription failed with ${status}`));
    }
  });
});

const makePlayer = async () => {
  const client = newClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`Anonymous sign-in failed: ${error?.message ?? "missing session"}`);
  await client.realtime.setAuth(data.session.access_token);
  return { client, userId: data.user.id, channel: undefined, legacyChannel: undefined, events: 0, legacyEvents: 0, observePushSnapshots: false, pushedStatuses: [], legacyStatuses: [] };
};

const players = [];
let roomId;
try {
  // These are three independent Supabase clients, exercised concurrently just
  // as three browser tabs would be.  The test never sends a chat message.
  const [host, guestOne, guestTwo] = await Promise.all([makePlayer(), makePlayer(), makePlayer()]);
  players.push(host, guestOne, guestTwo);

  const created = await rpc(host.client, "create_room", {
    p_name: `Simulation host ${Date.now()}`,
    p_avatar: "",
    p_password: "",
    p_max_players: 3,
    p_max_rounds: 1,
    p_language: "EN",
    p_round_seconds: 10,
  });
  roomId = created.roomId;

  await Promise.all([
    rpc(guestOne.client, "join_room", { p_code: (await snapshot(host.client, roomId)).code, p_name: "Simulation guest one", p_avatar: "", p_password: "" }),
    rpc(guestTwo.client, "join_room", { p_code: (await snapshot(host.client, roomId)).code, p_name: "Simulation guest two", p_avatar: "", p_password: "" }),
  ]);

  await Promise.all(players.map(async (player) => {
    player.channel = player.client
      .channel(`lyricmatch:room:${roomId}`, { config: { private: true } })
      .on("broadcast", { event: "room_updated" }, () => {
        player.events += 1;
        if (player.observePushSnapshots) {
          void snapshot(player.client, roomId)
            .then((state) => { player.pushedStatuses.push(state.status); })
            .catch(() => undefined);
        }
      });
    await subscribe(player.channel);
    player.legacyChannel = player.client
      .channel(`lyricmatch:legacy-room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "lyricmatch", table: "rooms", filter: `id=eq.${roomId}` }, () => {
        player.legacyEvents += 1;
        if (player.observePushSnapshots) {
          void snapshot(player.client, roomId)
            .then((state) => { player.legacyStatuses.push(state.status); })
            .catch(() => undefined);
        }
      });
    await subscribe(player.legacyChannel);
  }));

  await rpc(host.client, "start_game", { p_room_id: roomId });
  await waitFor("all three clients to receive the started round", async () => {
    const states = await Promise.all(players.map((player) => snapshot(player.client, roomId)));
    return states.every((state) => state.status === "playing");
  });
  assert(players.every((player) => player.events > 0), "A client did not receive the server-push start notification");
  players.forEach((player) => {
    player.observePushSnapshots = true;
    player.pushedStatuses = [];
    player.legacyStatuses = [];
  });

  const dueAdvanceResult = await rpc(host.client, "advance_due_rooms", {});
  assert(Number.isInteger(dueAdvanceResult), "An authenticated client could not request the due-round fallback");

  if (!legacySubmitAnswer) await rpc(guestOne.client, "record_answer_selection", { p_track_id: "3135556" });

  players.forEach((player) => { player.pushedStatuses = []; player.legacyStatuses = []; });
  if (!skipAnswerVerification) {
    const { data: verification, error: verificationError } = await guestOne.client.functions.invoke("submit-answer", { body: { trackId: "3135556" } });
    if (verificationError) {
      const response = verificationError.context;
      const detail = response instanceof Response ? await response.text() : "";
      throw new Error(`submit-answer: ${detail || verificationError.message}`);
    }
    if (verification?.error) throw new Error(`submit-answer: ${verification.error}`);
  }

  const selectedState = await waitFor("guest one's durable selection", async () => {
    const state = await snapshot(guestOne.client, roomId);
    return state.answers.length === 1 ? state : null;
  });
  assert(selectedState.answers[0].track === "Verifying selection…" || selectedState.answers[0].track.length > 0,
    "The selection was not stored before lyric verification");
  const hiddenAnswerState = await snapshot(guestTwo.client, roomId);
  assert(hiddenAnswerState.answers.length === 0, "Another player's in-round answer was exposed");

  await waitFor("all clients to receive the round-end state through Broadcast", () => {
    return players.every((player) => player.pushedStatuses.some((status) => status === "analyzing" || status === "finished"));
  }, 25_000);
  await waitFor("all clients to receive the round-end state through Postgres Changes", () => {
    return players.every((player) => player.legacyStatuses.some((status) => status === "analyzing" || status === "finished"));
  }, 10_000);
  const finishedState = await snapshot(host.client, roomId);
  assert(finishedState.answers.length === 1, "The selected song disappeared when the round ended");

  console.log(`PASS: three-client room simulation completed; ${skipAnswerVerification ? "push updates through round end" : "submit-answer and push updates through round end"}, plus durable selection, were observed without chat activity.`);
} finally {
  await Promise.all(players.map(async (player) => {
    if (roomId) await rpc(player.client, "leave_room", { p_room_id: roomId }).catch(() => undefined);
    if (player.channel) await player.client.removeChannel(player.channel);
    if (player.legacyChannel) await player.client.removeChannel(player.legacyChannel);
  }));
}

const autoLeavePlayers = [];
let previousRoomId;
try {
  const [formerHost, remainingPlayer] = await Promise.all([makePlayer(), makePlayer()]);
  autoLeavePlayers.push(formerHost, remainingPlayer);

  const oldRoom = await rpc(formerHost.client, "create_room", {
    p_name: "Auto-leave host",
    p_avatar: "",
    p_password: "",
    p_max_players: 2,
    p_max_rounds: 1,
    p_language: "EN",
    p_round_seconds: 10,
  });
  previousRoomId = oldRoom.roomId;
  const oldCode = (await snapshot(formerHost.client, previousRoomId)).code;
  await rpc(remainingPlayer.client, "join_room", {
    p_code: oldCode,
    p_name: "Auto-leave member",
    p_avatar: "",
    p_password: "",
  });

  const replacementRoom = await rpc(formerHost.client, "create_room", {
    p_name: "Moved host",
    p_avatar: "",
    p_password: "",
    p_max_players: 2,
    p_max_rounds: 1,
    p_language: "EN",
    p_round_seconds: 10,
  });
  const oldRoomAfterCreate = await snapshot(remainingPlayer.client, previousRoomId);
  assert(oldRoomAfterCreate.players.length === 1, "Creating a room did not leave the previous room");
  assert(oldRoomAfterCreate.players[0].userId === remainingPlayer.userId && oldRoomAfterCreate.players[0].isHost,
    "The remaining player did not receive host ownership");
  assert((await snapshot(formerHost.client, replacementRoom.roomId)).players.length === 1,
    "The replacement room was not created for the moved player");

  await rpc(formerHost.client, "join_room", {
    p_code: oldCode,
    p_name: "Returned player",
    p_avatar: "",
    p_password: "",
  });
  const oldRoomAfterJoin = await snapshot(formerHost.client, previousRoomId);
  assert(oldRoomAfterJoin.players.length === 2, "Joining a room did not replace the previous membership");
  assert(oldRoomAfterJoin.players.find((player) => player.userId === remainingPlayer.userId)?.isHost,
    "Host ownership changed unexpectedly after automatic leave");

  console.log("PASS: automatic leave and host transfer were verified for create and join.");
} finally {
  await Promise.all(autoLeavePlayers.map(async (player) => {
    if (previousRoomId) await rpc(player.client, "leave_room", { p_room_id: previousRoomId }).catch(() => undefined);
    if (player.channel) await player.client.removeChannel(player.channel);
  }));
}
