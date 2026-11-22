import Chat from "./Chat";
import "../../../css/game/mobile/mobilechatframe.css"

const MobileChatFrame: React.FC = () => {
    return (
        <div id="mobile_chat_frame_box">
            <div className="mobile-panel-heading mobile-chat-heading">
                <div>
                    <span className="mobile-eyebrow">ROOM CHAT</span>
                    <h1>Talk to the crew</h1>
                </div>
            </div>
            <div id="mobile_chat_frame">
                <Chat/>
            </div>
        </div>
    );
}

export default MobileChatFrame;
