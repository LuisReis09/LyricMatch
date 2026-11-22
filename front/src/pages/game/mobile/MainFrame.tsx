import React from "react";

import MobileLeftFrame from "./MobileLeftFrame";
import MobileMiddleFrame from "./MobileMiddleFrame";
import MobileRightFrame from "./MobileRightFrame";
import MobileChatFrame from "./MobileChatFrame";

import "../../../css/game/mobile/mainframe.css"
import { useRoomContext } from "../../../utils/RoomContext";

const MainFrame: React.FC = () => {
    const [lastFrame, setLastFrame] = React.useState<string>("middle_frame");
    const [frame, setFrame] = React.useState<string>("middle_frame");
    const { leaveRoom, room, players } = useRoomContext();

    const openFrame = (nextFrame: string) => {
        if (nextFrame === "left_frame" && frame === "left_frame") {
            setFrame(lastFrame);
            return;
        }
        if (nextFrame === "chat_frame" && frame === "chat_frame") {
            setFrame(lastFrame);
            return;
        }
        if (frame !== "chat_frame" && frame !== nextFrame) setLastFrame(frame);
        setFrame(nextFrame);
    };

    return (
        <div id="mobile_main_frame">
            <header className="mobile-game-header">
                <div className="mobile-game-brand">
                    <img src="/assets/logo.svg" alt="Lyric Match" />
                    <div>
                        <strong>Lyric Match</strong>
                        <span>Round {room?.currentRound ?? 0} of {room?.maxRounds ?? 0}</span>
                    </div>
                </div>
                <button
                    className="mobile-icon-button mobile-leave-button"
                    type="button"
                    aria-label="Leave room"
                    title="Leave room"
                    onClick={() => { void leaveRoom(); }}
                >
                    <i className="fa fa-sign-out" aria-hidden="true" />
                </button>
            </header>

            <main className="mobile-game-content" aria-live="polite">
                {frame === "left_frame"   && <MobileLeftFrame setFrame={setFrame} />}
                {frame === "middle_frame" && <MobileMiddleFrame setFrame={setFrame} />}
                {frame === "right_frame"  && <MobileRightFrame setFrame={setFrame} />}
                {frame === "chat_frame"   && <MobileChatFrame/>}
            </main>

            <nav id="mobile_main_frame_option_buttons" aria-label="Game navigation">
                <button
                    className={frame === "left_frame" ? "is-active" : ""}
                    type="button"
                    onClick={() => openFrame("left_frame")}
                >
                    <span className="mobile-nav-icon"><i className="fa fa-users" aria-hidden="true" /></span>
                    <span className="mobile-nav-label">Players</span>
                    <b className="mobile-nav-badge">{players?.length ?? 0}</b>
                </button>
                <button
                    className={frame === "middle_frame" ? "is-active" : ""}
                    type="button"
                    onClick={() => openFrame("middle_frame")}
                >
                    <span className="mobile-nav-icon"><i className="fa fa-music" aria-hidden="true" /></span>
                    <span className="mobile-nav-label">Game</span>
                </button>
                <button
                    className={frame === "chat_frame" ? "is-active" : ""}
                    type="button"
                    onClick={() => openFrame("chat_frame")}
                >
                    <span className="mobile-nav-icon"><i className="fa fa-comments" aria-hidden="true" /></span>
                    <span className="mobile-nav-label">Chat</span>
                </button>
            </nav>
        </div>
    );
}

export default MainFrame;
