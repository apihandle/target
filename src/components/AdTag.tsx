import Script from "next/script";

/** Third-party ad tag (Monetag). Only rendered on public marketing pages, never inside /app. */
export default function AdTag() {
  return <Script id="monetag-tag" src="https://nap5k.com/tag.min.js" data-zone="12150496" strategy="afterInteractive" />;
}
