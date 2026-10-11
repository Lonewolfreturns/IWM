# Store privacy declarations — answer sheet

Fill the Play Console Data Safety form and the App Store Connect App Privacy
questionnaire from this file.

**Why it is written down.** Four things describe the same data and reviewers
compare them against each other and against the app:

1. Play Console → Data Safety
2. App Store Connect → App Privacy
3. `frontend/ios/App/App/PrivacyInfo.xcprivacy`
4. https://foodloss.ca/privacy

A disagreement between any two is a rejection, and they drift the moment one is
edited alone. Change this file first, then propagate.

**The source of truth is the code**, not this document. Everything below comes
from the sign-up form (`pages/SignUp.jsx`), the user record written by
`aws/lambdas/auth`, and the fact that the app has no analytics, no ad SDK and
no third-party network calls.

---

## Google Play — Data Safety

### Data collection and security

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — TLS to AWS Lambda; the app refuses cleartext (`usesCleartextTraffic=false` + network security config) |
| Do you provide a way for users to request that their data be deleted? | **Yes** |
| Account deletion URL | `https://foodloss.ca/delete-account` |

### Data types

All of the following: **collected** (not shared), **required** (not optional),
**not processed ephemerally**, purpose **App functionality** and **Account
management** only.

| Category | Type | Notes |
| --- | --- | --- |
| Personal info | Name | Sign-up |
| Personal info | Email address | Sign-up, and the sign-in identifier |
| Personal info | Phone number | Sign-up |
| Personal info | Address → City | Sign-up. City only, never a street address |
| App activity | Other user-generated content | Organization name |

### Explicitly NOT collected

Answer **No** to every one of these — the app requests none of them and the
Android manifest declares no permission that would allow it:

Location (precise or approximate) · Financial info · Health and fitness ·
Messages · Photos and videos · Audio files · Files and docs · Calendar ·
Contacts · App activity (app interactions, in-app search history, installed
apps) · Web browsing history · App info and performance (crash logs,
diagnostics) · Device or other IDs

### Notes for specific questions

- **"Is data shared with third parties?"** → **No.** AWS hosts the
  infrastructure as a processor, which Google's definition explicitly excludes
  from "sharing".
- **"Is data used for advertising or marketing?"** → **No.** There is no ad
  SDK and no advertising identifier in the app.
- **Scale readings** are not declared. They are measurements from kitchen
  hardware, keyed by device UID, and do not map to any Play data type. The
  account that can read them *is* declared above, which is the part that
  identifies a person.
- **Crash logs** → **No**, because nothing collects them. If Crashlytics or
  Sentry is ever added, this becomes Yes and both stores need updating.

---

## Apple — App Privacy

Must match `PrivacyInfo.xcprivacy` exactly.

| Question | Answer |
| --- | --- |
| Do you or your third-party partners collect data from this app? | **Yes** |
| Is data used to track users? | **No** — no ATT prompt is needed, and none is shown |

### Data linked to the user

Purpose **App Functionality** for all four. None used for tracking.

| Category | Type |
| --- | --- |
| Contact Info | Name |
| Contact Info | Email Address |
| Contact Info | Phone Number |
| Contact Info | Physical Address (city only) |
| Identifiers | — *none* |
| Other Data | Other Data Types (organization name) |

### Data not linked to the user

None.

### Data used to track you

None. `NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty.

### Required-reason APIs

One, declared in the privacy manifest:

| API category | Reason | Why |
| --- | --- | --- |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | `@capacitor/filesystem` links it in; the app writes report files to its own container and reads back their URI. Apple checks what is linked into the binary, not which paths run |

### Export compliance

`ITSAppUsesNonExemptEncryption = false` in `Info.plist`. The only cryptography
is HTTPS via the OS and the Keychain, both covered by the standard exemption.
Declaring it in the plist is what stops App Store Connect asking on every
upload.

---

## Listing copy

Both stores need these URLs; they are live routes in the app and work signed
out.

| Field | Value |
| --- | --- |
| Privacy policy | `https://foodloss.ca/privacy` |
| Account deletion | `https://foodloss.ca/delete-account` |
| Support email | `support@foodloss.ca` |
| Category | Business (Apple) / Business (Play) |
| Content rating | Everyone — no user-generated content, no ads, no social features |

**`support@foodloss.ca` has to exist and be monitored before you submit.** Both
listings point at it, both deletion screens tell users to write to it, and the
privacy policy promises a 30-day response. A reviewer may well send a test
message to it.

---

## When this changes

Update this file, then all four places, if any of the following happens:

- A field is added to or removed from the sign-up form
- Push notifications are added — that adds a device token (Identifiers) and,
  on iOS, a new required-reason declaration
- Crash reporting or analytics is added — Play gains "App info and
  performance", Apple gains Diagnostics, and "no third-party SDK" stops being
  true
- Readings start carrying anything that identifies a person rather than a
  device
