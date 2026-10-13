import 'dart:convert';
import 'dart:typed_data';

/// Public facts about a user, as the server reports them. Untrusted until the
/// certificate verifies against the owner key this account trusts.
class UserKeys {
  final String userId;
  final String username;
  final String publicEncKey;
  final String publicSignKey;
  final String? keyCert;

  const UserKeys({
    required this.userId,
    required this.username,
    required this.publicEncKey,
    required this.publicSignKey,
    this.keyCert,
  });

  factory UserKeys.fromJson(Map<String, dynamic> json) => UserKeys(
        userId: json['userId'] as String,
        username: json['username'] as String,
        publicEncKey: json['publicEncKey'] as String,
        publicSignKey: json['publicSignKey'] as String,
        keyCert: json['keyCert'] as String?,
      );
}

/// The account as the server stores it: public keys, and private keys only the
/// master passphrase can decrypt.
class AccountKeys {
  final String id;
  final String kdfSalt;
  final String encryptedPrivateKeys;
  final String privateKeysNonce;
  final String publicEncKey;
  final String publicSignKey;

  const AccountKeys({
    required this.id,
    required this.kdfSalt,
    required this.encryptedPrivateKeys,
    required this.privateKeysNonce,
    required this.publicEncKey,
    required this.publicSignKey,
  });

  factory AccountKeys.fromJson(Map<String, dynamic> json) => AccountKeys(
        id: json['id'] as String,
        kdfSalt: json['kdfSalt'] as String,
        encryptedPrivateKeys: json['encryptedPrivateKeys'] as String,
        privateKeysNonce: json['privateKeysNonce'] as String,
        publicEncKey: json['publicEncKey'] as String,
        publicSignKey: json['publicSignKey'] as String,
      );
}

/// What a new account sends to the server. Nothing in it is secret.
class AccountMaterial {
  final String kdfSalt;
  final String encryptedPrivateKeys;
  final String privateKeysNonce;
  final String publicEncKey;
  final String publicSignKey;

  /// Owner only: their signature over their own keys.
  final String? keyCert;

  /// Invitee only: proof, keyed from the invite link, that these are their keys.
  final String? keyBinding;

  const AccountMaterial({
    required this.kdfSalt,
    required this.encryptedPrivateKeys,
    required this.privateKeysNonce,
    required this.publicEncKey,
    required this.publicSignKey,
    this.keyCert,
    this.keyBinding,
  });

  Map<String, dynamic> toJson() => {
        'kdfSalt': kdfSalt,
        'encryptedPrivateKeys': encryptedPrivateKeys,
        'privateKeysNonce': privateKeysNonce,
        'publicEncKey': publicEncKey,
        'publicSignKey': publicSignKey,
      };
}

/// One vault this account can open, with its wrapped copy of the vault key.
class VaultInfo {
  final String id;

  /// `creator` (the key is also behind the vault passphrase) or `member`.
  final String role;
  final String permission;
  final String wrappedKey;
  final String? kdfSalt;
  final String? grantSig;
  final UserKeys? granter;
  final String? labelEncrypted;
  final String? labelNonce;

  const VaultInfo({
    required this.id,
    required this.role,
    this.permission = 'view',
    required this.wrappedKey,
    this.kdfSalt,
    this.grantSig,
    this.granter,
    this.labelEncrypted,
    this.labelNonce,
  });

  bool get isCreator => role == 'creator';

  factory VaultInfo.fromJson(Map<String, dynamic> json) => VaultInfo(
        id: json['id'] as String,
        role: json['role'] as String,
        permission: json['permission'] as String? ?? 'view',
        wrappedKey: json['wrappedKey'] as String,
        kdfSalt: json['kdfSalt'] as String?,
        grantSig: json['grantSig'] as String?,
        granter: json['granter'] == null
            ? null
            : UserKeys.fromJson(json['granter'] as Map<String, dynamic>),
        labelEncrypted: json['labelEncrypted'] as String?,
        labelNonce: json['labelNonce'] as String?,
      );
}

/// An album shared with this account on its own.
class SharedAlbumInfo {
  final String id;
  final String vaultId;
  final String permission;
  final String wrappedKey;
  final String grantSig;
  final UserKeys? granter;
  final String? nameEncrypted;
  final String? nameNonce;

  const SharedAlbumInfo({
    required this.id,
    required this.vaultId,
    this.permission = 'view',
    required this.wrappedKey,
    required this.grantSig,
    this.granter,
    this.nameEncrypted,
    this.nameNonce,
  });

