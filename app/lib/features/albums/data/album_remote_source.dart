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
}
