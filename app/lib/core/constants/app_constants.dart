class AppConstants {
  static const String appName = 'Kura Vault';
  static const int defaultPageSize = 50;
  static const int maxPageSize = 100;

  // Secure storage keys
  static const String keyAccounts = 'accounts';
  static const String keyActiveAccountId = 'active_account_id';

  // Single-session keys from before multi-account; deleted on launch
  static const List<String> legacySessionKeys = [
    'access_token',
    'refresh_token',
    'device_id',
    'user_id',
    'user_role',
  ];

  // Cache
  static const int thumbCacheMaxCount = 5000;
}
