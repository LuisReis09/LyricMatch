import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "../lib/supabase";

export interface Player {
    id: string;
    userId: string;
    name: string;
    avatar: string | null;
    score: number;
    isHost: boolean;
    lastSeenAt: string;
}

export interface Answer {
    id: string;
    playerId: string;
    track: string;
    artist: string;
    albumImage: string | null;
    preview: string | null;
    isCorrect: boolean;
}

export interface Room {
    id: string;
    code: string;
    maxPlayers: number;
    maxRounds: number;
    language: "PT" | "EN" | "ES";
    status: "waiting" | "playing" | "analyzing" | "finished";
    currentRound: number;
    currentWord: string | null;
    roundTimer: number;
    roundStartedAt: string | null;
    roundEndsAt: string | null;
    analysisEndsAt: string | null;
    players: Player[];
    messages: Array<{ id: string; playerId: string; message: string; createdAt: string }>;
    answers: Answer[];
}

type RoomAccess = { roomId: string; playerId: string };

const roomStorageKey = "lyricmatch.roomId";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unexpected game error";

interface RoomContextType {
    room: Room;
    in_game: boolean;
    players: Player[];
    player: Player | null;
    userId: string | null;
    error: string | null;
    clearError: () => void;
    createRoom: (input: { name: string; avatar: string; password: string; maxPlayers: number; maxRounds: number; language: "PT" | "EN" | "ES" }) => Promise<void>;
    joinRoom: (input: { code: string; name: string; avatar: string; password: string }) => Promise<void>;
    startGame: () => Promise<void>;
    nextRound: () => Promise<void>;
    resetRoom: () => Promise<void>;
    leaveRoom: () => Promise<void>;
    sendMessage: (message: string) => Promise<void>;
    expelPlayer: (playerId: string) => Promise<void>;
    changeHost: (playerId: string) => Promise<void>;
    submitAnswer: (trackId: string | number) => Promise<void>;
    searchMusic: (artist: string, track: string) => Promise<any[]>;
    getAdminMetrics: () => Promise<any>;
    getAdminLocations: () => Promise<any[]>;
    setPlayer: (player: Player | null) => void;
    setPlayers: (players: Player[]) => void;
    setRoom: (room: Room | null) => void;
    setInGame: (inGame: boolean) => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider = ({ children }: { children: ReactNode }) => {
    const [room, setRoom] = useState<Room | null>(null);
    const [in_game, setInGame] = useState<boolean>(false);
    const [players, setPlayers] = useState<Player[]>([]);
    const [player, setPlayer] = useState<Player | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const roomIdRef = useRef<string | null>(null);

    const clearLocalRoom = useCallback(() => {
        roomIdRef.current = null;
        localStorage.removeItem(roomStorageKey);
        setRoom(null);
        setPlayers([]);
        setPlayer(null);
        setInGame(false);
    }, []);

    const ensureIdentity = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            setUserId(session.user.id);
            return session.user;
        }
        const { data, error: authError } = await supabase.auth.signInAnonymously();
        if (authError || !data.user) throw authError ?? new Error("Could not establish a player identity");
        setUserId(data.user.id);
        return data.user;
    }, []);

    const snapshot = useCallback(async (roomId: string, clearOnFailure = true) => {
        try {
            const identity = await ensureIdentity();
            const { data: dueData, error: dueError } = await supabase.rpc("advance_due_rooms");
            if (dueError) throw dueError;
            void dueData;
            const { data, error: snapshotError } = await supabase.rpc("room_snapshot", { p_room_id: roomId });
            if (snapshotError) throw snapshotError;
            const nextRoom = data as Room;
            roomIdRef.current = roomId;
            localStorage.setItem(roomStorageKey, roomId);
            setRoom(nextRoom);
            setPlayers(nextRoom.players);
            setPlayer(nextRoom.players.find((item) => item.userId === identity.id) ?? null);
            setInGame(true);
        } catch (snapshotFailure) {
            if (clearOnFailure) clearLocalRoom();
            throw snapshotFailure;
        }
    }, [clearLocalRoom, ensureIdentity]);

    const run = useCallback(async <T,>(operation: () => Promise<T>) => {
        try {
            setError(null);
            return await operation();
        } catch (operationError) {
            const message = errorMessage(operationError);
            setError(message);
            throw new Error(message);
        }
    }, []);

    const rpcThenSnapshot = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
        const roomId = roomIdRef.current;
        if (!roomId) throw new Error("You are not in a room");
        await ensureIdentity();
        const { error: rpcError } = await supabase.rpc(name, args);
        if (rpcError) throw rpcError;
        await snapshot(roomId);
    }, [ensureIdentity, snapshot]);

    const recordApproximateLocation = useCallback(async (roomId: string) => {
        try {
            // The old flow used IP geolocation. Only an approximate city and
            // rounded coordinates are persisted; the IP itself is discarded.
            const response = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5_000) });
            if (!response.ok) return;
            const data = await response.json() as { city?: string; loc?: string };
            const [latitude, longitude] = data.loc?.split(",").map(Number) ?? [];
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            await supabase.rpc("record_location", {
                p_room_id: roomId,
                p_city: data.city ?? "",
                p_latitude: latitude,
                p_longitude: longitude,
            });
        } catch {
            // Location data must never block a player from joining a game.
        }
    }, []);

    const createRoom = useCallback((input: { name: string; avatar: string; password: string; maxPlayers: number; maxRounds: number; language: "PT" | "EN" | "ES" }) => run(async () => {
        await ensureIdentity();
        const { data, error: rpcError } = await supabase.rpc("create_room", {
            p_name: input.name,
            p_avatar: input.avatar,
            p_password: input.password,
            p_max_players: input.maxPlayers,
            p_max_rounds: input.maxRounds,
            p_language: input.language,
            p_round_seconds: 30,
        });
        if (rpcError) throw rpcError;
        const roomId = (data as RoomAccess).roomId;
        await snapshot(roomId);
        void recordApproximateLocation(roomId);
    }), [ensureIdentity, recordApproximateLocation, run, snapshot]);

    const joinRoom = useCallback((input: { code: string; name: string; avatar: string; password: string }) => run(async () => {
        await ensureIdentity();
        const { data, error: rpcError } = await supabase.rpc("join_room", {
            p_code: input.code,
            p_name: input.name,
            p_avatar: input.avatar,
            p_password: input.password,
        });
        if (rpcError) throw rpcError;
        const roomId = (data as RoomAccess).roomId;
        await snapshot(roomId);
        void recordApproximateLocation(roomId);
    }), [ensureIdentity, recordApproximateLocation, run, snapshot]);

    const startGame = useCallback(() => run(() => rpcThenSnapshot("start_game", { p_room_id: roomIdRef.current })), [rpcThenSnapshot, run]);
    const nextRound = useCallback(() => run(() => rpcThenSnapshot("next_round", { p_room_id: roomIdRef.current })), [rpcThenSnapshot, run]);
    const resetRoom = useCallback(() => run(() => rpcThenSnapshot("reset_room", { p_room_id: roomIdRef.current })), [rpcThenSnapshot, run]);
    const sendMessage = useCallback((message: string) => run(() => rpcThenSnapshot("send_message", { p_room_id: roomIdRef.current, p_message: message })), [rpcThenSnapshot, run]);
    const expelPlayer = useCallback((playerId: string) => run(() => rpcThenSnapshot("expel_player", { p_room_id: roomIdRef.current, p_player_id: playerId })), [rpcThenSnapshot, run]);
    const changeHost = useCallback((playerId: string) => run(() => rpcThenSnapshot("change_host", { p_room_id: roomIdRef.current, p_player_id: playerId })), [rpcThenSnapshot, run]);

    const leaveRoom = useCallback(() => run(async () => {
        const roomId = roomIdRef.current;
        if (roomId) {
            await ensureIdentity();
            const { error: rpcError } = await supabase.rpc("leave_room", { p_room_id: roomId });
            if (rpcError) throw rpcError;
        }
        clearLocalRoom();
    }), [clearLocalRoom, ensureIdentity, run]);

    const submitAnswer = useCallback((trackId: string | number) => run(async () => {
        await ensureIdentity();
        const { data, error: functionError } = await supabase.functions.invoke("submit-answer", { body: { trackId } });
        if (functionError) throw functionError;
        if (data?.error) throw new Error(data.error);
        if (roomIdRef.current) await snapshot(roomIdRef.current);
    }), [ensureIdentity, run, snapshot]);

    const searchMusic = useCallback((artist: string, track: string) => run(async () => {
        await ensureIdentity();
        const { data, error: functionError } = await supabase.functions.invoke("search-music", { body: { artist, track } });
        if (functionError) throw functionError;
        if (data?.error) throw new Error(data.error);
        return Array.isArray(data) ? data : [];
    }), [ensureIdentity, run]);

    const getAdminMetrics = useCallback(() => run(async () => {
        await ensureIdentity();
        const { data, error: rpcError } = await supabase.rpc("admin_metrics");
        if (rpcError) throw rpcError;
        return data;
    }), [ensureIdentity, run]);

    const getAdminLocations = useCallback(() => run(async () => {
        await ensureIdentity();
        const { data, error: rpcError } = await supabase.rpc("admin_location_aggregates");
        if (rpcError) throw rpcError;
        return Array.isArray(data) ? data : [];
    }), [ensureIdentity, run]);

    useEffect(() => {
        void ensureIdentity().catch((identityError) => setError(errorMessage(identityError)));
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
        return () => listener.subscription.unsubscribe();
    }, [ensureIdentity]);

    useEffect(() => {
        const savedRoomId = localStorage.getItem(roomStorageKey);
        if (savedRoomId) void snapshot(savedRoomId).catch(() => undefined);
    }, [snapshot]);

    useEffect(() => {
        const roomId = room?.id;
        if (!roomId) return;
        const refresh = () => void snapshot(roomId).catch(() => undefined);
        const channel = supabase.channel(`lyricmatch:room:${roomId}`)
            .on("postgres_changes", { event: "*", schema: "lyricmatch", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
            .on("postgres_changes", { event: "*", schema: "lyricmatch", table: "players", filter: `room_id=eq.${roomId}` }, refresh)
            .on("postgres_changes", { event: "*", schema: "lyricmatch", table: "messages", filter: `room_id=eq.${roomId}` }, refresh)
            .on("postgres_changes", { event: "*", schema: "lyricmatch", table: "player_answers", filter: `room_id=eq.${roomId}` }, refresh)
            .subscribe();
        const heartbeat = window.setInterval(() => {
            void supabase.rpc("touch_presence", { p_room_id: roomId });
            void supabase.rpc("advance_due_rooms");
        }, 20_000);
        return () => {
            window.clearInterval(heartbeat);
            void supabase.removeChannel(channel);
        };
    }, [room?.id, snapshot]);

    return (
        <RoomContext.Provider value={{ room: room as Room, in_game, players, player, userId, error, clearError: () => setError(null), createRoom, joinRoom, startGame, nextRound, resetRoom, leaveRoom, sendMessage, expelPlayer, changeHost, submitAnswer, searchMusic, getAdminMetrics, getAdminLocations, setPlayer, setPlayers, setRoom, setInGame }}>
            {children}
        </RoomContext.Provider>
    );
};

export const useRoomContext = () => {
    const context = useContext(RoomContext);
    if (!context) {
        throw new Error("useRoomContext must be used within a RoomProvider");
    }
    return context;
}



