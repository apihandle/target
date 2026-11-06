# TARGET Android auto-update

How the Android app (`target-app/`) updates itself, and what has to be set up once.

## How it works

1. **One fixed release key.** Every release APK is signed with the same keystore. It lives only in
   GitHub Actions repo secrets (never in git). Android refuses an update signed by a different key,
   so this key must never change. If it is lost, every user has to uninstall and reinstall.
2. **Release workflow** `.github/workflows/android-release.yml` runs on every push to `main` that
   touches `target-app/**` (or by hand: Actions → Android release → Run workflow). It:
   - builds a signed release APK with `versionCode = github.run_number`, `versionName = 0.1.<run_number>`;
   - checks the signature, package name and versionCode, and computes the SHA-256;
   - writes `version.json`:
     ```json
     {"versionCode": 12, "versionName": "0.1.12", "sha256": "…64 hex…",
      "url": "https://<project>.supabase.co/storage/v1/object/public/app-updates/android/target-12.apk",
      "notes": "last commit subject", "minSdk": 26}
     ```
   - creates the GitHub release `android-v<code>` (APK + version.json) and updates `version.json`
     on the stable release `android-latest`;
   - uploads `android/target-<code>.apk` and then `android/version.json` to the **public Supabase
     Storage bucket `app-updates`** (created automatically). This is what phones read, because the
     GitHub repo is private and its release assets are not downloadable without a token.
   - Pushes to `wip/android-autoupdate` build and verify only; they publish nothing.
3. **In-app updater** (`app/src/main/java/app/target/assistant/update/`):
   - checks on app launch and every ~6 hours (WorkManager, only with a network connection);
   - reads `BuildConfig.UPDATE_MANIFEST_URL`
     (default `https://eauoflkytzrxbyicvfzu.supabase.co/storage/v1/object/public/app-updates/android/version.json`;
     CI sets it from `SUPABASE_URL` when that secret exists);
   - updates only when `versionCode` is higher and the phone meets `minSdk`;
   - downloads to the app cache, verifies the SHA-256, then checks the APK's package name,
     versionCode and signing certificate (SHA-256 of the cert, via `GET_SIGNING_CERTIFICATES`)
     against the installed app; any mismatch stops the update;
   - installs with a `PackageInstaller` session. On Android 12+ it asks for
     `USER_ACTION_NOT_REQUIRED`, so updates are silent once TARGET installed itself at least once.
     On Android 8–11, and for the first self-update after installing the APK from a browser/file
     manager, Android shows its own "Update?" screen (`STATUS_PENDING_USER_ACTION`); if that screen
     cannot open while TARGET is in the background, it opens on the next app launch.
   - Settings (TARGET assistant setup) → **App update**: "Auto-update" toggle (on by default),
     "Abhi check karo" button, current version, and the last result.
   - Debug builds never auto-check (they are signed with a different key and could not install a release).

## Repo secrets

Settings → Secrets and variables → Actions → Repository secrets.

| Secret | What | Who sets it |
|---|---|---|
| `ANDROID_KEYSTORE_B64` | release keystore (PKCS12), base64 | created once with the release key |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password | created once |
| `ANDROID_KEY_ALIAS` | key alias | created once |
| `ANDROID_KEY_PASSWORD` | key password (same as the keystore password for PKCS12) | created once |
| `SUPABASE_URL` | your Supabase project URL, e.g. `https://eauoflkytzrxbyicvfzu.supabase.co` | **you** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role (secret) key; used only in CI to create the bucket and upload | **you** |

Without the two Supabase secrets the workflow still builds, signs and creates the GitHub releases,
but logs a warning and phones cannot download the update. Add them, then re-run the workflow
(Actions → Android release → Run workflow on `main`).

Keep an offline backup of the release keystore and its password somewhere safe outside GitHub
(GitHub secrets cannot be read back).

## First install (one time)

Phones that have the old **debug** build (v0.1 from the "target-assistant-debug" artifact) must
**uninstall it and install the first signed release by hand**: debug and release are signed with
different keys, so Android will not update one into the other. Download `target-<code>.apk` from the
GitHub release `android-v<code>` (or the Supabase public URL in `version.json`), allow "Install
unknown apps" for your browser/file manager, and install. From then on TARGET updates itself.
