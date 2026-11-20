import { useRoomContext } from "../../../../utils/RoomContext";
import "../../../../css/game/desktop/rightbox_boxes/gamestart.css"
import Button from "../../../../utils/Button"

const GameStart: React.FC = () => {
    const { player, startGame: startRoomGame } = useRoomContext();
    const hostPlayer = player?.isHost;

    const handleStartGame = () => {
        if(hostPlayer)
            void startRoomGame();
    }



    return (
        <div id="game_start_box">
            <div id="game_start_title">Waiting for the host</div>

            {
                hostPlayer &&
                <div id="game_start_host_buttons">
                    <Button id="game_start_button_start_game" func={handleStartGame} text="Start"/>
                </div>
            }
        </div>
    )
}

export default GameStart;
