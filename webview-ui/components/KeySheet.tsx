// The keyboard shortcut sheet, opened from the top bar or with "?" on any page.
import { I, Keyboard, X } from "./Icons";
import type { KeySection } from "../board/page-keys";

/** The shortcuts sheet: this page's keys first, then the ones that work everywhere. */
export function KeySheet({ sections, close }: { sections: KeySection[]; close: () => void }) {
  return (
    <div className="keysheetwrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="keysheet" role="dialog" aria-label="Keyboard shortcuts">
        <div className="keysheethead">
          <Keyboard {...I} size={15} />
          <strong>Keyboard shortcuts</strong>
          <span className="grow" />
          <button className="icon sm" onClick={close} aria-label="Close">
            <X {...I} />
          </button>
        </div>
        {sections.map((sec) => (
          <section key={sec.title} className="keysection">
            <div className="keysectiontitle">{sec.title}</div>
            <dl className="keylist">
              {sec.keys.map(([ks, what]) => (
                <div key={ks.join("+") + what} className="keyrow">
                  <dt>
                    {ks.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
