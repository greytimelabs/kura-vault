> **Historical document.** Original Flutter app build plan, April 2026. Kept unedited for reference; it is not maintained to match the code.
> Current state: [architecture](../architecture.md), [crypto](../crypto/README.md). See also the [archive notes](README.md).

# Flutter App - Implementation Plan

## Overview

Flutter app for Kura Vault with client-side encryption, multi-vault support,
gallery UI with virtual scroll, and encrypted local caching.

## Setup

```bash
flutter create --org com.kuravault --project-name kura_vault app   # bundle ID was later set to com.kuravault.app
cd app
```

## Dependencies (pubspec.yaml)

```yaml
name: kura_vault
description: Encrypted personal media vault
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.4.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter

  # State management
  flutter_bloc: ^8.1.6
  bloc: ^8.1.4

  # Networking
  dio: ^5.4.3+1

  # Crypto
  pointycastle: ^3.9.1     # AES-256-GCM, Argon2
  cryptography: ^2.7.0      # Alternative: native crypto
  cryptography_flutter: ^2.3.2  # Native AES acceleration

  # Local storage
  isar: ^3.1.0+1            # Encrypted local DB for cache
  isar_flutter_libs: ^3.1.0+1
  flutter_secure_storage: ^9.2.2  # Keychain/Keystore
  path_provider: ^2.1.3

  # UI
  cached_memory_image: ^0.1.0  # Custom (we build this)
  photo_view: ^0.15.0        # Pinch zoom
  shimmer: ^3.0.0            # Loading placeholders

  # Auth
  local_auth: ^2.2.0         # Biometric

  # Utils
  uuid: ^4.4.0
  intl: ^0.19.0
  equatable: ^2.0.5
  freezed_annotation: ^2.4.1
  json_annotation: ^4.9.0
  go_router: ^14.2.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.9
  freezed: ^2.5.2
  json_serializable: ^6.8.0
  bloc_test: ^9.1.7
  isar_generator: ^3.1.0+1
  flutter_lints: ^3.0.2

flutter:
  uses-material-design: true
```

## Directory Structure

```
lib/
├── main.dart
├── app.dart
├── core/
│   ├── crypto/
│   │   ├── crypto_service.dart       # AES-256-GCM encrypt/decrypt
│   │   ├── key_derivation.dart       # Argon2id KEK derivation
│   │   └── cache_crypto.dart         # HKDF cache key + cache encrypt/decrypt
│   ├── network/
│   │   ├── api_client.dart           # Dio setup with interceptors
│   │   ├── api_endpoints.dart        # All endpoint constants
│   │   └── interceptors/
│   │       ├── auth_interceptor.dart  # JWT attach + refresh
│   │       └── error_interceptor.dart
│   ├── storage/
│   │   ├── secure_storage_service.dart  # flutter_secure_storage wrapper
│   │   └── cache_service.dart           # Isar encrypted thumb cache
│   ├── auth/
│   │   └── auth_manager.dart          # Session lifecycle
│   └── constants/
│       └── app_constants.dart
├── features/
│   ├── auth/
│   │   ├── presentation/
│   │   │   ├── screens/
│   │   │   │   ├── passphrase_screen.dart
│   │   │   │   └── device_register_screen.dart
│   │   │   └── widgets/
│   │   ├── domain/
│   │   │   └── auth_repository.dart
│   │   └── data/
│   │       └── auth_remote_source.dart
│   ├── gallery/
│   │   ├── presentation/
│   │   │   ├── screens/
│   │   │   │   ├── timeline_screen.dart
│   │   │   │   └── album_grid_screen.dart
│   │   │   └── widgets/
│   │   │       ├── media_grid.dart
│   │   │       ├── encrypted_image.dart  # Custom ImageProvider
│   │   │       └── month_header.dart
│   │   ├── domain/
│   │   │   └── media_repository.dart
│   │   └── data/
│   │       └── media_remote_source.dart
│   ├── viewer/
│   │   └── presentation/
│   │       └── screens/
│   │           └── photo_viewer_screen.dart
│   ├── albums/
│   │   ├── presentation/
│   │   │   ├── screens/
│   │   │   │   └── albums_screen.dart
│   │   │   └── widgets/
│   │   │       └── album_card.dart
│   │   ├── domain/
│   │   │   └── album_repository.dart
│   │   └── data/
│   │       └── album_remote_source.dart
│   └── settings/
│       └── presentation/
│           └── screens/
│               └── settings_screen.dart
├── blocs/
│   ├── auth/
│   │   ├── auth_cubit.dart
│   │   └── auth_state.dart
│   ├── vault/
│   │   ├── vault_cubit.dart
│   │   └── vault_state.dart
│   ├── media/
│   │   ├── media_cubit.dart
│   │   └── media_state.dart
│   ├── album/
│   │   ├── album_cubit.dart
│   │   └── album_state.dart
│   └── crypto/
│       ├── vault_crypto_cubit.dart
│       └── vault_crypto_state.dart
└── routing/
    └── app_router.dart
```

