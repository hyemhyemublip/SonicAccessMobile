/**
 * SonicAccess — Phase 1 gate pass screen.
 *
 * Two states:
 *  - not enrolled: manual enrollment form (student id + secret + name).
 *  - enrolled: an authenticator-style view that always shows the current
 *    6-digit rolling code (recomputed ~3x/second) with a countdown bar, plus an
 *    "Emit gate pass" button that modulates that code to an ultrasonic WAV and
 *    plays it through the speaker for the gate node to decode.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';

import {
  clearCredential,
  enroll,
  getCredential,
  validateCredential,
  type Credential,
} from '../services/authService';
import {
  TIME_STEP_MS,
  formatCode,
  generateToken,
  verifyToken,
  type SonicToken,
} from '../services/tokenGenerator';
import {
  cleanupChirps,
  synthesizeChirp,
} from '../utils/audioSynthesizer';

type Phase = 'loading' | 'enroll' | 'ready';

export default function GatePassScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [credential, setCredential] = useState<Credential | null>(null);

  const [idInput, setIdInput] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [nameInput, setNameInput] = useState('');

  const [emitting, setEmitting] = useState(false);
  // `live` is the current-window token, recomputed on a timer like an
  // authenticator app so the student always sees the code they will send.
  const [live, setLive] = useState<SonicToken | null>(null);
  const [emittedCounter, setEmittedCounter] = useState<number | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);

  /* -- lifecycle ------------------------------------------------------------ */

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
      // non-fatal: playback still works with the ringer on
    });
    cleanupChirps();

    getCredential()
      .then((c) => {
        setCredential(c);
        setPhase(c ? 'ready' : 'enroll');
      })
      .catch(() => setPhase('enroll'));

    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
      cleanupChirps();
    };
  }, []);

  // recompute the current-window token ~3x/second while enrolled
  useEffect(() => {
    if (phase !== 'ready' || !credential) return;
    const refresh = () => {
      try {
        setLive(generateToken(credential.secret, credential.studentId));
      } catch {
        setLive(null);
      }
    };
    refresh();
    const id = setInterval(refresh, 300);
    return () => clearInterval(id);
  }, [phase, credential]);

  /* -- actions ------------------------------------------------------------- */

  const handleEnroll = useCallback(async () => {
    const idTrimmed = idInput.trim();
    const parsed: Partial<Credential> = {
      studentId: /^\d+$/.test(idTrimmed) ? Number(idTrimmed) : NaN,
      secret: secretInput,
      name: nameInput,
    };
    const err = validateCredential(parsed);
    if (err) {
      Alert.alert('Check your details', err);
      return;
    }
    try {
      await enroll(parsed as Credential);
      const c = await getCredential();
      setCredential(c);
      setPhase('ready');
    } catch (e) {
      Alert.alert('Enrollment failed', String(e instanceof Error ? e.message : e));
    }
  }, [idInput, secretInput, nameInput]);

  const handleReenroll = useCallback(() => {
    Alert.alert('Remove this enrollment?', 'You will need the ID and secret again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await clearCredential();
          setCredential(null);
          setLive(null);
          setEmittedCounter(null);
          setIdInput('');
          setSecretInput('');
          setNameInput('');
          setPhase('enroll');
        },
      },
    ]);
  }, []);

  const handleEmit = useCallback(async () => {
    if (!credential || emitting) return;
    setEmitting(true);
    try {
      const fresh = generateToken(credential.secret, credential.studentId);

      // self-check: the payload we are about to broadcast must verify locally
      const check = verifyToken(credential.secret, fresh.bits);
      if (!check.ok) {
        throw new Error(`internal token check failed (${check.reason})`);
      }

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
      Alert.alert('Could not emit', String(e instanceof Error ? e.message : e));
    } finally {
      setEmitting(false);
    }
  }, [credential, emitting]);

  /* -- render ------------------------------------------------------------- */

  if (phase === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (phase === 'enroll') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Enroll device</Text>
        <Text style={styles.subtitle}>
          Enter the ID and secret issued by the registrar.
        </Text>

        <Text style={styles.label}>Student ID</Text>
        <TextInput
          style={styles.input}
          value={idInput}
          onChangeText={setIdInput}
          keyboardType="number-pad"
          placeholder="e.g. 231868"
          placeholderTextColor="#9aa5b1"
        />

        <Text style={styles.label}>Secret</Text>
        <TextInput
          style={styles.input}
          value={secretInput}
          onChangeText={setSecretInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="shared secret"
          placeholderTextColor="#9aa5b1"
        />

        <Text style={styles.label}>Name (optional)</Text>
        <TextInput
          style={styles.input}
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="shown on this screen only"
          placeholderTextColor="#9aa5b1"
        />

        <Pressable style={styles.primaryBtn} onPress={handleEnroll}>
          <Text style={styles.primaryBtnText}>Save enrollment</Text>
        </Pressable>
      </View>
    );
  }

  // phase === 'ready'
  const windowSecs = Math.round(TIME_STEP_MS / 1000);
  const msLeft = live ? Math.max(0, live.expiresAt - live.generatedAt) : 0;
  const secsLeft = Math.ceil(msLeft / 1000);
  const fracLeft = msLeft / TIME_STEP_MS;
  const codeStr = live ? formatCode(live.rollingCode) : '------';
  const codeGrouped = `${codeStr.slice(0, 3)} ${codeStr.slice(3)}`;
  const emittedThisWindow = live != null && emittedCounter === live.counter;
  const expiringSoon = secsLeft <= 4;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gate pass</Text>
      <Text style={styles.subtitle}>
        {credential?.name ? `${credential.name} · ` : ''}ID {credential?.studentId}
      </Text>

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

      <Text style={styles.debugLine}>window {live?.counter ?? '—'}</Text>

      <Pressable onPress={handleReenroll} style={styles.linkBtn}>
        <Text style={styles.linkText}>Re-enroll this device</Text>
      </Pressable>
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
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 15, marginTop: 4, marginBottom: 28 },
  label: { color: '#cbd5e1', fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  codeCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  codeLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
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
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#2563eb',
  },
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
  hint: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
    textAlign: 'center',
  },
  debugLine: { color: '#475569', fontSize: 12, marginTop: 10, textAlign: 'center' },
  linkBtn: { marginTop: 'auto', marginBottom: 32, alignItems: 'center' },
  linkText: { color: '#64748b', fontSize: 14 },
});
