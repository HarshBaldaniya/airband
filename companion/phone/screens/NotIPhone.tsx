import { Companion } from "../../figure/Companion";

export function NotIPhone() {
  return (
    <div className="phonepage linkscreen">
      <Companion mood="idle" name="Airband" size={96} />
      <h1>Open this on your iPhone</h1>
      <p className="muted lead">Airband's phone link connects your Mac and your iPhone, and nothing else. Scan the code on your Mac with your iPhone's camera.</p>
    </div>
  );
}