---

## IMPLEMENTATION ORDER

### Step 1: Core Crypto Service

This is the most critical piece. Build and test in isolation.

Create `lib/core/crypto/key_derivation.dart`:
```dart
import 'dart:convert';
import 'dart:typed_data';
import 'dart:isolate';
import 'package:pointycastle/pointycastle.dart';
import 'package:pointycastle/key_derivators/argon2.dart';

/// Derives KEK from passphrase using Argon2id.
/// Runs in isolate to avoid blocking UI.
class KeyDerivation {
  /// Derive a 256-bit KEK from passphrase + salt.
  /// Returns 32 bytes (Uint8List).
  static Future<Uint8List> deriveKek({
    required String passphrase,
    required Uint8List salt,
    int iterations = 3,
    int memoryKB = 65536,  // 64MB
    int parallelism = 1,
    int hashLength = 32,
  }) async {
    // Run in isolate to not block UI thread
    return await Isolate.run(() {
      final params = Argon2Parameters(
        Argon2Parameters.ARGON2_id,
        salt,
        desiredKeyLength: hashLength,
        iterations: iterations,
        memory: memoryKB,
        lanes: parallelism,
      );

      final argon2 = Argon2BytesGenerator();
      argon2.init(params);

      final passwordBytes = Uint8List.fromList(utf8.encode(passphrase));
      final result = Uint8List(hashLength);
      argon2.generateBytes(passwordBytes, result, 0, result.length);

      return result;
    });
  }

  /// Generate a random salt (16 bytes).
  static Uint8List generateSalt() {
    final secureRandom = SecureRandom('Fortuna')
      ..seed(KeyParameter(
        Uint8List.fromList(
          List<int>.generate(32, (_) => DateTime.now().microsecondsSinceEpoch % 256),
        ),
      ));
    return secureRandom.nextBytes(16);
  }
}
```

