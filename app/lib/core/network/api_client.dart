import 'package:dio/dio.dart';
import '../storage/secure_storage_service.dart';
import 'api_endpoints.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/error_interceptor.dart';

/// Singleton API client - inject via constructor or service locator.
/// Provided to the widget tree via RepositoryProvider.
class ApiClient {
  late final Dio _dio;

  ApiClient({required SecureStorageService secureStorage}) {
    _dio = Dio(BaseOptions(
      baseUrl: ApiEndpoints.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    _dio.interceptors.addAll([
      AuthInterceptor(dio: _dio, secureStorage: secureStorage),
      ErrorInterceptor(),
    ]);
  }

  Dio get dio => _dio;
}
