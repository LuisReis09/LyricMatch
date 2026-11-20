import React from "react";
import "../../css/initialpages/dashboard/requests.css";

const Requests: React.FC = () => (
  <div id="requests_box">
    <div id="requests_messages_box" className="request_message_box">
      <div className="request_type">SUPABASE REALTIME</div>
      <div className="request_message">Room events are delivered through authenticated Postgres Changes channels. Inspect Edge Function and Realtime logs in the Supabase dashboard for operational tracing.</div>
    </div>
  </div>
);

export default Requests;
