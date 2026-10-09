import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/auth/auth_manager.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import '../../core/storage/secure_storage_service.dart';
import 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  final ApiClient _apiClient;
  final AuthManager _authManager;
  final SecureStorageService _secureStorage;

  AuthCubit({
    required ApiClient apiClient,
    required AuthManager authManager,
    required SecureStorageService secureStorage,
  })  : _apiClient = apiClient,
        _authManager = authManager,
        _secureStorage = secureStorage,
        super(const AuthState());

  /// Check if user has an existing session.
  Future<void> checkAuth() async {
    final isLoggedIn = await _authManager.isLoggedIn();
    if (isLoggedIn) {
      final userId = await _secureStorage.getUserId();
      final role = await _secureStorage.getUserRole();
      emit(state.copyWith(
        status: AuthStatus.authenticated,
        userId: userId,
        userRole: role,
      ));
    } else {
      emit(state.copyWith(status: AuthStatus.unauthenticated));
    }
  }

  /// Login with device_id + password.
  Future<void> login({
    required String deviceId,
    required String password,
  }) async {
    emit(state.copyWith(status: AuthStatus.loading));
    try {
      final response = await _apiClient.dio.post(ApiEndpoints.login, data: {
        'deviceId': deviceId,
        'password': password,
      });

      final data = response.data['data'] as Map<String, dynamic>;
      await _authManager.saveSession(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
        userId: data['user']['id'] as String,
        role: data['user']['role'] as String,
      );
      await _secureStorage.saveDeviceId(deviceId);

      emit(state.copyWith(
        status: AuthStatus.authenticated,
        userId: data['user']['id'] as String,
        userRole: data['user']['role'] as String,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: AuthStatus.error,
        errorMessage: e.toString(),
      ));
    }
  }

  /// Logout — revoke tokens and clear session.
  Future<void> logout() async {
    try {
      // Sending this session's token ends only this session, so a browser
      // signed in to the same account stays signed in.
      final refreshToken = await _secureStorage.getRefreshToken();
      await _apiClient.dio.post(ApiEndpoints.logout, data: {
        if (refreshToken != null) 'refreshToken': refreshToken,
      });
    } catch (_) {
      // Best-effort logout
    }
    await _authManager.clearSession();
    emit(const AuthState(status: AuthStatus.unauthenticated));
  }
}
