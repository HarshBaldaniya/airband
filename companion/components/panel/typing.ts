import { MODE } from "../../api/desktop-bridge";

/** Typing (ask, tell a chat) is on the computer only. The phone link answers requests and shows
 *  what finished: nothing typed on a phone reaches a chat. */
export const TYPING = MODE === "desktop";
