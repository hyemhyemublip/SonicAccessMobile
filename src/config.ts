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
