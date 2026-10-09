import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/accounts/account.dart';
import 'package:kura_vault/core/accounts/account_store.dart';
import 'package:kura_vault/core/network/api_client.dart';
import 'package:kura_vault/core/network/interceptors/auth_interceptor.dart';
import 'package:kura_vault/core/storage/secure_storage_service.dart';

typedef _Handler = ResponseBody? Function(RequestOptions options);

/// Stands in for the network: records every request and answers from [handler].
/// A null answer means the server could not be reached.
class _FakeNetwork implements HttpClientAdapter {
  final List<RequestOptions> requests = [];
  late _Handler handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final response = handler(options);
    if (response == null) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'offline',
      );
    }
    return response;
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const home = 'https://home.example.com';
  const friend = 'https://friend.example.com';

  late AccountStore store;
  late _FakeNetwork network;
  late ApiClient client;
  late List<String> expired;
  late Account homeAccount;
  late Account friendAccount;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    store = AccountStore(SecureStorageService());
    await store.load();
    homeAccount = await store.saveSignIn(
      serverUrl: home,
      username: 'me',
      userId: 'u1',
      role: 'owner',
      accessToken: 'home-access',
      refreshToken: 'home-refresh',
    );
    friendAccount = await store.saveSignIn(
      serverUrl: friend,
      username: 'guest',
      userId: 'u2',
      role: 'viewer',
      accessToken: 'friend-access',
      refreshToken: 'friend-refresh',
    );
    network = _FakeNetwork();
    expired = [];
    client = ApiClient(accounts: store, httpClientAdapter: network)
      ..onSessionExpired = expired.add;
  });

  test('requests go to the active account server with its token', () async {
    network.handler = (_) => _json(200, {'data': []});

    await client.dio.get('/vaults');
    await store.setActive(homeAccount.id);
    await client.dio.get('/vaults');

    expect(network.requests[0].uri.toString(), '$friend/api/v1/vaults');
    expect(network.requests[0].headers['Authorization'], 'Bearer friend-access');
    expect(network.requests[1].uri.toString(), '$home/api/v1/vaults');
    expect(network.requests[1].headers['Authorization'], 'Bearer home-access');
  });

  test('a request can target an account that is not the active one', () async {
    network.handler = (_) => _json(200, {'data': {}});

    await client.dio.post(
      '/auth/logout',
      options: Options(extra: {AuthInterceptor.accountIdKey: homeAccount.id}),
    );

    expect(network.requests.single.uri.toString(), '$home/api/v1/auth/logout');
    expect(
        network.requests.single.headers['Authorization'], 'Bearer home-access');
  });

  test('a 401 refreshes that account only and retries with the new token',
      () async {
    network.handler = (options) {
      if (options.path.endsWith('/auth/refresh')) {
        return _json(200, {
          'data': {'accessToken': 'friend-access-2', 'refreshToken': 'friend-refresh-2'},
        });
      }
      return options.headers['Authorization'] == 'Bearer friend-access-2'
          ? _json(200, {'data': 'ok'})
          : _json(401, {'message': 'Unauthorized'});
    };

    final response = await client.dio.get('/vaults');

    expect(response.data['data'], 'ok');
    final refresh =
        network.requests.firstWhere((r) => r.path.endsWith('/auth/refresh'));
    expect(refresh.uri.toString(), '$friend/api/v1/auth/refresh');
    expect(refresh.data, {'refreshToken': 'friend-refresh'});
    expect(await store.accessToken(friendAccount.id), 'friend-access-2');
    expect(await store.refreshToken(friendAccount.id), 'friend-refresh-2');
    expect(await store.accessToken(homeAccount.id), 'home-access');
    expect(expired, isEmpty);
  });

  test('parallel 401s share one refresh', () async {
    network.handler = (options) {
      if (options.path.endsWith('/auth/refresh')) {
        return _json(200, {
          'data': {'accessToken': 'friend-access-2', 'refreshToken': 'friend-refresh-2'},
        });
      }
      return options.headers['Authorization'] == 'Bearer friend-access-2'
          ? _json(200, {'data': 'ok'})
          : _json(401, {'message': 'Unauthorized'});
    };

    await Future.wait([
      client.dio.get('/vaults'),
      client.dio.get('/albums'),
      client.dio.get('/media'),
    ]);

    expect(
      network.requests.where((r) => r.path.endsWith('/auth/refresh')),
      hasLength(1),
    );
  });

  test('a rejected refresh signs out that account and leaves the other',
      () async {
    network.handler = (_) => _json(401, {'message': 'Unauthorized'});

    await expectLater(client.dio.get('/vaults'), throwsA(isA<DioException>()));

    expect(expired, [friendAccount.id]);
    expect(store.byId(friendAccount.id)!.signedIn, isFalse);
    expect(await store.refreshToken(friendAccount.id), isNull);
    expect(store.byId(homeAccount.id)!.signedIn, isTrue);
    expect(await store.refreshToken(homeAccount.id), 'home-refresh');
    // The account itself is remembered for signing in again
    expect(store.accounts, hasLength(2));
  });

  test('being offline during a refresh signs nobody out', () async {
    network.handler = (options) => options.path.endsWith('/auth/refresh')
        ? null
        : _json(401, {'message': 'Unauthorized'});

    await expectLater(client.dio.get('/vaults'), throwsA(isA<DioException>()));

    expect(expired, isEmpty);
    expect(store.byId(friendAccount.id)!.signedIn, isTrue);
    expect(await store.refreshToken(friendAccount.id), 'friend-refresh');
  });

  group('checkServer', () {
    test('accepts a Kura Vault server', () async {
      network.handler = (_) => _json(200, {
            'data': {'status': 'ok', 'app': 'kura-vault', 'apiVersion': 'v1'},
          });
      await client.checkServer(home);
      expect(network.requests.single.uri.toString(), '$home/api/v1/health');
      expect(network.requests.single.headers.containsKey('Authorization'), isFalse);
    });

    test('rejects something else that answers', () async {
      network.handler = (_) => _json(200, {'hello': 'world'});
      await expectLater(
          client.checkServer(home), throwsA(isA<ServerCheckException>()));

      network.handler = (_) => _json(404, {'message': 'Not found'});
      await expectLater(
          client.checkServer(home), throwsA(isA<ServerCheckException>()));
    });

    test('reports an unreachable server', () async {
      network.handler = (_) => null;
      await expectLater(
        client.checkServer(home),
        throwsA(isA<ServerCheckException>()
            .having((e) => e.message, 'message', contains('Could not reach'))),
      );
    });
  });

  test('login posts username and password to the chosen server', () async {
    network.handler = (_) => _json(200, {
          'data': {'accessToken': 'a', 'refreshToken': 'r'},
        });

    await client.login(serverUrl: home, username: 'me', password: 'secret');

    final request = network.requests.single;
    expect(request.uri.toString(), '$home/api/v1/auth/login');
    expect(request.data, {'username': 'me', 'password': 'secret'});
  });
}
