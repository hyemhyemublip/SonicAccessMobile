/**
 * Password-wrapped secret vault.
 *
 * The 160-bit shared secret is stored on the device only as ciphertext: it is
 * sealed with XChaCha20-Poly1305 under a key derived from the student's unlock
 * password via scrypt. The password never leaves the device and is never
 * persisted — only the salt, nonce, and ciphertext are. Wrong password ->
 * Poly1305 tag mismatch -> `WrongPassword`.
 *
 * See CONSIDERATIONS.md "Enrollment / provisioning + app login" (model A).
 */

import { Buffer } from 'buffer';
import { scrypt } from '@noble/hashes/scrypt';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';

/**
 * scrypt cost. N=2^14 is ~0.4 s in Node, a few seconds under Hermes on a
 * low-end phone — fine for a one-time unlock. Drop N to 2^13 if too slow on
 * target hardware. Changing these invalidates existing vaults (re-enroll).
 */
export const KDF_PARAMS = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 } as const;

const SALT_LEN = 16;
const NONCE_LEN = 24; // XChaCha20

export interface VaultBlob {
  v: 1;
  salt: string; // base64
  nonce: string; // base64
  ct: string; // base64 (ciphertext || Poly1305 tag)
}

export class WrongPassword extends Error {
  constructor() {
    super('wrong password');
    this.name = 'WrongPassword';
  }
}

const b64e = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const b64d = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/** Randomness from expo-crypto on device, WebCrypto (Node) under tests. */
async function randomBytes(n: number): Promise<Uint8Array> {
  try {
    const { getRandomBytesAsync } = await import('expo-crypto');
    return await getRandomBytesAsync(n);
  } catch {
    const u = new Uint8Array(n);
    const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
    if (g.crypto?.getRandomValues) {
      g.crypto.getRandomValues(u);
      return u;
    }
    // last-resort non-crypto fill (should never run on device or in Node 22)
    for (let i = 0; i < n; i++) u[i] = Math.floor(Math.random() * 256);
    return u;
  }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return scrypt(utf8ToBytes(password.normalize('NFKC')), salt, { ...KDF_PARAMS });
}

export async function wrapSecret(secret: string, password: string): Promise<VaultBlob> {
  const salt = await randomBytes(SALT_LEN);
  const nonce = await randomBytes(NONCE_LEN);
  const key = await deriveKey(password, salt);
  try {
    const ct = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(secret));
    return { v: 1, salt: b64e(salt), nonce: b64e(nonce), ct: b64e(ct) };
  } finally {
    key.fill(0);
  }
}

export async function unwrapSecret(blob: VaultBlob, password: string): Promise<string> {
  if (!blob || blob.v !== 1) throw new Error('unrecognised vault format');
  const key = await deriveKey(password, b64d(blob.salt));
  try {
    const pt = xchacha20poly1305(key, b64d(blob.nonce)).decrypt(b64d(blob.ct));
    return bytesToUtf8(pt);
  } catch {
    throw new WrongPassword();
  } finally {
    key.fill(0);
  }
}
