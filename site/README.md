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
one source: Roger's figure from `companion/figure`, the wordmark and icon from `media/`, and
the agents' logos. The copies are git-ignored.

The pictures in `public/shots/` are of the real app, taken from a test Station with made-up chats.

**Deploy:** Vercel, project `airband`, served at `airband.harshbaldaniya.com` (the domain's DNS
is on Vercel). The project is connected to this repository: a push to `main` that changes the site,
`companion/`, `media/`, the changelog or the version builds and deploys it. The build settings are in
the repository's root `vercel.json`. To deploy by hand from `site/` (signed in with
`npx vercel login`):

```bash
npm run deploy
```

After a release, deploy once more when its files are on GitHub: the file sizes come from the
release.