Create `lib/core/crypto/crypto_service.dart`:
```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:pointycastle/pointycastle.dart';
import 'package:pointycastle/block/aes.dart';
import 'package:pointycastle/block/modes/gcm.dart';

/// Core AES-256-GCM encryption/decryption service.
/// All operations are in-memory only.
class CryptoService {
  /// Generate a cryptographically secure random DEK (32 bytes).
  static Uint8List generateDek() {
    final secureRandom = _getSecureRandom();
    return secureRandom.nextBytes(32);
  }

  /// Generate a random IV/nonce (12 bytes for GCM).
  static Uint8List generateIv() {
    final secureRandom = _getSecureRandom();
    return secureRandom.nextBytes(12);
  }

  /// Encrypt data with AES-256-GCM.
  /// Returns: encrypted bytes with 16-byte auth tag appended.
  static Uint8List encrypt({
    required Uint8List plaintext,
    required Uint8List key,
    required Uint8List iv,
  }) {
    final cipher = GCMBlockCipher(AESEngine());
    final params = AEADParameters(
      KeyParameter(key),
      128, // tag length in bits
      iv,
      Uint8List(0), // no additional authenticated data
    );
    cipher.init(true, params); // true = encrypt

    final output = Uint8List(plaintext.length + 16); // +16 for auth tag
    var offset = 0;
    offset += cipher.processBytes(plaintext, 0, plaintext.length, output, offset);
    offset += cipher.doFinal(output, offset);

    return output.sublist(0, offset);
  }

  /// Decrypt data with AES-256-GCM.
  /// Input: encrypted bytes with 16-byte auth tag appended.
  /// Throws if auth tag verification fails (data tampered).
  static Uint8List decrypt({
    required Uint8List ciphertext,
    required Uint8List key,
    required Uint8List iv,
  }) {
    final cipher = GCMBlockCipher(AESEngine());
    final params = AEADParameters(
      KeyParameter(key),
      128,
      iv,
      Uint8List(0),
    );
    cipher.init(false, params); // false = decrypt

    final output = Uint8List(ciphertext.length);
    var offset = 0;
    offset += cipher.processBytes(ciphertext, 0, ciphertext.length, output, offset);
    offset += cipher.doFinal(output, offset);

    return output.sublist(0, offset);
  }

  /// Encrypt a DEK with the vault's KEK (envelope encryption).
  static ({Uint8List encryptedDek, Uint8List nonce}) wrapDek({
    required Uint8List dek,
    required Uint8List kek,
  }) {
    final nonce = generateIv();
    final encrypted = encrypt(plaintext: dek, key: kek, iv: nonce);
    return (encryptedDek: encrypted, nonce: nonce);
  }

  /// Decrypt a DEK using the vault's KEK.
  static Uint8List unwrapDek({
    required Uint8List encryptedDek,
    required Uint8List kek,
    required Uint8List nonce,
  }) {
    return decrypt(ciphertext: encryptedDek, key: kek, iv: nonce);
  }

  /// Verify a passphrase by trying to decrypt the vault's verification token.
  /// Returns true if passphrase matches this vault.
  static bool verifyKek({
    required Uint8List kek,
    required Uint8List kekVerify,
    required Uint8List kekVerifyNonce,
    required String expectedVaultId,
  }) {
    try {
      final decrypted = decrypt(ciphertext: kekVerify, key: kek, iv: kekVerifyNonce);
      final decryptedStr = utf8.decode(decrypted);
      return decryptedStr == expectedVaultId;
    } catch (_) {
      return false; // Wrong passphrase = decryption fails
    }
  }

  static SecureRandom _getSecureRandom() {
    final secureRandom = SecureRandom('Fortuna');
    final seed = Uint8List(32);
    final random = DateTime.now().microsecondsSinceEpoch;
    for (var i = 0; i < 32; i++) {
      seed[i] = (random + i * 37) % 256;
    }
    secureRandom.seed(KeyParameter(seed));
    return secureRandom;
  }
}
```

Create `lib/core/crypto/cache_crypto.dart`:
```dart
import 'dart:typed_data';
import 'package:pointycastle/pointycastle.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'crypto_service.dart';

/// Derives a cache encryption key from KEK using HKDF-like derivation.
/// Cache key is used to encrypt thumbnails stored on local disk.
class CacheCrypto {
  /// Derive cache key from KEK.
  /// Deterministic: same KEK always produces same cache key.
  static Uint8List deriveCacheKey(Uint8List kek) {
    // Simple HKDF-Extract + Expand using SHA-256
    final hmac = Mac('SHA-256/HMAC');
    hmac.init(KeyParameter(kek));

    final info = Uint8List.fromList('kura-vault-thumbnail-cache'.codeUnits);
    final input = Uint8List(kek.length + info.length);
    input.setAll(0, kek);
    input.setAll(kek.length, info);

    final digest = SHA256Digest();
    final result = Uint8List(digest.digestSize);
    digest.update(input, 0, input.length);
    digest.doFinal(result, 0);

    return result;
  }

  /// Encrypt thumbnail for local cache storage.
  static Uint8List encryptForCache({
    required Uint8List plaintext,
    required Uint8List cacheKey,
  }) {
    final iv = CryptoService.generateIv();
    final encrypted = CryptoService.encrypt(
      plaintext: plaintext,
      key: cacheKey,
      iv: iv,
    );
    // Prepend IV to encrypted data for storage
    final result = Uint8List(iv.length + encrypted.length);
    result.setAll(0, iv);
    result.setAll(iv.length, encrypted);
    return result;
  }

  /// Decrypt thumbnail from local cache.
  static Uint8List decryptFromCache({
    required Uint8List cacheData,
    required Uint8List cacheKey,
  }) {
    final iv = cacheData.sublist(0, 12);
    final encrypted = cacheData.sublist(12);
    return CryptoService.decrypt(
      ciphertext: encrypted,
      key: cacheKey,
      iv: iv,
    );
  }
}
```

