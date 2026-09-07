/**
 * SonicAccess — Phase 1 enrollment + unlock.
 *
 * Enrollment (model A): the student presents a registrar QR / code carrying
 * `{ studentId, secret }`, then sets an unlock password. The secret is sealed
 * with that password (`vault.ts`) and only the ciphertext + non-secret metadata
 * (`studentId`, `name`) are kept in `expo-secure-store`. The raw secret exists
 * in memory only while emitting.
 *
 * Unlock: the password decrypts the vault and returns the secret. After
 * `MAX_UNLOCK_ATTEMPTS` wrong tries the vault self-wipes and the student must
 * re-enroll (which the registrar pairs with revoking the old secret).
 */

import * as SecureStore from 'expo-secure-store';

import { MAX_UNLOCK_ATTEMPTS, MIN_PASSWORD_LENGTH } from '../config';
import { MAX_STUDENT_ID } from './tokenGenerator';
import { WrongPassword, unwrapSecret, wrapSecret, type VaultBlob } from './vault';

const K_META = 'sonic.enrollment.meta'; // { studentId, name? }  — not secret
const K_VAULT = 'sonic.enrollment.vault'; // VaultBlob JSON
const K_FAILS = 'sonic.enrollment.fails'; // wrong-password counter

export interface Enrollment {
  studentId: number;
  name?: string;
}

export class LockedOut extends Error {
  constructor() {
    super('too many wrong passwords — this device must be re-enrolled');
    this.name = 'LockedOut';
  }
}

export class WrongPasswordError extends Error {
  attemptsLeft: number;
  constructor(attemptsLeft: number) {
    super('wrong password');
    this.name = 'WrongPasswordError';
    this.attemptsLeft = attemptsLeft;
  }
}

/* -- validation -------------------------------------------------------------- */

export function validateStudentId(id: unknown): string | null {
  if (!Number.isInteger(id) || (id as number) < 0 || (id as number) > MAX_STUDENT_ID) {
    return `Student ID must be a whole number between 0 and ${MAX_STUDENT_ID}.`;
  }
  return null;
}

export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/* -- enrollment ------------------------------------------------------------- */

export async function enroll(opts: {
  studentId: number;
  secret: string;
  password: string;
  name?: string;
}): Promise<void> {
  const idErr = validateStudentId(opts.studentId);
  if (idErr) throw new Error(idErr);
  const pwErr = validatePassword(opts.password);
  if (pwErr) throw new Error(pwErr);
  if (!opts.secret || opts.secret.trim().length < 8) {
    throw new Error('The enrollment code has no usable secret.');
  }

  const blob = await wrapSecret(opts.secret.trim(), opts.password);
  await SecureStore.setItemAsync(K_VAULT, JSON.stringify(blob));
  await SecureStore.setItemAsync(
    K_META,
    JSON.stringify({ studentId: opts.studentId, name: opts.name?.trim() || undefined }),
  );
  await SecureStore.deleteItemAsync(K_FAILS);
}

export async function getEnrollment(): Promise<Enrollment | null> {
  const raw = await SecureStore.getItemAsync(K_META);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Enrollment;
    if (!Number.isInteger(m.studentId)) return null;
    return { studentId: m.studentId, name: m.name };
  } catch {
    return null;
  }
}

export async function isEnrolled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_VAULT)) != null;
}

export async function clearEnrollment(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(K_META),
    SecureStore.deleteItemAsync(K_VAULT),
    SecureStore.deleteItemAsync(K_FAILS),
  ]);
}

/* -- unlock --------------------------------------------------------------- */

/** Returns the decrypted secret. Throws `WrongPasswordError` or `LockedOut`. */
export async function unlock(password: string): Promise<string> {
  const vaultRaw = await SecureStore.getItemAsync(K_VAULT);
  if (!vaultRaw) throw new Error('this device is not enrolled');
  const blob = JSON.parse(vaultRaw) as VaultBlob;

  let fails = Number((await SecureStore.getItemAsync(K_FAILS)) ?? 0);
  if (fails >= MAX_UNLOCK_ATTEMPTS) {
    await clearEnrollment();
    throw new LockedOut();
  }

  try {
    const secret = await unwrapSecret(blob, password);
    await SecureStore.deleteItemAsync(K_FAILS);
    return secret;
  } catch (e) {
    if (!(e instanceof WrongPassword)) throw e;
    fails += 1;
    if (fails >= MAX_UNLOCK_ATTEMPTS) {
      await clearEnrollment();
      throw new LockedOut();
    }
    await SecureStore.setItemAsync(K_FAILS, String(fails));
    throw new WrongPasswordError(MAX_UNLOCK_ATTEMPTS - fails);
  }
}

export { MAX_UNLOCK_ATTEMPTS, MIN_PASSWORD_LENGTH };
