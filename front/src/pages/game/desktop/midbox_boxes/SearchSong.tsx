import { useEffect, useRef, useState } from "react";
import TextInput from "../../../../utils/TextInput";
import Button from "../../../../utils/Button";
import { useSearchContext } from "../../../../utils/SearchContext";
import "../../../../css/game/desktop/midBox/searchSong.css";
import { useRoomContext } from "../../../../utils/RoomContext";

const SearchSong: React.FC = () => {
  const { setCount } = useSearchContext();
  const { room, searchMusic } = useRoomContext();
  const [artist, setArtist] = useState("");
  const [track, setTrack] = useState("");
  const [timer, setTimer] = useState(room?.roundTimer ?? 30);
  const [alert, setAlert] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const trackInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setTimer(Math.max(0, Math.ceil(((room?.roundEndsAt ? new Date(room.roundEndsAt).getTime() : Date.now()) - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [room?.roundEndsAt]);

  useEffect(() => {
    if (!isSearching) return;
    const interval = window.setInterval(() => setLoadingStep((step) => (step + 1) % 3), 900);
    return () => window.clearInterval(interval);
  }, [isSearching]);

  const search = async () => {
    if (isSearching) return;
    if (!artist.trim() && !track.trim()) {
      setAlert("Enter an artist or a song to search");
      return;
    }
    setAlert("");
    setIsSearching(true);
    try {
      const results = await searchMusic(artist, track);
      if (!results.length) setAlert("No song found with this name or artist");
      else setCount(results);
    } catch (error) {
      setAlert(error instanceof Error ? error.message : "Music search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const duration = room?.roundTimer ?? 30;
  const loadingMessages = ["Tuning the speakers...", "Searching the crates...", "Matching the lyrics..."];
  return <div id="search_song_mid_box">
    <div id="search_song_word_box">{room?.currentWord}</div>
    <div id="search_song_subtitle">Enter a song with the word: {room?.currentWord}</div>
    <div id="search_box"><div id="search_song_inputs_box">
      <TextInput label="Artist:" setText={setArtist} placeholder="Enter the name of the artist" enterFunc={() => trackInputRef.current?.focus()} />
      <TextInput ref={trackInputRef} label="Song:" setText={setTrack} placeholder="Enter the name of the song" enterFunc={search} />
    </div><div id="search_song_button"><Button text={isSearching ? "Searching..." : "Search"} func={search} /></div></div>
    <div id="search_song_timer_back"><div id="search_song_timer_bar" style={{ width: `${Math.max(0, 100 / duration * timer)}%` }} /></div>
    {isSearching && <div className="desktop-search-loader" role="status" aria-live="assertive">
      <div className="desktop-loader-disc"><span className="fa fa-music" aria-hidden="true" /></div>
      <span className="desktop-loader-equalizer" aria-hidden="true"><i /><i /><i /><i /></span>
      <strong>Finding your sound</strong>
      <p>{loadingMessages[loadingStep]}</p>
    </div>}
    {alert && <div className="custom-alert">{alert}</div>}
  </div>;
};

export default SearchSong;
