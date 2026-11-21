// The phone link is parked until Airband has its own iPhone app. A web page over the Wi-Fi is plain
// http: the browser marks it "Not Secure", its address is a number, and anyone on the same network
// could read the phone's key. Until the app, nothing turns it on: no setting, no page, no command.
// The code stays (the phone page, its key, the Station's rules for it) for the app to build on.
export const PHONE_LINK = false;
