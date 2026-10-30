import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { Env } from "@/lib/connectors/types";

/**
 * AES-256-GCM for connector credentials.
 * Key: CONNECTOR_ENCRYPTION_KEY = 32 random bytes, base64 (`openssl rand -base64 32`).
 * Backward compatibility: TOKEN_ENCRYPTION_KEY (from the earlier Google Calendar integration) is used
 * when CONNECTOR_ENCRYPTION_KEY is not set, and is also tried for decryption when both are set, so
 * rows written with the old key keep working and are re-encrypted with the new key on next refresh/save.
 */
export function parseKey(raw: string | undefined, name = "CONNECTOR_ENCRYPTION_KEY"): Buffer {
  if (!raw) throw new Error(`${name} is not set`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

/** Key used for new ciphertext. */
export function primaryKey(env: Env = process.env): Buffer {
  if (env.CONNECTOR_ENCRYPTION_KEY) return parseKey(env.CONNECTOR_ENCRYPTION_KEY);
  return parseKey(env.TOKEN_ENCRYPTION_KEY, "CONNECTOR_ENCRYPTION_KEY (or legacy TOKEN_ENCRYPTION_KEY)");
}

/** All keys that may decrypt existing ciphertext, newest first. */
export function decryptionKeys(env: Env = process.env): Buffer[] {
  const out: Buffer[] = [];
  if (env.CONNECTOR_ENCRYPTION_KEY) out.push(parseKey(env.CONNECTOR_ENCRYPTION_KEY));
  if (env.TOKEN_ENCRYPTION_KEY) {
    const legacy = parseKey(env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
    if (!out.some((k) => k.equals(legacy))) out.push(legacy);
  }
  if (!out.length) throw new Error("CONNECTOR_ENCRYPTION_KEY is not set");
  return out;
}

export const hasEncryptionKey = (env: Env = process.env) => !!(env.CONNECTOR_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY);

/** Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). Same format as the earlier integration. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(box: string, key: Buffer): string {
  const [v, iv, tag, ct] = (box || "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Bad secret format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Try each key; the auth tag makes a wrong key fail loudly instead of returning garbage. */
export function decryptWithAny(box: string, keys: Buffer[]): string {
  for (const k of keys) {
    try { return decryptSecret(box, k); } catch { /* try next key */ }
  }
  throw new Error("Could not decrypt stored credentials");
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");

/** PKCE (RFC 7636, S256). */
export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: sha256(verifier) };
}
