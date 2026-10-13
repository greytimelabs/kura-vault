import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';
import '../../core/crypto/aad.dart';
import '../../core/crypto/crypto_service.dart';
import '../../core/crypto/identity_crypto.dart';
import '../../core/crypto/key_derivation.dart';
import '../../core/crypto/cache_crypto.dart';
import '../../core/crypto/media_worker.dart';
import '../../core/crypto/models.dart';
import 'vault_crypto_state.dart';

export '../../core/crypto/models.dart';

/// A vault this account created whose passphrase matched.
///
/// Holds a live vault key. Every MatchedVault returned by
/// [VaultCryptoCubit.findMatches] must eventually be either committed via
/// [VaultCryptoCubit.selectVault] or zeroed via
/// [VaultCryptoCubit.discardMatches] — never simply dropped.
class MatchedVault {
  final String vaultId;
  final Uint8List key;

  /// Decrypted vault label, or a neutral positional fallback ("Vault 1")
  /// when the vault has no label. Never the vault UUID: that is a stable
  /// identifier an observer could correlate against the database.
  final String label;

  MatchedVault({
    required this.vaultId,
    required this.key,
    required this.label,
  });
}

class _Identity {
  final String userId;
  final Uint8List encSk;
  final Uint8List signSk;
  final Uint8List encPk;
  final Uint8List signPk;

  /// The trust root: other users' keys count only when certified by this key.
  final Uint8List ownerSignPk;

  _Identity({
    required this.userId,
    required this.encSk,
    required this.signSk,
    required this.encPk,
    required this.signPk,
    required this.ownerSignPk,
  });
}

/// The server reports public keys for this account that its private keys do
/// not belong to. Others would be sealing to a key this user cannot open, or
/// to someone else's.
class KeysNotYoursException implements Exception {
  @override
  String toString() =>
      'The server reports keys that are not yours. Do not continue; contact the server owner.';
}

/// Every key this app holds, and everything done with them: the account's
/// private keys, the key of each open vault, album keys. All of it lives here
/// in memory only and is zeroed by [lock].
class VaultCryptoCubit extends Cubit<VaultCryptoState> {
  VaultCryptoCubit() : super(const VaultCryptoState());

  /// Max Argon2id derivations in flight at once. Each allocates 64MB
  /// (memoryKB = 65536), so an unbounded fan-out over N vaults would peak
  /// at N * 64MB.
  static const int _maxConcurrentDerivations = 4;

  _Identity? _identity;
  final Map<String, Uint8List> _vaultKeys = {};
  final Map<String, Uint8List> _albumKeys = {};

  /// Which vault an album key was reached through, so closing the vault drops it.
  final Map<String, String> _albumVault = {};

  _Identity get _me {
    final identity = _identity;
    if (identity == null) throw StateError('Account is locked');
    return identity;
  }

  Uint8List _vaultKey(String vaultId) {
    final key = _vaultKeys[vaultId];
    if (key == null) throw StateError('Vault is locked');
    return key;
  }

  Uint8List _albumKey(String albumId) {
    final key = _albumKeys[albumId];
    if (key == null) throw StateError('Album key is not loaded');
    return key;
  }

  // ── Account ──

