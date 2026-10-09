import '../../../blocs/album/album_state.dart';
import '../data/album_remote_source.dart';

class AlbumRepository {
  final AlbumRemoteSource _remoteSource;

  AlbumRepository(this._remoteSource);

  Future<List<AlbumItem>> getAlbums(String vaultId) async {
    final data = await _remoteSource.listAlbums(vaultId);
    return data
        .map((a) => AlbumItem.fromJson(a as Map<String, dynamic>))
        .toList();
  }

  Future<void> createAlbum({
    required String vaultId,
    required String nameEncrypted,
    required String nameNonce,
  }) async {
    await _remoteSource.createAlbum(
      vaultId: vaultId,
      nameEncrypted: nameEncrypted,
      nameNonce: nameNonce,
    );
  }

  Future<void> addMedia(String albumId, String mediaId) {
    return _remoteSource.addMediaToAlbum(albumId, mediaId);
  }

  Future<void> removeMedia(String albumId, String mediaId) {
    return _remoteSource.removeMediaFromAlbum(albumId, mediaId);
  }
}
