/**
 * App-wide flags and build constants. One place so release vs dev behaviour is
 * obvious and future toggles land here rather than scattered `__DEV__` checks.
 */

/**
 * Show the small diagnostic line on the gate screen (`window <counter>`) and any
 * other developer-only affordances. On in dev, off in a release build.
 */
export const SHOW_DEBUG: boolean = __DEV__;

/**
 * Lower bound for the device-clock sanity check. If the phone believes it is
 * meaningfully earlier than this, its clock is wrong and the rolling code will
 * not verify at the gate. Bump this to roughly "now" on every release.
 */
export const BUILD_EPOCH_MS: number = Date.parse('2026-09-07T00:00:00Z');

/** Minimum unlock-password length. (scrypt cost lives in `services/vault.ts`.) */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * How long an unlocked session survives the app being backgrounded before it
 * re-locks. Foreground time doesn't count against it (like an authenticator
 * app). Short — this is a gate credential.
 */
export const SESSION_TTL_MS = 3 * 60 * 1000;

/** Wrong-password attempts before the vault self-wipes and re-enrollment is required. */
export const MAX_UNLOCK_ATTEMPTS = 10;
