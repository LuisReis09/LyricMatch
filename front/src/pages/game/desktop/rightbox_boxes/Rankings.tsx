import Button from "../../../../utils/Button";
import { useRoomContext } from "../../../../utils/RoomContext";
import "../../../../css/game/desktop/rightbox_boxes/rankings.css"


const Rankings: React.FC = () => {
    const { player, resetRoom } = useRoomContext();

    return (
        <div id="rankings_box_right_box">
            <div id="rankings_title">Match Ended!</div>
            

            <div id="rankings_right_box_buttons">
                {
                    player?.isHost &&
                    <Button 
                        text="Restart"
                        func={() => {
                            void resetRoom();
                        }}
                    />
                }

            </div>
            
        </div>
    )
}

export default Rankings;
