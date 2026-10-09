import '../data/auth_remote_source.dart';
import '../../../core/auth/auth_manager.dart';
import '../../../core/storage/secure_storage_service.dart';

class AuthRepository {
  final AuthRemoteSource _remoteSource;
  final AuthManager _authManager;
  final SecureStorageService _secureStorage;

  AuthRepository({
    required AuthRemoteSource remoteSource,
    required AuthManager authManager,
    required SecureStorageService secureStorage,
  })  : _remoteSource = remoteSource,
        _authManager = authManager,
        _secureStorage = secureStorage;

  Future<void> register({
    required String name,
    required String deviceId,
    required String password,
    String? inviteCode,
  }) async {
    await _remoteSource.register(
      name: name,
      deviceId: deviceId,
      password: password,
      inviteCode: inviteCode,
    );
  }

  Future<Map<String, dynamic>> login({
    required String deviceId,
    required String password,
  }) async {
    final data = await _remoteSource.login(
      deviceId: deviceId,
      password: password,
    );

    await _authManager.saveSession(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
      userId: data['user']['id'] as String,
      role: data['user']['role'] as String,
    );
    await _secureStorage.saveDeviceId(deviceId);

    return data;
  }

  Future<void> logout() async {
    try {
      await _remoteSource.logout();
    } catch (_) {
      // Best-effort
    }
    await _authManager.clearSession();
  }

  Future<bool> isLoggedIn() => _authManager.isLoggedIn();
}
