import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "../../css/initialpages/dashboard/playersmap.css";
import { useEffect, useState } from "react";
import { useRoomContext } from "../../utils/RoomContext";

const customIcon = new L.Icon({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });

const PlayersMap: React.FC = () => {
  const [locations, setLocations] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const { getAdminLocations } = useRoomContext();
  useEffect(() => {
    void getAdminLocations().then(setLocations).catch(() => setMessage("This dashboard requires the lyricmatch_admin claim."));
  }, [getAdminLocations]);
  if (message) return <div id="dashboard_players_map" className="dashboard-empty">{message}</div>;
  return <div id="dashboard_players_map"><MapContainer center={locations.length ? [locations[0].latitude, locations[0].longitude] : [0, 0]} zoom={2} style={{ height: "100%", width: "100%" }} id="dashboard_map">
    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {locations.map((location, index) => <Marker key={`${location.latitude}-${location.longitude}-${index}`} position={[location.latitude, location.longitude]} icon={customIcon}><Popup>{location.city} ({location.count} players)</Popup></Marker>)}
  </MapContainer></div>;
};

export default PlayersMap;
