import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/crypto/aad.dart';
import 'package:kura_vault/core/crypto/crypto_service.dart';
import 'package:kura_vault/core/crypto/identity_crypto.dart';
import 'package:kura_vault/core/crypto/key_derivation.dart';

/// Recomputes every entry of crypto-vectors.json (written by the web client's
/// implementation) with this app's crypto. Passing proves the web client, the
/// migration CLI and this app read and write the same bytes.
Uint8List _hex(String s) => Uint8List.fromList(
    [for (var i = 0; i < s.length; i += 2) int.parse(s.substring(i, i + 2), radix: 16)]);

String _toHex(Uint8List b) =>
    b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

Uint8List _utf8(String s) => Uint8List.fromList(utf8.encode(s));

void main() {
  final vectors = jsonDecode(
    File('../crypto-vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final owner = vectors['users']['owner'] as Map<String, dynamic>;
  final member = vectors['users']['member'] as Map<String, dynamic>;
  final ownerSignPk = b64d(owner['publicSignKey'] as String);
  final vault = vectors['vault'] as Map<String, dynamic>;
  final album = vectors['album'] as Map<String, dynamic>;
  final media = vectors['media'] as Map<String, dynamic>;
  final account = vectors['account'] as Map<String, dynamic>;

  AccountKeys accountOf(Map<String, dynamic> user, {String? kdfSalt, String? enc, String? nonce}) =>
      AccountKeys(
        id: user['userId'] as String,
        kdfSalt: kdfSalt ?? account['kdfSalt'] as String,
        encryptedPrivateKeys: enc ?? account['encryptedPrivateKeys'] as String,
        privateKeysNonce: nonce ?? account['privateKeysNonce'] as String,
        publicEncKey: user['publicEncKey'] as String,
        publicSignKey: user['publicSignKey'] as String,
      );

  group('interop vectors', () {
    test('Argon2id derivation matches', () async {
      for (final v in vectors['kdf'] as List<dynamic>) {
        final key = await KeyDerivation.deriveKek(
          passphrase: v['passphrase'] as String,
          salt: b64d(v['salt'] as String),
        );
        expect(_toHex(key), v['kek'], reason: 'passphrase ${v['passphrase']}');
      }
    });

    test('AES-256-GCM matches, with and without additional data', () {
      for (final v in vectors['gcm'] as List<dynamic>) {
        final key = _hex(v['key'] as String);
        final iv = b64d(v['iv'] as String);
        final aad = v['aad'] == null ? null : _utf8(v['aad'] as String);
        final plaintext = b64d(v['plaintext'] as String);

        final encrypted = CryptoService.encrypt(plaintext: plaintext, key: key, iv: iv, aad: aad);
        expect(b64e(encrypted), v['ciphertext']);
        expect(
          CryptoService.decrypt(ciphertext: b64d(v['ciphertext'] as String), key: key, iv: iv, aad: aad),
          plaintext,
        );
      }
    });

    test('public keys are derived the same way', () async {
      for (final user in [owner, member]) {
        expect(b64e(await IdentityCrypto.encPublicOf(b64d(user['encSk'] as String))), user['publicEncKey']);
        expect(b64e(await IdentityCrypto.signPublicOf(b64d(user['signSk'] as String))), user['publicSignKey']);
      }
    });

    test('sealing produces and opens the same bytes', () async {
      final v = vectors['seal'] as Map<String, dynamic>;
      final aad = _utf8(v['aad'] as String);
      final sealed = await IdentityCrypto.seal(
        recipientPk: b64d(v['recipientEncPk'] as String),
        plaintext: _utf8(v['plaintext'] as String),
        aad: aad,
        ephSk: b64d(v['ephSk'] as String),
        iv: b64d(v['iv'] as String),
      );
      expect(b64e(sealed), v['sealed']);

      final opened = await IdentityCrypto.open(
        encSk: b64d(v['recipientEncSk'] as String),
        encPk: b64d(v['recipientEncPk'] as String),
        sealed: b64d(v['sealed'] as String),
        aad: aad,
      );
      expect(utf8.decode(opened), v['plaintext']);
    });

    test('certificates verify and are reproduced', () async {
      for (final user in [owner, member]) {
        final keys = UserKeys.fromJson(user);
        expect(await IdentityCrypto.verifyCert(ownerSignPk, keys), true);
        expect(await IdentityCrypto.signCert(b64d(owner['signSk'] as String), keys), user['keyCert']);
      }
    });

    test('the private bundle opens and re-encrypts to the same bytes', () async {
      final masterKey = await KeyDerivation.deriveKek(
        passphrase: account['passphrase'] as String,
        salt: b64d(account['kdfSalt'] as String),
      );
      final bundle = IdentityCrypto.decryptBundle(
        masterKey: masterKey,
        userId: account['userId'] as String,
        encrypted: account['encryptedPrivateKeys'] as String,
        nonce: account['privateKeysNonce'] as String,
      );
      expect(b64e(bundle.encSk), member['encSk']);
      expect(b64e(bundle.signSk), member['signSk']);
      expect(b64e(bundle.ownerSignPk), owner['publicSignKey']);

      final again = IdentityCrypto.encryptBundle(
        masterKey: masterKey,
        userId: account['userId'] as String,
        encSk: bundle.encSk,
        signSk: bundle.signSk,
        ownerSignPk: bundle.ownerSignPk,
        iv: b64d(account['privateKeysNonce'] as String),
      );
      expect(again.encrypted, account['encryptedPrivateKeys']);
    });

    test('the invite token and binding match', () async {
      final secret = b64d(vectors['invite']['secret'] as String);
      expect(b64e(await IdentityCrypto.inviteAuthToken(secret)), vectors['invite']['authToken']);
      expect(
        b64e(await IdentityCrypto.inviteBinding(secret, UserKeys.fromJson(member))),
        vectors['invite']['keyBinding'],
      );
    });

    test('grant signatures match', () async {
      final sealed = b64d(vault['share']['wrappedKey'] as String);
      expect(
        await IdentityCrypto.signGrant(
          signSk: b64d(owner['signSk'] as String),
          kind: 'vault',
          resourceId: vault['id'] as String,
          recipientId: member['userId'] as String,
          granterId: owner['userId'] as String,
          sealed: sealed,
        ),
        vault['share']['grantSig'],
      );
    });

    test('a shared vault and a shared album open through the cubit, with thumbnail', () async {
      final cubit = VaultCryptoCubit();
      expect(
        await cubit.unlockAccount(account: accountOf(member), passphrase: account['passphrase'] as String),
        true,
      );

      final spaces = await cubit.openShared(
        vaults: [
          VaultInfo(
            id: vault['id'] as String,
            role: 'member',
            permission: 'view',
            wrappedKey: vault['share']['wrappedKey'] as String,
            grantSig: vault['share']['grantSig'] as String,
            granter: UserKeys.fromJson(owner),
            labelEncrypted: vault['labelEncrypted'] as String,
            labelNonce: vault['labelNonce'] as String,
          ),
        ],
        albums: [
          SharedAlbumInfo(
            id: album['id'] as String,
            vaultId: 'another-vault',
            wrappedKey: album['share']['wrappedKey'] as String,
            grantSig: album['share']['grantSig'] as String,
            granter: UserKeys.fromJson(owner),
            nameEncrypted: album['nameEncrypted'] as String,
            nameNonce: album['nameNonce'] as String,
          ),
        ],
      );
      expect(spaces.map((s) => '${s.kind}:${s.label}'), ['vault:${vault['label']}', 'album:${album['name']}']);

      cubit.openSpace(spaces.first);
      expect(cubit.state.activeVaultId, vault['id']);
      expect(cubit.state.canWrite, false);

      // The vault's album key arrives wrapped under the vault key
      final names = cubit.openAlbums(vault['id'] as String, [
        (
          id: album['id'] as String,
          keyWrapped: album['keyWrapped'] as String?,
          keyNonce: album['keyNonce'] as String?,
          nameEncrypted: album['nameEncrypted'] as String?,
          nameNonce: album['nameNonce'] as String?,
        ),
      ]);
      expect(names[album['id']], album['name']);

      // The same item decrypts through its vault wrap and through its album wrap
      for (final ref in [
        MediaKeyRef(
          scope: 'vault',
          vaultId: vault['id'] as String,
          wrapped: media['vaultWrap']['wrapped'] as String,
          nonce: media['vaultWrap']['nonce'] as String,
        ),
        MediaKeyRef(
          scope: 'album',
          vaultId: vault['id'] as String,
          albumId: album['id'] as String,
          wrapped: media['albumWrap']['wrapped'] as String,
          nonce: media['albumWrap']['nonce'] as String,
        ),
      ]) {
        final thumb = cubit.decryptMedia(
          mediaId: media['id'] as String,
          tier: 'thumb',
          key: ref,
          ivB64: media['thumbIv'] as String,
          encryptedBlob: b64d(media['thumbCiphertext'] as String),
        );
        expect(b64e(thumb), media['thumbPlaintext']);
        // One tier cannot be passed off as another
        expect(
          () => cubit.decryptMedia(
            mediaId: media['id'] as String,
            tier: 'preview',
            key: ref,
            ivB64: media['thumbIv'] as String,
            encryptedBlob: b64d(media['thumbCiphertext'] as String),
          ),
          throwsA(anything),
        );
      }

      cubit.lock();
      expect(cubit.state.accountUnlocked, false);
    });

    test('a created vault opens with its passphrase after the account is unlocked', () async {
      // The owner's own bundle is not in the vectors; build one from their keys
      final salt = KeyDerivation.generateSalt();
      final masterKey = await KeyDerivation.deriveKek(passphrase: 'owner master', salt: salt);
      final bundle = IdentityCrypto.encryptBundle(
        masterKey: masterKey,
        userId: owner['userId'] as String,
        encSk: b64d(owner['encSk'] as String),
        signSk: b64d(owner['signSk'] as String),
        ownerSignPk: ownerSignPk,
      );
      final cubit = VaultCryptoCubit();
      expect(
        await cubit.unlockAccount(
          account: accountOf(owner, kdfSalt: b64e(salt), enc: bundle.encrypted, nonce: bundle.nonce),
          passphrase: 'owner master',
        ),
        true,
      );
      expect(cubit.isTrustRoot, true);

      final created = VaultInfo(
        id: vault['id'] as String,
        role: 'creator',
        permission: 'write',
        wrappedKey: vault['creator']['wrappedKey'] as String,
        kdfSalt: vault['creator']['kdfSalt'] as String,
        labelEncrypted: vault['labelEncrypted'] as String,
        labelNonce: vault['labelNonce'] as String,
      );
      expect(await cubit.findMatches(passphrase: 'not the passphrase', vaults: [created]), isEmpty);

      final matches = await cubit.findMatches(passphrase: vault['passphrase'] as String, vaults: [created]);
      expect(matches, hasLength(1));
      expect(_toHex(matches.single.key), vault['key']);
      expect(matches.single.label, vault['label']);

      cubit.selectVault(matches.single, matches);
      expect(cubit.state.isCreator, true);
      expect(Aad.vaultLabel('x'), isNotEmpty);
      cubit.lock();
    });
  });
}
