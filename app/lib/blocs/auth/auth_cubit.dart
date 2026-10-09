import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/accounts/account_store.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import '../../core/network/interceptors/auth_interceptor.dart';
import 'auth_state.dart';

/// Accounts and which one is active. Changing the active account, or the
/// active account losing its login, is what the app shell reacts to by locking
/// the vault.
class AuthCubit extends Cubit<AuthState> {
  final ApiClient _apiClient;
  final AccountStore _accounts;

  AuthCubit({
    required ApiClient apiClient,
    required AccountStore accounts,
  })  : _apiClient = apiClient,
        _accounts = accounts,
        super(const AuthState()) {
    _apiClient.onSessionExpired = (_) => _sync();
  }

  /// Read the saved accounts.
  Future<void> init() async {
    await _accounts.load();
    _sync();
  }

  /// Sign in with username + password on [serverUrl] and make that account
  /// active. The password is used for this one request and not kept.
  Future<bool> login({
    required String serverUrl,
    required String username,
    required String password,
  }) async {
    emit(state.copyWith(busy: true));
    try {
      final data = await _apiClient.login(
        serverUrl: serverUrl,
        username: username,
        password: password,
      );
      await _accounts.saveSignIn(
        serverUrl: serverUrl,
        username: username,
        userId: data['user']['id'] as String,
        role: data['user']['role'] as String,
        accessLevel: data['user']['accessLevel'] as String?,
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      _sync();
      return true;
    } catch (e) {
      emit(state.copyWith(
        busy: false,
        errorMessage: e is DioException ? '${e.error}' : 'Login failed',
      ));
      return false;
    }
  }

  /// Make another signed-in account the active one.
  Future<void> switchAccount(String id) async {
    final account = _accounts.byId(id);
    if (account == null || !account.signedIn || id == _accounts.activeId) {
      return;
    }
    await _accounts.setActive(id);
    _sync();
  }

  /// Sign out of one account — revoke its tokens but remember its server and
  /// username. If it was the active account and another one is still signed
  /// in, that one becomes active.
  Future<void> signOut(String id) async {
    await _revoke(id);
    await _accounts.markSignedOut(id);
    if (id == _accounts.activeId) {
      final next = _accounts.otherSignedIn(id);
      if (next != null) await _accounts.setActive(next.id);
    }
    _sync();
  }

  /// Sign out and forget the account on this device.
  Future<void> removeAccount(String id) async {
    await _revoke(id);
    await _accounts.remove(id);
    _sync();
  }

  Future<void> _revoke(String id) async {
    if (!(_accounts.byId(id)?.signedIn ?? false)) return;
    try {
      // Sending this session's token ends only this session, so a browser
      // signed in to the same account stays signed in.
      final refreshToken = await _accounts.refreshToken(id);
      await _apiClient.dio.post(
        ApiEndpoints.logout,
        data: {if (refreshToken != null) 'refreshToken': refreshToken},
        options: Options(extra: {AuthInterceptor.accountIdKey: id}),
      );
    } catch (_) {
      // Best-effort logout
    }
  }

  void _sync() {
    if (isClosed) return;
    emit(AuthState(
      initialized: true,
      accounts: _accounts.accounts,
      activeId: _accounts.activeId,
    ));
  }
}
