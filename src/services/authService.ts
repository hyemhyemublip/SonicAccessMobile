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
 *
 * Optional biometric unlock: a copy of the secret is also kept in
 * `expo-secure-store` behind `requireAuthentication`, so Face ID / fingerprint
 * returns it without the password. Turning this on is the student's choice at
 * enrollment; the password path always remains.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { MAX_UNLOCK_ATTEMPTS, MIN_PASSWORD_LENGTH } from '../config';
import { MAX_STUDENT_ID } from './tokenGenerator';
import { WrongPassword, unwrapSecret, wrapSecret, type VaultBlob } from './vault';

const K_META = 'sonic.enrollment.meta'; // { studentId, name? }  — not secret
const K_VAULT = 'sonic.enrollment.vault'; // VaultBlob JSON
const K_FAILS = 'sonic.enrollment.fails'; // wrong-password counter
const K_BIO = 'sonic.enrollment.bioSecret'; // secret behind requireAuthentication
const K_BIO_FLAG = 'sonic.enrollment.bioOn'; // "1" if biometric unlock is set up

const BIO_STORE_OPTS = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  authenticationPrompt: 'Unlock SonicAccess',
} as const;

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
  biometric?: boolean;
}): Promise<void> {
  const idErr = validateStudentId(opts.studentId);
  if (idErr) throw new Error(idErr);
  const pwErr = validatePassword(opts.password);
  if (pwErr) throw new Error(pwErr);
  const secret = (opts.secret ?? '').trim();
  if (secret.length < 8) throw new Error('The enrollment code has no usable secret.');

  const blob = await wrapSecret(secret, opts.password);
  await SecureStore.setItemAsync(K_VAULT, JSON.stringify(blob));
  await SecureStore.setItemAsync(
    K_META,
    JSON.stringify({ studentId: opts.studentId, name: opts.name?.trim() || undefined }),
  );
  await SecureStore.deleteItemAsync(K_FAILS);
  await SecureStore.deleteItemAsync(K_BIO);
  await SecureStore.deleteItemAsync(K_BIO_FLAG);

  if (opts.biometric) {
    try {
      await SecureStore.setItemAsync(K_BIO, secret, BIO_STORE_OPTS);
      await SecureStore.setItemAsync(K_BIO_FLAG, '1');
    } catch {
      // no device passcode/biometric enrolled — silently fall back to password
    }
  }
}

/** Is Face ID / fingerprint hardware present and enrolled on this device? */
export async function biometricSupported(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

/** Did this enrollment opt into biometric unlock? (cheap flag, no prompt) */
export async function biometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_BIO_FLAG)) === '1';
}

/**
 * Turn biometric unlock on after enrollment — needs the plaintext secret (the
 * caller has it because the session is unlocked). Throws `BiometricUnavailable`
 * if the device can't store an auth-gated item.
 */
export async function enableBiometric(secret: string): Promise<void> {
  if (!secret) throw new Error('no secret to protect');
  try {
    await SecureStore.setItemAsync(K_BIO, secret, BIO_STORE_OPTS);
    await SecureStore.setItemAsync(K_BIO_FLAG, '1');
  } catch {
    await SecureStore.deleteItemAsync(K_BIO).catch(() => {});
    await SecureStore.deleteItemAsync(K_BIO_FLAG).catch(() => {});
    throw new BiometricUnavailable('this device cannot store a biometric-protected value');
  }
}

/** Turn biometric unlock off. */
export async function disableBiometric(): Promise<void> {
  await SecureStore.deleteItemAsync(K_BIO);
  await SecureStore.deleteItemAsync(K_BIO_FLAG);
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
    SecureStore.deleteItemAsync(K_BIO),
    SecureStore.deleteItemAsync(K_BIO_FLAG),
  ]);
}

/* -- unlock --------------------------------------------------------------- */

export class BiometricUnavailable extends Error {
  constructor(msg = 'biometric unlock is not available') {
    super(msg);
    this.name = 'BiometricUnavailable';
  }
}

/**
 * Returns the secret via Face ID / fingerprint (the OS shows the prompt). Throws
 * `BiometricUnavailable` if it isn't set up or the user cancels — the caller
 * should fall back to the password field.
 */
export async function unlockBiometric(): Promise<string> {
  if (!(await biometricEnabled())) throw new BiometricUnavailable('not enabled for this device');
  try {
    const secret = await SecureStore.getItemAsync(K_BIO, BIO_STORE_OPTS);
    if (!secret) throw new BiometricUnavailable();
    return secret;
  } catch (e) {
    if (e instanceof BiometricUnavailable) throw e;
    throw new BiometricUnavailable('authentication was cancelled or failed');
  }
}

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
