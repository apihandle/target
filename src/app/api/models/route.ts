import { json, requireUser, unauthorized } from "@/lib/server/auth";
import { AUTO_MODEL, modelOptions, resolveModel } from "@/lib/llm";
import { loadPreferredModel } from "@/lib/settings";
import { customOptions, listCustomProviders } from "@/lib/server/customProviders";
import { parseCustomModelId } from "@/lib/customProvider";

export const dynamic = "force-dynamic";

/** Models the picker may offer: the server's configured NVIDIA / OpenRouter models plus the user's own custom models. No keys are exposed. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const options = modelOptions().map(({ id, label, provider, vision }) => ({ id, label, provider, vision }));
  const [pref, rows] = await Promise.all([loadPreferredModel(a.db, a.user.id), listCustomProviders(a.db, a.user.id)]);
  const custom = customOptions(rows);
  const saved = parseCustomModelId(pref) ? (custom.find((o) => o.id === pref)?.id ?? null) : resolveModel(pref)?.id ?? null;
  return json({ options: [{ id: AUTO_MODEL, label: "Auto (best available)", provider: "auto", vision: false }, ...options, ...custom], selected: saved ?? AUTO_MODEL });
}
