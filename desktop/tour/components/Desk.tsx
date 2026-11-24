import { Companion } from "../../../companion/figure/Companion";
import type { Scan } from "../types";

/** A small picture of the screen with Roger in his corner: where to find him. */
export function Desk({ os }: { os: Scan["os"] }) {
  return (
    <div className={`desk ${os}`} aria-hidden>
      <div className="bar">
        <i />
        <i />
        <i className="me" />
      </div>
      <div className="win" />
      <div className="roger">
        <Companion mood="hello" name="Roger" size={40} />
      </div>
    </div>
  );
}
