import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:kura_vault/core/accounts/account_store.dart';
import 'package:kura_vault/core/network/api_client.dart';
import 'package:kura_vault/core/storage/secure_storage_service.dart';

/// Stands in for the network: records every request and answers from [handler].
class FakeNetwork implements HttpClientAdapter {
  final List<RequestOptions> requests = [];
  ResponseBody Function(RequestOptions options) handler = (_) => json(200, {'data': null});

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}

  /// Requests made with [method] to a path ending in [path].
  Iterable<RequestOptions> sent(String method, String path) =>
      requests.where((r) => r.method == method && r.uri.path.endsWith(path));

  static ResponseBody json(int status, Object body) => ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
}

/// An API client signed in as one account, talking to [network].
Future<ApiClient> signedInClient(FakeNetwork network, {String role = 'owner'}) async {
  FlutterSecureStorage.setMockInitialValues({});
  final store = AccountStore(SecureStorageService());
  await store.load();
  await store.saveSignIn(
    serverUrl: 'https://home.example.com',
    username: 'me',
    userId: 'u1',
    role: role,
    accessToken: 'access',
    refreshToken: 'refresh',
  );
  return ApiClient(accounts: store, httpClientAdapter: network);
}