  /// Generate a new user's keys and encrypt the private half under the master
  /// passphrase. Without [invite] this is the server owner, who certifies
  /// themselves; with it, the new user proves their keys to the owner through
  /// the link's secret and takes the owner's key from the link as trust root.
  Future<AccountMaterial> createAccount({
    required String userId,
    required String username,
    required String passphrase,
    InviteLink? invite,
  }) async {
    final encSk = CryptoService.generateKey();
    final signSk = CryptoService.generateKey();
    final encPk = await IdentityCrypto.encPublicOf(encSk);
    final signPk = await IdentityCrypto.signPublicOf(signSk);
    final ownerSignPk = invite != null ? b64d(invite.ownerSignKey) : signPk;

    final salt = KeyDerivation.generateSalt();
    final masterKey =
        await KeyDerivation.deriveKek(passphrase: passphrase, salt: salt);
    final bundle = IdentityCrypto.encryptBundle(
      masterKey: masterKey,
      userId: userId,
      encSk: encSk,
      signSk: signSk,
      ownerSignPk: ownerSignPk,
    );
    CryptoService.zero(masterKey);

    lock();
    _identity = _Identity(
      userId: userId,
      encSk: encSk,
      signSk: signSk,
      encPk: encPk,
      signPk: signPk,
      ownerSignPk: ownerSignPk,
    );
    emit(const VaultCryptoState(accountUnlocked: true));

    final keys = UserKeys(
      userId: userId,
      username: username,
      publicEncKey: b64e(encPk),
      publicSignKey: b64e(signPk),
    );
    return AccountMaterial(
      kdfSalt: b64e(salt),
      encryptedPrivateKeys: bundle.encrypted,
      privateKeysNonce: bundle.nonce,
      publicEncKey: keys.publicEncKey,
      publicSignKey: keys.publicSignKey,
      keyCert: invite == null ? await IdentityCrypto.signCert(signSk, keys) : null,
      keyBinding: invite == null
          ? null
          : b64e(await IdentityCrypto.inviteBinding(b64d(invite.secret), keys)),
    );
  }

  /// Load the account's private keys with the master passphrase. False means
  /// a wrong passphrase. Throws [KeysNotYoursException] when the public keys
  /// the server reports are not the ones these private keys belong to.
  Future<bool> unlockAccount({
    required AccountKeys account,
    required String passphrase,
  }) async {
    final masterKey = await KeyDerivation.deriveKek(
      passphrase: passphrase,
      salt: b64d(account.kdfSalt),
    );
    try {
      return await unlockAccountWithKey(account: account, masterKey: masterKey);
    } finally {
      CryptoService.zero(masterKey);
    }
  }

  /// Load the account's private keys with the master key itself: what the
  /// passphrase derives to, as fingerprint or face unlock keeps it. The same
  /// checks apply as with the passphrase. False means the key does not open
  /// this account (the passphrase was changed since). The caller zeroes
  /// [masterKey].
  Future<bool> unlockAccountWithKey({
    required AccountKeys account,
    required Uint8List masterKey,
  }) async {
    final ({Uint8List encSk, Uint8List signSk, Uint8List ownerSignPk}) bundle;
    try {
      bundle = IdentityCrypto.decryptBundle(
        masterKey: masterKey,
        userId: account.id,
        encrypted: account.encryptedPrivateKeys,
        nonce: account.privateKeysNonce,
      );
    } catch (_) {
      return false;
    }

    final encPk = await IdentityCrypto.encPublicOf(bundle.encSk);
    final signPk = await IdentityCrypto.signPublicOf(bundle.signSk);
    if (b64e(encPk) != account.publicEncKey ||
        b64e(signPk) != account.publicSignKey) {
      CryptoService.zero(bundle.encSk);
      CryptoService.zero(bundle.signSk);
      throw KeysNotYoursException();
    }

    lock();
    _identity = _Identity(
      userId: account.id,
      encSk: bundle.encSk,
      signSk: bundle.signSk,
      encPk: encPk,
      signPk: signPk,
      ownerSignPk: bundle.ownerSignPk,
    );
    emit(const VaultCryptoState(accountUnlocked: true));
    return true;
  }

  /// The master key [passphrase] derives to, if it is this account's master
  /// passphrase; null if it is not. Changes nothing that is unlocked. Used to
  /// switch on fingerprint or face unlock; the caller zeroes the result.
  static Future<Uint8List?> masterKeyFor({
    required AccountKeys account,
    required String passphrase,
  }) async {
    final masterKey = await KeyDerivation.deriveKek(
      passphrase: passphrase,
      salt: b64d(account.kdfSalt),
    );
    try {
      final bundle = IdentityCrypto.decryptBundle(
        masterKey: masterKey,
        userId: account.id,
        encrypted: account.encryptedPrivateKeys,
        nonce: account.privateKeysNonce,
      );
      CryptoService.zero(bundle.encSk);
      CryptoService.zero(bundle.signSk);
      return masterKey;
    } catch (_) {
      CryptoService.zero(masterKey);
      return null;
    }
  }

