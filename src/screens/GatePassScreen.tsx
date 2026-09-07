/**
 * SonicAccess — gate pass screen (authenticated).
 *
 * Assumes an unlocked session: `secret` + `studentId` come in as props (held in
 * memory by App, never persisted in the clear). Shows the current 6-digit
 * rolling code (recomputed ~3x/second) with a countdown bar and an "Emit gate
 * pass" button that modulates the code to an ultrasonic WAV and plays it.
 *
 * Shows a clock-drift warning when the device time looks wrong. The
 * `window <counter>` diagnostic line is gated on `SHOW_DEBUG` (dev only).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { SHOW_DEBUG } from '../config';
import { clockWarning } from '../services/clock';
import {
  TIME_STEP_MS,
  formatCode,
  generateToken,
  verifyToken,
  type SonicToken,
} from '../services/tokenGenerator';
import { cleanupChirps, synthesizeChirp } from '../utils/audioSynthesizer';

type Props = {
  studentId: number;
  name?: string;
  secret: string;
  onLock: () => void;
};

export default function GatePassScreen({ studentId, name, secret, onLock }: Props) {
  const [emitting, setEmitting] = useState(false);
  const [live, setLive] = useState<SonicToken | null>(null);
  const [emittedCounter, setEmittedCounter] = useState<number | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    cleanupChirps();
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
      cleanupChirps();
    };
  }, []);

  // recompute the current-window token ~3x/second
  useEffect(() => {
    const refresh = () => {
      try {
        setLive(generateToken(secret, studentId));
      } catch {
        setLive(null);
      }
    };
    refresh();
    const id = setInterval(refresh, 300);
    return () => clearInterval(id);
  }, [secret, studentId]);

  const handleEmit = useCallback(async () => {
    if (emitting) return;
    setEmitting(true);
    try {
      const fresh = generateToken(secret, studentId);
      const check = verifyToken(secret, fresh.bits);
      if (!check.ok) throw new Error(`internal token check failed (${check.reason})`);

      const chirp = await synthesizeChirp(fresh.bits);

      playerRef.current?.remove();
      const player = createAudioPlayer(chirp.uri);
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          player.remove();
          if (playerRef.current === player) playerRef.current = null;
        }
      });
      player.play();

      setLive(fresh);
      setEmittedCounter(fresh.counter);
    } catch (e) {
      Alert.alert('Could not emit', e instanceof Error ? e.message : String(e));
    } finally {
      setEmitting(false);
    }
  }, [emitting, secret, studentId]);

  const windowSecs = Math.round(TIME_STEP_MS / 1000);
  const msLeft = live ? Math.max(0, live.expiresAt - live.generatedAt) : 0;
  const secsLeft = Math.ceil(msLeft / 1000);
  const fracLeft = msLeft / TIME_STEP_MS;
  const codeStr = live ? formatCode(live.rollingCode) : '------';
  const codeGrouped = `${codeStr.slice(0, 3)} ${codeStr.slice(3)}`;
  const emittedThisWindow = live != null && emittedCounter === live.counter;
  const expiringSoon = secsLeft <= 4;
  const clockMsg = clockWarning();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Gate pass</Text>
          <Text style={styles.subtitle}>
            {name ? `${name} · ` : ''}ID {studentId}
          </Text>
        </View>
        <Pressable onPress={onLock} hitSlop={12}>
          <Text style={styles.lockText}>Lock</Text>
        </Pressable>
      </View>

      {clockMsg ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>{clockMsg}</Text>
        </View>
      ) : null}

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>YOUR CODE THIS WINDOW</Text>
        <Text
          style={[styles.codeValue, expiringSoon && styles.codeValueExpiring]}
          accessibilityLabel={`Code ${codeStr}`}
        >
          {codeGrouped}
        </Text>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(0, Math.min(1, fracLeft)) * 100}%` },
              expiringSoon && styles.progressFillExpiring,
            ]}
          />
        </View>
        <Text style={styles.codeMeta}>
          new code in {secsLeft}s · rolls every {windowSecs}s
        </Text>
      </View>

      <Pressable
        style={[styles.emitBtn, emitting && styles.emitBtnBusy]}
        onPress={handleEmit}
        disabled={emitting}
      >
        {emitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.emitBtnText}>
            {emittedThisWindow ? 'Emit again' : 'Emit gate pass'}
          </Text>
        )}
      </Pressable>

      <Text style={styles.hint}>
        {emittedThisWindow
          ? '♪ Sent this window — hold the speaker toward the gate node.'
          : 'Point the phone speaker at the gate node, then tap Emit.'}
      </Text>

      {SHOW_DEBUG ? (
        <Text style={styles.debugLine}>window {live?.counter ?? '—'}</Text>
      ) : null}
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingHorizontal: 24,
    paddingTop: 72,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 15, marginTop: 4 },
  lockText: { color: '#64748b', fontSize: 14, paddingTop: 8 },
  warnBanner: { backgroundColor: '#7c2d12', borderRadius: 10, padding: 12, marginBottom: 16 },
  warnText: { color: '#fdba74', fontSize: 13, lineHeight: 18 },
  codeCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  codeLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', letterSpacing: 1.5 },
  codeValue: {
    color: '#f8fafc',
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 4,
    marginTop: 10,
  },
  codeValueExpiring: { color: '#f59e0b' },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#334155',
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#2563eb' },
  progressFillExpiring: { backgroundColor: '#f59e0b' },
  codeMeta: { color: '#94a3b8', fontSize: 13, marginTop: 10 },
  emitBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  emitBtnBusy: { opacity: 0.7 },
  emitBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  hint: { color: '#94a3b8', fontSize: 13, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  debugLine: { color: '#475569', fontSize: 12, marginTop: 10, textAlign: 'center' },
});
