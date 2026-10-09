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
    int memoryKB = 65536, // 64MB
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
      argon2.deriveKey(passwordBytes, 0, result, 0);

      return result;
    });
  }

  /// Generate a random salt (16 bytes).
  static Uint8List generateSalt() {
    final secureRandom = SecureRandom('Fortuna')
      ..seed(KeyParameter(
        Uint8List.fromList(
          List<int>.generate(
              32, (_) => DateTime.now().microsecondsSinceEpoch % 256),
        ),
      ));
    return secureRandom.nextBytes(16);
  }
}