  /// True when the owner this account trusts is the account itself.
  bool get isTrustRoot =>
      IdentityCrypto.equalBytes(_me.signPk, _me.ownerSignPk);

  // ── Vaults ──

  /// A creator's own copy of a vault key has two layers: the vault passphrase
  /// inside, their public key outside. Either secret alone opens nothing.
  /// [salt], [innerIv], [ephSk] and [iv] exist for test vectors only.
  static Future<({String wrappedKey, String kdfSalt})> wrapCreatorGrant({
    required Uint8List vaultKey,
    required String passphrase,
    required String vaultId,
    required String userId,
    required Uint8List encPk,
    Uint8List? salt,
    Uint8List? innerIv,
    Uint8List? ephSk,
    Uint8List? iv,
  }) async {
    final kdfSalt = salt ?? KeyDerivation.generateSalt();
    final passphraseKey =
        await KeyDerivation.deriveKek(passphrase: passphrase, salt: kdfSalt);
    try {
      final nonce = innerIv ?? CryptoService.generateIv();
      final inner = Uint8List.fromList([
        ...nonce,
        ...CryptoService.encrypt(
          plaintext: vaultKey,
          key: passphraseKey,
          iv: nonce,
          aad: Aad.vaultKeyPassphrase(vaultId, userId),
        ),
      ]);
      final sealed = await IdentityCrypto.seal(
        recipientPk: encPk,
        plaintext: inner,
        aad: Aad.vaultKey(vaultId, userId),
        ephSk: ephSk,
        iv: iv,
      );
      return (wrappedKey: b64e(sealed), kdfSalt: b64e(kdfSalt));
    } finally {
      CryptoService.zero(passphraseKey);
    }
  }

  /// Make a vault. [vault] is what the server stores; [match] holds the new
  /// key so the caller can open the vault straight away with [selectVault],
  /// and must be given to [discardMatches] otherwise.
  Future<({NewVault vault, MatchedVault match})> createVault({
    required String passphrase,
    required String label,
  }) async {
    final me = _me;
    final id = const Uuid().v4();
    final key = CryptoService.generateKey();
    try {
      final grant = await wrapCreatorGrant(
        vaultKey: key,
        passphrase: passphrase,
        vaultId: id,
        userId: me.userId,
        encPk: me.encPk,
      );
      final name = label.trim();
      final encLabel =
          name.isEmpty ? null : _encryptText(key, name, Aad.vaultLabel(id));
      return (
        vault: (
          id: id,
          wrappedKey: grant.wrappedKey,
          kdfSalt: grant.kdfSalt,
          labelEncrypted: encLabel?.encrypted,
          labelNonce: encLabel?.nonce,
        ),
        match: MatchedVault(
          vaultId: id,
          key: key,
          label: name.isEmpty ? 'New vault' : name,
        ),
      );
    } catch (_) {
      CryptoService.zero(key);
      rethrow;
    }
  }

