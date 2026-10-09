import 'dart:convert';
import 'dart:typed_data';

/// Additional data for every AES-GCM operation, and the messages that get
/// signed. Each names what the ciphertext is and the rows it belongs to, so the
/// server cannot move a wrapped key or a blob to another user, vault, album or
/// item. Must stay identical to web/src/lib/crypto/aad.ts.
class Aad {
  static Uint8List _text(List<String> parts) =>
      Uint8List.fromList(utf8.encode('kura/v1/${parts.join('|')}'));

  static Uint8List userKeys(String userId) => _text(['user-keys', userId]);
  static Uint8List inviteSecret(String inviteId) =>
      _text(['invite-secret', inviteId]);

  /// Inner, passphrase layer of a creator's vault key.
  static Uint8List vaultKeyPassphrase(String vaultId, String userId) =>
      _text(['vault-key-pass', vaultId, userId]);

  /// A vault key sealed to a user.
  static Uint8List vaultKey(String vaultId, String userId) =>
      _text(['vault-key', vaultId, userId]);
  static Uint8List vaultLabel(String vaultId) => _text(['vault-label', vaultId]);

  /// An album key wrapped under its vault key.
  static Uint8List albumKey(String albumId, String vaultId) =>
      _text(['album-key', albumId, vaultId]);

  /// An album key sealed to a user.
  static Uint8List albumKeyGrant(String albumId, String userId) =>
      _text(['album-key-grant', albumId, userId]);
  static Uint8List albumName(String albumId) => _text(['album-name', albumId]);
  static Uint8List mediaKeyVault(String mediaId, String vaultId) =>
      _text(['media-key', mediaId, 'vault', vaultId]);
  static Uint8List mediaKeyAlbum(String mediaId, String albumId) =>
      _text(['media-key', mediaId, 'album', albumId]);

  /// [tier] is `thumb`, `preview` or `original`.
  static Uint8List mediaBlob(String mediaId, String tier) =>
      _text(['media-blob', mediaId, tier]);
  static Uint8List mediaMeta(String mediaId) => _text(['media-meta', mediaId]);

  // ── Signed messages ──

  /// The owner's statement that these public keys belong to this user.
  static Uint8List cert(
          String userId, String username, String encPk, String signPk) =>
      _text(['cert', userId, username, encPk, signPk]);

  /// A sharer's statement that they issued this sealed key. [digest] is the
  /// base64 SHA-256 of the sealed bytes; [kind] is `vault` or `album`.
  static Uint8List grant(String kind, String resourceId, String recipientId,
          String granterId, String digest) =>
      _text(['grant', kind, resourceId, recipientId, granterId, digest]);

  /// What an invitee authenticates with the invite secret.
  static Uint8List binding(
          String userId, String username, String encPk, String signPk) =>
      _text(['bind', userId, username, encPk, signPk]);

  static final Uint8List sealInfo =
      Uint8List.fromList(utf8.encode('kura/seal/v1'));
  static final Uint8List inviteAuthInfo =
      Uint8List.fromList(utf8.encode('kura/v1/invite/auth'));
  static final Uint8List inviteBindInfo =
      Uint8List.fromList(utf8.encode('kura/v1/invite/bind'));
}
