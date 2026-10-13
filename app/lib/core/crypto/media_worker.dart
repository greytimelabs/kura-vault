import 'dart:isolate';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';
import 'crypto_service.dart';
import 'models.dart';

/// AES-GCM over whole files, off the UI isolate.
///
/// Uses the `cryptography` package's pure-Dart AES-GCM, which is about ten
/// times faster than [CryptoService] on large inputs and produces the same
/// bytes (the interop tests check both against the shared vectors).
///
/// Only one item's key ever crosses into the worker: vault and album keys stay
/// in the isolate that holds the keyring. The worker gets its own copy of the
/// item key and zeroes it before returning; the caller zeroes theirs.
class MediaWorker {
  static const int _tagLength = 16;
  static final _gcm = DartAesGcm.with256bits();

  /// Encrypt each of [tiers] (by tier name) under [key], each with a fresh IV
  /// and the additional data given for it in [aads].
  static Future<Map<String, EncryptedTier>> encryptTiers({
    required Uint8List key,
    required Map<String, Uint8List> tiers,
    required Map<String, Uint8List> aads,
  }) {
    // Moved rather than copied on the way in; the result is moved on the way out
    final names = tiers.keys.toList();
    final data = [
      for (final name in names) TransferableTypedData.fromList([tiers[name]!]),
    ];
    final additional = [for (final name in names) aads[name]!];
    final keyCopy = Uint8List.fromList(key);
    return Isolate.run(() async {
      final secretKey = SecretKeyData(keyCopy, overwriteWhenDestroyed: true);
      try {
        final out = <String, EncryptedTier>{};
        for (var i = 0; i < names.length; i++) {
          final iv = CryptoService.generateIv();
          final box = await _gcm.encrypt(
            data[i].materialize().asUint8List(),
            secretKey: secretKey,
            nonce: iv,
            aad: additional[i],
          );
          // Ciphertext with the 16-byte tag appended, as everywhere else
          final blob = Uint8List(box.cipherText.length + box.mac.bytes.length)
            ..setAll(0, box.cipherText)
            ..setAll(box.cipherText.length, box.mac.bytes);
          out[names[i]] = (data: blob, iv: b64e(iv));
        }
        return out;
      } finally {
        secretKey.destroy();
        CryptoService.zero(keyCopy);
      }
    }).whenComplete(() => CryptoService.zero(keyCopy));
  }

  /// Decrypt one blob. Throws when the key, IV or [aad] is not what it was
  /// encrypted with, or the data was changed.
  static Future<Uint8List> decrypt({
    required Uint8List key,
    required Uint8List iv,
    required Uint8List aad,
    required Uint8List ciphertext,
  }) {
    final data = TransferableTypedData.fromList([ciphertext]);
    final keyCopy = Uint8List.fromList(key);
    return Isolate.run(() async {
      final secretKey = SecretKeyData(keyCopy, overwriteWhenDestroyed: true);
      try {
        final blob = data.materialize().asUint8List();
        if (blob.length < _tagLength) throw ArgumentError('Too short');
        final split = blob.length - _tagLength;
        final plain = await _gcm.decrypt(
          SecretBox(
            Uint8List.sublistView(blob, 0, split),
            nonce: iv,
            mac: Mac(Uint8List.sublistView(blob, split)),
          ),
          secretKey: secretKey,
          aad: aad,
        );
        return plain is Uint8List ? plain : Uint8List.fromList(plain);
      } finally {
        secretKey.destroy();
        CryptoService.zero(keyCopy);
      }
    }).whenComplete(() => CryptoService.zero(keyCopy));
  }
}
