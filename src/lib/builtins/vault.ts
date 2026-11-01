import { z } from "zod";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { luhn, vaultPreview } from "@/lib/builtins/helpers";

/**
 * The user's vault: logins, cards, API keys and notes, sealed with AES-256-GCM and bound to the owner.
 * Values are only ever opened server-side for an approved browser job; no API returns them.
 */
export const VAULT_KINDS = ["login", "card", "api_key", "note"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];
export const MAX_VAULT_ITEMS = 50;

const s = (n: number) => z.string().trim().max(n);
export const vaultInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("login"), label: s(80).min(1), site: s(200).optional(), username: s(200).min(1), password: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal("card"), label: s(80).min(1), name: s(100).optional(),
    number: z.string().transform((v) => v.replace(/[\s-]/g, "")).refine(luhn, "That card number doesn't look right"),
    expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Expiry looks like 08/29"), cvc: z.string().regex(/^\d{3,4}$/).optional(),
  }),
  z.object({ kind: z.literal("api_key"), label: s(80).min(1), site: s(200).optional(), value: z.string().min(4).max(4000) }),
  z.object({ kind: z.literal("note"), label: s(80).min(1), value: z.string().min(1).max(4000) }),
]);
export type VaultInput = z.infer<typeof vaultInput>;

export function sealVault(userId: string, input: VaultInput, env = process.env): { secret_box: string; preview: string; site: string | null } {
  const { kind, label, ...rest } = input;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) if (typeof v === "string" && v && k !== "site") fields[k] = v;
  const box = encryptSecret(JSON.stringify({ v: 1, u: userId, f: fields }), primaryKey(env));
  void label;
  return { secret_box: box, preview: vaultPreview(kind, fields), site: "site" in input && input.site ? input.site : null };
}

export function openVault(userId: string, box: string, env = process.env): Record<string, string> {
  const j = JSON.parse(decryptWithAny(box, decryptionKeys(env))) as { v?: number; u?: string; f?: Record<string, string> };
  if (j.u !== userId) throw new Error("Vault item belongs to a different account");
  return j.f ?? {};
}
