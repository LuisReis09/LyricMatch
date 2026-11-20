import TextInput from "../../utils/TextInput";
import Button from "../../utils/Button";
import "../../css/utils/form.css";
import { useRoomContext } from "../../utils/RoomContext";
import { useEffect, useState } from "react";

interface EnterProps {
  username: string;
  avatar: number | string;
}

const Enter: React.FC<EnterProps> = ({ username, avatar }) => {
  const [roomCode, setRoomCode] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const { joinRoom } = useRoomContext();

  useEffect(() => setRoomCode(new URLSearchParams(window.location.search).get("code") || ""), []);

  const handleEnterRoom = async () => {
    if (!username.trim()) return setAlertMessage("Input Error: Please, set a username first.");
    if (!roomCode.trim()) return setAlertMessage("Input Error: Please, set a room code.");
    if (!roomPassword) return setAlertMessage("Input Error: Please, set a room password.");
    try {
      await joinRoom({ code: roomCode, name: username, avatar: String(avatar), password: roomPassword });
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "Could not enter the room.");
    }
  };

  return (
    <div className="form_box">
      <TextInput label="Code:" placeholder="Enter the room code" setText={setRoomCode} value={roomCode} />
      <TextInput label="Password:" isPassword placeholder="Enter the room password" setText={setRoomPassword} enterFunc={handleEnterRoom} />
      <Button text="Enter room" func={handleEnterRoom} />
      {alertMessage && <div className="custom-alert">{alertMessage}</div>}
    </div>
  );
};

export default Enter;
