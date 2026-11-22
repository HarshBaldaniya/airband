import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/download/", "/docs/", "/changelog/", "/privacy/"].map((p) => ({ url: `${SITE.origin}${p}`, changeFrequency: p === "/changelog/" ? "weekly" : "monthly", priority: p === "/" ? 1 : 0.7 }));
}
