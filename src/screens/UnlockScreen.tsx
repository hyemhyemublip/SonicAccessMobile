/**
 * Unlock: the enrolled student types their password; on success the decrypted
 * secret is handed to the caller (held in memory only). After
 * `MAX_UNLOCK_ATTEMPTS` wrong tries the vault self-wipes -> re-enroll.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  LockedOut,
  WrongPasswordError,
  clearEnrollment,
  unlock,
  type Enrollment,
} from '../services/authService';

type Props = {
  enrollment: Enrollment;
  onUnlocked: (secret: string) => void;
  onReset: () => void;
};

export default function UnlockScreen({ enrollment, onUnlocked, onReset }: Props) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doUnlock = useCallback(async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const secret = await unlock(pw);
      setPw('');
      onUnlocked(secret);
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        setErr(`Wrong password. ${e.attemptsLeft} attempt${e.attemptsLeft === 1 ? '' : 's'} left.`);
      } else if (e instanceof LockedOut) {
        Alert.alert('Device locked', e.message, [{ text: 'OK', onPress: onReset }]);
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }, [pw, busy, onUnlocked, onReset]);

  const doReset = useCallback(() => {
    Alert.alert(
      'Re-enroll this device?',
      'You will need a new code from the registrar. Your current pass will stop working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-enroll',
          style: 'destructive',
          onPress: async () => {
            await clearEnrollment();
            onReset();
          },
        },
      ],
    );
  }, [onReset]);

  return (
    <View style={s.c}>
      <Text style={s.h1}>Unlock gate pass</Text>
      <Text style={s.sub}>
        {enrollment.name ? `${enrollment.name} · ` : ''}ID {enrollment.studentId}
      </Text>

      <Text style={s.label}>Password</Text>
      <TextInput
        style={s.in}
        value={pw}
        onChangeText={(t) => {
          setPw(t);
          if (err) setErr(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoFocus
        onSubmitEditing={doUnlock}
        returnKeyType="go"
      />
      {err ? <Text style={s.err}>{err}</Text> : null}

      <Pressable style={s.btn} onPress={doUnlock} disabled={busy || !pw}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Unlock</Text>}
      </Pressable>

      <Pressable style={s.link} onPress={doReset}>
        <Text style={s.linkT}>Forgot password — re-enroll</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#0f172a', paddingHorizontal: 24, paddingTop: 96 },
  h1: { color: '#f8fafc', fontSize: 26, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 15, marginTop: 4, marginBottom: 28 },
  label: { color: '#cbd5e1', fontSize: 13, marginBottom: 6 },
  in: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  err: { color: '#fca5a5', fontSize: 13, marginTop: 10 },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: 20, marginTop: 'auto', marginBottom: 24 },
  linkT: { color: '#64748b', fontSize: 14 },
});
