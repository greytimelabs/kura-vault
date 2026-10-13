# Kura Vault mobile app

Flutter client for [Kura Vault](../README.md). It unlocks vaults with a
passphrase, decrypts media on the device, and shows it as a timeline and
albums.

## Run

```bash
flutter pub get
flutter run
```

The app asks for the server address at first launch; nothing is compiled in.
For a local backend use `http://10.0.2.2:3000` on the Android emulator,
`http://localhost:3000` on the iOS simulator, or your machine's LAN address on
a physical device. Backend setup is in
[docs/getting-started.md](../docs/getting-started.md).

## Layout

| Path | Contents |
|---|---|
| `lib/core/crypto/` | Argon2id key derivation, AES-256-GCM, X25519 sealing and Ed25519 signatures, cache encryption |
| `lib/core/accounts/` | Saved accounts (server + username), the active one, per-account tokens |
| `lib/core/server/` | Server address parsing and the http-only-on-local-networks rule |
| `lib/core/network/` | API client, endpoints, auth and error interceptors |
| `lib/core/storage/` | Secure storage, the encrypted thumbnail cache, preferences, clean-up of picked files |
| `lib/core/platform/` | Channels to the native code in `android/` and `ios/`: image processing, saving a file to the device, the key kept behind a fingerprint or face |
| `lib/core/security/` | When fingerprint or face unlock is on offer, and when the master passphrase is asked for again |
| `lib/core/widgets/` | The confirmation asked before anything is deleted |
| `lib/blocs/` | Cubits: auth, vault, crypto, media, album, selection, upload |
| `lib/features/` | Screens and widgets by feature: auth, gallery, albums, viewer, upload, sharing, users, settings |
| `integration_test/` | The app against a real backend and the web client's crypto (see [getting started](../docs/getting-started.md#tests)) |
| `lib/routing/` | Routes (`go_router`) |

## Test

```bash
flutter analyze
flutter test
```

`test/core/crypto/interop_vectors_test.dart` checks this implementation
against the shared vectors in `crypto-vectors.json` at the repository root, so
the app stays compatible with the web client and the migration CLI. See
[docs/crypto/README.md](../docs/crypto/README.md).
