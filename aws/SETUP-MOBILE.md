# IWM — Android & iOS apps

The mobile apps are the existing React app running inside a native shell
(Capacitor 8). One codebase, three outputs: foodloss.ca, an Android AAB, and an
iOS IPA.

---

## Why a native shell and not a rewrite

A React Native rewrite would mean rebuilding Reports from scratch. That one
page is 474 kB of chart drawing, PDF layout and XLSX generation (`jsPDF`,
`jspdf-autotable`, the hand-rolled OOXML writer in `lib/xlsx.js`) — none of
which has a React Native equivalent. Analytics is another 128 kB of Recharts.
Rewriting both would fork the reporting logic into two implementations that
have to stay numerically identical forever, which is the kind of thing that
goes wrong quietly.

The shell keeps one implementation. What it costs is that anything the web
cannot do has to be bridged explicitly, and that bridging is `src/native/`.

### Why not Expo

Expo is React Native, so it carries the same rewrite cost as above — `<View>`
and `<Text>`, not the DOM that Recharts, jsPDF, Radix and Tailwind all need.
Wrapping the web build in `react-native-webview` under Expo avoids the rewrite
but is strictly worse than Capacitor for this app: still a WebView, so no
performance gain, but with an extra React Native layer and all five bridges
re-implemented across a `postMessage` boundary instead of direct plugin calls.

The real draw of Expo here is **EAS Build** — cloud compilation without a
local toolchain or a Mac. EAS only builds React Native projects, so it cannot
build this app, but that capability is what
`.github/workflows/mobile-build.yml` provides instead. See *Cloud builds*.

**What is NOT happening:** the app does not load foodloss.ca in a WebView. The
web bundle is compiled into the app and served locally, so it launches offline
and starts instantly. This matters for review — Apple rejects thin wrappers
around a website under guideline 4.2, and "it's just our site in a frame" is
the first thing a reviewer checks.

---

## What had to change in the web app

Five things genuinely do not work in a WebView. Each is bridged in
`src/native/`, and each falls back to the original web behaviour automatically.

| Problem | Why the web version breaks | Where it is fixed |
| --- | --- | --- |
| Report downloads | `<a download>` asks the *browser* to save a file. A WebView has no downloads folder and no download manager, so every export silently did nothing. | `native/saveFile.js` — writes to the app cache, opens the system share sheet |
| Session storage | `localStorage` in a WebView is an unencrypted file in the app sandbox. A bearer token read out of it is a working session. | `native/session.js` — iOS Keychain / Android EncryptedSharedPreferences |
| The Configure Scales link | `target="_blank"` has no meaning — there is no second tab. The link replaced the app with a website, with no address bar and no way back. | `native/openExternal.js` — Chrome Custom Tab / SFSafariViewController |
| Android back button | A WebView does not know what the last action was. One back press from a dialog closed the whole app. | `native/shell.js` — handler stack, then router, then minimise |
| Notch / home indicator | `viewport-fit=cover` lets content run under them. The page title sat under the clock. | `styles/native.css` + inline insets on the layout chrome |

`native/platform.js` gates all of it. On the web, `isNative` is false and every
path above is the original code.

### The one structural change

`main.jsx` now awaits `hydrateSession()` before the first render. Every auth
check in the app is synchronous — `isAuthenticated()` in the route guards,
`getCurrentUser()` in the sidebar, the axios request interceptor — and the
Keychain is not. Rendering first would mount every guard against an empty
session, bouncing a signed-in user to the login screen on each cold start.
Hence `launchAutoHide: false` on the splash screen: it stays up until the app
is genuinely ready.

---

## Responsive behaviour

| Width | Layout |
| --- | --- |
| < 768 (phones) | Sidebar is a 260 px drawer behind the hamburger |
| ≥ 768 (tablets, foldables, desktop) | Fixed 240 px sidebar |

The 80 px icon rail that used to sit between 768 and 1024 is gone. It hid every
nav label, the whole timezone picker and the signed-in user's name, while the
brand wordmark — which never got the collapsed treatment the others did —
overflowed its 80 px and collided with the page title. A tablet has room for
all of it.

Labels are no longer hidden by breakpoint anywhere. `SidebarContent` renders in
two places, the fixed sidebar *and* the mobile drawer, and a viewport media
query cannot tell them apart — so on a phone, where the drawer is the only way
to navigate, every label was hidden and the menu was a column of unlabelled
icons.

Also handled in `styles/native.css`: 44 px minimum touch targets, 16 px form
fields (anything smaller makes iOS zoom in on focus and never zoom back),
momentum scrolling, no rubber-band overscroll, no pull-to-refresh, and
`prefers-reduced-motion` honoured so the landing page's animated background
stops draining battery.