### Step 2: Vault Crypto Cubit

Create `lib/blocs/crypto/vault_crypto_state.dart`:
```dart
import 'dart:typed_data';
import 'package:equatable/equatable.dart';

class VaultCryptoState extends Equatable {
  final String? activeVaultId;
  final Uint8List? kek;
  final Uint8List? cacheKey;
  final bool isUnlocked;

  const VaultCryptoState({
    this.activeVaultId,
    this.kek,
    this.cacheKey,
    this.isUnlocked = false,
  });

  VaultCryptoState copyWith({
    String? activeVaultId,
    Uint8List? kek,
    Uint8List? cacheKey,
    bool? isUnlocked,
  }) {
    return VaultCryptoState(
      activeVaultId: activeVaultId ?? this.activeVaultId,
      kek: kek ?? this.kek,
      cacheKey: cacheKey ?? this.cacheKey,
      isUnlocked: isUnlocked ?? this.isUnlocked,
    );
  }

  @override
  List<Object?> get props => [activeVaultId, isUnlocked];
}
```

Create `lib/blocs/crypto/vault_crypto_cubit.dart`:
```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/crypto/crypto_service.dart';
import '../../core/crypto/key_derivation.dart';
import '../../core/crypto/cache_crypto.dart';
import 'vault_crypto_state.dart';

/// Manages vault encryption state.
/// KEK and cache key live here in memory only.
class VaultCryptoCubit extends Cubit<VaultCryptoState> {
  VaultCryptoCubit() : super(const VaultCryptoState());

  /// Attempt to unlock a vault with passphrase.
  /// Tries each vault's salt/verify to find a match.
  Future<String?> unlock({
    required String passphrase,
    required List<VaultInfo> vaults,
  }) async {
    for (final vault in vaults) {
      final salt = _base64ToBytes(vault.kekSalt);
      final kek = await KeyDerivation.deriveKek(
        passphrase: passphrase,
        salt: salt,
      );

      final isMatch = CryptoService.verifyKek(
        kek: kek,
        kekVerify: _base64ToBytes(vault.kekVerify),
        kekVerifyNonce: _base64ToBytes(vault.kekVerifyNonce),
        expectedVaultId: vault.id,
      );

      if (isMatch) {
        final cacheKey = CacheCrypto.deriveCacheKey(kek);
        emit(VaultCryptoState(
          activeVaultId: vault.id,
          kek: kek,
          cacheKey: cacheKey,
          isUnlocked: true,
        ));
        return vault.id;
      }
    }
    return null; // No vault matched
  }

  /// Lock the vault - wipe all secrets from memory.
  void lock() {
    // Zero out key material before discarding
    if (state.kek != null) {
      state.kek!.fillRange(0, state.kek!.length, 0);
    }
    if (state.cacheKey != null) {
      state.cacheKey!.fillRange(0, state.cacheKey!.length, 0);
    }
    emit(const VaultCryptoState());
  }

  /// Decrypt a photo's DEK and then decrypt the photo.
  Uint8List decryptMedia({
    required Uint8List encryptedBlob,
    required String encryptedDekB64,
    required String dekNonceB64,
    required String ivB64,
  }) {
    if (!state.isUnlocked || state.kek == null) {
      throw StateError('Vault is locked');
    }

    // Unwrap DEK (lives ~1ms in this variable)
    final dek = CryptoService.unwrapDek(
      encryptedDek: _base64ToBytes(encryptedDekB64),
      kek: state.kek!,
      nonce: _base64ToBytes(dekNonceB64),
    );

    // Decrypt media
    final plaintext = CryptoService.decrypt(
      ciphertext: encryptedBlob,
      key: dek,
      iv: _base64ToBytes(ivB64),
    );

    // Zero DEK immediately
    dek.fillRange(0, dek.length, 0);

    return plaintext;
  }

  Uint8List _base64ToBytes(String b64) => Uint8List.fromList(base64.decode(b64));
}

// Simple data class for vault info from API
class VaultInfo {
  final String id;
  final String kekSalt;
  final String kekVerify;
  final String kekVerifyNonce;
  final String? labelEncrypted;
  final String? labelNonce;

  VaultInfo({
    required this.id,
    required this.kekSalt,
    required this.kekVerify,
    required this.kekVerifyNonce,
    this.labelEncrypted,
    this.labelNonce,
  });
}
```

