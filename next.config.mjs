/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // PDF text extraction (chat attachments) runs server-side; keep pdf.js out of the webpack bundle.
    serverComponentsExternalPackages: ["unpdf"],
  },
  async headers() {
    return [
      {
        // Public read-only share links: never indexed or cached, and the token never leaks via Referer.
        source: "/share/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // The /app PWA service worker must never be served stale.
        source: "/app-sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
