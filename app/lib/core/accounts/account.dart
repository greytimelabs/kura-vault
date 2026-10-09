import 'package:equatable/equatable.dart';

/// One sign-in on one server. The password is never part of this: only the
/// server and username are remembered, and tokens live under separate keys.
class Account extends Equatable {
  final String id;

  /// Server root without the API prefix, e.g. `https://vault.example.com`.
  final String serverUrl;
  final String username;
  final String? userId;
  final String? role;

  /// `full` may create vaults of their own; `limited` only uses what is
  /// shared with them.
  final String? accessLevel;

  /// False once the login expired or the user signed out. The entry stays so
  /// signing back in only needs the password.
  final bool signedIn;

  const Account({
    required this.id,
    required this.serverUrl,
    required this.username,
    this.userId,
    this.role,
    this.accessLevel,
    this.signedIn = false,
  });

  bool get isOwner => role == 'owner';
  bool get canCreateVaults => isOwner || accessLevel == 'full';

  String get apiBaseUrl => '$serverUrl/api/v1';

  /// Host (and port, when not the default) for display.
  String get host {
    final uri = Uri.parse(serverUrl);
    return uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;
  }

  Account copyWith({String? userId, String? role, String? accessLevel, bool? signedIn}) {
    return Account(
      id: id,
      serverUrl: serverUrl,
      username: username,
      userId: userId ?? this.userId,
      role: role ?? this.role,
      accessLevel: accessLevel ?? this.accessLevel,
      signedIn: signedIn ?? this.signedIn,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'serverUrl': serverUrl,
        'username': username,
        'userId': userId,
        'role': role,
        'accessLevel': accessLevel,
        'signedIn': signedIn,
      };

  factory Account.fromJson(Map<String, dynamic> json) => Account(
        id: json['id'] as String,
        serverUrl: json['serverUrl'] as String,
        username: json['username'] as String,
        userId: json['userId'] as String?,
        role: json['role'] as String?,
        accessLevel: json['accessLevel'] as String?,
        signedIn: json['signedIn'] as bool? ?? false,
      );

  @override
  List<Object?> get props =>
      [id, serverUrl, username, userId, role, accessLevel, signedIn];
}
