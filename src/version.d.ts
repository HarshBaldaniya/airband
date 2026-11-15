/** Airband's version, written in at build time from package.json. */
declare const __AIRBAND_VERSION__: string;

/** The parser package and each .wasm file's SHA-256 and size, written in at build time. */
declare const __AIRBAND_GRAMMARS__: { pkg: string; files: Record<string, { sha256: string; size: number }> };
