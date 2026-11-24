// What this phone can do: whether it is an iPhone, added to the Home Screen, able to show alerts.

export const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** Airband's phone link is for an iPhone (iPhone, or an iPad acting as one: same Safari, same alerts). */
export const iphone = () => ios();
export const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const pushable = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const deviceName = () => (/iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad" : "iPhone");
