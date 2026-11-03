/** One-line, plain ad disclosure for public pages (the Monetag tag never loads in /app, /login or /auth). */
export const AD_DISCLOSURE = "This site shows ads from Monetag.";

export default function AdDisclosure({ className = "" }: { className?: string }) {
  return (
    <p data-testid="ad-disclosure" className={className}>
      {AD_DISCLOSURE} <a href="/privacy#advertising" className="underline">Learn more</a>
    </p>
  );
}
