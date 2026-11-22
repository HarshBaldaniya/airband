import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { changelog, releaseDates, type Release } from "@/lib/release";
import { inline } from "@/lib/inline";
import { NEW_TAB } from "@/lib/ext";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "What's new", description: "What's new in Airband, version by version.", alternates: { canonical: "/changelog/" } };

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : undefined);

/** "0.0.1 (first release)" → the number and its note. */
function heading(r: Release) {
  const m = /^(\S+)\s*\((.+)\)$/.exec(r.version);
  return m ? { number: m[1], note: m[2][0].toUpperCase() + m[2].slice(1) } : { number: r.version, note: undefined };
}

/** "**Title.** What it does." becomes a title and its line. A bold start that runs on into the
 *  sentence ("**Four new skills** agents use…") stays one line, its bold part the short label. */
function item(text: string) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text);
  if (m && /[.!?]$/.test(m[1])) return { title: m[1].replace(/\.$/, ""), label: m[1].replace(/\.$/, ""), line: m[2] };
  const label = m ? m[1] : text.replace(/[`*]/g, "").split(/[.:(]/)[0];
  return { title: undefined, label: label.length > 70 ? `${label.slice(0, 68)}…` : label, line: text };
}

/** A line with its own points ("The new ones: - a - b") as the line and a list. */
function Line({ text }: { text: string }) {
  const at = text.indexOf(": - ");
  if (at < 0) return <p>{inline(text)}</p>;
  const [head, ...points] = text.slice(0, at + 1).concat(text.slice(at + 1)).split(/\s-\s/);
  return (
    <>
      <p>{inline(head)}</p>
      <ul className="pts">
        {points.map((x, i) => (
          <li key={i}>{inline(x)}</li>
        ))}
      </ul>
    </>
  );
}

export default async function WhatsNew() {
  const [latest, ...earlier] = changelog();
  const dates = await releaseDates();
  const top = heading(latest);
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">What&apos;s new</h1>
          <p>Every version of Airband, newest first.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <article className="latest">
            <header>
              <div className="ver">
                <span className="tag">Latest</span>
                <b>{top.number}</b>
                {day(dates[top.number]) && <small>{day(dates[top.number])}</small>}
              </div>
              <Link className="btn small primary" href="/download/">
                <ArrowDownToLine /> Get it
              </Link>
            </header>
            <ol className="changes">
              {latest.items.map((t, i) => {
                const it = item(t);
                return (
                  <li key={i}>
                    <span className="n">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      {it.title && <b>{it.title}</b>}
                      <Line text={it.line} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>
        </Reveal>

        <section className="tl" aria-label="Earlier versions">
          {earlier.map((r) => {
            const h = heading(r);
            const when = day(dates[h.number]);
            return (
              <Reveal key={r.version} className="tl-row">
                <div className="tl-when">
                  <b>{h.number}</b>
                  {when && <small>{when}</small>}
                  {h.note && <span className="tag quiet">{h.note}</span>}
                </div>
                <details className="tl-body">
                  <summary>
                    <ul className="tl-titles">
                      {r.items.map((t, i) => (
                        <li key={i}>{item(t).label}</li>
                      ))}
                    </ul>
                    <span className="tl-toggle" />
                  </summary>
                  <ul className="tl-items">
                    {r.items.map((t, i) => {
                      const it = item(t);
                      return (
                        <li key={i}>
                          {it.title && <b>{it.title}</b>}
                          <Line text={it.line} />
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </Reveal>
            );
          })}
        </section>

        <p className="tl-end">
          <a className="pill" href={`${SITE.repo}/releases`} {...NEW_TAB}>
            Every release on GitHub <ArrowUpRight className="arrow" />
          </a>
        </p>
      </div>
    </div>
  );
}
