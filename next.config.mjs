/** @type {import('next').NextConfig} */
const nextConfig = {
  // PDF text extraction (chat attachments) runs server-side; keep pdf.js out of the server bundle.
  serverExternalPackages: ["unpdf", "playwright-core"],
  async headers() {
    return [
      {
        // Baseline security headers on every page and API route.
        source: "/:path*",
        headers: [
          {
            // Fix #6: CSP now that the Monetag tag (nap5k.com) and its remote service
            // worker (3nbf4.com) are gone. script-src needs 'unsafe-inline' because the
            // App Router injects inline bootstrap scripts and there is no nonce pipeline
            // (src/proxy.ts sets none); everything else is 'self' plus the origins the
            // client genuinely uses: Supabase (REST + realtime) and remote images/media
            // the app displays (link previews, shared content). No third-party script
            // origin is allowed at all. See FIX6-NOTES.md.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'self'",
              "form-action 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "worker-src 'self'",
              "manifest-src 'self'",
            ].join("; "),
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
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
