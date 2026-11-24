import { useEffect, useState } from "react";
import { api, type StationState } from "../../api/station";
import { SettingRow } from "./SettingRow";
import { Toggle } from "./Toggle";

/** A QR code for a link, as an image address, drawn on the screen itself. */
const qrImage = (url: string, width: number) => import("qrcode").then((m) => m.toDataURL(url, { margin: 1, width }));

/** Link your iPhone through Airband's relay: a code that works once, then which iPhone holds the link. */
export function PhoneLinkRow({ state }: { state: StationState }) {
  const l = state.link;
  const [url, setUrl] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const waiting = !!l?.codeUntil;
  // A code is showing: fetch it (the panel may have opened after Link), and count down.
  useEffect(() => {
    if (!waiting) return setUrl(undefined);
    if (!url) void api.phoneCode().then((r) => setUrl(r.url));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting, url]);
  useEffect(() => {
    if (!url) return setQr(undefined);
    void qrImage(url, 264).then(setQr);
  }, [url]);
  // Test: a pretend request goes to the iPhone at once; the line below says what happened.
  const [sent, setSent] = useState<{ at: number; text: string; ok: boolean }>();
  if (!l) return null;
  const phone = l.phones[0];
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const link = () => run(async () => setUrl((await api.linkPhone()).url));
  const unlink = () => run(async () => void (await api.unlinkPhone(), setUrl(undefined), setSent(undefined)));
  const test = () =>
    run(async () => {
      const at = Date.now();
      try {
        const { results } = await api.testPhone();
        const bad = results.find((r) => !r.ok);
        setSent({ at, ok: !bad && results.length > 0, text: !results.length ? "Alerts aren't on yet. On the iPhone, open Airband and tap Turn on alerts." : bad ? bad.why ?? "It didn't go through." : `Sent to your ${phone?.name ?? "iPhone"}. Tap Allow or Deny there.` });
      } catch (e) {
        setSent({ at, ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  const answered = sent && state.test && state.test.at >= sent.at ? state.test : undefined;
  const result = !sent
    ? undefined
    : answered
      ? answered.answer === "none"
        ? { ok: false, text: "Nobody answered in 90 seconds." }
        : { ok: true, text: `${answered.from === "phone" ? `Your ${phone?.name ?? "iPhone"}` : "You, on this Mac,"} answered: ${answered.answer === "deny" ? "Deny" : answered.answer === "always" ? "Always" : "Allow"}. It works.` }
      : sent;
  const left = waiting ? Math.max(0, Math.round((l.codeUntil! - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const note = phone
    ? `${phone.name} linked${phone.alerts ? ", alerts on" : ". Turn on alerts on the iPhone"}.`
    : waiting
      ? `Scan with your iPhone's camera. Works once, ${clock} left.`
      : l.expired
        ? "The code ran out. Click Link for a new one."
        : "Requests on your iPhone, from anywhere.";
  return (
    <>
      <SettingRow title="Your phone" note={note}>
        {phone ? (
          <span className="rowbtns">
            {phone.alerts && (
              <button className="btn small" disabled={busy} onClick={() => void test()} title="Send a pretend request to your iPhone">
                Test
              </button>
            )}
            <button className="btn small" disabled={busy} onClick={() => void unlink()}>
              Unlink
            </button>
          </span>
        ) : waiting ? (
          <button className="btn small" disabled={busy} onClick={() => void unlink()}>
            Cancel
          </button>
        ) : (
          <button className="btn small primary" disabled={busy} onClick={() => void link()}>
            Link
          </button>
        )}
      </SettingRow>
      {(phone || waiting) && !l.online && <p className="testline bad">Can't reach Airband's relay. Trying again…</p>}
      {phone && (
        <SettingRow title="Alert my phone always" note="Also while you're at this Mac.">
          <Toggle on={state.settings.phoneAlways} label="Alert my phone always" onChange={(on) => api.settings({ phoneAlways: on })} />
        </SettingRow>
      )}
      {result && (
        <p className={`testline${result.ok ? " ok" : " bad"}`} role="status">
          {result.text}
        </p>
      )}
      <div className={`phonelink${waiting && url ? " open" : ""}`}>
        <div className="phoneinner">
          {qr ? <img src={qr} alt="Code to link your iPhone" width={132} height={132} /> : url && <code className="linkurl">{url}</code>}
          <ol className="linksteps muted">
            <li>Scan with your iPhone's camera.</li>
            <li>Share, then Add to Home Screen.</li>
            <li>Open Airband there. It links by itself.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
