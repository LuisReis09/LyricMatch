import React, { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Home from "./pages/home/Home";
import About from "./pages/about/About";
import NotFound from "./pages/notFound/NotFound";
import Nav from "./pages/nav/nav";
import GameScreen from "./pages/game/GameScreen";
import Dashboard from "./pages/dashboard/Dashboard";
import AboutGame from "./pages/AboutGame/AboutGame";
import "./css/initialpages/App.css";
import { useRoomContext } from "./utils/RoomContext";
import { useSongContext } from "./utils/SongContext";
import { useSearchContext } from "./utils/SearchContext";

const App = () => {
  const { in_game, room, player, error, clearError } = useRoomContext();
  const { setSongSelected, setGuesses } = useSongContext();
  const { setCount, setTimerInit } = useSearchContext();
  const [alert, setAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const selectedSongPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room) return;
    if (room.status === "analyzing" || room.status === "finished") {
      setCount(null);
      setGuesses(room.answers);
      const answerPhase = `${room.id}:${room.currentRound}:answers`;
      // Initialise the player's own answer once when results become visible.
      // Subsequent snapshots must not override a song deliberately selected
      // from another player's card.
      if (selectedSongPhaseRef.current !== answerPhase) {
        selectedSongPhaseRef.current = answerPhase;
        setSongSelected(room.answers.find((answer) => answer.playerId === player?.id) ?? null);
      }
    } else if (room.status === "playing") {
      setTimerInit(room.roundStartedAt ? new Date(room.roundStartedAt).getTime() : Date.now());
      setGuesses([]);
      const playingPhase = `${room.id}:${room.currentRound}:playing`;
      if (selectedSongPhaseRef.current !== playingPhase) {
        selectedSongPhaseRef.current = playingPhase;
        setSongSelected(null);
      }
    } else {
      selectedSongPhaseRef.current = null;
    }
  }, [room, player?.id, setCount, setGuesses, setSongSelected, setTimerInit]);

  useEffect(() => {
    if (!error) return;
    setAlertMessage(error);
    setAlert(true);
    const timeout = window.setTimeout(() => {
      setAlert(false);
      clearError();
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [clearError, error]);

  return (
    <div className="App" id="App_Screen">
      {!in_game && <Nav />}
      {!in_game && (
        <Routes>
          <Route path="/" element={<Home closeMenu={() => undefined} />} />
          <Route path="/about" element={<About closeMenu={() => undefined} />} />
          <Route path="/aboutgame" element={<AboutGame closeMenu={() => undefined} />} />
          <Route path="/dashboard" element={<Dashboard closeMenu={() => undefined} />} />
          <Route path="*" element={<NotFound closeMenu={() => undefined} />} />
        </Routes>
      )}
      {in_game && <GameScreen />}
      {alert && <div className="custom-alert">{alertMessage}</div>}
    </div>
  );
};

export default App;