  /// Try the passphrase against EVERY vault this account created and return
  /// all that open.
  ///
  /// Each vault has its own random salt, so one passphrase can legitimately
  /// open more than one. There is deliberately NO early exit: a full scan
  /// means unlock latency does not reveal which vault matched, or how many.
  ///
  /// Returns matches in [vaults] order. An empty list means the passphrase
  /// was wrong.
  Future<List<MatchedVault>> findMatches({
    required String passphrase,
    required List<VaultInfo> vaults,
  }) async {
    final me = _me;
    final own = vaults.where((v) => v.isCreator && v.kdfSalt != null).toList();
    final matches = <MatchedVault>[];

    for (var i = 0; i < own.length; i += _maxConcurrentDerivations) {
      final batch = own.skip(i).take(_maxConcurrentDerivations).toList();

      final keys = await Future.wait(batch.map((v) async {
        try {
          // Outer layer: sealed to this account. Inner: the vault passphrase.
          final inner = await IdentityCrypto.open(
            encSk: me.encSk,
            encPk: me.encPk,
            sealed: b64d(v.wrappedKey),
            aad: Aad.vaultKey(v.id, me.userId),
          );
          final passphraseKey = await KeyDerivation.deriveKek(
            passphrase: passphrase,
            salt: b64d(v.kdfSalt!),
          );
          try {
            final key = CryptoService.decrypt(
              ciphertext: inner.sublist(12),
              key: passphraseKey,
              iv: inner.sublist(0, 12),
              aad: Aad.vaultKeyPassphrase(v.id, me.userId),
            );
            return key.length == 32 ? key : null;
          } finally {
            CryptoService.zero(passphraseKey);
          }
        } catch (_) {
          return null; // wrong passphrase, or not sealed to this account
        }
      }));

      for (var j = 0; j < batch.length; j++) {
        final key = keys[j];
        if (key == null) continue;
        final vault = batch[j];
        matches.add(MatchedVault(
          vaultId: vault.id,
          key: key,
          label: _decryptText(vault.labelEncrypted, vault.labelNonce, key,
                  Aad.vaultLabel(vault.id)) ??
              'Vault ${matches.length + 1}',
        ));
      }
    }

    return matches;
  }

  /// Commit [chosen] as the open vault and zero the keys of every other match.
  void selectVault(MatchedVault chosen, List<MatchedVault> allMatches) {
    for (final m in allMatches) {
      if (!identical(m, chosen)) CryptoService.zero(m.key);
    }
    _vaultKeys[chosen.vaultId] = chosen.key;
    emit(VaultCryptoState(
      accountUnlocked: true,
      activeVaultId: chosen.vaultId,
      activeLabel: chosen.label,
      canWrite: true,
      isCreator: true,
      cacheKey: CacheCrypto.deriveCacheKey(chosen.key),
    ));
  }

  /// Zero every match without opening one. Call this whenever the picker is
  /// dismissed, so live keys are never stranded in memory.
  void discardMatches(List<MatchedVault> matches) {
    for (final m in matches) {
      CryptoService.zero(m.key);
    }
  }

  Future<void> _requireGrant(String kind, String resourceId, UserKeys? granter,
      String? signature, Uint8List sealed) async {
    final me = _me;
    if (granter == null || signature == null) {
      throw StateError('Unsigned share');
    }
    if (!await IdentityCrypto.verifyCert(me.ownerSignPk, granter)) {
      throw StateError('Unverified sharer');
    }
    final ok = await IdentityCrypto.verifyGrant(
      granterSignPk: b64d(granter.publicSignKey),
      signature: signature,
      kind: kind,
      resourceId: resourceId,
      recipientId: me.userId,
      granterId: granter.userId,
      sealed: sealed,
    );
    if (!ok) throw StateError('Share was not issued by its stated sender');
  }

  /// Open everything other people shared with this account. A share is used
  /// only if its sender's keys are certified by the owner and they signed
  /// this exact sealed key; anything else (a key the server made up, say) is
  /// left out.
  Future<List<SharedSpace>> openShared({
    required List<VaultInfo> vaults,
    required List<SharedAlbumInfo> albums,
  }) async {
    final me = _me;
    final spaces = <SharedSpace>[];
    final sharedVaultIds = <String>{};

    for (final vault in vaults.where((v) => !v.isCreator)) {
      try {
        final sealed = b64d(vault.wrappedKey);
        await _requireGrant('vault', vault.id, vault.granter, vault.grantSig, sealed);
        final key = await IdentityCrypto.open(
          encSk: me.encSk,
          encPk: me.encPk,
          sealed: sealed,
          aad: Aad.vaultKey(vault.id, me.userId),
        );
        _vaultKeys[vault.id] = key;
        sharedVaultIds.add(vault.id);
        spaces.add(SharedSpace(
          kind: 'vault',
          id: vault.id,
          vaultId: vault.id,
          label: _decryptText(vault.labelEncrypted, vault.labelNonce, key,
                  Aad.vaultLabel(vault.id)) ??
              'Shared vault',
          permission: vault.permission,
          sharedBy: vault.granter?.username ?? '',
        ));
      } catch (_) {
        // not usable: skipped
      }
    }

    for (final album in albums) {
      try {
        final sealed = b64d(album.wrappedKey);
        await _requireGrant('album', album.id, album.granter, album.grantSig, sealed);
        final key = await IdentityCrypto.open(
          encSk: me.encSk,
          encPk: me.encPk,
          sealed: sealed,
          aad: Aad.albumKeyGrant(album.id, me.userId),
        );
        _albumKeys[album.id] = key;
        // An album inside a vault that is shared as a whole is reached through the vault
        if (sharedVaultIds.contains(album.vaultId)) continue;
        spaces.add(SharedSpace(
          kind: 'album',
          id: album.id,
          vaultId: album.vaultId,
          label: _decryptText(album.nameEncrypted, album.nameNonce, key,
                  Aad.albumName(album.id)) ??
              'Shared album',
          permission: album.permission,
          sharedBy: album.granter?.username ?? '',
        ));
      } catch (_) {
        // not usable: skipped
      }
    }
    return spaces;
  }

