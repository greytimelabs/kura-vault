import 'dart:io';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';
import 'package:pointycastle/digests/sha256.dart';
import '../crypto/cache_crypto.dart';

/// Encrypted thumbnail cache stored on local filesystem.
/// Thumbnails are encrypted with a cache key derived from the vault KEK.
///
/// Files are namespaced per vault. A single photo can belong to more than one
/// vault (via media_vault_access), so a flat `<mediaId>.enc` layout would let
/// one vault's cache file be read under another vault's cache key after a
/// lock/unlock cycle: the GCM tag fails, the file is deleted, and every
/// cross-vault photo thrashes the cache forever.
class CacheService {
  Uint8List? _cacheKey;
  String? _cacheDir;

  Future<void> init(Uint8List cacheKey) async {
    _cacheKey = cacheKey;
    final dir = await getApplicationCacheDirectory();
    final root = '${dir.path}/thumbs';

    await _migrateLegacyLayout(root);

    // Namespace by a digest of the cache key rather than the vault UUID:
    // a UUID directory name would write vault identifiers to disk in plaintext
    // and reveal how many vaults exist to anyone with filesystem access.
    _cacheDir = '$root/${_namespace(cacheKey)}';
    await Directory(_cacheDir!).create(recursive: true);
  }

  /// One-time cleanup of the pre-namespacing layout: delete any .enc file
  /// sitting directly in thumbs/. Those entries are orphaned and unreadable;
  /// the only effect is one slower first load.
  Future<void> _migrateLegacyLayout(String root) async {
    final dir = Directory(root);
    if (!await dir.exists()) return;
    try {
      await for (final entity in dir.list(followLinks: false)) {
        if (entity is File && entity.path.endsWith('.enc')) {
          await entity.delete().catchError((_) => entity);
        }
      }
    } catch (_) {
      // Best effort — a failed cleanup must not block unlock.
    }
  }

  /// Directory name for a cache key: first 16 bytes of SHA-256, hex-encoded.
  /// Deterministic per vault, unlinkable to the vault without its KEK.
  static String _namespace(Uint8List cacheKey) {
    final digest = SHA256Digest();
    final out = Uint8List(digest.digestSize);
    digest.update(cacheKey, 0, cacheKey.length);
    digest.doFinal(out, 0);
    return out
        .sublist(0, 16)
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
  }

  /// Get a cached thumbnail (decrypted).
  Future<Uint8List?> getThumb(String mediaId) async {
    if (_cacheKey == null || _cacheDir == null) return null;

    final file = File('$_cacheDir/$mediaId.enc');
    if (!await file.exists()) return null;

    try {
      final encrypted = await file.readAsBytes();
      return CacheCrypto.decryptFromCache(
        cacheData: encrypted,
        cacheKey: _cacheKey!,
      );
    } catch (_) {
      // Cache corruption — delete and return null
      await file.delete().catchError((_) => file);
      return null;
    }
  }

  /// Store a thumbnail (encrypted) to cache.
  Future<void> putThumb(String mediaId, Uint8List plainBytes) async {
    if (_cacheKey == null || _cacheDir == null) return;

    final encrypted = CacheCrypto.encryptForCache(
      plaintext: plainBytes,
      cacheKey: _cacheKey!,
    );

    final file = File('$_cacheDir/$mediaId.enc');
    await file.writeAsBytes(encrypted);
  }

  /// Drop the cached thumbnail of an item that was deleted.
  Future<void> removeThumb(String mediaId) async {
    if (_cacheDir == null) return;
    final file = File('$_cacheDir/$mediaId.enc');
    try {
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Encrypted, and cleared with the rest of the cache at the latest
    }
  }

  /// Clear all cached thumbnails for the active vault.
  Future<void> clearCache() async {
    if (_cacheDir == null) return;
    final dir = Directory(_cacheDir!);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
      await dir.create(recursive: true);
    }
  }

  /// Wipe cache key from memory.
  void dispose() {
    if (_cacheKey != null) {
      _cacheKey!.fillRange(0, _cacheKey!.length, 0);
      _cacheKey = null;
    }
  }
}
