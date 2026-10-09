import 'package:dio/dio.dart';
import '../accounts/account_store.dart';
import 'api_endpoints.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/error_interceptor.dart';

/// Why a server address could not be used. [message] is shown to the user.
class ServerCheckException implements Exception {
  final String message;
  const ServerCheckException(this.message);

  @override
  String toString() => message;
}

/// Singleton API client - inject via constructor or service locator.
/// Provided to the widget tree via RepositoryProvider.
///
/// There is no fixed server. [dio] sends each request to the active account's
/// server with that account's token; a request can target another account by
/// passing `Options(extra: {AuthInterceptor.accountIdKey: id})`.
class ApiClient {
  late final Dio _dio;
  late final Dio _plain;
  late final AuthInterceptor _authInterceptor;

  /// [httpClientAdapter] replaces the network in tests.
  ApiClient({
    required AccountStore accounts,
    HttpClientAdapter? httpClientAdapter,
  }) {
    _plain = Dio(_baseOptions())..interceptors.add(ErrorInterceptor());
    _authInterceptor = AuthInterceptor(accounts: accounts, refreshDio: _plain);
    _dio = Dio(_baseOptions());
    if (httpClientAdapter != null) {
      _plain.httpClientAdapter = httpClientAdapter;
      _dio.httpClientAdapter = httpClientAdapter;
    }
    _authInterceptor.dio = _dio;
    _dio.interceptors.addAll([_authInterceptor, ErrorInterceptor()]);
  }

  static BaseOptions _baseOptions() => BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      );

  Dio get dio => _dio;

  /// Called with the account id when a login can no longer be refreshed.
  set onSessionExpired(void Function(String accountId)? handler) =>
      _authInterceptor.onSessionExpired = handler;

  /// Confirm that [serverUrl] answers as a Kura Vault server. Returns true
  /// when the server still needs its owner account created.
  Future<bool> checkServer(String serverUrl) async {
    final Response<dynamic> response;
    try {
      response = await _plain.get('$serverUrl/api/v1${ApiEndpoints.health}');
    } on DioException catch (e) {
      if (e.response != null) {
        throw const ServerCheckException(
          'This does not look like a Kura Vault server',
        );
      }
      throw const ServerCheckException(
        'Could not reach the server. Check the address and your connection',
      );
    }

    final body = response.data;
    final data = body is Map<String, dynamic> ? body['data'] : null;
    if (data is! Map<String, dynamic> || data['app'] != 'kura-vault') {
      throw const ServerCheckException(
        'This does not look like a Kura Vault server',
      );
    }
    return data['setupRequired'] == true;
  }

  /// Sign in on [serverUrl]. Returns the response's `data` object.
  Future<Map<String, dynamic>> login({
    required String serverUrl,
    required String username,
    required String password,
  }) async {
    final response = await _plain.post(
      '$serverUrl/api/v1${ApiEndpoints.login}',
      data: {'username': username, 'password': password},
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  /// First run: create the server's owner account with the setup key.
  Future<void> setup({
    required String serverUrl,
    required Map<String, dynamic> body,
  }) async {
    await _plain.post('$serverUrl/api/v1${ApiEndpoints.setup}', data: body);
  }

  /// What the server says about an invite, to whoever holds its link.
  Future<Map<String, dynamic>> getInvite({
    required String serverUrl,
    required String inviteId,
    required String token,
  }) async {
    final response = await _plain.get(
      '$serverUrl/api/v1${ApiEndpoints.invite(inviteId)}',
      options: Options(headers: {'X-Invite-Token': token}),
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  /// Turn an invite into an account.
  Future<void> acceptInvite({
    required String serverUrl,
    required String inviteId,
    required Map<String, dynamic> body,
  }) async {
    await _plain.post(
      '$serverUrl/api/v1${ApiEndpoints.inviteAccept(inviteId)}',
      data: body,
    );
  }
}
