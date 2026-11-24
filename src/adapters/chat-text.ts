// A chat's words as the person and the agent said them, without what editors and Airband add.
import { OLD_NAMES } from "../core/legacy";

/** A line Airband wrote into a chat, under its name or an earlier one: "[Airband] ...". */
const OWN_LINE = new RegExp(`^(Stop hook feedback:\\s*)?\\[(${["Airband", ...OLD_NAMES].join("|")})\\]`);

/** Drops the machinery the editor adds around a message, so only what was said remains. */
export function cleanText(text: string): string {
  let t = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, "")
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, "")
    .replace(/<artifact-content-authored-by-others\/>/g, "")
    .replace(/<\/?pasted_content[^>]*>/g, "")
    .trim();
  if (/^\[Request interrupted/.test(t)) t = "";
  // A summary Claude wrote when the chat ran out of room is not something anyone said.
  if (/^(The summarized conversation|This session is being continued from a previous conversation)/.test(t)) t = "";
  // Airband's own deliveries (also when Claude Code wraps them as hook feedback) are not part of the
  // conversation. They start with "[Airband]"; a reply that only quotes Airband's words is kept.
  if (OWN_LINE.test(t) || /^Noted the updates from (linked|connected) chats\.?$/.test(t)) t = "";
  return t;
}
