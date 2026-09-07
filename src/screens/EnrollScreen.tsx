/**
 * Enrollment: scan (or paste) the registrar code, then set an unlock password.
 * The code carries `{ studentId, secret }`; the secret is sealed under the
 * password by `authService.enroll` and the code itself is discarded.
 */

import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { MIN_PASSWORD_LENGTH } from '../config';
import { enroll, validatePassword } from '../services/authService';
import { parseEnrollPayload, type EnrollPayload } from '../services/enrollmentCode';

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
  const scannedRef = useRef(false);

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
      });
      onEnrolled();
    } catch (e) {
      Alert.alert('Enrollment failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [payload, pw1, pw2, name, onEnrolled]);

  if (step === 'password' && payload) {
    return (
      <View style={s.c}>
        <Text style={s.h1}>Set your unlock password</Text>
        <Text style={s.sub}>
          Student ID {payload.studentId}. You'll type this password to send a gate pass. The
          registrar's code is not saved — only your sealed pass on this device.
        </Text>

        <Text style={s.label}>Name (optional)</Text>
        <TextInput
          style={s.in}
          value={name}
          onChangeText={setName}
          placeholder="shown on this device only"
          placeholderTextColor="#9aa5b1"
        />

        <Text style={s.label}>Password ({MIN_PASSWORD_LENGTH}+ characters)</Text>
        <TextInput style={s.in} value={pw1} onChangeText={setPw1} secureTextEntry autoCapitalize="none" />

        <Text style={s.label}>Confirm password</Text>
        <TextInput style={s.in} value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" />

        <Pressable style={s.btn} onPress={doEnroll} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Create login</Text>}
        </Pressable>
      </View>
    );
  }

  if (step === 'manual') {
    return (
      <View style={s.c}>
        <Text style={s.h1}>Enter enrollment code</Text>
        <Text style={s.sub}>Paste the code the registrar gave you.</Text>
        <TextInput
          style={[s.in, { minHeight: 120, textAlignVertical: 'top' }]}
          value={manualText}
          onChangeText={setManualText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={'{"t":"sonicaccess/v1", ...}'}
          placeholderTextColor="#9aa5b1"
        />
        <Pressable style={s.btn} onPress={() => acceptPayload(manualText)}>
          <Text style={s.btnT}>Continue</Text>
        </Pressable>
        <Pressable style={s.link} onPress={() => setStep('scan')}>
          <Text style={s.linkT}>Scan QR instead</Text>
        </Pressable>
      </View>
    );
  }

  // step === 'scan'
  if (!perm) {
    return (
      <View style={[s.c, s.mid]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!perm.granted) {
    return (
      <View style={s.c}>
        <Text style={s.h1}>Enroll this device</Text>
        <Text style={s.sub}>
          Scan the QR code the registrar gave you. Camera access is needed for that.
        </Text>
        <Pressable style={s.btn} onPress={requestPerm}>
          <Text style={s.btnT}>Allow camera</Text>
        </Pressable>
        <Pressable style={s.link} onPress={() => setStep('manual')}>
          <Text style={s.linkT}>Enter the code manually</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={s.c}>
      <Text style={s.h1}>Scan enrollment QR</Text>
      <View style={s.cam}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
      </View>
      <Pressable
        style={s.link}
        onPress={() => {
          scannedRef.current = false;
          setStep('manual');
        }}
      >
        <Text style={s.linkT}>Enter the code manually</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#0f172a', paddingHorizontal: 24, paddingTop: 72 },
  mid: { alignItems: 'center', justifyContent: 'center' },
  h1: { color: '#f8fafc', fontSize: 26, fontWeight: '700' },
  sub: { color: '#94a3b8', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 24 },
  label: { color: '#cbd5e1', fontSize: 13, marginBottom: 6, marginTop: 14 },
  in: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  cam: { height: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', marginBottom: 16 },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: 16 },
  linkT: { color: '#64748b', fontSize: 14 },
});