  /// Open something from [openShared]. Its key is already loaded.
  void openSpace(SharedSpace space) {
    final key = space.isAlbum ? _albumKey(space.id) : _vaultKey(space.vaultId);
    emit(VaultCryptoState(
      accountUnlocked: true,
      activeVaultId: space.vaultId,
      activeLabel: space.label,
      albumOnlyId: space.isAlbum ? space.id : null,
      canWrite: space.canWrite,
      isCreator: false,
      cacheKey: CacheCrypto.deriveCacheKey(key),
    ));
  }

  /// Leave the open vault but stay unlocked. A vault opened with its
  /// passphrase needs it again; what was shared stays one tap away.
  void closeVault() {
    final vaultId = state.activeVaultId;
    if (vaultId != null && state.isCreator) {
      final key = _vaultKeys.remove(vaultId);
      if (key != null) CryptoService.zero(key);
      for (final albumId in _albumVault.keys
          .where((id) => _albumVault[id] == vaultId)
          .toList()) {
        final albumKey = _albumKeys.remove(albumId);
        if (albumKey != null) CryptoService.zero(albumKey);
        _albumVault.remove(albumId);
      }
    }
    if (state.cacheKey != null) CryptoService.zero(state.cacheKey!);
    emit(VaultCryptoState(accountUnlocked: _identity != null));
  }

  /// Lock - wipe every secret from memory.
  void lock() {
    final identity = _identity;
    if (identity != null) {
      CryptoService.zero(identity.encSk);
      CryptoService.zero(identity.signSk);
    }
    _identity = null;
    for (final key in _vaultKeys.values) {
      CryptoService.zero(key);
    }
    for (final key in _albumKeys.values) {
      CryptoService.zero(key);
    }
    _vaultKeys.clear();
    _albumKeys.clear();
    _albumVault.clear();
    if (state.cacheKey != null) CryptoService.zero(state.cacheKey!);
    if (!isClosed) emit(const VaultCryptoState());
  }

  // ── Albums ──

  /// Load the keys of a vault's albums through the vault key and return their
  /// names by album id. An album with no key (Liked) is left out.
  Map<String, String> openAlbums(
    String vaultId,
    Iterable<
            ({
              String id,
              String? keyWrapped,
              String? keyNonce,
              String? nameEncrypted,
              String? nameNonce
            })>
        albums,
  ) {
    final vaultKey = _vaultKeys[vaultId];
    final names = <String, String>{};
    for (final album in albums) {
      try {
        var key = _albumKeys[album.id];
        if (key == null) {
          if (vaultKey == null || album.keyWrapped == null || album.keyNonce == null) {
            continue;
          }
          key = CryptoService.unwrapKey(
            wrapped: b64d(album.keyWrapped!),
            wrappingKey: vaultKey,
            nonce: b64d(album.keyNonce!),
            aad: Aad.albumKey(album.id, vaultId),
          );
          _albumKeys[album.id] = key;
          _albumVault[album.id] = vaultId;
        }
        final name = _decryptText(
            album.nameEncrypted, album.nameNonce, key, Aad.albumName(album.id));
        if (name != null) names[album.id] = name;
      } catch (_) {
        // an album this account cannot open: it shows without a name
      }
    }
    return names;
  }

