import TextInput from "../../utils/TextInput";
import Button from "../../utils/Button";
import NumberInput from "../../utils/NumberInput";
import { useRoomContext } from "../../utils/RoomContext";
import "../../css/utils/form.css";
import "../../css/utils/input.css";
import { useState } from "react";

interface CreateProps {
  username: string;
  avatar: number | string;
}

const Create: React.FC<CreateProps> = ({ username, avatar }) => {
  const [password, setPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(3);
  const [maxRounds, setMaxRounds] = useState(1);
  const [language, setLanguage] = useState<"PT" | "EN" | "ES">("EN");
  const [alertMessage, setAlertMessage] = useState("");
  const { createRoom } = useRoomContext();

  const handleCreateRoom = async () => {
    if (!username.trim()) return setAlertMessage("Input Error: Please, set a username first.");
    if (!password) return setAlertMessage("Input Error: Please, set a password.");
    if (maxPlayers < 1 || maxPlayers > 100) return setAlertMessage("Input Error: Max players must be between 1 and 100.");
    if (maxRounds < 1 || maxRounds > 50) return setAlertMessage("Input Error: Max rounds must be between 1 and 50.");
    try {
      await createRoom({ name: username, avatar: String(avatar), password, maxPlayers, maxRounds, language });
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "Could not create the room.");
    }
  };

  return (
    <div className="form_box create_room_box">
      <TextInput label="Password:" isPassword placeholder="Create the room password" setText={setPassword} enterFunc={handleCreateRoom} />
      <div className="number_inputs">
        <NumberInput label="Max Players:" placeholder="1 - 100" setNumber={setMaxPlayers} enterFunc={handleCreateRoom} />
        <NumberInput label="Max Rounds:" placeholder="1 - 50" setNumber={setMaxRounds} enterFunc={handleCreateRoom} />
      </div>
      <div className="input_box" id="language_selection_box">
        <label id="languages_label">Language:</label>
        <div id="languages_icons_box">
          <div id="PT-flag" className={`language_icon ${language === "PT" ? "flag-selected" : ""}`} onClick={() => setLanguage("PT")} />
          <div id="EN-flag" className={`language_icon ${language === "EN" ? "flag-selected" : ""}`} onClick={() => setLanguage("EN")} />
          <div id="SP-flag" className={`language_icon ${language === "ES" ? "flag-selected" : ""}`} onClick={() => setLanguage("ES")} />
        </div>
      </div>
      <Button text="Create room" func={handleCreateRoom} />
      {alertMessage && <div className="custom-alert">{alertMessage}</div>}
    </div>
  );
};

export default Create;
