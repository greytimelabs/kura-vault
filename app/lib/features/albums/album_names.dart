import '../../blocs/album/album_state.dart';
import '../../blocs/crypto/vault_crypto_cubit.dart';

/// Decrypted names by album id, loading each album's key through the vault key
/// on the way. The server only ever holds the ciphertext.
Map<String, String> albumNames(
    VaultCryptoCubit crypto, String vaultId, List<AlbumItem> albums) {
  return crypto.openAlbums(vaultId, [
    for (final a in albums)
      (
        id: a.id,
        keyWrapped: a.keyWrapped,
        keyNonce: a.keyNonce,
        nameEncrypted: a.nameEncrypted,
        nameNonce: a.nameNonce,
      ),
  ]);
}

String albumTitle(AlbumItem album, Map<String, String> names) =>
    album.isLiked ? 'Liked' : (names[album.id] ?? 'Untitled album');

String itemCount(int count) => count == 1 ? '1 item' : '$count items';
