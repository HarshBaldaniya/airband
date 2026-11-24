// Which Airband this is, and how two version numbers compare.

/** Airband's version, written in at build time from package.json. */
export const VERSION = __AIRBAND_VERSION__;

/** A plain version number, as npm publishes them: 1.2.3 or 1.2.3-beta.1. */
export const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(-[0-9A-Za-z.]{1,40})?$/;

/** a > b, for plain x.y.z versions. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
