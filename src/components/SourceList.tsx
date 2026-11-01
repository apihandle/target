import { LinkCards } from "@/components/Blocks";
import type { Source } from "@/lib/search";

/** Web-search sources shown as link cards (favicon, title, host). */
export default function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div data-testid="sources">
      <LinkCards label="Sources" items={sources.map((s) => ({ title: s.title, url: s.url }))} />
    </div>
  );
}
