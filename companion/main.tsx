// The companion's screen: the desktop corner in the Airband app, or the phone page in a browser.
import { createRoot } from "react-dom/client";
import { MODE } from "./api/desktop-bridge";
import { DesktopView } from "./views/DesktopView";
import { PhoneView } from "./views/PhoneView";
import "./ui.css";

createRoot(document.getElementById("root")!).render(MODE === "desktop" ? <DesktopView /> : <PhoneView />);
