// A finished reply as a notification can carry it: the outcome, then a few key points, and
// whether it left the next step to the person.
import { plainText } from "../text";

/** Cut at the end of a sentence near `max`, else at a word, never mid-word. */
export function sentenceClip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.endsWith(".") ? cut.length - 1 : -1);
  if (end > max * 0.3) return cut.slice(0, end + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).replace(/[,;:\s]+$/, "")}…`;
}

/** The longest summary a notification carries. */
const BRIEF_MAX = 300;

/**
 * The reply as a notification can carry it: its outcome (the first plain paragraph), then up to
 * three key points from its lists, one short line each, within about 300 characters.
 */
export function briefOf(reply: string, yours = false): string {
  const paras = reply.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const outcome = plainText(paras.find((x) => !/^(#{1,6}\s|\||```|[-*•]\s|\d+\.\s|>)/.test(x)) ?? "");
  let out = sentenceClip(outcome, 200);
  // Handed back: what the person is to do comes next, before anything else.
  const step = yours ? yourStep(reply) : undefined;
  if (step) return `${out}\n${sentenceClip(`Your turn: ${step}`, BRIEF_MAX - out.length - 1)}`;
  for (const point of keyPoints(reply)) {
    if (out.length + point.length + 3 > BRIEF_MAX) break;
    out += `\n• ${point}`;
    if (out.split("\n").length > 3) break;
  }
  return out;
}

/** The reply's key points: its list items, or its table rows ("npm: airband@0.0.8 is the latest"). */
function keyPoints(reply: string): string[] {
  const points: string[] = [];
  const rows: string[] = [];
  for (const line of reply.split("\n")) {
    const item = /^\s{0,3}(?:[-*•]|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      const point = sentenceClip(plainText(item[1]), 90);
      if (point.length >= 12) points.push(point);
      continue;
    }
    const row = /^\|(.+)\|\s*$/.exec(line.trim());
    if (row && !/^[\s|:-]+$/.test(row[1])) {
      const cells = row[1].split("|").map((c) => plainText(c)).filter(Boolean);
      if (cells.length >= 2) rows.push(sentenceClip(`${cells[0]}: ${cells.slice(1).join(", ")}`, 90));
    }
  }
  // A table's first row is its header.
  return points.length ? points : rows.slice(1);
}

/** What the person is asked to do: the part under "Your step" (a command to run, then the words), or the sentence that asks. */
function yourStep(reply: string): string | undefined {
  const lines = reply.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s+.*\b(your step|your turn|what you do|to do)\b/i.test(l));
  if (at >= 0) {
    const rest = lines.slice(at + 1).join("\n");
    const code = /```[a-z]*\n([^\n]+)/.exec(rest)?.[1]?.trim();
    const words = rest.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((x) => plainText(x)).find((x) => x && !/^#{1,6}\s/.test(x));
    const say = words ? words.replace(/^Then\s/, "then ") : "";
    if (code) return `run ${code}${say ? `. ${say.charAt(0).toUpperCase()}${say.slice(1)}` : "."}`;
    if (say) return say;
  }
  const asked = plainText(reply).split(/(?<=[.!?])\s+/).find((x) => YOURS.test(x) || /\?$/.test(x));
  return asked;
}

// What hands the next step back: an explicit ask of the person, not a polite "tell me if".
export const YOURS = /\b(your step|your turn|only you can|you('ll| will)? need to|needs? your (answer|approval|code|input|ok|go-ahead|one-time code)|waiting (for|on) you|over to you|before I can|once you('ve| have)? (published|approved|run|done|logged in)|then tell me|tell me "[^"]+")/i;