  factory SharedAlbumInfo.fromJson(Map<String, dynamic> json) =>
      SharedAlbumInfo(
        id: json['id'] as String,
        vaultId: json['vaultId'] as String,
        permission: json['permission'] as String? ?? 'view',
        wrappedKey: json['wrappedKey'] as String,
        grantSig: json['grantSig'] as String,
        granter: json['granter'] == null
            ? null
            : UserKeys.fromJson(json['granter'] as Map<String, dynamic>),
        nameEncrypted: json['nameEncrypted'] as String?,
        nameNonce: json['nameNonce'] as String?,
      );
}

/// Something another user shared with this account, already opened: a whole
/// vault, or one album.
class SharedSpace {
  /// `vault` or `album`.
  final String kind;
  final String id;
  final String vaultId;
  final String label;
  final String permission;
  final String sharedBy;

  const SharedSpace({
    required this.kind,
    required this.id,
    required this.vaultId,
    required this.label,
    required this.permission,
    required this.sharedBy,
  });

  bool get isAlbum => kind == 'album';
  bool get canWrite => permission == 'write';
}

/// An item's wrapped key and which key it is wrapped under.
class MediaKeyRef {
  /// `vault` or `album`.
  final String scope;
  final String vaultId;
  final String? albumId;
  final String wrapped;
  final String nonce;

  const MediaKeyRef({
    required this.scope,
    required this.vaultId,
    this.albumId,
    required this.wrapped,
    required this.nonce,
  });

  static MediaKeyRef? fromJson(Object? json, String vaultId) {
    if (json is! Map<String, dynamic>) return null;
    return MediaKeyRef(
      scope: json['scope'] as String,
      vaultId: vaultId,
      albumId: json['albumId'] as String?,
      wrapped: json['wrapped'] as String,
      nonce: json['nonce'] as String,
    );
  }
}

/// A key wrapped under another AES key, both parts base64.
typedef WrappedKey = ({String wrapped, String nonce});

/// Text encrypted under a vault, album or item key, both parts base64.
typedef EncryptedText = ({String encrypted, String nonce});

/// One encrypted tier of an upload, with its IV in base64.
typedef EncryptedTier = ({Uint8List data, String iv});

/// What the server stores for a new vault.
typedef NewVault = ({
  String id,
  String wrappedKey,
  String kdfSalt,
  String? labelEncrypted,
  String? labelNonce,
});

/// What the server stores for a new album.
typedef NewAlbum = ({
  String id,
  String keyWrapped,
  String keyNonce,
  String nameEncrypted,
  String nameNonce,
});

/// An upload, encrypted. [vaultKey] is null when uploading with only an album
/// key; [albumKey] is null when the upload does not go into an album.
typedef EncryptedMedia = ({
  WrappedKey? vaultKey,
  WrappedKey? albumKey,
  EncryptedTier thumb,
  EncryptedTier preview,
  EncryptedTier original,
  String encryptedMeta,
  String metaNonce,
});

/// The invite link. Everything that matters is in the fragment, which is never
/// sent to any server: the secret that proves the invitee's keys to the owner,
/// and the owner's signing key the invitee will trust from then on.
class InviteLink {
  final String? server;
  final String inviteId;

  /// base64. Never sent to the server.
  final String secret;

  /// base64 Ed25519 public key of the server owner.
  final String ownerSignKey;

  const InviteLink({
    this.server,
    required this.inviteId,
    required this.secret,
    required this.ownerSignKey,
  });

  static const _invalid =
      FormatException('This invite link is not valid. Ask the owner for a new one.');

  /// Accepts a whole link or just what follows the `#`.
  factory InviteLink.parse(String link) {
    final trimmed = link.trim();
    final fragment = trimmed.contains('#')
        ? trimmed.substring(trimmed.indexOf('#') + 1)
        : trimmed;
    final dot = fragment.indexOf('.');
    try {
      if (dot <= 0 || fragment.substring(0, dot) != 'v1') throw _invalid;
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(fragment.substring(dot + 1)))),
      ) as Map<String, dynamic>;
      final invite = InviteLink(
        server: payload['s'] as String?,
        inviteId: payload['i'] as String,
        secret: payload['k'] as String,
        ownerSignKey: payload['o'] as String,
      );
      if (base64.decode(invite.secret).length != 32 ||
          base64.decode(invite.ownerSignKey).length != 32 ||
          !RegExp(r'^[0-9a-f-]{36}$').hasMatch(invite.inviteId)) {
        throw _invalid;
      }
      return invite;
    } catch (_) {
      throw _invalid;
    }
  }

  /// The link to hand over, for a client hosted at [origin].
  String encode(String origin) {
    final payload = jsonEncode({'s': server, 'i': inviteId, 'k': secret, 'o': ownerSignKey});
    final encoded = base64Url.encode(utf8.encode(payload)).replaceAll('=', '');
    return '$origin/join#v1.$encoded';
  }
}

Uint8List b64d(String value) => Uint8List.fromList(base64.decode(value));
String b64e(List<int> bytes) => base64.encode(bytes);
