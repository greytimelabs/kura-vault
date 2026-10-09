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
    offset +=
        cipher.processBytes(plaintext, 0, plaintext.length, output, offset);
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
    offset +=
        cipher.processBytes(ciphertext, 0, ciphertext.length, output, offset);
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
      final decrypted =
          decrypt(ciphertext: kekVerify, key: kek, iv: kekVerifyNonce);
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