---

## Building

### Android

Needs **JDK 21** and the **Android SDK** (Android Studio installs both).
Neither is on this machine, so the Android build has never been run — see
*Known untested* below.

```bash
cd frontend
npm run mobile:android      # build + sync + open Android Studio
```

Or from the command line:

```bash
cd frontend
npm run mobile:aab          # release bundle for Play
```

Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab`

### iOS

Needs **macOS** with **Xcode 15+**. Capacitor 8 uses Swift Package Manager, so
there is no CocoaPods step.

```bash
cd frontend
npm run mobile:ios          # build + sync + open Xcode
```

Then in Xcode: select *Any iOS Device*, **Product → Archive**, and distribute
to App Store Connect.

### After any web change

```bash
cd frontend
npm run mobile:sync         # rebuild the bundle and copy it into both projects
```

---

## Cloud builds

`.github/workflows/mobile-build.yml` builds both platforms on GitHub's
runners. This is how iOS gets compiled at all from a Windows machine, and it
is the Capacitor equivalent of what people reach for Expo's EAS Build to do.

Run it from the repo's **Actions** tab → *Mobile build* → *Run workflow*, and
pick a platform and variant. A `v*` tag builds release versions of both.

It is deliberately not on every push: macOS runner minutes bill at 10x on
private repos, and building both platforms per commit would exhaust the free
allowance in days.

**Repository secrets it reads** (Settings → Secrets and variables → Actions):

| Secret | Needed for |
| --- | --- |
| `VITE_API_URL`, `VITE_CORE_API_URL`, `VITE_READINGS_API_URL`, `VITE_ANALYTICS_API_URL`, `VITE_REPORTS_API_URL` | Every build. Vite inlines these at build time — without them the app compiles but every request 404s |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Release Android builds only. The debug APK needs none of them |

To produce the keystore secret on Windows:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("iwm-release.jks")) | Set-Clipboard
```

The iOS job **verifies but does not release**. It compiles unsigned for the
simulator, which needs no Apple Developer account and proves the Xcode project
is valid, the Swift packages resolve and every plugin builds — then asserts
that `PrivacyInfo.xcprivacy` actually landed inside `App.app`, because a
manifest that is not in the target looks correct in the repo and is rejected
at upload with ITMS-91053.

Producing a signed IPA needs the $99/yr membership plus a distribution
certificate and provisioning profile as secrets. Until that exists, the
realistic path is: run this job to confirm it compiles, then Archive and
upload from a Mac once.

## Signing (Android)

Create the keystore once:

```bash
keytool -genkey -v -keystore iwm-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias iwm
```

Then `frontend/android/keystore.properties` (gitignored):

```properties
storeFile=../iwm-release.jks
storePassword=...
keyAlias=iwm
keyPassword=...
```

**Back the keystore up somewhere you will still have in five years.** If it is
lost, the app can never be updated under the same Play listing again — the only
remedy is a new listing and asking every user to reinstall. Put it in a
password manager, not just on this laptop.

If no keystore is found the release build is left **unsigned** rather than
falling back to the debug key. That is deliberate: a debug-signed APK installs
and runs perfectly, so a silent fallback produces something that looks
shippable, cannot be uploaded, and could never be upgraded by a correctly
signed build.

---

## Security work already done

Run `npm run mobile:check` to re-verify all of it — it parses every config file
and asserts each property below.

**Android**

- `allowBackup="false"` — with backup on, `adb backup` and Google's cloud
  backup both copy the entire app sandbox off the device, including the
  encrypted session file. This is the finding every mobile pentest opens with.
- `data_extraction_rules.xml` + `backup_rules.xml` — closed in both directions
  (cloud backup and device-to-device transfer), in case a library's manifest
  merge ever re-enables backup.
- `network_security_config.xml` — no cleartext, system CAs only. The dev
  exceptions live in a **debug-variant copy** of the file, because
  `debug-overrides` cannot contain `domain-config` and a top-level exception
  would have applied to the shipped app too.
