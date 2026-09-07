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
  Switch,
  Text,
  View,
} from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { SHOW_DEBUG } from '../config';
import { clockWarning } from '../services/clock';
import {
  BiometricUnavailable,
  biometricEnabled,
  biometricSupported,
  disableBiometric,
  enableBiometric,
} from '../services/authService';
import {
  TIME_STEP_MS,
  formatCode,
  generateToken,
  verifyToken,
  type SonicToken,
} from '../services/tokenGenerator';
import { cleanupChirps, synthesizeChirp } from '../utils/audioSynthesizer';
import { Banner, Brand, Button, Card, Screen } from '../components/ui';
import { palette, t, text } from '../theme';

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
  const [bioAvail, setBioAvail] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    cleanupChirps();
    biometricSupported().then(setBioAvail).catch(() => setBioAvail(false));
    biometricEnabled().then(setBioOn).catch(() => setBioOn(false));
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
      cleanupChirps();
    };
  }, []);

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

  const toggleBiometric = useCallback(
    async (next: boolean) => {
      if (bioBusy) return;
      setBioBusy(true);
      try {
        if (next) await enableBiometric(secret);
        else await disableBiometric();
        // reflect what actually persisted, not what we hoped
        setBioOn(await biometricEnabled());
      } catch (e) {
        setBioOn(await biometricEnabled().catch(() => false));
        Alert.alert(
          'Biometric unlock',
          e instanceof BiometricUnavailable
            ? "Couldn't turn on fingerprint / Face ID unlock. Set a screen lock on the device, and use a real build — Expo Go can't store a biometric-protected value on Android."
            : e instanceof Error
              ? e.message
              : String(e),
        );
      } finally {
        setBioBusy(false);
      }
    },
    [bioBusy, secret],
  );

  const windowSecs = Math.round(TIME_STEP_MS / 1000);
  const msLeft = live ? Math.max(0, live.expiresAt - live.generatedAt) : 0;
  const secsLeft = Math.ceil(msLeft / 1000);
  const fracLeft = Math.max(0, Math.min(1, msLeft / TIME_STEP_MS));
  const codeStr = live ? formatCode(live.rollingCode) : '––––––';
  const codeGrouped = `${codeStr.slice(0, 3)} ${codeStr.slice(3)}`;
  const emittedThisWindow = live != null && emittedCounter === live.counter;
  const expiringSoon = secsLeft <= 4;
  const clockMsg = clockWarning();

  return (
    <Screen>
      <View style={s.headerRow}>
        <Brand subtitle="Gate pass" />
        <Pressable onPress={onLock} hitSlop={12} style={s.lockBtn}>
          <Text style={s.lockText}>Lock</Text>
        </Pressable>
      </View>

      <Text style={s.who}>
        {name ? `${name}  ·  ` : ''}ID {studentId}
      </Text>

      {clockMsg ? <Banner tone="warn">{clockMsg}</Banner> : null}

      <Card accent style={s.codeCard}>
        <Text style={[text.label, { color: palette.blue }]}>YOUR CODE THIS WINDOW</Text>
        <Text
          style={[s.code, expiringSoon && s.codeExpiring]}
          accessibilityLabel={`Code ${codeStr}`}
        >
          {codeGrouped}
        </Text>

        <View style={s.track}>
          <View
            style={[
              s.fill,
              { width: `${fracLeft * 100}%` },
              expiringSoon && s.fillExpiring,
            ]}
          />
        </View>
        <Text style={s.meta}>
          new code in {secsLeft}s · rolls every {windowSecs}s
        </Text>
      </Card>

      <View style={s.emitWrap}>
        <Button
          label={emitting ? '' : emittedThisWindow ? 'Emit again' : 'Emit gate pass'}
          onPress={handleEmit}
          loading={emitting}
        />
      </View>

      <Text style={s.hint}>
        {emittedThisWindow
          ? '♪  Sent this window — hold the speaker toward the gate node.'
          : 'Point the phone speaker at the gate node, then tap Emit.'}
      </Text>

      {bioAvail ? (
        <View style={s.bioRow}>
          <View style={{ flex: 1 }}>
            <Text style={text.body}>Unlock with fingerprint / Face ID</Text>
            <Text style={s.bioState}>{bioOn ? 'On' : 'Off'}</Text>
          </View>
          <Switch
            value={bioOn}
            onValueChange={toggleBiometric}
            disabled={bioBusy}
            trackColor={{ true: palette.blue, false: palette.line }}
            thumbColor={palette.white}
          />
        </View>
      ) : null}

      {SHOW_DEBUG ? <Text style={s.debug}>window {live?.counter ?? '—'}</Text> : null}
    </Screen>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const s = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  lockBtn: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: t.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: palette.white,
  },
  lockText: { color: palette.inkMute, fontSize: 13, fontWeight: '700' },
  who: { color: palette.inkMute, fontSize: 14, fontWeight: '600', marginBottom: t.space.xl },

  codeCard: { alignItems: 'center', paddingVertical: t.space.xxl },
  code: {
    color: palette.blue,
    fontSize: 58,
    lineHeight: 66,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 4,
    marginTop: t.space.md,
  },
  codeExpiring: { color: palette.red },
  track: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.blueTint,
    marginTop: t.space.xl,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: palette.gold },
  fillExpiring: { backgroundColor: palette.red },
  meta: { color: palette.inkMute, fontSize: 13, marginTop: t.space.md },

  emitWrap: { marginTop: t.space.xl },
  hint: {
    color: palette.inkMute,
    fontSize: 13,
    lineHeight: 19,
    marginTop: t.space.lg,
    textAlign: 'center',
  },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    marginTop: t.space.xl,
    paddingHorizontal: t.space.xs,
  },
  bioState: { color: palette.inkFaint, fontSize: 12.5, marginTop: 2, fontWeight: '700' },
  debug: { color: palette.inkFaint, fontSize: 12, marginTop: t.space.md, textAlign: 'center' },
});
