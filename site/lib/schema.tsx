// What search and answer engines read about Airband, as schema.org JSON-LD: the app, its maker
// (the same @id as on his portfolio, so the two sites are one person), the site, and Roger's
// answers as an FAQ. Built from the same facts the pages show.
import { ANSWERS } from "./answers";
import { SITE } from "./site";

const PERSON_ID = "https://www.harshbaldaniya.com/#person";

export function siteGraph(version: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE.origin}/#app`,
        name: "Airband",
        url: SITE.origin,
        description: SITE.description,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "AI coding tools",
        operatingSystem: "macOS 11 or later, Windows 10 or 11, Linux",
        softwareVersion: version,
        downloadUrl: `${SITE.origin}/download/`,
        installUrl: SITE.npm,
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Connects Claude Code, Codex and Gemini CLI chats so each knows what the others did",
          "Desktop companion, Roger, that shows requests and finished chats",
          "Allow, Always or Deny a chat's request from the corner of the screen",
          "iPhone alerts, locked end to end",
          "A code map agents query in a few hundred tokens",
        ],
        image: `${SITE.origin}/brand/icon.png`,
        screenshot: `${SITE.origin}/opengraph-image`,
        sameAs: [SITE.repo, SITE.npm],
        author: { "@id": PERSON_ID },
        creator: { "@id": PERSON_ID },
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: SITE.author.name,
        url: "https://www.harshbaldaniya.com",
        sameAs: ["https://github.com/HarshBaldaniya", "https://www.linkedin.com/in/hb134/"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE.origin}/#website`,
        url: SITE.origin,
        name: "Airband",
        description: SITE.description,
        publisher: { "@id": PERSON_ID },
        about: { "@id": `${SITE.origin}/#app` },
        inLanguage: "en",
      },
    ],
  };
}

/** Roger's answers, word for word as he says them, for the home page. */
export function faqGraph() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE.origin}/#faq`,
    mainEntity: ANSWERS.map((a) => ({ "@type": "Question", name: a.ask, acceptedAnswer: { "@type": "Answer", text: a.say } })),
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
