import type { Metadata } from "next";
import { Check, Laptop, Lock, Server, Smartphone } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { NEW_TAB } from "@/lib/ext";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", description: "What Airband keeps, where, and what leaves your computer: nothing, unless you link an iPhone.", alternates: { canonical: "/privacy/" } };

const ZERO = ["No account", "No telemetry", "No logins read"];

const ONLINE = [
  { what: "Version check", when: "Once a day, on npm", off: "AIRBAND_OFFLINE=1" },
  { what: "Code parser", when: "Once, the first time a project needs it", off: "AIRBAND_OFFLINE=1" },
  { what: "Setup downloads", when: "Node.js and the engine, during the tour", off: "Only when missing" },
  { what: "Roger's look-ups", when: "Only questions he can't answer himself", off: "A switch in settings" },
];

export default function Privacy() {
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">Privacy</h1>
          <p>Your chats and your code stay on your computer.</p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="zero">
            {ZERO.map((z) => (
              <span key={z}>
                <Check /> {z}
              </span>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="pv">
            <h2>What goes online</h2>
            <div className="pv-rows">
              {ONLINE.map((o) => (
                <div key={o.what} className="pv-r">
                  <b>{o.what}</b>
                  <span>{o.when}</span>
                  <span className={`off${o.off.startsWith("AIRBAND") ? " mono" : ""}`}>Off: {o.off}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="pv">
            <h2>Your iPhone link</h2>
            <div className="flow" aria-label="Mac to relay to iPhone, locked end to end">
              <div>
                <Laptop />
                <b>Your Mac</b>
                <span>Locks every message</span>
              </div>
              <i className="wire">
                <Lock />
              </i>
              <div>
                <Server />
                <b>The relay</b>
                <span>Can't read a word</span>
              </div>
              <i className="wire">
                <Lock />
              </i>
              <div>
                <Smartphone />
                <b>Your iPhone</b>
                <span>The only one with the key</span>
              </div>
            </div>
            <ul className="pv-notes">
              <li>The link code works once, for 10 minutes. One iPhone per Mac.</li>
              <li>The relay keeps only the latest locked state, and deletes a link unused for 30 days.</li>
              <li>Your iPhone gets no folder paths, and can only answer requests.</li>
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="pv-end">
            This website has no cookies, no analytics and no forms. Found a security problem? See{" "}
            <a href={`${SITE.repo}/blob/main/SECURITY.md`} {...NEW_TAB}>
              SECURITY.md
            </a>
            .
          </p>
        </Reveal>
      </div>
    </div>
  );
}
