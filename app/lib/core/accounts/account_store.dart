import 'dart:convert';
import 'package:uuid/uuid.dart';
import '../constants/app_constants.dart';
import '../storage/secure_storage_service.dart';
import 'account.dart';

/// The accounts this device knows about, which one is active, and each
/// account's tokens. Everything is kept in secure storage; passwords are never
/// written anywhere.
class AccountStore {
  final SecureStorageService _storage;
  List<Account> _accounts = const [];
  String? _activeId;

  AccountStore(this._storage);

  List<Account> get accounts => List.unmodifiable(_accounts);
  String? get activeId => _activeId;

  Account? get active => _activeId == null ? null : byId(_activeId!);

  Account? byId(String id) {
    for (final account in _accounts) {
      if (account.id == id) return account;
    }
    return null;
  }

  Future<void> load() async {
    // Builds before multi-account kept one global session under these keys.
    for (final key in AppConstants.legacySessionKeys) {
      await _storage.delete(key);
    }

    final raw = await _storage.read(AppConstants.keyAccounts);
    if (raw != null) {
      try {
        _accounts = (jsonDecode(raw) as List<dynamic>)
            .map((a) => Account.fromJson(a as Map<String, dynamic>))
            .toList();
      } catch (_) {
        _accounts = const [];
      }
    }
    final activeId = await _storage.read(AppConstants.keyActiveAccountId);
    _activeId = activeId != null && byId(activeId) != null
        ? activeId
        : (_accounts.isEmpty ? null : _accounts.first.id);
  }

  /// Record a successful sign-in and make that account the active one.
  /// Signing in again to a known server + username reuses its entry.
  Future<Account> saveSignIn({
    required String serverUrl,
    required String username,
    required String userId,
    required String role,
    String? accessLevel,
    required String accessToken,
    required String refreshToken,
  }) async {
    final existing = _find(serverUrl, username);
    final account = Account(
      id: existing?.id ?? const Uuid().v4(),
      serverUrl: serverUrl,
      username: username,
      userId: userId,
      role: role,
      accessLevel: accessLevel,
      signedIn: true,
    );
    _accounts = existing == null
        ? [..._accounts, account]
        : [for (final a in _accounts) a.id == account.id ? account : a];
    _activeId = account.id;

    await saveTokens(account.id, accessToken: accessToken, refreshToken: refreshToken);
    await _persist();
    return account;
  }

  Future<void> setActive(String id) async {
    if (byId(id) == null) return;
    _activeId = id;
    await _storage.write(AppConstants.keyActiveAccountId, id);
  }

  Future<String?> accessToken(String id) => _storage.read(_accessKey(id));

  Future<String?> refreshToken(String id) => _storage.read(_refreshKey(id));

  Future<void> saveTokens(
    String id, {
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(_accessKey(id), accessToken);
    await _storage.write(_refreshKey(id), refreshToken);
  }

  /// Drop the account's tokens but keep its server and username.
  Future<void> markSignedOut(String id) async {
    await _deleteTokens(id);
    _accounts = [
      for (final a in _accounts) a.id == id ? a.copyWith(signedIn: false) : a,
    ];
    await _persist();
  }

  /// Forget the account entirely.
  Future<void> remove(String id) async {
    await _deleteTokens(id);
    _accounts = _accounts.where((a) => a.id != id).toList();
    if (_activeId == id) {
      _activeId = _preferredFallback()?.id;
    }
    await _persist();
  }

  /// The account to fall back to when the active one goes away: one that is
  /// still signed in if there is one.
  Account? _preferredFallback() {
    for (final account in _accounts) {
      if (account.signedIn) return account;
    }
    return _accounts.isEmpty ? null : _accounts.first;
  }

  /// A signed-in account other than [id], if any.
  Account? otherSignedIn(String id) {
    for (final account in _accounts) {
      if (account.id != id && account.signedIn) return account;
    }
    return null;
  }

  Account? _find(String serverUrl, String username) {
    for (final account in _accounts) {
      if (account.serverUrl == serverUrl && account.username == username) {
        return account;
      }
    }
    return null;
  }

  Future<void> _deleteTokens(String id) async {
    await _storage.delete(_accessKey(id));
    await _storage.delete(_refreshKey(id));
  }

  Future<void> _persist() async {
    await _storage.write(
      AppConstants.keyAccounts,
      jsonEncode(_accounts.map((a) => a.toJson()).toList()),
    );
    if (_activeId == null) {
      await _storage.delete(AppConstants.keyActiveAccountId);
    } else {
      await _storage.write(AppConstants.keyActiveAccountId, _activeId!);
    }
  }

  static String _accessKey(String id) => 'acct.$id.access';
  static String _refreshKey(String id) => 'acct.$id.refresh';
}
