/**
 * Monetag In-Page Push tag, emitted as a plain inline <script> in the server HTML
 * (exactly as Monetag provides it) so their installation check can find it.
 * Only rendered on public marketing pages, never inside /app.
 */
const SNIPPET =
  "(function(s){s.dataset.zone='12150496',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))";

export default function AdTag() {
  return <script id="monetag-tag" dangerouslySetInnerHTML={{ __html: SNIPPET }} />;
}
