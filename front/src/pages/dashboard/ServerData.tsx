import { useEffect, useState } from "react";
import "./../../css/initialpages/dashboard/serverdata.css";
import { useRoomContext } from "../../utils/RoomContext";

const ServerData: React.FC = () => {
  const [data, setData] = useState<any>({ activeRoomCount: "–", activePlayerCount: "–", connectedWebSocketClientCount: "–", averageClients: "–" });
  const { getAdminMetrics } = useRoomContext();
  useEffect(() => { void getAdminMetrics().then(setData).catch(() => undefined); }, [getAdminMetrics]);
  return <div className="server_data_box">
    <div className="box_item"><div className="info_number">{data.activeRoomCount}</div><div className="info_text">Active rooms</div></div>
    <div className="box_item"><div className="info_number">{data.activePlayerCount}</div><div className="info_text">Active players</div></div>
    <div className="box_item"><div className="info_number">{data.connectedWebSocketClientCount}</div><div className="info_text">Players seen in 60s</div></div>
    <div className="box_item"><div className="info_number">{data.averageClients}</div><div className="info_text">Players mean per room</div></div>
  </div>;
};

export default ServerData;
