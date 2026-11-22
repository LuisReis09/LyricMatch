import "../css/utils/songcard.css"

interface SongCard_Props{
    song_name: string,
    artist_name: string,
    album_cover: string,
    func?: any
    selected?: boolean
}

const SongCard: React.FC<SongCard_Props> = ({song_name, artist_name, album_cover, func, selected}) => {
    return (
        <div
            className={`song_card ${selected ? "selected" : ""}`}
            onClick={func}
            role={func ? "button" : undefined}
            tabIndex={func ? 0 : undefined}
            aria-pressed={func ? selected : undefined}
            onKeyDown={(event) => {
                if (func && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    func();
                }
            }}
        >
            <div className="song_card_album_cover" style={{backgroundImage: `url(${album_cover})`}}/>

            <div className="song_card_info">
                <div className="song_card_song_name">{song_name}</div>
                <div className="song_card_artist_name">{artist_name}</div>
            </div>
        </div>
    )
}

export default SongCard;
