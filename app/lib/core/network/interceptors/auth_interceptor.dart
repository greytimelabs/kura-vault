import 'package:dio/dio.dart';
import '../../storage/secure_storage_service.dart';
import '../api_endpoints.dart';

/// Attaches JWT access token to requests and handles 401 refresh.
class AuthInterceptor extends Interceptor {
  final Dio dio;
  final SecureStorageService secureStorage;
  bool _isRefreshing = false;

  AuthInterceptor({required this.dio, required this.secureStorage});

  @override
  void onRequest(
      RequestOptions options, RequestInterceptorHandler handler) async {
    // Skip auth for login/register/refresh
    final noAuthPaths = [
      ApiEndpoints.login,
      ApiEndpoints.register,
      ApiEndpoints.refresh,
    ];
    if (noAuthPaths.any((p) => options.path.contains(p))) {
      return handler.next(options);
    }

    final token = await secureStorage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401 && !_isRefreshing) {
      _isRefreshing = true;
      try {
        final refreshToken = await secureStorage.getRefreshToken();
        if (refreshToken == null) {
          _isRefreshing = false;
          return handler.next(err);
        }

        // Attempt token refresh
        final response = await Dio(BaseOptions(
          baseUrl: ApiEndpoints.baseUrl,
        )).post(ApiEndpoints.refresh, data: {
          'refreshToken': refreshToken,
        });

        final newAccessToken = response.data['data']['accessToken'] as String;
        final newRefreshToken =
            response.data['data']['refreshToken'] as String;

        await secureStorage.saveAccessToken(newAccessToken);
        await secureStorage.saveRefreshToken(newRefreshToken);

        // Retry original request
        final opts = err.requestOptions;
        opts.headers['Authorization'] = 'Bearer $newAccessToken';
        final retryResponse = await dio.fetch(opts);
        _isRefreshing = false;
        return handler.resolve(retryResponse);
      } catch (_) {
        _isRefreshing = false;
        // Refresh failed — clear tokens
        await secureStorage.clearAll();
      }
    }
    handler.next(err);
  }
}