  bool hasAlbumKey(String albumId) => _albumKeys.containsKey(albumId);

  /// Make an album in an open vault: a fresh key wrapped under the vault key,
  /// and the name encrypted under the album key.
  NewAlbum createAlbum({required String vaultId, required String name}) {
    final vaultKey = _vaultKey(vaultId);
    final id = const Uuid().v4();
    final key = CryptoService.generateKey();
    final wrapped = CryptoService.wrapKey(
      key: key,
      wrappingKey: vaultKey,
      aad: Aad.albumKey(id, vaultId),
    );
    final encName = _encryptText(key, name, Aad.albumName(id));
    _albumKeys[id] = key;
    _albumVault[id] = vaultId;
    return (
      id: id,
      keyWrapped: b64e(wrapped.wrapped),
      keyNonce: b64e(wrapped.nonce),
      nameEncrypted: encName.encrypted,
      nameNonce: encName.nonce,
    );
  }

  EncryptedText encryptAlbumName({required String albumId, required String name}) =>
      _encryptText(_albumKey(albumId), name, Aad.albumName(albumId));

  // ── Media ──

  Uint8List _mediaKey(String mediaId, MediaKeyRef ref) {
    return ref.scope == 'vault'
        ? CryptoService.unwrapKey(
            wrapped: b64d(ref.wrapped),
            wrappingKey: _vaultKey(ref.vaultId),
            nonce: b64d(ref.nonce),
            aad: Aad.mediaKeyVault(mediaId, ref.vaultId),
          )
        : CryptoService.unwrapKey(
            wrapped: b64d(ref.wrapped),
            wrappingKey: _albumKey(ref.albumId!),
            nonce: b64d(ref.nonce),
            aad: Aad.mediaKeyAlbum(mediaId, ref.albumId!),
          );
  }

  /// Unwrap an item's key and decrypt one of its tiers (`thumb`, `preview`
  /// or `original`).
  Uint8List decryptMedia({
    required String mediaId,
    required String tier,
    required MediaKeyRef key,
    required String ivB64,
    required Uint8List encryptedBlob,
  }) {
    final mediaKey = _mediaKey(mediaId, key);
    try {
      return CryptoService.decrypt(
        ciphertext: encryptedBlob,
        key: mediaKey,
        iv: b64d(ivB64),
        aad: Aad.mediaBlob(mediaId, tier),
      );
    } finally {
      // Zero the item's key immediately
      CryptoService.zero(mediaKey);
    }
  }

  /// Like [decryptMedia], off the UI isolate. For previews and originals.
  Future<Uint8List> decryptMediaInBackground({
    required String mediaId,
    required String tier,
    required MediaKeyRef key,
    required String ivB64,
    required Uint8List encryptedBlob,
  }) async {
    final mediaKey = _mediaKey(mediaId, key);
    try {
      return await MediaWorker.decrypt(
        key: mediaKey,
        iv: b64d(ivB64),
        aad: Aad.mediaBlob(mediaId, tier),
        ciphertext: encryptedBlob,
      );
    } finally {
      CryptoService.zero(mediaKey);
    }
  }

