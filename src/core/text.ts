// Small helpers for the words Airband shows and sends: one line, cut to fit, Markdown taken out,
// counts in words, and the rough token count every budget uses.

/** All runs of white space (line breaks too) as one space, trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One line, cut to `max` characters with "…" when longer. */
export function shorten(text: string, max: number): string {
  const s = oneLine(text);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Words fit for a small screen: no Markdown marks, no escaped line breaks, no links, one line. */
export function plainText(text: string): string {
  return text
    .replace(/\\[nrt]/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*|__|`|^#+\s*/gm, "")
    // *A word* or _a word_ in italics, but never the underscores inside a name like snake_case.
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*\(?https?:\/\/\S+\)?/g, "")
    .replace(/[:,]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1 file", "3 files"; `many` for a word whose plural isn't just an "s". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** About how many characters make one token, for budgets and estimates (no tokenizer needed). */
export const CHARS_PER_TOKEN = 4;

/** Roughly how many tokens `chars` characters cost. */
export const tokensFor = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);
