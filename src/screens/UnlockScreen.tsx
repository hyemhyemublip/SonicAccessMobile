/**
 * Unlock: the enrolled student types their password (or uses Face ID /
 * fingerprint if they enabled it). On success the decrypted secret is handed to
 * the caller — held in memory only. After `MAX_UNLOCK_ATTEMPTS` wrong password
 * tries the vault self-wipes -> re-enroll.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  BiometricUnavailable,
  LockedOut,
  WrongPasswordError,
  biometricEnabled,
  biometricSupported,
  clearEnrollment,
  unlock,
  unlockBiometric,
  type Enrollment,
} from '../services/authService';
import { Banner, Brand, Button, Card, Field, LinkButton, Screen } from '../components/ui';
import { palette, t, text } from '../theme';

type Props = {
  enrollment: Enrollment;
  onUnlocked: (secret: string) => void;
  onReset: () => void;
};

export default function UnlockScreen({ enrollment, onUnlocked, onReset }: Props) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bio, setBio] = useState(false);
  const [bioHardware, setBioHardware] = useState(false);
  const bioTried = useRef(false);

  const runBiometric = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const secret = await unlockBiometric();
      onUnlocked(secret);
    } catch (e) {
      if (!(e instanceof BiometricUnavailable)) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      // otherwise: user cancelled -> just fall back to the password field
    } finally {
      setBusy(false);
    }
  }, [onUnlocked]);

  // offer biometric, and try it once automatically on first mount
  useEffect(() => {
    let alive = true;
    biometricSupported().then((h) => alive && setBioHardware(h));
    biometricEnabled().then((on) => {
      if (!alive) return;
      setBio(on);
      if (on && !bioTried.current) {
        bioTried.current = true;
        runBiometric();
      }
    });
    return () => {
      alive = false;
    };
  }, [runBiometric]);

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
    <Screen>
      <View style={s.top}>
        <Brand subtitle="Gate pass" />
        <Text style={text.title}>Unlock</Text>
        <Text style={[text.muted, { marginTop: 4 }]}>
          {enrollment.name ? `${enrollment.name}  ·  ` : ''}ID {enrollment.studentId}
        </Text>
      </View>

      <Card>
        <Field
          label="Password"
          value={pw}
          onChangeText={(t2) => {
            setPw(t2);
            if (err) setErr(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          onSubmitEditing={doUnlock}
          returnKeyType="go"
        />
        {err ? (
          <View style={{ marginTop: t.space.md }}>
            <Banner tone="error">{err}</Banner>
          </View>
        ) : null}
        <View style={{ marginTop: t.space.lg }}>
          <Button label="Unlock" onPress={doUnlock} loading={busy} disabled={!pw} />
        </View>
        {bio ? (
          <View style={{ marginTop: t.space.md }}>
            <Button
              label="Use fingerprint / Face ID"
              variant="secondary"
              onPress={runBiometric}
              disabled={busy}
            />
          </View>
        ) : bioHardware ? (
          <Text style={s.note}>
            Fingerprint / Face ID unlock isn't set up. Turn it on from the gate
            screen after you unlock with your password.
          </Text>
        ) : null}
      </Card>

      <View style={s.footer}>
        <LinkButton label="Forgot password — re-enroll" onPress={doReset} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { marginBottom: t.space.xl },
  note: {
    color: palette.inkFaint,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: t.space.md,
  },
  footer: { marginTop: 'auto' },
});
