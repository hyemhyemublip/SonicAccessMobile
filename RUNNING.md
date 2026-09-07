# Running SonicAccessMobile

How to get the Phase 1 client running on a phone (or in a browser for a quick
UI look). The app emits an ultrasonic chirp through the device speaker, so a
**real phone is required** for the full flow — simulators and browsers have no
usable speaker path.

---

## 1. Prerequisites

| Need                | Notes                                                        |
| ------------------- | ---------------------------------------------------------- |
| Node.js 22+         | `node -v`. The seed/self-test scripts use `--experimental-strip-types`. |
| npm                 | ships with Node.                                            |
| A phone             | Android 6+ or iOS 15+, with a working speaker and camera (for the QR). |
| Same-ish network    | Phone and computer on the same Wi-Fi **or** use `--tunnel` (below). |

Install project dependencies once:

```bash
npm install
```

---

## 2. Install Expo Go on the phone

The app runs inside **Expo Go** (a free host app) during development — you do
not build a native binary for this.

- **Android:** Play Store → search **"Expo Go"** → Install.
  Direct link: <https://play.google.com/store/apps/details?id=host.exp.exponent>
- **iOS:** App Store → search **"Expo Go"** → Get.
  Direct link: <https://apps.apple.com/app/expo-go/id982107779>

Open Expo Go once and, if it asks, create/sign in with a free Expo account
(optional on Android, sometimes required on iOS to open a project).

> The Expo Go version must match the project SDK (**SDK 57**). If a newer Expo Go
> refuses the project, install "Expo Go (SDK 57)" from the store listing's older
> versions, or use a development build (out of scope here).

---

## 3. Start the dev server

From the project folder:

```bash
npm start
```

This prints a QR code and a URL. Pick the connection mode that matches your
setup:

### a) Phone and computer on the same Wi-Fi (simplest)

`npm start` defaults to LAN. Just scan the QR (next section).

If the phone cannot connect, the computer's LAN IP is probably not reachable
(common with WSL, VPNs, or "guest" Wi-Fi). Use tunnel mode:

### b) Different networks / WSL / locked-down Wi-Fi → tunnel

```bash
npx expo start --tunnel
```

First run installs `@expo/ngrok` and asks you to log in with a free Expo
account (`npx expo register` if you don't have one). The tunnel routes through
Expo's servers, so network location stops mattering. Slightly slower reload.

### c) Running the server inside WSL

WSL2 has its own NAT'd IP the phone can't reach, so either:

- use **tunnel mode** (b) — easiest; or
- run `npm start` from **Windows** (copy the project to a Windows folder first —
  Metro over the `\\wsl$` share breaks file watching); or
- port-forward 8081 from Windows to the WSL IP and set
  `REACT_NATIVE_PACKAGER_HOSTNAME=<windows-LAN-IP>`.

---

## 4. Open the app on the phone

- **Android:** open Expo Go → **Scan QR code** → point at the terminal QR.
- **iOS:** open the **Camera** app → point at the QR → tap the
  "Open in Expo Go" banner.

The JS bundle downloads (first load is slower), then the app starts on the
**Enroll device** screen.

---

## 5. Enroll a test student

Enrollment takes a **code** from the registrar (the base64 of
`{ studentId, secret }`), then you set an **unlock password**. Get a test code:

```bash
npm run enroll-code -- 231800        # one seeded student
npm run enroll-code -- --all         # all of them
```

In the app:

1. On the enroll screen, tap **Enter the code manually** and paste the base64
   string (or scan its QR — see below).
2. Set a password (8+ characters), confirm it, tap **Create login**.
3. On next launch (or after Lock) you'll type that password to unlock.

You land on the gate-pass screen showing a big 6-digit **code** and a countdown
bar. The code rolls every 30 seconds. The secret is sealed on-device with the
password — it is never stored in the clear.

To test the QR scan instead: turn the base64 string into a QR with any
generator, or open the console's **Enrollment · Registrar** tab (`GET /`), issue
the student, and scan the QR it shows.

---

## 6. Emit and verify

1. Point the phone's speaker at the gate node (or just at a laptop mic for a
   dry run).
2. Tap **Emit gate pass**. Allow the audio prompt if asked. You may hear a faint
   tick — the tone itself is near-inaudible.
3. Cross-check: run `npm run seed -- --show --vectors` again immediately. The
   `code (6-digit)` printed for `231800` must equal the code the app showed, as
   long as you check within the same 30-second window.

There is **one gate node** in this pilot — it decodes the chirp, re-derives the
expected code for the current window (± 1 window of clock drift), and opens the
gate on a match. Its firmware is a separate deliverable; the wire format it
expects is `src/PROTOCOL.md`.

---

## 7. Web preview (UI only, no phone)

```bash
npx expo start --web
```

Opens `http://localhost:8081` in the browser. The enroll and gate-pass screens
render, so you can review layout and the code card. **Emit will fail on web** —
`expo-file-system` file writes and `expo-audio` file playback are not supported
there. Use this only for visual checks.

---

## 8. Standalone build (EAS)

Expo Go is dev-only. For a real, installable app — and to verify it runs fully
offline — build with EAS. Profiles are in `eas.json`; `app.config.js` blocks the
Android `INTERNET` permission for every profile except `development`.

One-time setup (needs a free Expo account + connectivity):

```bash
npm i -g eas-cli          # or use: npx eas-cli <cmd>
eas login
eas init                  # writes extra.eas.projectId into app.json — commit it
```

Build an installable APK:

```bash
eas build --profile preview --platform android      # internal APK
eas build --profile production --platform android    # store bundle (.aab)
eas build --profile development --platform android    # dev client (INTERNET allowed, for Metro)
```

iOS is analogous (`--platform ios`; needs an Apple account).

### Verify it is offline

1. Install the `preview` APK on a phone.
2. Enroll: scan the QR from the registrar console (that page needs a network to
   load, but the app's enrollment itself is local — the QR is just data).
3. Turn on **airplane mode**.
4. Unlock with your password, tap **Emit gate pass** — it must still produce the
   code and play the chirp.
5. Confirm the manifest: `aapt dump permissions <apk> | grep INTERNET` prints
   nothing (the `preview`/`production` builds have it blocked).

---

## 9. Handy scripts

```bash
npm run typecheck              # tsc --noEmit
npm test                       # typecheck + token + FSK + enroll + e2e suites
npm run seed -- --show --vectors   # roster + each student's live 6-digit code
npm run enroll-code -- 231800      # a test enrollment code (base64 + JSON)
```

---

## 10. Troubleshooting

| Symptom                                         | Fix                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| QR scans but "Something went wrong" / timeout  | Switch to `npx expo start --tunnel`.                                |
| Expo Go says the SDK is unsupported            | Install the SDK 57 build of Expo Go, or update this project.        |
| `npx expo login` prompt on `--tunnel`          | Expected — run `npx expo register` (free) then retry.               |
| Metro cache weirdness after edits              | `npx expo start -c` (clears the bundler cache).                     |
| Emit does nothing / no sound                   | Expected to be near-silent; verify via the `--vectors` code match. Check the volume isn't at zero and the audio permission was granted. |
| App stuck on the spinner                       | `expo-secure-store` read failed; reinstall the app in Expo Go.     |
| Code never matches the vector                  | Device clock drift — enable automatic date/time on the phone.       |
