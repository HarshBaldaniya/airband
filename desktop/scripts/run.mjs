// Starts the app from source with Electron. Editors built on Electron (VS Code) set
// ELECTRON_RUN_AS_NODE for their terminals, which would start Electron as plain Node: it is taken out.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(here, "..")], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
