import 'dart:typed_data';
import 'package:pointycastle/digests/sha256.dart';
import 'crypto_service.dart';

/// Derives a cache encryption key from the key of whatever is open (a vault
/// key, or an album key when only an album is shared).
/// Cache key is used to encrypt thumbnails stored on local disk.
class CacheCrypto {
  /// Derive cache key from the open vault or album key.
  /// Deterministic: the same key always produces the same cache key.
  static Uint8List deriveCacheKey(Uint8List kek) {
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