  /// One fresh key per file; the three tiers and the metadata share it, each
  /// with its own IV. The key is wrapped under the vault key when this
  /// account holds it, and under the album key when the upload goes into an
  /// album.
  Future<EncryptedMedia> encryptMedia({
    required String mediaId,
    required String vaultId,
    String? albumId,
    required Uint8List thumb,
    required Uint8List preview,
    required Uint8List original,
    required Map<String, Object?> meta,
  }) async {
    final vaultKey = _vaultKeys[vaultId];
    final albumKey = albumId == null ? null : _albumKey(albumId);
    if (vaultKey == null && albumKey == null) throw StateError('Vault is locked');

    final key = CryptoService.generateKey();
    try {
      final encMeta = _encryptText(key, jsonEncode(meta), Aad.mediaMeta(mediaId));
      final vaultWrap = vaultKey == null
          ? null
          : CryptoService.wrapKey(
              key: key,
              wrappingKey: vaultKey,
              aad: Aad.mediaKeyVault(mediaId, vaultId),
            );
      final albumWrap = albumKey == null
          ? null
          : CryptoService.wrapKey(
              key: key,
              wrappingKey: albumKey,
              aad: Aad.mediaKeyAlbum(mediaId, albumId!),
            );
      final tiers = await MediaWorker.encryptTiers(
        key: key,
        tiers: {'thumb': thumb, 'preview': preview, 'original': original},
        aads: {
          for (final tier in const ['thumb', 'preview', 'original'])
            tier: Aad.mediaBlob(mediaId, tier),
        },
      );
      return (
        vaultKey: vaultWrap == null
            ? null
            : (wrapped: b64e(vaultWrap.wrapped), nonce: b64e(vaultWrap.nonce)),
        albumKey: albumWrap == null
            ? null
            : (wrapped: b64e(albumWrap.wrapped), nonce: b64e(albumWrap.nonce)),
        thumb: tiers['thumb']!,
        preview: tiers['preview']!,
        original: tiers['original']!,
        encryptedMeta: encMeta.encrypted,
        metaNonce: encMeta.nonce,
      );
    } finally {
      CryptoService.zero(key);
    }
  }

  /// An item's metadata as the JSON text it was stored as. Null when there is
  /// none, no usable key, or it does not verify.
  String? decryptMeta({
    required String mediaId,
    required MediaKeyRef? key,
    required String? encrypted,
    required String? nonce,
  }) {
    if (key == null) return null;
    final Uint8List mediaKey;
    try {
      mediaKey = _mediaKey(mediaId, key);
    } catch (_) {
      return null;
    }
    try {
      return _decryptText(encrypted, nonce, mediaKey, Aad.mediaMeta(mediaId));
    } finally {
      CryptoService.zero(mediaKey);
    }
  }

  /// Wrap an existing item's key under another key this account holds: an
  /// album's ([albumId]), to put the item in that album, or the vault's
  /// ([vaultId]), for an item uploaded by someone who had only an album.
  /// Exactly one of the two is given.
  WrappedKey rewrapMediaKey({
    required String mediaId,
    required MediaKeyRef key,
    String? albumId,
    String? vaultId,
  }) {
    if ((albumId == null) == (vaultId == null)) {
      throw ArgumentError('Give an album or a vault, not both');
    }
    final mediaKey = _mediaKey(mediaId, key);
    try {
      final wrapped = albumId != null
          ? CryptoService.wrapKey(
              key: mediaKey,
              wrappingKey: _albumKey(albumId),
              aad: Aad.mediaKeyAlbum(mediaId, albumId),
            )
          : CryptoService.wrapKey(
              key: mediaKey,
              wrappingKey: _vaultKey(vaultId!),
              aad: Aad.mediaKeyVault(mediaId, vaultId),
            );
      return (wrapped: b64e(wrapped.wrapped), nonce: b64e(wrapped.nonce));
    } finally {
      CryptoService.zero(mediaKey);
    }
  }

  // ── Users and sharing ──

  /// True when the owner this account trusts certified exactly these keys for
  /// this user.
  Future<bool> verifyUser(UserKeys user) =>
      IdentityCrypto.verifyCert(_me.ownerSignPk, user);

