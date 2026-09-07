/**
 * Enrollment: scan (or paste) the registrar code, then set an unlock password.
 * The code carries `{ studentId, secret }`; the secret is sealed under the
 * password by `authService.enroll` and the code itself is discarded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { MIN_PASSWORD_LENGTH } from '../config';
import { biometricSupported, enroll, validatePassword } from '../services/authService';
import { parseEnrollPayload, type EnrollPayload } from '../services/enrollmentCode';
import { Brand, Button, Card, Field, LinkButton, Screen } from '../components/ui';
import { palette, t, text } from '../theme';

type Props = { onEnrolled: () => void };
type Step = 'scan' | 'manual' | 'password';

export default function EnrollScreen({ onEnrolled }: Props) {
  const [step, setStep] = useState<Step>('scan');
  const [perm, requestPerm] = useCameraPermissions();
  const [payload, setPayload] = useState<EnrollPayload | null>(null);
  const [manualText, setManualText] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [bioAvail, setBioAvail] = useState(false);
  const [bioOn, setBioOn] = useState(true);
  const scannedRef = useRef(false);

  useEffect(() => {
    biometricSupported().then(setBioAvail).catch(() => setBioAvail(false));
  }, []);

  const acceptPayload = useCallback((raw: string) => {
    try {
      const p = parseEnrollPayload(raw);
      setPayload(p);
      setName(p.name ?? '');
      setStep('password');
    } catch (e) {
      Alert.alert('Invalid code', e instanceof Error ? e.message : String(e));
      scannedRef.current = false;
    }
  }, []);

  const onScan = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;
      scannedRef.current = true;
      acceptPayload(data);
    },
    [acceptPayload],
  );

  const doEnroll = useCallback(async () => {
    if (!payload) return;
    const pwErr = validatePassword(pw1);
    if (pwErr) return Alert.alert('Check password', pwErr);
    if (pw1 !== pw2) return Alert.alert('Check password', 'The two passwords do not match.');
    setBusy(true);
    try {
      await enroll({
        studentId: payload.studentId,
        secret: payload.secret,
        password: pw1,
        name: name.trim() || payload.name,
        biometric: bioAvail && bioOn,
      });
      onEnrolled();
    } catch (e) {
      Alert.alert('Enrollment failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [payload, pw1, pw2, name, bioAvail, bioOn, onEnrolled]);

  /* -- password step ------------------------------------------------------- */
  if (step === 'password' && payload) {
    return (
      <Screen scroll>
        <Brand subtitle="Enroll device" />
        <Text style={text.title}>Set your password</Text>
        <Text style={[text.muted, { marginTop: 4, marginBottom: t.space.lg }]}>
          Student ID {payload.studentId}. You'll type this password to send a gate pass. The
          registrar's code is not saved — only your sealed pass on this device.
        </Text>

        <Card>
          <Field
            label="Name (optional)"
            value={name}
            onChangeText={setName}
            placeholder="shown on this device only"
          />
          <Field
            label={`Password (${MIN_PASSWORD_LENGTH}+ characters)`}
            value={pw1}
            onChangeText={setPw1}
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="Confirm password"
            value={pw2}
            onChangeText={setPw2}
            secureTextEntry
            autoCapitalize="none"
          />
          {bioAvail ? (
            <View style={s.bioRow}>
              <Text style={[text.body, { flex: 1 }]}>
                Also unlock with fingerprint / Face ID
              </Text>
              <Switch
                value={bioOn}
                onValueChange={setBioOn}
                trackColor={{ true: palette.blue, false: palette.line }}
                thumbColor={palette.white}
              />
            </View>
          ) : null}
          <View style={{ marginTop: t.space.xl }}>
            <Button label="Create login" onPress={doEnroll} loading={busy} />
          </View>
        </Card>
      </Screen>
    );
  }

  /* -- manual entry step -------------------------------------------------- */
  if (step === 'manual') {
    return (
      <Screen scroll>
        <Brand subtitle="Enroll device" />
        <Text style={text.title}>Enter enrollment code</Text>
        <Text style={[text.muted, { marginTop: 4, marginBottom: t.space.lg }]}>
          Paste the code the registrar gave you — the long letters-and-numbers
          string.
        </Text>
        <Card>
          <Field
            label="Enrollment code"
            value={manualText}
            onChangeText={setManualText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textContentType="none"
            keyboardType="visible-password"
            placeholder="eyJ0Ijoic29uaWNhY2Nlc3MvdjEiLCJ…"
          />
          <View style={{ marginTop: t.space.lg }}>
            <Button label="Continue" onPress={() => acceptPayload(manualText)} />
          </View>
        </Card>
        <LinkButton label="Scan QR instead" onPress={() => setStep('scan')} />
      </Screen>
    );
  }

  /* -- scan step -------------------------------------------------------------- */
  if (!perm) {
    return <Screen center><Text style={text.muted}>Preparing camera…</Text></Screen>;
  }

  if (!perm.granted) {
    return (
      <Screen>
        <Brand subtitle="Enroll device" />
        <Text style={text.title}>Enroll this device</Text>
        <Text style={[text.muted, { marginTop: 4, marginBottom: t.space.xl }]}>
          Scan the QR code the registrar gave you. Camera access is needed for that.
        </Text>
        <Button label="Allow camera" onPress={requestPerm} />
        <LinkButton label="Enter the code manually" onPress={() => setStep('manual')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Brand subtitle="Enroll device" />
      <Text style={text.title}>Scan enrollment QR</Text>
      <Text style={[text.muted, { marginTop: 4, marginBottom: t.space.lg }]}>
        Point the camera at the registrar's QR code.
      </Text>
      <View style={s.camFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={s.reticle} />
      </View>
      <LinkButton
        label="Enter the code manually"
        onPress={() => {
          scannedRef.current = false;
          setStep('manual');
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    marginTop: t.space.lg,
  },
  camFrame: {
    height: 300,
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 200,
    height: 200,
    borderWidth: 3,
    borderColor: palette.gold,
    borderRadius: t.radius.md,
    backgroundColor: 'transparent',
  },
});
