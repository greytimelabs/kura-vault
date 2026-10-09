import 'package:equatable/equatable.dart';
import '../../core/accounts/account.dart';

class AuthState extends Equatable {
  /// False until the saved accounts have been read at launch.
  final bool initialized;
  final List<Account> accounts;
  final String? activeId;

  /// A sign-in is in progress.
  final bool busy;
  final String? errorMessage;

  const AuthState({
    this.initialized = false,
    this.accounts = const [],
    this.activeId,
    this.busy = false,
    this.errorMessage,
  });

  /// The account every request is made for.
  Account? get active {
    for (final account in accounts) {
      if (account.id == activeId) return account;
    }
    return null;
  }

  bool get isAuthenticated => active?.signedIn ?? false;
  String? get userId => active?.userId;
  String? get userRole => active?.role;

  AuthState copyWith({bool? busy, String? errorMessage}) {
    return AuthState(
      initialized: initialized,
      accounts: accounts,
      activeId: activeId,
      busy: busy ?? this.busy,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props =>
      [initialized, accounts, activeId, busy, errorMessage];
}
