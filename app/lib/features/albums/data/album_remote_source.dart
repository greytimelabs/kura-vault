import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

class AlbumRemoteSource {
  final ApiClient _apiClient;

  AlbumRemoteSource(this._apiClient);

  Future<List<dynamic>> listAlbums(String vaultId) async {
    final response = await _apiClient.dio.get(
      ApiEndpoints.albums,
      queryParameters: {'vaultId': vaultId},
    );
    return response.data['data'] as List<dynamic>;
  }

  Future<Map<String, dynamic>> createAlbum({
    required String vaultId,
    required String nameEncrypted,
    required String nameNonce,
  }) async {
    final response = await _apiClient.dio.post(ApiEndpoints.albums, data: {
      'vaultId': vaultId,
      'nameEncrypted': nameEncrypted,
      'nameNonce': nameNonce,
    });
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<void> addMediaToAlbum(String albumId, String mediaId) async {
    await _apiClient.dio.post(ApiEndpoints.albumMedia(albumId), data: {
      'mediaId': mediaId,
    });
  }

  Future<void> removeMediaFromAlbum(String albumId, String mediaId) async {
    await _apiClient.dio.delete(ApiEndpoints.albumMediaRemove(albumId, mediaId));
  }
}
