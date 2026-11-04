import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export type CredentialIdentity = { organization: string; id: string; provider: string; model: string };
export type Envelope = { version: 1; key_id: string; wrapped_key: string; nonce: string; ciphertext: string; tag: string };
export const credentialAAD = (identity: CredentialIdentity) => Buffer.from(JSON.stringify(["inkspect-byok-v1", identity.organization, identity.id, identity.provider, identity.model]));

export function encryptionKey() {
  const path = process.env.INKSPECT_BYOK_PUBLIC_KEY_FILE;
  if (!path) throw new Error("BYOK encryption is not configured");
  const pem = readFileSync(path);
  if (pem.length > 16384 || pem.includes(Buffer.from("PRIVATE KEY"))) throw new Error("BYOK requires an encryption-only public key");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength || 0) < 3072) throw new Error("Invalid BYOK public key");
  return key;
}
export function encryptionReady() { try { encryptionKey(); return true; } catch { return false; } }

// Only public-key encryption exists in the web service. Decryption lives only in the engine worker.
export function encryptCredential(secret: string, identity: CredentialIdentity, key = encryptionKey()): Envelope {
  if (secret.length < 16 || secret.length > 4096 || /[^\x21-\x7e]/.test(secret)) throw new Error("Invalid provider API key");
  const dataKey = randomBytes(32), nonce = randomBytes(12), aad = credentialAAD(identity);
  try {
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const wrapped = publicEncrypt({ key, oaepHash: "sha256", oaepLabel: aad, padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey);
    return { version: 1, key_id: createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex"), wrapped_key: wrapped.toString("base64"), nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  } finally { dataKey.fill(0); }
}
