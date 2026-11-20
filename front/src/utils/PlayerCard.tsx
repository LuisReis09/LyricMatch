import React from "react";
import "../css/utils/playercard.css";
import { useRoomContext } from "./RoomContext";

interface PlayerCardProps {
  name: string;
  avatar: string | null;
  points: number;
  isHost?: boolean;
  hostView?: boolean;
  playerId?: string;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ name, avatar, points, isHost, hostView, playerId }) => {
  const { changeHost, expelPlayer } = useRoomContext();
  return (
    <div className={`player-card ${isHost ? "host" : ""}`}>
      <div className="player-card-avatar" style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }}>
        {isHost && <div className="player-card-host-icon fa fa-crown" />}
      </div>
      <div className="player-card-infos">
        {hostView && !isHost && playerId && (
          <div className="player-card-host-options">
            <i className="fa fa-crown player-card-host-options-turn-to-host" onClick={() => void changeHost(playerId)} />
            <i className="fa fa-times-circle player-card-host-options-kick" onClick={() => void expelPlayer(playerId)} />
          </div>
        )}
        <div className="player-card-name">{name}</div>
        <div className="player-card-points">{points} points</div>
      </div>
    </div>
  );
};

export default PlayerCard;
