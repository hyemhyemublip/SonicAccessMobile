/**
 * SonicAccess — Phase 1 FSK ultrasonic modulator.
 *
 * Turns an MSB-first bit payload (from `tokenGenerator`) into a mono 16-bit PCM
 * WAV file in the app cache and returns its `file://` URI so `expo-audio` can
 * play it through the phone speaker. The ESP32 gate node listens with a digital
 * mic and runs an FFT to recover the bits.
 *
 * Frame layout (see src/PROTOCOL.md — must match the firmware):
 *   [lead silence] [preamble tone x N] [start marker = one '1' symbol]
 *   [payload symbols, one per bit] [trail silence]
 *
 * Binary FSK: bit 0 -> f0, bit 1 -> f1. The preamble is a distinct third tone
 * so the gate can detect "a chirp is starting" and lock symbol timing before
 * the payload arrives.
 */

import { Buffer } from 'buffer';

// `expo-file-system` is loaded lazily (dynamic import) so the pure parts of this
// module — `buildWaveform`, `encodeWav` — can be imported from plain Node (the
// reference decoder and round-trip test do this). Only `synthesizeChirp` and
// `cleanupChirps` touch the filesystem, and only on-device.

export interface ChirpConfig {
  sampleRate: number; // Hz
  symbolMs: number; // duration of one FSK symbol
  f0: number; // Hz, encodes bit 0
  f1: number; // Hz, encodes bit 1
  fPreamble: number; // Hz, sync tone
  preambleSymbols: number; // how many sync symbols before the start marker
  leadSilenceMs: number;
  trailSilenceMs: number;
  amplitude: number; // 0..1 peak
  rampMs: number; // raised-cosine edge on every symbol to suppress clicks/splatter
}

/**
 * Defaults target the ~17–19 kHz band: near-inaudible to most people, still
 * well inside the 22.05 kHz Nyquist limit of a 44.1 kHz stream and within the
 * usable response of typical phone speakers and MEMS mics. Tune per hardware
 * during the pilot; keep the client and firmware configs identical.
 */
export const DEFAULT_CHIRP: ChirpConfig = {
  sampleRate: 44100,
  symbolMs: 20,
  f0: 18000,
  f1: 19000,
  fPreamble: 17000,
  preambleSymbols: 8,
  leadSilenceMs: 40,
  trailSilenceMs: 40,
  amplitude: 0.9,
  rampMs: 3,
};

export interface Chirp {
  uri: string;
  durationMs: number;
  /** Symbols actually written: preamble + 1 start marker + payload. */
  symbolCount: number;
  config: ChirpConfig;
}

/* -------------------------------------------------------------------------- */
/* synthesis                                                                 */
/* -------------------------------------------------------------------------- */

function appendTone(
  out: number[],
  freq: number,
  durationSec: number,
  cfg: ChirpConfig,
  phaseRef: { phase: number },
): void {
  const n = Math.round(durationSec * cfg.sampleRate);
  const rampSamples = Math.min(
    Math.floor((cfg.rampMs / 1000) * cfg.sampleRate),
    Math.floor(n / 2),
  );
  const dPhase = (2 * Math.PI * freq) / cfg.sampleRate;

  for (let i = 0; i < n; i++) {
    let env = 1;
    if (rampSamples > 0) {
      if (i < rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
      } else if (i >= n - rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - i)) / rampSamples));
      }
    }
    out.push(Math.sin(phaseRef.phase) * cfg.amplitude * env);
    phaseRef.phase += dPhase;
    if (phaseRef.phase > Math.PI * 2) phaseRef.phase -= Math.PI * 2;
  }
}

function appendSilence(out: number[], durationSec: number, sampleRate: number): void {
  const n = Math.round(durationSec * sampleRate);
  for (let i = 0; i < n; i++) out.push(0);
}

/** Build the full float waveform (-1..1) for a payload. */
export function buildWaveform(
  bits: number[],
  cfg: ChirpConfig = DEFAULT_CHIRP,
): { samples: number[]; symbolCount: number } {
  if (!bits.length) throw new Error('bits payload is empty');

  const symbolSec = cfg.symbolMs / 1000;
  const samples: number[] = [];
  const phaseRef = { phase: 0 };

  appendSilence(samples, cfg.leadSilenceMs / 1000, cfg.sampleRate);

  for (let i = 0; i < cfg.preambleSymbols; i++) {
    appendTone(samples, cfg.fPreamble, symbolSec, cfg, phaseRef);
  }
  // start marker: a single bit-1 symbol delimits preamble from payload
  appendTone(samples, cfg.f1, symbolSec, cfg, phaseRef);

  for (const bit of bits) {
    appendTone(samples, bit ? cfg.f1 : cfg.f0, symbolSec, cfg, phaseRef);
  }

  appendSilence(samples, cfg.trailSilenceMs / 1000, cfg.sampleRate);

  return { samples, symbolCount: cfg.preambleSymbols + 1 + bits.length };
}

/* -------------------------------------------------------------------------- */
/* WAV container                                                             */
/* -------------------------------------------------------------------------- */

/** Wrap a float waveform (-1..1) in a 16-bit mono PCM WAV container. */
export function encodeWav(samples: number[], sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buf;
}

/* -------------------------------------------------------------------------- */
/* public API                                                               */
/* -------------------------------------------------------------------------- */

const CHIRP_PREFIX = 'sonic-chirp-';

/**
 * Modulate `bits` and write the WAV to the cache directory.
 * Returns a `file://` URI ready to hand to `createAudioPlayer`.
 */
export async function synthesizeChirp(
  bits: number[],
  cfg: ChirpConfig = DEFAULT_CHIRP,
): Promise<Chirp> {
  const { File, Paths } = await import('expo-file-system');
  const { samples, symbolCount } = buildWaveform(bits, cfg);
  const wav = encodeWav(samples, cfg.sampleRate);
  const base64 = Buffer.from(wav).toString('base64');

  const file = new File(Paths.cache, `${CHIRP_PREFIX}${Date.now()}.wav`);
  if (file.exists) file.delete();
  file.write(base64, { encoding: 'base64' });

  return {
    uri: file.uri,
    durationMs: (samples.length / cfg.sampleRate) * 1000,
    symbolCount,
    config: cfg,
  };
}

/** Delete cached chirp WAVs from previous emissions. Best-effort, fire-and-forget. */
export function cleanupChirps(): void {
  import('expo-file-system')
    .then(({ File, Paths }) => {
      try {
        for (const entry of Paths.cache.list()) {
          if (entry instanceof File && entry.name.startsWith(CHIRP_PREFIX)) {
            try {
              entry.delete();
            } catch {
              // ignore a single stubborn file
            }
          }
        }
      } catch {
        // cache listing unavailable — nothing to clean
      }
    })
    .catch(() => {
      // module unavailable (e.g. running under plain Node) — nothing to clean
    });
}