- `file_paths.xml` narrowed from the Capacitor template, which exposed the root
  of external storage (`/sdcard` — Downloads, DCIM, every other app's files)
  through the FileProvider. Now scoped to one cache subdirectory.
- Legacy `READ/WRITE_EXTERNAL_STORAGE` stripped from the merged manifest with
  `tools:node="remove"`. Only `INTERNET` and `ACCESS_NETWORK_STATE` are
  declared.
- `targetSdk 36`, `resizeableActivity`, predictive back opt-in.

**iOS**

- `PrivacyInfo.xcprivacy` — mandatory since 1 May 2024. Declares no tracking,
  the four collected data types, and `C617.1` for the file-timestamp API that
  `@capacitor/filesystem` links in. **Registered in the Xcode target's Copy
  Bundle Resources phase**, which is the step everyone forgets: a manifest that
  is not in the target is not in the IPA, and the upload is rejected with
  ITMS-91053 exactly as if it did not exist.
- ATS with no exceptions. A single `NSAllowsArbitraryLoads` draws a written
  question from App Review.
- `ITSAppUsesNonExemptEncryption=false` — stops App Store Connect asking the
  export-compliance questions on every upload.
- No usage-description strings, because the app requests no protected
  resources. A declared-but-unused permission is a 5.1.1 rejection.
- Obsolete `armv7` requirement removed (it would filter the app off current
  hardware); `UIRequiresFullScreen=false` for iPad Split View.

**Both**

- Session token in hardware-backed secure storage, excluded from backups.
- No analytics, no ad SDK, no third-party trackers, no advertising identifier.
- App icons generated from the brand mark (`npm run mobile:assets`) — the
  Capacitor placeholder logos are gone, and the iOS icon is alpha-free as
  Apple requires.

---

## Store compliance

### Account deletion

Both stores require an **in-app** route to account deletion for any app with
sign-up. Apple 5.1.1(v) says directing users to a website or to support as the
*only* option is not sufficient; Play additionally wants a web URL for people
who have already uninstalled.

Implemented as a request flow, processed by the team:

- In-app: **Settings → Password & Security → Request account deletion**
  (`components/common/DeleteAccountCard.jsx`)
- Web: **https://foodloss.ca/delete-account** — submit this URL in the Play
  Console Data Safety form
- Processing: an admin deletes the account with the existing
  `DELETE /users/{id}` in User Management. No new endpoint was needed.

Both screens state the same thing: personal details are deleted, scale readings
are kept because they belong to the organisation's hardware rather than to a
login. That wording must stay in step with the privacy policy, because
reviewers compare them.

> **Risk worth knowing.** Apple sometimes pushes back on a deletion flow with a
> human in the loop and asks for the button to do the deletion directly. If
> that happens, the fix is a `POST /auth/delete-account` in the auth Lambda
> that re-checks the password and deletes the row — roughly an hour's work,
> since the auth Lambda already does exactly that re-check for
> `/auth/credentials`. The 30-day commitment on both screens has to be real in
> the meantime.

### Privacy policy

**https://foodloss.ca/privacy** — written from the actual data flows, not a
template. Needs a lawyer's eye before launch, particularly the PIPEDA and
retention wording.

### Data Safety / App Privacy answers

See `aws/STORE-DATA-SAFETY.md`.

---

## Before you submit

- [ ] Build and run on a real Android device and a real iPhone
- [ ] Sign in, export a PDF and an XLSX, tap Configure Scales, press back from
      a dialog — these four paths are the ones that go through native plugins
- [ ] `npm run mobile:check` passes
- [ ] Keystore created and backed up
- [ ] `support@foodloss.ca` exists and is monitored — both store listings and
      both deletion screens point at it
- [ ] Privacy policy reviewed by counsel
- [ ] Play: Data Safety form completed, deletion URL submitted
- [ ] Apple: App Privacy questionnaire matching `PrivacyInfo.xcprivacy`
- [ ] Screenshots for both stores, phone and tablet sizes

---

## Known untested

Honest list of what has *not* been verified, and why.

1. **Neither app has been compiled.** This machine has no JDK, no Android SDK,
   and is not a Mac. Everything above is configuration and code, validated by
   parsing and by `npm run mobile:check`, not by a build. The first real build
   may surface Gradle or Xcode issues.
2. **The native bridges have not run on a device.** `saveFile`, `session`,
   `openExternal` and the back-button stack were written against the plugins'
   actual APIs and type definitions, but no plugin call has executed. The web
   fallbacks are verified; the native paths are not.
3. **R8 / minification is off.** `proguard-rules.pro` has the correct keep
   rules, but enabling it without being able to test is how you ship an app
   that launches fine and fails at the first plugin call. See the comment in
   `android/app/build.gradle` for what to exercise when turning it on.
4. **`npm audit` reports vulnerabilities** in the existing web dependency tree.
   These are build-time and bundler packages rather than anything shipped in
   the WebView, but they are worth a pass before release.

What *has* been verified in the browser: the session refactor (hydrate →
sync cache → `isAuthenticated()` before first render), the 401 handler
(clears the session and routes to `/login` without a page reload), the phone
drawer, the tablet sidebar, the desktop layout, and both new public pages.