  /// Start an invitation. The secret goes into the link and nowhere else: the
  /// server gets a hash of a token derived from it, and a copy sealed to the
  /// owner so their client can check the invitee's keys later.
  Future<
      ({
        String secret,
        String tokenHash,
        String ownerSecretEncrypted,
        String ownerSignKey
      })> createInvite(String inviteId) async {
    final me = _me;
    final secret = CryptoService.randomBytes(32);
    try {
      final token = await IdentityCrypto.inviteAuthToken(secret);
      final hash = await IdentityCrypto.sha256(token);
      return (
        secret: b64e(secret),
        tokenHash: hash.map((b) => b.toRadixString(16).padLeft(2, '0')).join(),
        ownerSecretEncrypted: b64e(await IdentityCrypto.seal(
          recipientPk: me.encPk,
          plaintext: secret,
          aad: Aad.inviteSecret(inviteId),
        )),
        ownerSignKey: b64e(me.signPk),
      );
    } finally {
      CryptoService.zero(secret);
    }
  }

  /// Sign a new user's keys, but only if they are the keys the invitee bound
  /// with the link's secret. Null means they are not: the server (or someone
  /// on the path) replaced them, and nothing must be shared with that account.
  Future<String?> certifyUser({
    required UserKeys user,
    required String inviteId,
    required String ownerSecretEncrypted,
    required String keyBinding,
  }) async {
    final me = _me;
    final Uint8List secret;
    try {
      secret = await IdentityCrypto.open(
        encSk: me.encSk,
        encPk: me.encPk,
        sealed: b64d(ownerSecretEncrypted),
        aad: Aad.inviteSecret(inviteId),
      );
    } catch (_) {
      return null;
    }
    try {
      final expected = await IdentityCrypto.inviteBinding(secret, user);
      final Uint8List presented;
      try {
        presented = b64d(keyBinding);
      } catch (_) {
        return null;
      }
      if (!IdentityCrypto.equalBytes(expected, presented)) return null;
      return await IdentityCrypto.signCert(me.signSk, user);
    } finally {
      CryptoService.zero(secret);
    }
  }

  Future<({String wrappedKey, String grantSig})> _share(
      String kind, String resourceId, Uint8List key, Uint8List aad, UserKeys recipient) async {
    final me = _me;
    if (!await verifyUser(recipient)) {
      throw StateError(
          'The keys for ${recipient.username} could not be verified. Nothing was shared.');
    }
    final sealed = await IdentityCrypto.seal(
      recipientPk: b64d(recipient.publicEncKey),
      plaintext: key,
      aad: aad,
    );
    return (
      wrappedKey: b64e(sealed),
      grantSig: await IdentityCrypto.signGrant(
        signSk: me.signSk,
        kind: kind,
        resourceId: resourceId,
        recipientId: recipient.userId,
        granterId: me.userId,
        sealed: sealed,
      ),
    );
  }

  /// Seal an open vault's key to another user, after checking the owner
  /// certified their keys. The vault passphrase is never shared.
  Future<({String wrappedKey, String grantSig})> shareVault({
    required String vaultId,
    required UserKeys recipient,
  }) =>
      _share('vault', vaultId, _vaultKey(vaultId),
          Aad.vaultKey(vaultId, recipient.userId), recipient);

  Future<({String wrappedKey, String grantSig})> shareAlbum({
    required String albumId,
    required UserKeys recipient,
  }) =>
      _share('album', albumId, _albumKey(albumId),
          Aad.albumKeyGrant(albumId, recipient.userId), recipient);

  static EncryptedText _encryptText(Uint8List key, String text, Uint8List aad) {
    final iv = CryptoService.generateIv();
    final encrypted = CryptoService.encrypt(
      plaintext: Uint8List.fromList(utf8.encode(text)),
      key: key,
      iv: iv,
      aad: aad,
    );
    return (encrypted: b64e(encrypted), nonce: b64e(iv));
  }

  /// Null when there is nothing to decrypt or the ciphertext does not verify.
  static String? _decryptText(
      String? encrypted, String? nonce, Uint8List key, Uint8List aad) {
    if (encrypted == null || nonce == null) return null;
    try {
      final text = utf8
          .decode(CryptoService.decrypt(
              ciphertext: b64d(encrypted), key: key, iv: b64d(nonce), aad: aad))
          .trim();
      return text.isEmpty ? null : text;
    } catch (_) {
      return null;
    }
  }
}
