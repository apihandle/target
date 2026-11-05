/**
 * Monetag In-Page Push tag (zone 12150496), placed in <head> from the root layout as
 * Monetag's installation check requires. The exact snippet only runs on public pages:
 * it never loads inside the signed-in workspace (/app), the admin panel (/admin), /login or /auth.
 */
const SNIPPET =
  "if(!/^\\/(app|admin|login|auth)(\\/|$)/.test(location.pathname)){" +
  "(function(s){s.dataset.zone='12150496',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))" +
  "}";

export default function AdTag() {
  return <script id="monetag-tag" dangerouslySetInnerHTML={{ __html: SNIPPET }} />;
}
