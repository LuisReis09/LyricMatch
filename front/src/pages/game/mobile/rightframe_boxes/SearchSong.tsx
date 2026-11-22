import { useState } from "react";
import { useSearchContext } from "../../../../utils/SearchContext";
import SongCard from "../../../../utils/SongCard";
import "../../../../css/game/mobile/rightframe/SearchSong.css";
import { useRoomContext } from "../../../../utils/RoomContext";

interface SearchSongProps { setFrame: (frame: string) => void; }

const SearchSong: React.FC<SearchSongProps> = ({ setFrame }) => {
  const [selected, setSelected] = useState("");
  const { count } = useSearchContext();
  const { submitAnswer } = useRoomContext();
  return <div id="MOBILE_search_song_box">
    <div id="mobile_search_song_header"><div className="fa fa-arrow-left" id="mobile_search_song_button_return" onClick={() => setFrame("middle_frame")} /><div id="search_song_title">Which song?</div></div>
    <div id="search_results_box">{count?.map((result: any, index: number) => (
      <SongCard key={index} album_cover={result.album_image} song_name={result.track_name} artist_name={result.artist}
        selected={String(result.id) === selected}
        func={() => {
          // Keep the visual acknowledgement immediate, even while the answer
          // is being persisted and the server response is still in flight.
          setSelected(String(result.id));
          void submitAnswer(result.id);
        }} />
    ))}</div>
  </div>;
};

export default SearchSong;
