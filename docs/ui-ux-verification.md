# LoveCapsule UI/UX implementation and simulator guide

Implemented on `codex/ui-ux-polish`, against the approved [UI/UX Problems](https://app.notion.com/p/406fb935cec980abb80adc4bc479623f) plan. The existing warm palette and diary cards remain the visual foundation. All screenshots in this folder contain synthetic staging content.

## What changed

| Notion reference                        | Implementation                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMG_4978, draft/note details            | Shared filled Edit and destructive Delete buttons, native Back navigation, padded draft messaging, original deletion confirmation.                                                                                                                                                    |
| IMG_4977–4975, writing                  | Keyboard-aware caret scrolling and a measured sticky toolbar; photo, location, audio, Save Draft, Publish/Save Changes and Cancel controls have visible surfaces and 44-point targets. Existing save receipts, drafts, attachment recovery and cancellation behavior remain in place. |
| IMG_4974 and IMG_4970, schedules        | Matching sections, 1–31 seven-column grid, native calendar/time controls, searchable city/timezone sheet, staged edits, concise summary and expandable timing details. New schedules default to the device timezone; existing ones keep their saved zone.                             |
| IMG_4973–4971, Settings                 | Privacy/diagnostics section removed; internal diagnostic collection retained. Enable/Disable notifications sit side by side. Account deletion has its own destructive section and keeps the confirmation dialog. Anniversary styling matches the surrounding cards.                   |
| IMG_4969, Reveal and supporting screens | Anniversary capsule hero, explicit sealed/ready/opening states, checkpoint/history cards, local viewer timestamps, diary-style annual library and reader, consistent recap/retry/navigation controls. Server authorization and opening identities remain authoritative.               |
| IMG_4968–4966, Diary/Home               | Initial fetch no longer activates the pull-to-refresh inset; deliberate refresh has its own state. Shared note cards retain Diary navigation and Reveal's separately authorized reader path. Home spacing and secondary contrast are refined.                                         |

Compact toolbar/header controls cap text scaling at 1.4 to preserve usable controls; body text scales. Calendar day labels also cap at 1.4. The Home navigation title keeps its standard size to fit the fixed navigation bar. Cards and controls wrap rather than relying on fixed text heights.

The editor's iOS Cancel control uses the native button so UIKit centers its label inside the iOS glass background. This exception applies only to Cancel; the other styled buttons keep their shared backgrounds. See the [verified glass Cancel screenshot](ui-ux/editor-cancel-glass-dark-iphone16e.png). Account deletion uses the revised label “Delete my account and diary.”

Migration **018_checkpoint_month_end.sql** extends recurring checkpoint days to 31. February and other short months clamp to their last day. RPC signatures, version checks, saved due occurrences and history remain intact. Apply 018 to each target database **before** releasing this client. Production has not been migrated or deployed by this work.

## Prepared staging environment

- Organization: PersonalOrg. Project: **LoveCapsule Staging** (`kkooflwrjdnwexmiptwe`), region `us-west-1`; creation quote was $0/month.
- `.env.local` contains the staging URL/public anon key and `EXPO_PUBLIC_DEV_TOOLS=false`. It is ignored and mode 600. Keep service-role/worker secrets out of Expo variables.
- `.env.staging-test` contains the two disposable account emails and password, also ignored and mode 600. Accounts are Alex and Sam, paired with each other; no personal diary data was copied.
- Migrations 001–018 are applied and the migration ledger matches the repository's numeric versions. The empty-schema ordering helper was used for 001. Migration 011's historical data repair was verified inapplicable on the empty project and recorded as a guarded no-op; its repository file is unchanged.
- `scripts/seed_staging.sql` creates the initial 120 synthetic entries, two accounts and schedules. It refuses nonempty Auth/profiles. Run only once on a newly initialized staging project, inside a transaction with a disposable `lovecapsule.test_password` setting. See [the existing bootstrap/rollout guide](reveal-rollout.md) for database initialization.
- `STAGING_PROJECT_REF=kkooflwrjdnwexmiptwe node scripts/seed_staging_media.cjs` adds one synthetic attachment note and a checkpoint due ten seconds later. It reads the ignored credentials, authenticates as Sam, uploads the bundled icon plus a generated one-second tone, and uses the normal entry/schedule RPCs. It has already run here. Existing fixture entries are not overwritten.
- Live verification saved additional drafts, opened the 2026 annual capsule, and claimed checkpoint outcomes. These are disposable test results, so the current screen may show history rather than the original ready state.
- Staging Edge Functions, scheduled workers, APNs credentials and email delivery have not been configured by this UI work. Account deletion's final destructive action was not executed; its confirmation was inspected and cancelled.

## Reopen the simulator

The native development build is installed on **iPhone 17** and **iPhone 16e**, both using iOS 26.2. Xcode 26.3 and Homebrew CocoaPods 1.16.2 were used for the successful build.

1. From the repository, run `npm start -- --dev-client --localhost` if Metro is not already running.
2. Open Xcode's Simulator. Choose **File → Open Simulator → iOS 26.2 → iPhone 17** (or iPhone 16e). Keep one device window open during automated interaction to avoid directing a tap to the other simulator.
3. Open **LoveCapsule** on the simulated Home screen (Home → Search → LoveCapsule). In its development launcher, choose `http://localhost:8081`, or enter that URL manually.
4. Sign in with either synthetic account from `.env.staging-test`. Choose **Not Now** when iOS offers to save the disposable password.
5. Use **I/O → Keyboard → Toggle Software Keyboard** (Command-K) to show the onscreen keyboard. Hardware typing can hide it again; use the onscreen keys for the final typing check.
6. UI changes use Fast Refresh. For a full reload, choose **Device → Shake**, then **Reload** in the Expo developer menu. Command-R in Simulator records the screen, so use the menu path for app reloads.
7. Use **Features → Toggle Appearance** for dark mode and **Features → Increase/Decrease Preferred Text Size** for accessibility sizes. After a runtime text-size change, fully reload the app so native text and layout measurements agree.

Codex can navigate, type, move the caret, scroll, inspect native accessibility controls and capture screenshots through Simulator. The app needs to be running and connected to the local Metro server. No screenshot upload is needed for that workflow.

### Rebuild when native dependencies change

`react-native-keyboard-controller` 1.18.5 requires a development build; Expo Go is not the verification target.

```bash
npm ci
npx expo prebuild --platform ios --clean
npm run ios -- --device "iPhone 17"
```

Use `/opt/homebrew/bin/pod` (1.16.2 here), rather than the older system CocoaPods 1.11.3, which cannot parse the installed native dependencies' visionOS configuration. On this Mac an existing duplicate ignored `ios/LoveCapsule 2.xcodeproj` made CocoaPods project discovery ambiguous. The generated, ignored Podfile now explicitly selects `project 'LoveCapsule.xcodeproj'`; preserve that line if the duplicate is still present after prebuild. Native generated files remain ignored.

The verified direct Xcode build used:

```bash
xcodebuild -workspace ios/LoveCapsule.xcworkspace -scheme LoveCapsule \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /private/tmp/lovecapsule-ux-build build
```

## Verification record — October 27, 2026

- Native Debug build: passed. Both simulator sizes opened the same real staging app.
- `npm run validate`: formatting, lint, route/type generation and **183 tests in 29 suites passed**. `npm run test:ci` also passed with coverage collection.
- Real PostgreSQL 17: **53 tests passed**, including 29–31 in leap/non-leap February and short months, quarterly/semiannual schedules, DST, repeat generation, saved claims, authorization and version conflicts. Generated database types check passed; no interface drift.
- `npm run test:edge`: three functions checked and **5 maintenance tests passed**.
- Live iPhone 17: reproduced the original hidden keyboard toolbar; verified long-entry typing after the fix, draft recovery/save, Diary spacing, annual opening, recap Skip, library pagination beyond 50 entries, full reader, Back/Close, sealed next annual capsule, checkpoint empty result/history, 31-day selection, timezone search and cancellation, notification controls, and cancelled account deletion confirmation.
- Live iPhone 16e: verified long-entry end typing and moving/inserting the caret into the middle with the software keyboard, complete toolbar visibility, saved draft and detail controls. Opened a new checkpoint, loaded its private image and played its generated audio through completion. Switched to the other synthetic account, saved edits with existing image/audio attachments intact, cancelled the location sheet, and published a new note. Dark Diary, reader, Settings, native anniversary calendar and the complete 31-day grid were inspected on this smaller screen. Annual Save/Cancel stay in the header; the fullscreen location sheet measures its own safe area.
- Dark appearance and the largest preferred text size were inspected on iPhone 17. Compact actions remain usable; longer body content scrolls. Error/retry and concurrency edge cases are covered by automated tests; not every error was artificially forced in Simulator.

Representative screenshots (all synthetic), including [attachment editing](ui-ux/editor-attachments-dark-iphone16e.png) and the [anniversary form](ui-ux/anniversary-dark-iphone16e.png):

| Screen              | Evidence                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Writing, iPhone 17  | [Caret and keyboard toolbar](ui-ux/editor-keyboard-iphone17.png)                                                                      |
| Writing, iPhone 16e | [Long-entry keyboard toolbar](ui-ux/editor-keyboard-iphone16e.png)                                                                    |
| Diary               | [Initial spacing and note cards](ui-ux/diary-iphone17.png)                                                                            |
| Reveal              | [Ready capsule](ui-ux/reveal-ready-iphone17.png), [annual library](ui-ux/reveal-library-iphone17.png)                                 |
| Checkpoint          | [Day 31 grid](ui-ux/checkpoint-day31-iphone17.png), [smaller phone in dark mode](ui-ux/checkpoint-day31-dark-iphone16e.png)           |
| Reader attachments  | [Private image and completed audio playback, dark mode](ui-ux/reader-attachments-dark-iphone16e.png)                                  |
| Settings            | [Account and notification controls](ui-ux/settings-account-iphone17.png), [dark largest text](ui-ux/settings-large-text-iphone17.png) |

The original Notion screenshots contain personal text and are intentionally kept out of the repository. Compare these artifacts with their IMG references in the first table.

### Repeat before release

Run the same screen checks in light/dark appearance at normal and larger text sizes on both devices. For writing, use several pages of text, move the caret to the middle, insert lines, dismiss/refocus the keyboard, and check the whole toolbar. Exercise Save Draft, new-note Publish, edit Save Changes, attachment retry and cancellation. For schedules, stage a different timezone and Cancel, then reopen to confirm the original saved zone. Schedule a checkpoint a minute ahead to inspect both sealed and ready states.

Run required repository checks after further changes:

```bash
npm run validate
npm run test:edge
# Disposable local PostgreSQL database only; this runner drops its fixture schemas.
LOVE_CAPSULE_TEST_DB=postgresql://localhost/lovecapsule_test_local python3 scripts/test_database.py
LOVE_CAPSULE_TEST_DB=postgresql://localhost/lovecapsule_test_local python3 scripts/generate_database_types.py --check
```

## Physical iPhone checks deferred at the user's request

Connect an iPhone to this Mac, unlock it, trust the Mac if prompted, and enable **Settings → Privacy & Security → Developer Mode**. In Xcode open `ios/LoveCapsule.xcworkspace`, choose the LoveCapsule target, select your development team under Signing & Capabilities, and choose the connected phone as the run destination. Run the app using staging configuration and keep the phone/Mac on the same network; for a physical phone start Metro with `npm start -- --dev-client --lan` rather than localhost. The current bundle ID is shared with the existing app, so use a dedicated test phone or configure a separate staging bundle ID before installing alongside an existing production app.

On that phone, verify caret/toolbar behavior, camera/photo permissions, audio recording/playback/interruption, keyboard dismissal/refocus, and notification Enable/Disable permissions. Real push delivery additionally needs staging workers and valid APNs/Expo credentials from the [rollout guide](reveal-rollout.md). Simulator checks and automated tests do not complete those physical-device checks.
