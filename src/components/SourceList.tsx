import { hostOf, type Source } from "@/lib/search";

export default function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div data-testid="sources" className="mt-3 flex flex-wrap gap-2">
      <span className="self-center text-[11px] uppercase tracking-wider text-white/40">Sources</span>
      {sources.map((s, i) => (
        <a key={s.url + i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
          className="max-w-[220px] truncate rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10">
          [{i + 1}] {hostOf(s.url)}
        </a>
      ))}
    </div>
  );
}
