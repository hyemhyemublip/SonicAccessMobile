/**
 * Device-clock sanity check.
 *
 * The rolling code is `HOTP(secret, floor(now / 15s))`. The gate accepts the
 * current window ± 1 (~30–45 s of slack). If the phone clock has drifted past
 * that, every emit is rejected and the student has no idea why. There is no
 * network reference here (Phase 1 is offline), so this is a best-effort check:
 * the year must be sane, and the clock must not be earlier than the build.
 */

import { BUILD_EPOCH_MS } from '../config';
import { TIME_STEP_MS } from './tokenGenerator';

export interface ClockCheck {
  ok: boolean;
  reason?: 'year-out-of-range' | 'behind-build';
  detail?: string;
}

const YEAR_MIN = 2025;
const YEAR_MAX = 2100;
const BEHIND_SLACK_MS = 24 * 60 * 60 * 1000; // tolerate a day of "behind"

export function checkClock(now: number = Date.now()): ClockCheck {
  const year = new Date(now).getUTCFullYear();
  if (year < YEAR_MIN || year > YEAR_MAX) {
    return { ok: false, reason: 'year-out-of-range', detail: `device says the year is ${year}` };
  }
  if (Number.isFinite(BUILD_EPOCH_MS) && now < BUILD_EPOCH_MS - BEHIND_SLACK_MS) {
    return { ok: false, reason: 'behind-build', detail: 'device clock is set in the past' };
  }
  return { ok: true };
}

/** One-line warning for the UI, or `null` when the clock looks fine. */
export function clockWarning(now: number = Date.now()): string | null {
  const c = checkClock(now);
  if (c.ok) return null;
  const slackSec = Math.round(TIME_STEP_MS / 1000);
  return (
    `Your device clock looks wrong — ${c.detail}. ` +
    `Turn on automatic date & time: the gate code is time-based and is refused ` +
    `if the clock is more than ~${slackSec}s off.`
  );
}
