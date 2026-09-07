/**
 * Shared UI kit — QCU-themed primitives used by every screen.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { palette, t, text } from '../theme';

/* -- Screen ------------------------------------------------------------------ */

export function Screen({
  children,
  scroll,
  center,
}: {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
}) {
  const inner = (
    <View style={[s.screenInner, center && s.center]}>{children}</View>
  );
  return (
    <View style={s.screen}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.scrollBody}
        >
          {children}
        </ScrollView>
      ) : (
        inner
      )}
    </View>
  );
}

/* -- Brand wordmark -------------------------------------------------------- */

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <View style={s.brandWrap}>
      <Text style={s.brand}>
        <Text style={{ color: palette.blue }}>Sonic</Text>
        <Text style={{ color: palette.goldDeep }}>Access</Text>
      </Text>
      <Text style={s.brandSub}>{subtitle ?? 'Quezon City University'}</Text>
    </View>
  );
}

/* -- Card ---------------------------------------------------------------- */

export function Card({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: ViewStyle;
  accent?: boolean;
}) {
  return <View style={[s.card, accent && s.cardAccent, style]}>{children}</View>;
}

/* -- Button ------------------------------------------------------------------ */

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: ButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        variant === 'primary' && s.btnPrimary,
        variant === 'secondary' && s.btnSecondary,
        variant === 'danger' && s.btnDanger,
        pressed && !off && s.btnPressed,
        off && s.btnOff,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? palette.blue : palette.white} />
      ) : (
        <Text
          style={[
            s.btnText,
            variant === 'secondary' ? { color: palette.blue } : { color: palette.white },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.link} hitSlop={8}>
      <Text style={s.linkText}>{label}</Text>
    </Pressable>
  );
}

/* -- Field ------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={s.field}>
      <Text style={text.label}>{label.toUpperCase()}</Text>
      <TextInput
        placeholderTextColor={palette.inkFaint}
        {...input}
        style={[s.input, input.multiline && s.inputMultiline, input.style]}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/* -- Banner ---------------------------------------------------------------- */

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  return (
    <View
      style={[
        s.banner,
        tone === 'info' && s.bannerInfo,
        (tone === 'warn' || tone === 'error') && s.bannerAlert,
      ]}
    >
      <Text style={[s.bannerText, tone !== 'info' && { color: palette.red }]}>{children}</Text>
    </View>
  );
}

/* -- styles ---------------------------------------------------------------- */

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.paper },
  screenInner: { flex: 1, paddingHorizontal: t.space.xl, paddingTop: t.space.xxl },
  scrollBody: { paddingHorizontal: t.space.xl, paddingTop: t.space.xxl, paddingBottom: t.space.xxl, flexGrow: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  brandWrap: { marginBottom: t.space.xl },
  brand: { fontSize: 24, fontWeight: '800', letterSpacing: 0.3 },
  brandSub: { color: palette.inkFaint, fontSize: 12.5, fontWeight: '600', marginTop: 2, letterSpacing: 0.4 },

  card: {
    backgroundColor: palette.white,
    borderRadius: t.radius.lg,
    padding: t.space.xl,
    borderWidth: 1,
    borderColor: palette.line,
    ...t.shadow,
  },
  cardAccent: { borderColor: palette.blueTint, backgroundColor: palette.white },

  btn: {
    borderRadius: t.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: palette.blue },
  btnSecondary: { backgroundColor: palette.white, borderWidth: 1.5, borderColor: palette.blue },
  btnDanger: { backgroundColor: palette.red },
  btnPressed: { opacity: 0.85 },
  btnOff: { opacity: 0.5 },
  btnText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  link: { alignItems: 'center', paddingVertical: t.space.lg },
  linkText: { color: palette.inkMute, fontSize: 14, fontWeight: '600' },

  field: { marginTop: t.space.lg },
  input: {
    marginTop: t.space.sm,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: t.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: palette.ink,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  hint: { color: palette.inkFaint, fontSize: 12.5, marginTop: 6 },

  banner: { borderRadius: t.radius.md, padding: t.space.md, marginBottom: t.space.lg, borderWidth: 1 },
  bannerInfo: { backgroundColor: palette.blueTint, borderColor: '#CBDBF4' },
  bannerAlert: { backgroundColor: palette.redTint, borderColor: '#F3C6CE' },
  bannerText: { color: palette.blueDark, fontSize: 13, lineHeight: 18 },
});
