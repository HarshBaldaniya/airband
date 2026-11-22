import Link from "next/link";
import { NEW_TAB } from "@/lib/ext";
import { SITE } from "@/lib/site";
import { VERSION } from "@/lib/release";
import { FootRoger } from "./FootRoger";

export function Foot() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-card">
          <div className="foot-brand">
            <FootRoger />
            <div>
              <img src="/brand/airband-wordmark-dark.svg" alt="Airband" />
              <p>Every AI agent, on one frequency.</p>
            </div>
          </div>
          <div className="foot-cols">
            <div>
              <b>Product</b>
              <Link href="/download/">Download</Link>
              <Link href="/docs/">Guide</Link>
              <Link href="/changelog/">What's new</Link>
            </div>
            <div>
              <b>Open source</b>
              <a href={SITE.repo} {...NEW_TAB}>GitHub</a>
              <a href={SITE.npm} {...NEW_TAB}>npm</a>
              <a href={`${SITE.repo}/releases`} {...NEW_TAB}>Releases</a>
            </div>
            <div>
              <b>About</b>
              <Link href="/privacy/">Privacy</Link>
              <a href={`${SITE.repo}/blob/main/LICENSE`} {...NEW_TAB}>MIT license</a>
              <a href={SITE.author.url} {...NEW_TAB}>{SITE.author.name}</a>
            </div>
          </div>
        </div>
        <div className="foot-base">
          <span>
            © {new Date().getFullYear()} <a href={SITE.author.url} {...NEW_TAB}>{SITE.author.name}</a>
          </span>
          <span className="ver">
            <i /> v{VERSION}
          </span>
        </div>
      </div>
      <div className="foot-word" aria-hidden>
        <img src="/brand/airband-wordmark-dark.svg" alt="" />
      </div>
    </footer>
  );
}
