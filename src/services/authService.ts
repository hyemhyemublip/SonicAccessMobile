/**
 * SonicAccess — Phase 1 credential store.
 *
 * Holds the student's enrollment on-device: their numeric id and the shared
 * secret used to derive rolling ultrasonic codes. Stored in the OS keychain /
 * keystore via `expo-secure-store`, never in plain AsyncStorage.
 *
 * Phase 1 enrollment is manual (the student pastes an id + secret issued by the
 * registrar). A later phase can replace `enroll` with a provisioning call to
 * the SonicAccess web backend.
 */

import * as SecureStore from 'expo-secure-store';

import { MAX_STUDENT_ID } from './tokenGenerator';

const K_STUDENT_ID = 'sonic.studentId';
const K_SECRET = 'sonic.secret';
const K_NAME = 'sonic.name';

export interface Credential {
  studentId: number;
  /** Raw shared-secret string; used directly as the HMAC key. */
  secret: string;
  name?: string;
}

export function validateCredential(c: Partial<Credential>): string | null {
  if (
    typeof c.studentId !== 'number' ||
    !Number.isInteger(c.studentId) ||
    c.studentId < 0 ||
    c.studentId > MAX_STUDENT_ID
  ) {
    return `Student ID must be a whole number between 0 and ${MAX_STUDENT_ID}.`;
  }
  if (!c.secret || c.secret.trim().length < 8) {
    return 'Secret must be at least 8 characters.';
  }
  return null;
}

export async function enroll(c: Credential): Promise<void> {
  const err = validateCredential(c);
  if (err) throw new Error(err);

  await SecureStore.setItemAsync(K_STUDENT_ID, String(c.studentId));
  await SecureStore.setItemAsync(K_SECRET, c.secret.trim());
  if (c.name && c.name.trim()) {
    await SecureStore.setItemAsync(K_NAME, c.name.trim());
  } else {
    await SecureStore.deleteItemAsync(K_NAME);
  }
}

export async function getCredential(): Promise<Credential | null> {
  const [idStr, secret, name] = await Promise.all([
    SecureStore.getItemAsync(K_STUDENT_ID),
    SecureStore.getItemAsync(K_SECRET),
    SecureStore.getItemAsync(K_NAME),
  ]);

  if (!idStr || !secret) return null;
  const studentId = Number(idStr);
  if (!Number.isInteger(studentId)) return null;

  return { studentId, secret, name: name ?? undefined };
}

export async function isEnrolled(): Promise<boolean> {
  return (await getCredential()) !== null;
}

export async function clearCredential(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(K_STUDENT_ID),
    SecureStore.deleteItemAsync(K_SECRET),
    SecureStore.deleteItemAsync(K_NAME),
  ]);
}