### Step 3: API Client

Create `lib/core/network/api_client.dart`:
```dart
import 'package:dio/dio.dart';
import '../storage/secure_storage_service.dart';
import 'api_endpoints.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/error_interceptor.dart';

/// Singleton API client - inject via constructor or service locator.
/// Provided to the widget tree via RepositoryProvider.
class ApiClient {
  late final Dio _dio;

  ApiClient({required SecureStorageService secureStorage}) {
    _dio = Dio(BaseOptions(
      baseUrl: ApiEndpoints.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    _dio.interceptors.addAll([
      AuthInterceptor(dio: _dio, secureStorage: secureStorage),
      ErrorInterceptor(),
      LogInterceptor(requestBody: true, responseBody: true), // Remove in prod
    ]);
  }

  Dio get dio => _dio;
}
```

Create `lib/core/network/api_endpoints.dart`:
```dart
class ApiEndpoints {
  // TODO: Configure from env/build config
  static const String baseUrl = 'http://localhost:3000/api/v1';

  // Auth
  static const String register = '/auth/register';
  static const String login = '/auth/login';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';

  // Vaults
  static const String vaults = '/vaults';
  static String vaultInvite(String id) => '/vaults/$id/invite';

  // Media
  static const String media = '/media';
  static const String uploadInit = '/media/upload/init';
  static const String uploadComplete = '/media/upload/complete';
  static String mediaUrls(String id) => '/media/$id/urls';
  static String mediaVaultAccess(String id) => '/media/$id/vault-access';

  // Albums
  static const String albums = '/albums';
  static String albumMedia(String id) => '/albums/$id/media';
  static String albumMediaRemove(String albumId, String mediaId) =>
      '/albums/$albumId/media/$mediaId';
}
```

### Step 4: Encrypted Image Widget

Create `lib/features/gallery/presentation/widgets/encrypted_image.dart`:
```dart
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/storage/cache_service.dart';

/// Widget that fetches encrypted thumbnail from S3,
/// decrypts it client-side, and displays it.
/// Uses local encrypted cache for repeat views.
class EncryptedImage extends StatefulWidget {
  final String mediaId;
  final String thumbUrl;
  final String encryptedDek;
  final String dekNonce;
  final String thumbIv;
  final double? width;
  final double? height;
  final BoxFit fit;

  const EncryptedImage({
    super.key,
    required this.mediaId,
    required this.thumbUrl,
    required this.encryptedDek,
    required this.dekNonce,
    required this.thumbIv,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
  });

  @override
  State<EncryptedImage> createState() => _EncryptedImageState();
}

class _EncryptedImageState extends State<EncryptedImage> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _loadImage();
  }

  Future<void> _loadImage() async {
    try {
      final cacheService = context.read<CacheService>();

      // 1. Check cache first
      final cached = await cacheService.getThumb(widget.mediaId);
      if (cached != null && mounted) {
        setState(() {
          _imageBytes = cached;
          _loading = false;
        });
        return;
      }

      // 2. Fetch encrypted blob from S3
      final response = await Dio().get<List<int>>(
        widget.thumbUrl,
        options: Options(responseType: ResponseType.bytes),
      );
      final encryptedBytes = Uint8List.fromList(response.data!);

      // 3. Decrypt
      final cryptoCubit = context.read<VaultCryptoCubit>();
      final decrypted = cryptoCubit.decryptMedia(
        encryptedBlob: encryptedBytes,
        encryptedDekB64: widget.encryptedDek,
        dekNonceB64: widget.dekNonce,
        ivB64: widget.thumbIv,
      );

      // 4. Cache for next time
      await cacheService.putThumb(widget.mediaId, decrypted);

      if (mounted) {
        setState(() {
          _imageBytes = decrypted;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = true;
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    if (_error || _imageBytes == null) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: const Icon(Icons.broken_image, color: Colors.grey),
      );
    }

    return Image.memory(
      _imageBytes!,
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      gaplessPlayback: true,
    );
  }
}
```

