# airband.harshbaldaniya.com

Airband's website: a static Next.js export (no server). Pages: home, download, docs (one page),
changelog and privacy.

```bash
cd site
npm install
npm run dev      # http://localhost:3500
npm run build    # static files in out/
```

Nothing about a release is typed in. At build time the site reads the version from the
repository's `package.json`, the notes from `CHANGELOG.md`, and each download's size and SHA-256
from the GitHub release of that version. Rebuild it after a release, once the release's files are
up.

`npm run sync` (run by `dev` and `build`) copies in what the site shares with the app, so each has
one source: Roger's figure from `companion/companion`, the wordmark and icon from `media/`, and
the agents' logos. The copies are git-ignored.

The pictures in `public/shots/` are of the real app, taken from a test Station with made-up chats.

**Deploy:** Vercel, project `airband`, served at `airband.harshbaldaniya.com` (the domain's DNS
is on Vercel). The built files are deployed as they are, so Vercel builds nothing. From `site/`,
signed in once with `npx vercel login`:

```bash
npm run deploy
```

Deploy again after each release, once its files are on GitHub: the version and the file sizes come
from the release.
