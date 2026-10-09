import 'package:dio/dio.dart';

/// Global error handling interceptor.
class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Transform DioExceptions into more readable errors
    final statusCode = err.response?.statusCode;
    final message = _extractMessage(err);

    final enrichedError = DioException(
      requestOptions: err.requestOptions,
      response: err.response,
      type: err.type,
      error: message,
      message: '[$statusCode] $message',
    );

    handler.next(enrichedError);
  }

  String _extractMessage(DioException err) {
    try {
      final data = err.response?.data;
      if (data is Map<String, dynamic>) {
        return data['message'] as String? ?? 'Unknown error';
      }
    } catch (_) {}

    return switch (err.type) {
      DioExceptionType.connectionTimeout => 'Connection timed out',
      DioExceptionType.receiveTimeout => 'Server took too long to respond',
      DioExceptionType.connectionError => 'Could not connect to server',
      _ => 'Something went wrong',
    };
  }
}