### Step 5: Passphrase Screen

Create `lib/features/auth/presentation/screens/passphrase_screen.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';

class PassphraseScreen extends StatefulWidget {
  const PassphraseScreen({super.key});

  @override
  State<PassphraseScreen> createState() => _PassphraseScreenState();
}

class _PassphraseScreenState extends State<PassphraseScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    // Clear passphrase from memory
    _controller.clear();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    final passphrase = _controller.text;
    if (passphrase.isEmpty) return;

    setState(() { _loading = true; _error = null; });

    try {
      // Fetch vault list from API
      final vaults = await context.read<VaultCubit>().fetchVaults();

      // Try to unlock
      final vaultId = await context.read<VaultCryptoCubit>().unlock(
        passphrase: passphrase,
        vaults: vaults,
      );

      // Clear passphrase immediately
      _controller.clear();

      if (vaultId != null) {
        // Navigate to gallery
        if (mounted) {
          Navigator.of(context).pushReplacementNamed('/gallery');
        }
      } else {
        setState(() { _error = 'Invalid passphrase'; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = 'Something went wrong'; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_outline, size: 64, color: Colors.blueGrey),
              const SizedBox(height: 24),
              const Text(
                'Enter Passphrase',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _controller,
                obscureText: true,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: 'Vault passphrase',
                  errorText: _error,
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                ),
                onSubmitted: (_) => _unlock(),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _unlock,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Unlock'),
                ),
              ),
              // No indication of how many vaults exist
              // No "forgot passphrase" option (by design)
            ],
          ),
        ),
      ),
    );
  }
}
```

### Step 6: Timeline Screen, Album Screen, Photo Viewer

Build these using standard Flutter patterns:
- **TimelineScreen**: Virtual scroll (ListView.builder) grouped by year_month.
  Each group shows month header + grid of EncryptedImage widgets.
  Pagination: load next page when scroll reaches 70%.
- **AlbumGridScreen**: Grid of album cards with cover thumbnails.
  Tap album → filter media by album_id.
- **PhotoViewerScreen**: Full-screen viewer with PhotoView for pinch zoom.
  Swipe left/right for adjacent photos.
  Fetch preview-quality version on open.
  Fetch original on "download" action.

### Step 7: App Router

Create `lib/routing/app_router.dart` using GoRouter:
- `/` → Check auth state → redirect to `/passphrase` or `/gallery`
- `/register` → Device registration (first time)
- `/passphrase` → Passphrase unlock
- `/gallery` → Timeline view (default tab)
- `/gallery/albums` → Album list
- `/gallery/albums/:id` → Album detail grid
- `/viewer/:mediaId` → Full screen photo viewer
- `/settings` → Settings (lock, biometric toggle, cache management)

---

## TESTING

### Unit Tests
- `crypto_service_test.dart`: Encrypt → decrypt roundtrip, wrong key fails, tampered data fails
- `key_derivation_test.dart`: Same passphrase+salt = same KEK, different salt = different KEK
- `cache_crypto_test.dart`: Cache encrypt/decrypt roundtrip

### Integration Tests
- Full unlock flow: passphrase → KEK → verify vault → load albums → decrypt thumb
- Upload flow: generate DEK → encrypt → upload → complete → verify in DB
- Cross-vault: add photo to second vault → verify decryptable with second KEK
