import { useEffect, useRef, useState } from "react";
import TextInput from "../../../../utils/TextInput";
import Button from "../../../../utils/Button";
import { useSearchContext } from "../../../../utils/SearchContext";
import "../../../../css/game/mobile/midframe/SearchSong.css";
import { useRoomContext } from "../../../../utils/RoomContext";

interface SearchSongProps { setFrame: (frame: string) => void; }

const SearchSong: React.FC<SearchSongProps> = ({ setFrame }) => {
  const { setCount } = useSearchContext();
  const { room, searchMusic } = useRoomContext();
  const [artist, setArtist] = useState("");
  const [track, setTrack] = useState("");
  const [timer, setTimer] = useState(room?.roundTimer ?? 30);
  const [alert, setAlert] = useState("");
  const trackInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setTimer(Math.max(0, Math.ceil(((room?.roundEndsAt ? new Date(room.roundEndsAt).getTime() : Date.now()) - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [room?.roundEndsAt]);

  const search = async () => {
    try {
      const results = await searchMusic(artist, track);
      if (!results.length) return setAlert("No song found with this name or artist");
      setCount(results);
      setFrame("right_frame");
    } catch (error) {
      setAlert(error instanceof Error ? error.message : "Music search failed");
    }
  };

  const duration = room?.roundTimer ?? 30;
  return <div id="MOBILE_search_song_mid_box">
    <div id="search_song_word_box">{room?.currentWord}</div>
    <div id="search_song_subtitle">Enter a song with the word: {room?.currentWord}</div>
    <div id="search_box"><div id="search_song_inputs_box">
      <TextInput label="Artist:" setText={setArtist} placeholder="Enter the name of the artist" enterFunc={() => trackInputRef.current?.focus()} />
      <TextInput ref={trackInputRef} label="Song:" setText={setTrack} placeholder="Enter the name of the song" enterFunc={search} />
    </div><div id="search_song_button"><Button text="Search" func={search} /></div></div>
    <div id="search_song_timer_back"><div id="search_song_timer_bar" style={{ width: `${Math.max(0, 100 / duration * timer)}%` }} /></div>
    {alert && <div className="custom-alert">{alert}</div>}
  </div>;
};

export default SearchSong;
