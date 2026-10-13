import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/crypto/aad.dart';
import 'package:kura_vault/core/crypto/crypto_service.dart';
import 'package:kura_vault/core/crypto/identity_crypto.dart';
import 'package:kura_vault/core/crypto/key_derivation.dart';
import 'package:kura_vault/core/crypto/media_worker.dart';

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

    test('the background worker reads and writes the same bytes', () async {
      final mediaId = media['id'] as String;
      final key = _hex(media['key'] as String);
      final aad = Aad.mediaBlob(mediaId, 'thumb');
      final plaintext = b64d(media['thumbPlaintext'] as String);

      // The web client's ciphertext opens in the worker
      expect(
        await MediaWorker.decrypt(
          key: key,
          iv: b64d(media['thumbIv'] as String),
          aad: aad,
          ciphertext: b64d(media['thumbCiphertext'] as String),
        ),
        plaintext,
      );

      // What the worker writes is what the vector-checked implementation writes
      final big = Uint8List.fromList(List.generate(70000, (i) => (i * 7) % 256));
      final made = await MediaWorker.encryptTiers(
        key: key,
        tiers: {'thumb': plaintext, 'original': big},
        aads: {'thumb': aad, 'original': Aad.mediaBlob(mediaId, 'original')},
      );
      expect(
        made['thumb']!.data,
        CryptoService.encrypt(plaintext: plaintext, key: key, iv: b64d(made['thumb']!.iv), aad: aad),
      );
      expect(
        made['original']!.data,
        CryptoService.encrypt(
            plaintext: big, key: key, iv: b64d(made['original']!.iv), aad: Aad.mediaBlob(mediaId, 'original')),
      );
      // The caller's key is theirs to zero; the worker only wiped its copy
      expect(_toHex(key), media['key']);

      // A flipped bit, the wrong tier and a truncated blob are all refused
      final tampered = Uint8List.fromList(made['original']!.data)..[5] ^= 1;
      for (final attempt in [
        (data: tampered, aad: Aad.mediaBlob(mediaId, 'original')),
        (data: made['original']!.data, aad: Aad.mediaBlob(mediaId, 'preview')),
        (data: Uint8List(8), aad: aad),
      ]) {
        await expectLater(
          MediaWorker.decrypt(
              key: key, iv: b64d(made['original']!.iv), aad: attempt.aad, ciphertext: attempt.data),
          throwsA(anything),
        );
      }
    });

    test('what this app writes is what the web client writes', () async {
      final vaultId = vault['id'] as String;
      final albumId = album['id'] as String;
      final mediaId = media['id'] as String;
      final vaultKey = _hex(vault['key'] as String);
      final albumKey = _hex(album['key'] as String);
      final mediaKey = _hex(media['key'] as String);
      String gcm(Uint8List plaintext, Uint8List key, String iv, Uint8List aad) =>
          b64e(CryptoService.encrypt(plaintext: plaintext, key: key, iv: b64d(iv), aad: aad));

      final creator = vault['creator'] as Map<String, dynamic>;
      final grant = await VaultCryptoCubit.wrapCreatorGrant(
        vaultKey: vaultKey,
        passphrase: vault['passphrase'] as String,
        vaultId: vaultId,
        userId: owner['userId'] as String,
        encPk: b64d(owner['publicEncKey'] as String),
        salt: b64d(creator['kdfSalt'] as String),
        innerIv: b64d(creator['innerIv'] as String),
        ephSk: b64d(creator['ephSk'] as String),
        iv: b64d(creator['iv'] as String),
      );
      expect(grant.wrappedKey, creator['wrappedKey']);
      expect(grant.kdfSalt, creator['kdfSalt']);

      expect(
        gcm(_utf8(vault['label'] as String), vaultKey, vault['labelNonce'] as String, Aad.vaultLabel(vaultId)),
        vault['labelEncrypted'],
      );
      expect(
        gcm(albumKey, vaultKey, album['keyNonce'] as String, Aad.albumKey(albumId, vaultId)),
        album['keyWrapped'],
      );
      expect(
        gcm(_utf8(album['name'] as String), albumKey, album['nameNonce'] as String, Aad.albumName(albumId)),
        album['nameEncrypted'],
      );
      expect(
        gcm(mediaKey, vaultKey, media['vaultWrap']['nonce'] as String, Aad.mediaKeyVault(mediaId, vaultId)),
        media['vaultWrap']['wrapped'],
      );
      expect(
        gcm(mediaKey, albumKey, media['albumWrap']['nonce'] as String, Aad.mediaKeyAlbum(mediaId, albumId)),
        media['albumWrap']['wrapped'],
      );
      expect(
        gcm(_utf8(media['meta'] as String), mediaKey, media['metaNonce'] as String, Aad.mediaMeta(mediaId)),
        media['encryptedMeta'],
      );
    });

    test('a vault, an album and an upload made here open again', () async {
      final salt = KeyDerivation.generateSalt();
      final masterKey = await KeyDerivation.deriveKek(passphrase: 'owner master', salt: salt);
      final bundle = IdentityCrypto.encryptBundle(
        masterKey: masterKey,
        userId: owner['userId'] as String,
        encSk: b64d(owner['encSk'] as String),
        signSk: b64d(owner['signSk'] as String),
        ownerSignPk: ownerSignPk,
      );
      final ownerAccount = accountOf(owner, kdfSalt: b64e(salt), enc: bundle.encrypted, nonce: bundle.nonce);
      final cubit = VaultCryptoCubit();
      expect(await cubit.unlockAccount(account: ownerAccount, passphrase: 'owner master'), true);

      // Vault: only the stored rows and the passphrase are needed to open it again
      final made = await cubit.createVault(passphrase: 'a new vault', label: '  Trips ');
      final newKey = _toHex(made.match.key);
      expect(made.match.label, 'Trips');
      cubit.discardMatches([made.match]);
      expect(made.match.key.every((b) => b == 0), true);

      final stored = VaultInfo(
        id: made.vault.id,
        role: 'creator',
        permission: 'write',
        wrappedKey: made.vault.wrappedKey,
        kdfSalt: made.vault.kdfSalt,
        labelEncrypted: made.vault.labelEncrypted,
        labelNonce: made.vault.labelNonce,
      );
      expect(await cubit.findMatches(passphrase: 'wrong', vaults: [stored]), isEmpty);
      final matches = await cubit.findMatches(passphrase: 'a new vault', vaults: [stored]);
      expect(_toHex(matches.single.key), newKey);
      expect(matches.single.label, 'Trips');
      cubit.selectVault(matches.single, matches);
      final vaultId = made.vault.id;

      // A vault without a label stores none
      final unnamed = await cubit.createVault(passphrase: 'x', label: '  ');
      expect(unnamed.vault.labelEncrypted, isNull);
      expect(unnamed.match.label, 'New vault');
      cubit.discardMatches([unnamed.match]);

      // Album: created, renamed, and read back by a keyring that has only the vault key
      final newAlbum = cubit.createAlbum(vaultId: vaultId, name: 'Beach');
      expect(cubit.hasAlbumKey(newAlbum.id), true);
      final renamed = cubit.encryptAlbumName(albumId: newAlbum.id, name: 'Beach 2025');

      // Upload: into the album, so the key is wrapped under both
      const mediaId = '0f0e0d0c-0b0a-4908-8706-050403020100';
      final thumb = Uint8List.fromList(List.generate(300, (i) => i % 251));
      final preview = Uint8List.fromList(List.generate(5000, (i) => i % 253));
      final original = Uint8List.fromList(List.generate(200000, (i) => i % 255));
      final encrypted = await cubit.encryptMedia(
        mediaId: mediaId,
        vaultId: vaultId,
        albumId: newAlbum.id,
        thumb: thumb,
        preview: preview,
        original: original,
        meta: {'filename': 'IMG_1.jpg', 'gpsLatitude': 1.5},
      );
      expect({encrypted.thumb.iv, encrypted.preview.iv, encrypted.original.iv}, hasLength(3));
      expect(encrypted.original.data.length, original.length + 16);

      // Lock, then start again from what the server would hold
      cubit.lock();
      expect(await cubit.unlockAccount(account: ownerAccount, passphrase: 'owner master'), true);
      final again = await cubit.findMatches(passphrase: 'a new vault', vaults: [stored]);
      cubit.selectVault(again.single, again);
      expect(cubit.hasAlbumKey(newAlbum.id), false);
      final names = cubit.openAlbums(vaultId, [
        (
          id: newAlbum.id,
          keyWrapped: newAlbum.keyWrapped as String?,
          keyNonce: newAlbum.keyNonce as String?,
          nameEncrypted: renamed.encrypted as String?,
          nameNonce: renamed.nonce as String?,
        ),
      ]);
      expect(names[newAlbum.id], 'Beach 2025');

      final viaVault = MediaKeyRef(
        scope: 'vault',
        vaultId: vaultId,
        wrapped: encrypted.vaultKey!.wrapped,
        nonce: encrypted.vaultKey!.nonce,
      );
      final viaAlbum = MediaKeyRef(
        scope: 'album',
        vaultId: vaultId,
        albumId: newAlbum.id,
        wrapped: encrypted.albumKey!.wrapped,
        nonce: encrypted.albumKey!.nonce,
      );
      for (final ref in [viaVault, viaAlbum]) {
        expect(
          cubit.decryptMedia(
              mediaId: mediaId, tier: 'thumb', key: ref, ivB64: encrypted.thumb.iv, encryptedBlob: encrypted.thumb.data),
          thumb,
        );
        expect(
          await cubit.decryptMediaInBackground(
              mediaId: mediaId,
              tier: 'original',
              key: ref,
              ivB64: encrypted.original.iv,
              encryptedBlob: encrypted.original.data),
          original,
        );
        expect(
          cubit.decryptMeta(mediaId: mediaId, key: ref, encrypted: encrypted.encryptedMeta, nonce: encrypted.metaNonce),
          '{"filename":"IMG_1.jpg","gpsLatitude":1.5}',
        );
      }

      // Bound to its item and its tier: neither can be swapped
      await expectLater(
        cubit.decryptMediaInBackground(
            mediaId: mediaId,
            tier: 'preview',
            key: viaVault,
            ivB64: encrypted.original.iv,
            encryptedBlob: encrypted.original.data),
        throwsA(anything),
      );
      expect(
        cubit.decryptMeta(
            mediaId: 'another-item', key: viaVault, encrypted: encrypted.encryptedMeta, nonce: encrypted.metaNonce),
        isNull,
      );

      // Re-wrapping gives the same item key under the other scope
      final toAlbum = cubit.rewrapMediaKey(mediaId: mediaId, key: viaVault, albumId: newAlbum.id);
      final toVault = cubit.rewrapMediaKey(mediaId: mediaId, key: viaAlbum, vaultId: vaultId);
      for (final ref in [
        MediaKeyRef(scope: 'album', vaultId: vaultId, albumId: newAlbum.id, wrapped: toAlbum.wrapped, nonce: toAlbum.nonce),
        MediaKeyRef(scope: 'vault', vaultId: vaultId, wrapped: toVault.wrapped, nonce: toVault.nonce),
      ]) {
        expect(
          cubit.decryptMedia(
              mediaId: mediaId,
              tier: 'preview',
              key: ref,
              ivB64: encrypted.preview.iv,
              encryptedBlob: encrypted.preview.data),
          preview,
        );
      }
      expect(() => cubit.rewrapMediaKey(mediaId: mediaId, key: viaVault), throwsArgumentError);

      // With only the album key, an upload carries no vault-wrapped key
      cubit.closeVault();
      await expectLater(
        cubit.encryptMedia(
            mediaId: mediaId, vaultId: vaultId, thumb: thumb, preview: preview, original: original, meta: const {}),
        throwsStateError,
      );
      cubit.lock();
    });
  });
}
