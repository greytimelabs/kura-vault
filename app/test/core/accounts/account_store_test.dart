import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/accounts/account.dart';
import 'package:kura_vault/core/accounts/account_store.dart';
import 'package:kura_vault/core/storage/secure_storage_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const home = 'https://home.example.com';
  const friend = 'https://friend.example.com';

  Future<AccountStore> freshStore() async {
    final store = AccountStore(SecureStorageService());
    await store.load();
    return store;
  }

  Future<Account> signIn(AccountStore store, String server, String username) {
    return store.saveSignIn(
      serverUrl: server,
      username: username,
      userId: 'id-$username',
      role: 'owner',
      accessToken: 'access-$username',
      refreshToken: 'refresh-$username',
    );
  }

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('signing in adds an account, makes it active and survives a restart',
      () async {
    final store = await freshStore();
    final a = await signIn(store, home, 'me');
    final b = await signIn(store, friend, 'guest');

    expect(store.accounts, [a, b]);
    expect(store.activeId, b.id);

    final reloaded = await freshStore();
    expect(reloaded.accounts, [a, b]);
    expect(reloaded.activeId, b.id);
    expect(await reloaded.accessToken(a.id), 'access-me');
    expect(await reloaded.refreshToken(b.id), 'refresh-guest');
  });

  test('signing in again to the same server and username reuses the entry',
      () async {
    final store = await freshStore();
    final first = await signIn(store, home, 'me');
    await store.markSignedOut(first.id);
    final second = await signIn(store, home, 'me');

    expect(second.id, first.id);
    expect(store.accounts, hasLength(1));
    expect(store.accounts.single.signedIn, isTrue);
  });

  test('the same username on another server is a separate account', () async {
    final store = await freshStore();
    await signIn(store, home, 'me');
    await signIn(store, friend, 'me');
    expect(store.accounts, hasLength(2));
  });

  test('switching changes only the active account', () async {
    final store = await freshStore();
    final a = await signIn(store, home, 'me');
    final b = await signIn(store, friend, 'guest');

    await store.setActive(a.id);
    expect(store.active, a);
    expect(await store.accessToken(b.id), 'access-guest');

    await store.setActive('unknown');
    expect(store.activeId, a.id);
  });

  test('signing out drops the tokens but keeps server and username', () async {
    final store = await freshStore();
    final a = await signIn(store, home, 'me');
    await store.markSignedOut(a.id);

    expect(await store.accessToken(a.id), isNull);
    expect(await store.refreshToken(a.id), isNull);
    final kept = store.byId(a.id)!;
    expect(kept.signedIn, isFalse);
    expect(kept.serverUrl, home);
    expect(kept.username, 'me');
  });

  test('removing the active account falls back to one still signed in',
      () async {
    final store = await freshStore();
    final a = await signIn(store, home, 'me');
    final b = await signIn(store, friend, 'guest');
    final c = await signIn(store, 'https://third.example.com', 'x');
    await store.markSignedOut(a.id);

    await store.remove(c.id);
    expect(store.activeId, b.id);
    expect(await store.accessToken(c.id), isNull);

    await store.remove(b.id);
    await store.remove(a.id);
    expect(store.accounts, isEmpty);
    expect(store.active, isNull);
  });

  test('a password is never written to storage', () async {
    final store = await freshStore();
    final a = await signIn(store, home, 'me');
    await signIn(store, friend, 'guest');
    await store.markSignedOut(a.id);

    final all = await const FlutterSecureStorage().readAll();
    expect(
      all.keys.where((k) => k.toLowerCase().contains('password')),
      isEmpty,
    );
    expect(all.values.join().toLowerCase(), isNot(contains('password')));
  });

  test('sessions saved by builds before multi-account are cleared', () async {
    FlutterSecureStorage.setMockInitialValues({
      'access_token': 'old',
      'refresh_token': 'old',
      'device_id': 'old',
    });
    final store = await freshStore();

    expect(store.accounts, isEmpty);
    expect(await const FlutterSecureStorage().readAll(), isEmpty);
  });
}
