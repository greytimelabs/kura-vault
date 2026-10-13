import '../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

/// A user as the owner sees them.
class UserRow {
  final UserKeys keys;
  final String role;
  final String accessLevel;
  final String status;

  /// Present while the owner's client still has to verify this user's keys.
  final ({String inviteId, String ownerSecretEncrypted, String keyBinding})?
      verification;

  const UserRow({
    required this.keys,
    required this.role,
    required this.accessLevel,
    required this.status,
    this.verification,
  });

  String get userId => keys.userId;
  String get username => keys.username;
  bool get isOwner => role == 'owner';
  bool get isActive => status == 'active';
  bool get isVerified => keys.keyCert != null;

  factory UserRow.fromJson(Map<String, dynamic> json) {
    final v = json['verification'];
    return UserRow(
      keys: UserKeys.fromJson(json),
      role: json['role'] as String,
      accessLevel: json['accessLevel'] as String,
      status: json['status'] as String,
      verification: v is Map<String, dynamic>
          ? (
              inviteId: v['inviteId'] as String,
              ownerSecretEncrypted: v['ownerSecretEncrypted'] as String,
              keyBinding: v['keyBinding'] as String,
            )
          : null,
    );
  }
}

class PendingInvite {
  final String id;
  final String username;
  final String accessLevel;
  final bool expired;

  const PendingInvite({
    required this.id,
    required this.username,
    required this.accessLevel,
    required this.expired,
  });

  factory PendingInvite.fromJson(Map<String, dynamic> json) => PendingInvite(
        id: json['id'] as String,
        username: json['username'] as String,
        accessLevel: json['accessLevel'] as String,
        expired: json['expired'] == true,
      );
}

class UsersApi {
  final ApiClient _apiClient;

  const UsersApi(this._apiClient);

  /// Owner only.
  Future<({List<UserRow> users, List<PendingInvite> invites})> list() async {
    final response = await _apiClient.dio.get(ApiEndpoints.users);
    final data = response.data['data'] as Map<String, dynamic>;
    return (
      users: [
        for (final u in data['users'] as List<dynamic>)
          UserRow.fromJson(u as Map<String, dynamic>),
      ],
      invites: [
        for (final i in data['invites'] as List<dynamic>)
          PendingInvite.fromJson(i as Map<String, dynamic>),
      ],
    );
  }

  /// Active users something can be shared with, as the server claims them.
  /// The caller checks each certificate before offering anyone.
  Future<List<UserKeys>> directory() async {
    final response = await _apiClient.dio.get(ApiEndpoints.usersDirectory);
    return [
      for (final u in response.data['data'] as List<dynamic>)
        UserKeys.fromJson(u as Map<String, dynamic>),
    ];
  }

  Future<void> update(String userId, {String? accessLevel, String? status}) =>
      _apiClient.dio.patch(ApiEndpoints.user(userId), data: {
        'accessLevel': ?accessLevel,
        'status': ?status,
      });

  Future<void> certify(String userId, String keyCert) => _apiClient.dio
      .put(ApiEndpoints.userCert(userId), data: {'keyCert': keyCert});

  /// What deleting this user would erase: the vaults they created and
  /// everything in them.
  Future<({int vaults, int items})> deletionSummary(String userId) async {
    final response =
        await _apiClient.dio.get(ApiEndpoints.userDeletionSummary(userId));
    final data = response.data['data'] as Map<String, dynamic>;
    return (vaults: data['vaults'] as int, items: data['items'] as int);
  }

  Future<void> deleteUser(String userId) =>
      _apiClient.dio.delete(ApiEndpoints.user(userId));

  Future<void> deleteInvite(String inviteId) =>
      _apiClient.dio.delete(ApiEndpoints.userInvite(inviteId));
}

/// Verify and sign the keys of everyone who joined since the owner last
/// unlocked. Until this has happened nothing can be shared with them. Returns
/// the usernames whose keys were NOT the ones bound to their invite link.
Future<List<String>> certifyPendingUsers(
    UsersApi api, VaultCryptoCubit crypto) async {
  final rejected = <String>[];
  for (final user in (await api.list()).users) {
    final verification = user.verification;
    if (verification == null) continue;
    final keyCert = await crypto.certifyUser(
      user: user.keys,
      inviteId: verification.inviteId,
      ownerSecretEncrypted: verification.ownerSecretEncrypted,
      keyBinding: verification.keyBinding,
    );
    if (keyCert != null) {
      await api.certify(user.userId, keyCert);
    } else {
      rejected.add(user.username);
    }
  }
  return rejected;
}

/// What to tell the owner when [certifyPendingUsers] rejected someone.
String rejectedKeysMessage(List<String> usernames) =>
    'Keys could not be verified for: ${usernames.join(', ')}. '
    'Restrict the account and invite again.';
