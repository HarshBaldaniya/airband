import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { changelog, publishedAt } from "@/lib/release";
import { inline } from "@/lib/inline";
import { NEW_TAB } from "@/lib/ext";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "What's new", description: "What's new in the latest Airband.", alternates: { canonical: "/changelog/" } };

export default async function WhatsNew() {
  const [latest] = changelog();
  const at = await publishedAt();
  const when = at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : undefined;
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">What's new</h1>
          <p>The latest version of Airband.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <article className="latest">
            <header>
              <div>
                <b>{latest.version}</b>
                {when && <small> · {when}</small>}
              </div>
              <a className="btn small" href={`${SITE.repo}/releases`} {...NEW_TAB}>
                Every version <ArrowUpRight />
              </a>
            </header>
            <ol className="changes">
              {latest.items.map((t, i) => {
                // "**Title.** What it does." becomes a title and its line.
                const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(t);
                return (
                  <li key={i}>
                    <span className="n">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      {m ? (
                        <>
                          <b>{m[1].replace(/\.$/, "")}</b>
                          <p>{inline(m[2])}</p>
                        </>
                      ) : (
                        <p>{inline(t)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>
        </Reveal>
      </div>
    </div>
  );
}
