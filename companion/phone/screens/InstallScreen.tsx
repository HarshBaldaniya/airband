import { Share, SquarePlus } from "lucide-react";
import { Companion } from "../../figure/Companion";

/** In Safari: how to add Airband to the Home Screen. The Home Screen app does the rest. */
export function InstallScreen() {
  return (
    <div className="phonepage linkscreen">
      <Companion mood="hello" name="Airband" size={96} />
      <h1>Add Airband to your Home Screen</h1>
      <ol className="steps">
        <li>
          Tap <Share size={16} aria-label="Share" /> below.
        </li>
        <li>
          Choose <SquarePlus size={16} aria-hidden="true" /> Add to Home Screen, then Add.
        </li>
        <li>Open Airband from your Home Screen. It links by itself.</li>
      </ol>
      <p className="muted lead">Already have Airband on your Home Screen? Open it and tap Scan the code.</p>
    </div>
  );
}
