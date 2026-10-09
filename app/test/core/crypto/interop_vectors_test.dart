import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/crypto/crypto_service.dart';
import 'package:kura_vault/core/crypto/key_derivation.dart';

/// Recomputes every entry of crypto-vectors.json (written by the web client's
/// implementation) with this app's crypto. Passing proves the web client, the
/// migration CLI and this app read and write the same bytes.
Uint8List _hex(String s) => Uint8List.fromList(
    [for (var i = 0; i < s.length; i += 2) int.parse(s.substring(i, i + 2), radix: 16)]);

String _toHex(Uint8List b) =>
    b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

Uint8List _b64(String s) => Uint8List.fromList(base64.decode(s));

void main() {
  final vectors = jsonDecode(
    File('../crypto-vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  group('interop vectors', () {
    test('Argon2id KEK derivation matches', () async {
      for (final v in vectors['kdf'] as List<dynamic>) {
        final kek = await KeyDerivation.deriveKek(
          passphrase: v['passphrase'] as String,
          salt: _b64(v['salt'] as String),
        );
        expect(_toHex(kek), v['kek'], reason: 'passphrase ${v['passphrase']}');
      }
    });

    test('AES-256-GCM encrypt and decrypt match', () {
      for (final v in vectors['gcm'] as List<dynamic>) {
        final key = _hex(v['key'] as String);
        final iv = _b64(v['iv'] as String);
        final plaintext = _b64(v['plaintext'] as String);
        final ciphertext = _b64(v['ciphertext'] as String);

        expect(
          CryptoService.encrypt(plaintext: plaintext, key: key, iv: iv),
          ciphertext,
        );
        expect(
          CryptoService.decrypt(ciphertext: ciphertext, key: key, iv: iv),
          plaintext,
        );
      }
    });

    test('a web-created vault unlocks and its media decrypts', () async {
      final vault = vectors['vault'] as Map<String, dynamic>;
      final media = vectors['media'] as Map<String, dynamic>;
      final cubit = VaultCryptoCubit();

      final matches = await cubit.findMatches(
        passphrase: vault['passphrase'] as String,
        vaults: [VaultInfo.fromJson(vault)],
      );
      expect(matches, hasLength(1));
      expect(matches.single.vaultId, vault['id']);
      expect(matches.single.label, vault['label']);

      cubit.selectVault(matches.single, matches);

      final thumb = cubit.decryptMedia(
        encryptedBlob: _b64(media['thumbCiphertext'] as String),
        encryptedDekB64: media['encryptedDek'] as String,
        dekNonceB64: media['dekNonce'] as String,
        ivB64: media['thumbIv'] as String,
      );
      expect(thumb, _b64(media['thumbPlaintext'] as String));

      final meta = CryptoService.decrypt(
        ciphertext: _b64(media['encryptedMeta'] as String),
        key: cubit.state.kek!,
        iv: _b64(media['metaNonce'] as String),
      );
      expect(utf8.decode(meta), media['meta']);

      final wrong = await cubit.findMatches(
        passphrase: '${vault['passphrase']}x',
        vaults: [VaultInfo.fromJson(vault)],
      );
      expect(wrong, isEmpty);
      await cubit.close();
    });
  });
}
