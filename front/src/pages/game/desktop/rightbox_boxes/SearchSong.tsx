import { useState } from "react";
import { useSearchContext } from "../../../../utils/SearchContext";
import SongCard from "../../../../utils/SongCard";
import "../../../../css/game/desktop/rightbox_boxes/searchsong.css";
import { useRoomContext } from "../../../../utils/RoomContext";

const SearchSong: React.FC = () => {
  const [selected, setSelected] = useState<string>("");
  const { count } = useSearchContext();
  const { submitAnswer } = useRoomContext();
  return <div id="search_song_box">
    <div id="search_song_title">Which song?</div>
    <div id="search_results_box">{count?.map((result: any, index: number) => (
      <SongCard key={index} album_cover={result.album_image} song_name={result.track_name} artist_name={result.artist}
        selected={String(result.id) === selected}
        func={() => { setSelected(String(result.id)); void submitAnswer(result.id); }} />
    ))}</div>
  </div>;
};

export default SearchSong;
