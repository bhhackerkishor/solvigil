import crypto from "crypto";

const API_KEY_PREFIX = "sv_";
const KEY_BYTE_LENGTH = 32;

/**
 * Generates a new plaintext API key (shown once) and its SHA-256 hash (stored in DB).
 * Pattern identical to Stripe/GitHub token generation.
 */
export function generateApiKey(): { plaintext: string; hash: string } {
  const randomBytes = crypto.randomBytes(KEY_BYTE_LENGTH);
  const plaintext = API_KEY_PREFIX + randomBytes.toString("hex");
  const hash = sha256(plaintext);
  return { plaintext, hash };
}

/**
 * Hashes a plaintext API key using SHA-256 for comparison against stored hashes.
 */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export const hashApiKey = sha256;
/**
 * Verifies a plaintext API key against a stored SHA-256 hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  const candidateHash = sha256(plaintext);
  if (candidateHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(candidateHash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}
