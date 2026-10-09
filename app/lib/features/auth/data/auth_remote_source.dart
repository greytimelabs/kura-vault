import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

class AuthRemoteSource {
  final ApiClient _apiClient;

  AuthRemoteSource(this._apiClient);

  Future<Map<String, dynamic>> login({
    required String serverUrl,
    required String username,
    required String password,
  }) {
    return _apiClient.login(
      serverUrl: serverUrl,
      username: username,
      password: password,
    );
  }

  /// Ends the active account's session on its server.
  Future<void> logout({String? refreshToken}) async {
    await _apiClient.dio.post(ApiEndpoints.logout, data: {
      if (refreshToken != null) 'refreshToken': refreshToken,
    });
  }
}
