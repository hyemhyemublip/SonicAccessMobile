import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getEnrollment, type Enrollment } from './src/services/authService';
import EnrollScreen from './src/screens/EnrollScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import GatePassScreen from './src/screens/GatePassScreen';

type Route =
  | { k: 'loading' }
  | { k: 'enroll' }
  | { k: 'locked'; e: Enrollment }
  | { k: 'unlocked'; e: Enrollment; secret: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ k: 'loading' });

  const boot = useCallback(async () => {
    try {
      const e = await getEnrollment();
      setRoute(e ? { k: 'locked', e } : { k: 'enroll' });
    } catch {
      setRoute({ k: 'enroll' });
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // drop the in-memory secret whenever the app leaves the foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setRoute((r) => (r.k === 'unlocked' ? { k: 'locked', e: r.e } : r));
      }
    });
    return () => sub.remove();
  }, []);

  let body;
  if (route.k === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  } else if (route.k === 'enroll') {
    body = <EnrollScreen onEnrolled={boot} />;
  } else if (route.k === 'locked') {
    body = (
      <UnlockScreen
        enrollment={route.e}
        onUnlocked={(secret) => setRoute({ k: 'unlocked', e: route.e, secret })}
        onReset={() => setRoute({ k: 'enroll' })}
      />
    );
  } else {
    body = (
      <GatePassScreen
        studentId={route.e.studentId}
        name={route.e.name}
        secret={route.secret}
        onLock={() => setRoute({ k: 'locked', e: route.e })}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
