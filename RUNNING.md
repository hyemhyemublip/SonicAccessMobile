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
| A phone             | Android 6+ or iOS 15+, with a working speaker.              |
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

The client stores one student credential in the OS keychain. Get a sample one
from the seed roster:

```bash
npm run seed -- --show --vectors
```

Pick a row, e.g.:

```
studentId  231800
secret     SZCGVTXAKJWPLFZ5WN6SEGG72R7O7OVQ   (from seed/students.json)
```

In the app:

1. **Student ID** → `231800`
2. **Secret** → paste the secret string
3. **Name** (optional) → anything, shown on this screen only
4. **Save enrollment**

You land on the gate-pass screen showing a big 6-digit **code** and a countdown
bar. The code rolls every 15 seconds.

---

## 6. Emit and verify

1. Point the phone's speaker at the gate node (or just at a laptop mic for a
   dry run).
2. Tap **Emit gate pass**. Allow the audio prompt if asked. You may hear a faint
   tick — the tone itself is near-inaudible.
3. Cross-check: run `npm run seed -- --show --vectors` again immediately. The
   `code (6-digit)` printed for `231800` must equal the code the app showed, as
   long as you check within the same 15-second window.

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

## 8. Handy scripts

```bash
npm run typecheck              # tsc --noEmit
npm run selftest               # token crypto self-test (RFC 4226 vectors)
npm run seed -- --show         # view the current student roster
npm run seed -- --show --vectors   # roster + each student's live 6-digit code
```

---

## 9. Troubleshooting

| Symptom                                         | Fix                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| QR scans but "Something went wrong" / timeout  | Switch to `npx expo start --tunnel`.                                |
| Expo Go says the SDK is unsupported            | Install the SDK 57 build of Expo Go, or update this project.        |
| `npx expo login` prompt on `--tunnel`          | Expected — run `npx expo register` (free) then retry.               |
| Metro cache weirdness after edits              | `npx expo start -c` (clears the bundler cache).                     |
| Emit does nothing / no sound                   | Expected to be near-silent; verify via the `--vectors` code match. Check the volume isn't at zero and the audio permission was granted. |
| App stuck on the spinner                       | `expo-secure-store` read failed; reinstall the app in Expo Go.     |
| Code never matches the vector                  | Device clock drift — enable automatic date/time on the phone.       |
