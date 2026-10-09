import 'dart:math';
import 'dart:typed_data';
import 'package:pointycastle/pointycastle.dart';
import 'package:pointycastle/block/aes.dart';
import 'package:pointycastle/block/modes/gcm.dart';

/// Core AES-256-GCM encryption/decryption service.
/// All operations are in-memory only.
class CryptoService {
  // The operating system's CSPRNG. Every key and IV this app generates comes
  // from here; nothing is ever seeded from the clock.
  static final Random _random = Random.secure();

  /// Cryptographically secure random bytes.
  static Uint8List randomBytes(int length) {
    final out = Uint8List(length);
    for (var i = 0; i < length; i++) {
      out[i] = _random.nextInt(256);
    }
    return out;
  }

  /// Generate a random 32-byte key.
  static Uint8List generateKey() => randomBytes(32);

  /// Generate a random IV/nonce (12 bytes for GCM).
  static Uint8List generateIv() => randomBytes(12);

  /// Encrypt data with AES-256-GCM.
  /// Returns: encrypted bytes with 16-byte auth tag appended.
  /// [aad] binds the ciphertext to the ids it belongs to (see aad.dart).
  static Uint8List encrypt({
    required Uint8List plaintext,
    required Uint8List key,
    required Uint8List iv,
    Uint8List? aad,
  }) {
    final cipher = GCMBlockCipher(AESEngine());
    final params = AEADParameters(
      KeyParameter(key),
      128, // tag length in bits
      iv,
      aad ?? Uint8List(0),
    );
    cipher.init(true, params); // true = encrypt

    final output = Uint8List(plaintext.length + 16); // +16 for auth tag
    var offset = 0;
    offset +=
        cipher.processBytes(plaintext, 0, plaintext.length, output, offset);
    offset += cipher.doFinal(output, offset);

    return output.sublist(0, offset);
  }

  /// Decrypt data with AES-256-GCM.
  /// Input: encrypted bytes with 16-byte auth tag appended.
  /// Throws if the key or [aad] is wrong, or the data was tampered with.
  static Uint8List decrypt({
    required Uint8List ciphertext,
    required Uint8List key,
    required Uint8List iv,
    Uint8List? aad,
  }) {
    final cipher = GCMBlockCipher(AESEngine());
    final params = AEADParameters(
      KeyParameter(key),
      128,
      iv,
      aad ?? Uint8List(0),
    );
    cipher.init(false, params); // false = decrypt

    final output = Uint8List(ciphertext.length);
    var offset = 0;
    offset +=
        cipher.processBytes(ciphertext, 0, ciphertext.length, output, offset);
    offset += cipher.doFinal(output, offset);

    return output.sublist(0, offset);
  }

  /// Wrap one key under another (envelope encryption).
  static ({Uint8List wrapped, Uint8List nonce}) wrapKey({
    required Uint8List key,
    required Uint8List wrappingKey,
    required Uint8List aad,
  }) {
    final nonce = generateIv();
    final wrapped = encrypt(plaintext: key, key: wrappingKey, iv: nonce, aad: aad);
    return (wrapped: wrapped, nonce: nonce);
  }

  /// Unwrap a key. Throws when [wrappingKey] or [aad] is not what it was
  /// wrapped with.
  static Uint8List unwrapKey({
    required Uint8List wrapped,
    required Uint8List wrappingKey,
    required Uint8List nonce,
    required Uint8List aad,
  }) {
    return decrypt(ciphertext: wrapped, key: wrappingKey, iv: nonce, aad: aad);
  }

  static void zero(Uint8List bytes) => bytes.fillRange(0, bytes.length, 0);
}
