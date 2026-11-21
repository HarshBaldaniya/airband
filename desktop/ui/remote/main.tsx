// The phone app's page, served by Airband's relay.
import { createRoot } from "react-dom/client";
import "../ui.css";
import { PhoneApp } from "./PhoneApp";

createRoot(document.getElementById("root")!).render(<PhoneApp />);
