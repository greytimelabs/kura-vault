import 'dart:typed_data';
import 'package:dio/dio.dart';

/// The pre-signed link ran out before it was used.
class ExpiredLinkException implements Exception {}

/// The file is larger than this app handles in memory.
class TooLargeException implements Exception {
  final int maxBytes;
  const TooLargeException(this.maxBytes);
}

// Storage links are pre-signed: no token goes with them, and nothing about the
// account is sent to the storage host.
final Dio _storage = Dio(BaseOptions(
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(minutes: 5),
));

/// Fetch one encrypted blob from storage. Stops as soon as it is known to be
/// larger than [maxBytes], whether the server said so up front or not.
Future<Uint8List> fetchEncrypted(String url, {required int maxBytes}) async {
  final cancel = CancelToken();
  var tooLarge = false;
  try {
    final response = await _storage.get<List<int>>(
      url,
      cancelToken: cancel,
      options: Options(responseType: ResponseType.bytes),
      onReceiveProgress: (received, total) {
        if (received > maxBytes || total > maxBytes) {
          tooLarge = true;
          cancel.cancel();
        }
      },
    );
    final data = response.data!;
    if (data.length > maxBytes) throw TooLargeException(maxBytes);
    return data is Uint8List ? data : Uint8List.fromList(data);
  } on DioException catch (e) {
    if (tooLarge) throw TooLargeException(maxBytes);
    final status = e.response?.statusCode;
    if (status == 403 || status == 400) throw ExpiredLinkException();
    rethrow;
  }
}
