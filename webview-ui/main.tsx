import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { App } from "./app/App";

const view = document.body.dataset.view === "board" ? "board" : "sidebar";

createRoot(document.getElementById("root")!).render(<App view={view} />);
