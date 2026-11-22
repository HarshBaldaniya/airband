// The few Markdown marks the changelog uses, as elements: **bold**, `code` and [links](url).
import type { ReactNode } from "react";

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1]) out.push(<strong key={m.index}>{inline(m[1])}</strong>);
    else if (m[2]) out.push(<code key={m.index}>{m[2]}</code>);
    else out.push(<a key={m.index} href={m[4]}>{m[3]}</a>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
