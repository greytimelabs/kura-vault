import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../constants/app_constants.dart';

/// Wrapper around flutter_secure_storage for token persistence.
class SecureStorageService {
  final FlutterSecureStorage _storage;

  SecureStorageService()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
        );

  Future<void> saveAccessToken(String token) =>
      _storage.write(key: AppConstants.keyAccessToken, value: token);

  Future<String?> getAccessToken() =>
      _storage.read(key: AppConstants.keyAccessToken);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: AppConstants.keyRefreshToken, value: token);

  Future<String?> getRefreshToken() =>
      _storage.read(key: AppConstants.keyRefreshToken);

  Future<void> saveDeviceId(String deviceId) =>
      _storage.write(key: AppConstants.keyDeviceId, value: deviceId);

  Future<String?> getDeviceId() =>
      _storage.read(key: AppConstants.keyDeviceId);

  Future<void> saveUserId(String userId) =>
      _storage.write(key: AppConstants.keyUserId, value: userId);

  Future<String?> getUserId() => _storage.read(key: AppConstants.keyUserId);

  Future<void> saveUserRole(String role) =>
      _storage.write(key: AppConstants.keyUserRole, value: role);

  Future<String?> getUserRole() =>
      _storage.read(key: AppConstants.keyUserRole);

  Future<void> clearAll() => _storage.deleteAll();
}
