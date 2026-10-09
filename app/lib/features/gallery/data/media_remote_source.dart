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

  Future<Map<String, dynamic>> getMediaUrls(String mediaId, String vaultId) async {
    final response = await _apiClient.dio.get(
      ApiEndpoints.mediaUrls(mediaId),
      queryParameters: {'vaultId': vaultId},
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> initUpload({
    required String vaultId,
    required String mediaType,
    String? capturedAt,
    int? width,
    int? height,
    int? fileSizeBytes,
  }) async {
    final response = await _apiClient.dio.post(ApiEndpoints.uploadInit, data: {
      'vaultId': vaultId,
      'mediaType': mediaType,
      if (capturedAt != null) 'capturedAt': capturedAt,
      if (width != null) 'width': width,
      if (height != null) 'height': height,
      if (fileSizeBytes != null) 'fileSizeBytes': fileSizeBytes,
    });
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<void> completeUpload(Map<String, dynamic> params) async {
    await _apiClient.dio.post(ApiEndpoints.uploadComplete, data: params);
  }
}
