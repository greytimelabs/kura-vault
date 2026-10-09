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
}
