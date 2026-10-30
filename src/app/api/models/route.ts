import { json, requireUser, unauthorized } from "@/lib/server/auth";
import { AUTO_MODEL, modelOptions, resolveModel } from "@/lib/llm";
import { loadPreferredModel } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Models the picker may offer: only the server's configured NVIDIA / OpenRouter models. No keys are exposed. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const options = modelOptions().map(({ id, label, provider, vision }) => ({ id, label, provider, vision }));
  const saved = resolveModel(await loadPreferredModel(a.db, a.user.id));
  return json({ options: [{ id: AUTO_MODEL, label: "Auto (best available)", provider: "auto", vision: false }, ...options], selected: saved?.id ?? AUTO_MODEL });
}
