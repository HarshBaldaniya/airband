// Signs the engine that npm serves for a version, so the desktop app will install it: the app
// installs an engine only when its signature, on the GitHub release of the same version, checks
// out against the updater's public key (desktop/src-tauri/src/setup/signature.rs).
//
//   node scripts/sign-engine.mjs [version]      (package.json's version when left out)
//
// It downloads airband-<version>.tgz from npm, checks it against npm's own sha512, signs it with
// the updater's private key (the same key as the app's updates: TAURI_SIGNING_PRIVATE_KEY, the key
// itself or a path to it, and TAURI_SIGNING_PRIVATE_KEY_PASSWORD), and writes
// desktop/release/airband-engine-<version>.tgz.sig. The release workflow runs it on every v* tag
// and attaches the file to the release. Publish the version to npm first.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { download } from "./release-names.mjs";

// Paths are the repository's, wherever this is run from.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const REGISTRY = "https://registry.npmjs.org/";
const version = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const fail = (message) => {
  console.error(`sign-engine: ${message}`);
  process.exit(1);
};

const meta = await fetch(`${REGISTRY}airband/${version}`);
if (meta.status === 404) fail(`airband@${version} isn't on npm. Publish it first (npm run publish:npm).`);
if (!meta.ok) fail(`npm answered ${meta.status}`);
const { dist } = await meta.json();
if (!dist?.tarball?.startsWith(REGISTRY) || !dist.integrity?.startsWith("sha512-")) fail("npm's answer has no tarball or sha512");

const tarball = Buffer.from(await (await fetch(dist.tarball)).arrayBuffer());
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
if (integrity !== dist.integrity) fail("the tarball doesn't match npm's sha512");

// Signed under npm's own file name, bound to the version (the app checks the version).
const dir = mkdtempSync(join(tmpdir(), "airband-engine-"));
const file = join(dir, `airband-${version}.tgz`);
writeFileSync(file, tarball);
const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? "";
const env = { ...process.env };
const args = ["tauri", "signer", "sign", "--app-version", version];
if (key && existsSync(key)) {
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  args.push("--private-key-path", resolve(key));
} else if (!key) fail("TAURI_SIGNING_PRIVATE_KEY isn't set");
args.push(file);
const signed = spawnSync("npx", args, { cwd: "desktop", env, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
if (signed.status !== 0 || !existsSync(`${file}.sig`)) fail("tauri signer sign failed (is desktop/node_modules installed? npm ci --prefix desktop)");

mkdirSync("desktop/release", { recursive: true });
const out = join("desktop/release", download("engine-signature", version));
copyFileSync(`${file}.sig`, out);
rmSync(dir, { recursive: true, force: true });
console.log(`${out}  (airband-${version}.tgz from npm, ${(tarball.length / 1024).toFixed(0)} KB)`);
