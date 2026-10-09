import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/crypto/crypto_service.dart';
import 'package:kura_vault/core/crypto/key_derivation.dart';

String _b64(Uint8List b) => base64.encode(b);

Uint8List _salt(int seed) =>
    Uint8List.fromList(List<int>.generate(16, (i) => (seed * 31 + i) & 0xff));

/// Build a VaultInfo exactly the way the real vault-creation path does:
/// KEK = Argon2id(passphrase, salt); kek_verify = AES-GCM(vault UUID, KEK).
Future<VaultInfo> makeVault({
  required String id,
  required String passphrase,
  required Uint8List salt,
  String? label,
}) async {
  final kek = await KeyDerivation.deriveKek(passphrase: passphrase, salt: salt);
  final nonce = CryptoService.generateIv();
  final verify = CryptoService.encrypt(
    plaintext: Uint8List.fromList(utf8.encode(id)),
    key: kek,
    iv: nonce,
  );

  String? labelEnc;
  String? labelNonce;
  if (label != null) {
    final ln = CryptoService.generateIv();
    labelEnc = _b64(CryptoService.encrypt(
      plaintext: Uint8List.fromList(utf8.encode(label)),
      key: kek,
      iv: ln,
    ));
    labelNonce = _b64(ln);
  }

  return VaultInfo(
    id: id,
    kekSalt: _b64(salt),
    kekVerify: _b64(verify),
    kekVerifyNonce: _b64(nonce),
    labelEncrypted: labelEnc,
    labelNonce: labelNonce,
  );
}

bool _isAllZero(Uint8List b) => b.every((x) => x == 0);

void main() {
  const idA = '11111111-1111-1111-1111-111111111111';
  const idB = '22222222-2222-2222-2222-222222222222';
  const idC = '33333333-3333-3333-3333-333333333333';

  group('findMatches', () {
    test('same passphrase on two vaults returns BOTH matches', () async {
      // The core case: distinct salts mean distinct KEKs, so each vault
      // verifies independently. Not a collision.
      final a = await makeVault(
          id: idA, passphrase: 'shared-pass', salt: _salt(1), label: 'Family');
      final b = await makeVault(
          id: idB, passphrase: 'shared-pass', salt: _salt(2), label: 'Work');

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared-pass', vaults: [a, b]);

      expect(matches.length, 2);
      expect(matches.map((m) => m.vaultId), [idA, idB]);
      expect(matches.map((m) => m.label), ['Family', 'Work']);
    });

    test('distinct passphrases yield exactly one match', () async {
      final a = await makeVault(
          id: idA, passphrase: 'pass-a', salt: _salt(1), label: 'Family');
      final b = await makeVault(
          id: idB, passphrase: 'pass-b', salt: _salt(2), label: 'Work');

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'pass-a', vaults: [a, b]);

      expect(matches.length, 1);
      expect(matches.single.vaultId, idA);
    });

    test('wrong passphrase yields no matches and stays locked', () async {
      final a = await makeVault(id: idA, passphrase: 'pass-a', salt: _salt(1));

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'nope', vaults: [a]);

      expect(matches, isEmpty);
      expect(cubit.state.isUnlocked, isFalse);
      expect(cubit.state.kek, isNull);
    });

    test('falls back to a positional label, never the vault UUID', () async {
      // Unlabelled vault: the picker must not display the UUID, which is a
      // stable identifier an observer could correlate.
      final a = await makeVault(id: idA, passphrase: 'shared', salt: _salt(1));

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared', vaults: [a]);

      expect(matches.single.label, 'Vault 1');
      expect(matches.single.label, isNot(contains(idA)));
    });

    test('scans every vault with no early exit', () async {
      // Match sits FIRST; a third vault still has to be evaluated, proving
      // the loop does not stop at the first success.
      final a = await makeVault(id: idA, passphrase: 'shared', salt: _salt(1));
      final b = await makeVault(id: idB, passphrase: 'other', salt: _salt(2));
      final c = await makeVault(id: idC, passphrase: 'shared', salt: _salt(3));

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared', vaults: [a, b, c]);

      expect(matches.map((m) => m.vaultId), [idA, idC]);
    });
  });

  group('key hygiene', () {
    test('selectVault zeroes the KEKs of unchosen matches', () async {
      final a = await makeVault(
          id: idA, passphrase: 'shared', salt: _salt(1), label: 'Family');
      final b = await makeVault(
          id: idB, passphrase: 'shared', salt: _salt(2), label: 'Work');

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared', vaults: [a, b]);
      final chosen = matches.first;
      final other = matches.last;

      cubit.selectVault(chosen, matches);

      expect(_isAllZero(other.kek), isTrue, reason: 'unchosen KEK must be zeroed');
      expect(_isAllZero(chosen.kek), isFalse, reason: 'chosen KEK stays live');
      expect(cubit.state.activeVaultId, idA);
      expect(cubit.state.isUnlocked, isTrue);
      expect(cubit.state.cacheKey, isNotNull);
    });

    test('discardMatches zeroes every KEK', () async {
      final a = await makeVault(id: idA, passphrase: 'shared', salt: _salt(1));
      final b = await makeVault(id: idB, passphrase: 'shared', salt: _salt(2));

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared', vaults: [a, b]);

      cubit.discardMatches(matches);

      expect(matches.every((m) => _isAllZero(m.kek)), isTrue);
      expect(cubit.state.isUnlocked, isFalse);
    });

    test('lock wipes KEK and cache key', () async {
      final a = await makeVault(id: idA, passphrase: 'shared', salt: _salt(1));

      final cubit = VaultCryptoCubit();
      final matches =
          await cubit.findMatches(passphrase: 'shared', vaults: [a]);
      cubit.selectVault(matches.single, matches);

      final kek = cubit.state.kek!;
      final cacheKey = cubit.state.cacheKey!;
      cubit.lock();

      expect(_isAllZero(kek), isTrue);
      expect(_isAllZero(cacheKey), isTrue);
      expect(cubit.state.isUnlocked, isFalse);
      expect(cubit.state.activeVaultId, isNull);
    });
  });
}
