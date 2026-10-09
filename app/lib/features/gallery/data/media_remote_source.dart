import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

class MediaRemoteSource {
  final ApiClient _apiClient;

  MediaRemoteSource(this._apiClient);

  Future<Map<String, dynamic>> queryMedia({
    required String vaultId,
    int page = 1,
    int limit = 50,
    String? albumId,
    String? yearMonth,
  }) async {
    final response = await _apiClient.dio.get(
      ApiEndpoints.media,
      queryParameters: {
        'vaultId': vaultId,
        'page': page,
        'limit': limit,
        if (albumId != null) 'albumId': albumId,
        if (yearMonth != null) 'yearMonth': yearMonth,
      },
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getMediaUrls(String mediaId) async {
    final response = await _apiClient.dio.get(ApiEndpoints.mediaUrls(mediaId));
    return response.data['data'] as Map<String, dynamic>;
  }
}
