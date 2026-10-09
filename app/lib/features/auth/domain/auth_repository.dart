import '../data/auth_remote_source.dart';
import '../../../core/accounts/account_store.dart';

class AuthRepository {
  final AuthRemoteSource _remoteSource;
  final AccountStore _accounts;

  AuthRepository({
    required AuthRemoteSource remoteSource,
    required AccountStore accounts,
  })  : _remoteSource = remoteSource,
        _accounts = accounts;

  Future<Map<String, dynamic>> login({
    required String serverUrl,
    required String username,
    required String password,
  }) async {
    final data = await _remoteSource.login(
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

    return data;
  }

  /// Sign out of the active account, keeping its server and username.
  Future<void> logout() async {
    final active = _accounts.active;
    if (active == null) return;
    try {
      await _remoteSource.logout(
        refreshToken: await _accounts.refreshToken(active.id),
      );
    } catch (_) {
      // Best-effort
    }
    await _accounts.markSignedOut(active.id);
  }

  bool isLoggedIn() => _accounts.active?.signedIn ?? false;
}
