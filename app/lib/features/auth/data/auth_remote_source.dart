import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

class AuthRemoteSource {
  final ApiClient _apiClient;

  AuthRemoteSource(this._apiClient);

  Future<Map<String, dynamic>> register({
    required String name,
    required String deviceId,
    required String password,
    String? inviteCode,
  }) async {
    final response = await _apiClient.dio.post(ApiEndpoints.register, data: {
      'name': name,
      'deviceId': deviceId,
      'password': password,
      if (inviteCode != null) 'inviteCode': inviteCode,
    });
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> login({
    required String deviceId,
    required String password,
  }) async {
    final response = await _apiClient.dio.post(ApiEndpoints.login, data: {
      'deviceId': deviceId,
      'password': password,
    });
    return response.data['data'] as Map<String, dynamic>;
  }

  Future<void> logout() async {
    await _apiClient.dio.post(ApiEndpoints.logout);
  }

  Future<Map<String, dynamic>> refreshToken(String refreshToken) async {
    final response = await _apiClient.dio.post(ApiEndpoints.refresh, data: {
      'refreshToken': refreshToken,
    });
    return response.data['data'] as Map<String, dynamic>;
  }
}
