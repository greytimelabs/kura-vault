import 'package:dio/dio.dart';

/// The server's message for a failed request (see ErrorInterceptor), or
/// [fallback] when there is none worth showing.
String apiErrorMessage(Object error, String fallback) {
  if (error is DioException) {
    final message = error.error;
    if (message is String && message.isNotEmpty && message != 'Unknown error') {
      return message;
    }
  }
  if (error is StateError) return error.message;
  return fallback;
}

/// HTTP status of a failed request, or null when it never got an answer.
int? apiStatus(Object error) =>
    error is DioException ? error.response?.statusCode : null;
