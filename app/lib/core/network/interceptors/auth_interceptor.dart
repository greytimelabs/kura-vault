import 'package:dio/dio.dart';
import '../../accounts/account.dart';
import '../../accounts/account_store.dart';
import '../api_endpoints.dart';

/// Routes each request to an account's server, attaches that account's JWT
/// access token, and handles 401 refresh.
class AuthInterceptor extends Interceptor {
  /// `extra` key naming the account a request belongs to. Set by the caller to
  /// target a specific account; otherwise filled in with the active one.
  static const String accountIdKey = 'accountId';
  static const String _retriedKey = 'authRetried';

  final AccountStore accounts;

  /// Bare client for the refresh call itself, so it cannot recurse into here.
  final Dio refreshDio;
  late Dio dio;
  void Function(String accountId)? onSessionExpired;

  /// One refresh per account at a time: refresh tokens rotate on use, so two
  /// parallel refreshes would have one present an already-used token.
  final Map<String, Future<String?>> _refreshes = {};

  AuthInterceptor({required this.accounts, required this.refreshDio});

  @override
  void onRequest(
      RequestOptions options, RequestInterceptorHandler handler) async {
    final requestedId = options.extra[accountIdKey] as String?;
    final account =
        requestedId != null ? accounts.byId(requestedId) : accounts.active;
    if (account == null) {
      return handler.reject(DioException(
        requestOptions: options,
        type: DioExceptionType.cancel,
        error: 'No account',
      ));
    }

    // Pin the request to this account: if the user switches while it is in
    // flight, a 401 must still refresh the session it was sent with.
    options.extra[accountIdKey] = account.id;
    options.baseUrl = account.apiBaseUrl;

    final token = await accounts.accessToken(account.id);
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final opts = err.requestOptions;
    final accountId = opts.extra[accountIdKey] as String?;
    final account = accountId == null ? null : accounts.byId(accountId);

    if (err.response?.statusCode != 401 ||
        account == null ||
        opts.extra[_retriedKey] == true) {
      return handler.next(err);
    }

    try {
      final newAccessToken = await _refresh(account);
      if (newAccessToken == null) {
        return handler.next(err);
      }

      // Retry original request
      opts.extra[_retriedKey] = true;
      final retryResponse = await dio.fetch(opts);
      return handler.resolve(retryResponse);
    } on DioException catch (e) {
      // Refresh could not be attempted (offline) or the retry failed
      return handler.next(e);
    }
  }

  Future<String?> _refresh(Account account) {
    // Block body on purpose: returning the removed future from whenComplete
    // would make the refresh wait on itself.
    return _refreshes[account.id] ??= _doRefresh(account).whenComplete(() {
      _refreshes.remove(account.id);
    });
  }

  /// Returns the new access token, or null when the login is over. Throws when
  /// the server could not be reached: being offline never signs anyone out.
  Future<String?> _doRefresh(Account account) async {
    final refreshToken = await accounts.refreshToken(account.id);
    if (refreshToken == null) {
      await _expire(account.id);
      return null;
    }

    try {
      final response = await refreshDio.post(
        '${account.apiBaseUrl}${ApiEndpoints.refresh}',
        data: {'refreshToken': refreshToken},
      );
      final newAccessToken = response.data['data']['accessToken'] as String;
      final newRefreshToken = response.data['data']['refreshToken'] as String;
      await accounts.saveTokens(
        account.id,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );
      return newAccessToken;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        await _expire(account.id);
        return null;
      }
      rethrow;
    }
  }

  /// The login is over: keep the account, drop its tokens, tell the app.
  Future<void> _expire(String accountId) async {
    await accounts.markSignedOut(accountId);
    onSessionExpired?.call(accountId);
  }
}
