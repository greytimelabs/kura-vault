import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';

class Member {
  final String userId;
  final String username;
  final String? role;
  final String permission;

  const Member({
    required this.userId,
    required this.username,
    this.role,
    required this.permission,
  });

  bool get isCreator => role == 'creator';

  factory Member.fromJson(Map<String, dynamic> json) => Member(
        userId: json['userId'] as String,
        username: json['username'] as String,
        role: json['role'] as String?,
        permission: json['permission'] as String,
      );
}

/// Sharing works the same way for a vault and for an album.
class MembersApi {
  final ApiClient _apiClient;
  final String _base;

  MembersApi.vault(this._apiClient, String vaultId)
      : _base = ApiEndpoints.vaultMembers(vaultId);

  MembersApi.album(this._apiClient, String albumId)
      : _base = ApiEndpoints.albumMembers(albumId);

  Future<List<Member>> list() async {
    final response = await _apiClient.dio.get(_base);
    return [
      for (final m in response.data['data'] as List<dynamic>)
        Member.fromJson(m as Map<String, dynamic>),
    ];
  }

  /// [wrappedKey] is the vault or album key sealed to the recipient, and
  /// [grantSig] this account's signature over it.
  Future<void> add({
    required String userId,
    required String permission,
    required String wrappedKey,
    required String grantSig,
  }) =>
      _apiClient.dio.post(_base, data: {
        'userId': userId,
        'permission': permission,
        'wrappedKey': wrappedKey,
        'grantSig': grantSig,
      });

  Future<void> update(String userId, String permission) =>
      _apiClient.dio.patch('$_base/$userId', data: {'permission': permission});

  Future<void> remove(String userId) => _apiClient.dio.delete('$_base/$userId');
}
