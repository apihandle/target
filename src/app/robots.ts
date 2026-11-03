import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/privacy", "/terms"], disallow: ["/app", "/api", "/auth"] }],
    sitemap: "https://gettarget.vercel.app/sitemap.xml",
    host: "https://gettarget.vercel.app",
  };
}
