// The hook's entry point: agents run dist/airband-hook.js after each reply. Only this file runs
// anything when loaded, so tests importing airband-hook.ts never read stdin or exit.
import { main } from "./airband-hook";

main();
