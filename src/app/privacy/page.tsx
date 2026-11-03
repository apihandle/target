import LegalPage from "@/components/LegalPage";
export const metadata = { title: "Privacy Policy · TARGET" };
export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 4, 2026"
      sections={[
        { h: "What we collect", p: "Your email address and basic profile (name, photo) when you sign in with email or Google, and the messages, memories and projects you create in TARGET." },
        { h: "How we use it", p: "Only to run TARGET for you: signing you in, answering your requests, and remembering what you ask us to remember. We never sell your data." },
        { h: "Where it lives", p: "Data is stored with our infrastructure providers (Supabase for accounts and data, Vercel for hosting). AI requests are sent to model providers only to generate your answers." },
        { id: "advertising", h: "Advertising", p: "Public pages of this site (such as the homepage, these policy pages, published Pages and shared chats) show ads from Monetag, a third-party ad network, which may use cookies or similar technology to show and measure ads. Ads never load inside the signed-in TARGET app (/app), or on the sign-in pages, and your chats, memories and projects are never shared with advertisers. If you allowed push notifications from an ad, you can turn them off at any time in your browser settings (site settings, Notifications, then block or remove gettarget.vercel.app)." },
        { h: "Your control", p: "You can view, change or delete your data and your account at any time. Contact shadowxpov@gmail.com for any privacy request." },
      ]}
    />
  );
}
