# Kura Vault mobile app

Flutter client for [Kura Vault](../README.md). It unlocks vaults with a
passphrase, decrypts media on the device, and shows it as a timeline and
albums.

## Run

```bash
flutter pub get
flutter run
```

The API address is the `baseUrl` constant in
`lib/core/network/api_endpoints.dart`. It defaults to
`http://localhost:3000/api/v1`; use your machine's LAN address on a physical
device. Backend setup is in
[docs/getting-started.md](../docs/getting-started.md).

## Layout

| Path | Contents |
|---|---|
| `lib/core/crypto/` | Argon2id key derivation, AES-256-GCM, cache encryption |
| `lib/core/network/` | API client, endpoints, auth and error interceptors |
| `lib/core/storage/` | Secure storage and the encrypted thumbnail cache |
| `lib/blocs/` | Cubits: auth, vault, crypto, media, album |
| `lib/features/` | Screens and widgets by feature: auth, gallery, albums, viewer, settings |
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
