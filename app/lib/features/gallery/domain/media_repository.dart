import '../../../blocs/media/media_state.dart';
import '../data/media_remote_source.dart';

class MediaRepository {
  final MediaRemoteSource _remoteSource;

  MediaRepository(this._remoteSource);

  Future<({List<MediaItem> items, int total, int page, int totalPages})> getMedia({
    required String vaultId,
    int page = 1,
    int limit = 50,
    String? albumId,
    String? yearMonth,
  }) async {
    final data = await _remoteSource.queryMedia(
      vaultId: vaultId,
      page: page,
      limit: limit,
      albumId: albumId,
      yearMonth: yearMonth,
    );

    final items = (data['data'] as List<dynamic>)
        .map((m) => MediaItem.fromJson(m as Map<String, dynamic>))
        .toList();

    return (
      items: items,
      total: data['total'] as int,
      page: data['page'] as int,
      totalPages: data['totalPages'] as int,
    );
  }

  Future<Map<String, dynamic>> getMediaUrls(String mediaId, String vaultId) {
    return _remoteSource.getMediaUrls(mediaId, vaultId);
  }
}
