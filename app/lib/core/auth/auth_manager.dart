import '../storage/secure_storage_service.dart';

/// Manages session lifecycle: login state, token persistence.
class AuthManager {
  final SecureStorageService _secureStorage;

  AuthManager(this._secureStorage);

  Future<bool> isLoggedIn() async {
    final token = await _secureStorage.getAccessToken();
    return token != null;
  }

  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    required String userId,
    required String role,
  }) async {
    await _secureStorage.saveAccessToken(accessToken);
    await _secureStorage.saveRefreshToken(refreshToken);
    await _secureStorage.saveUserId(userId);
    await _secureStorage.saveUserRole(role);
  }

  Future<void> clearSession() async {
    await _secureStorage.clearAll();
  }
}
