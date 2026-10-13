class ApiEndpoints {
  // Paths only: the server comes from the account a request is made for.
  static const String health = '/health';

  // First run, and joining from an invite link
  static const String setup = '/setup';
  static String invite(String id) => '/invites/$id';
  static String inviteAccept(String id) => '/invites/$id/accept';

  // Auth
  static const String login = '/auth/login';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';

  // The signed-in account and its encrypted keys
  static const String me = '/me';

  // Users (owner), and the people something can be shared with
  static const String users = '/users';
  static const String usersDirectory = '/users/directory';
  static String user(String id) => '/users/$id';
  static String userCert(String id) => '/users/$id/cert';
  static String userDeletionSummary(String id) => '/users/$id/deletion-summary';
  static String userInvite(String id) => '/users/invites/$id';

  // Vaults
  static const String vaults = '/vaults';
  static String vault(String id) => '/vaults/$id';
  static String vaultMembers(String id) => '/vaults/$id/members';

  // Media
  static const String media = '/media';
  static const String mediaDelete = '/media/delete';
  static const String mediaUploadInit = '/media/upload/init';
  static const String mediaUploadComplete = '/media/upload/complete';
  static String mediaUrls(String id) => '/media/$id/urls';
  static String mediaVaultKey(String id) => '/media/$id/vault-key';

  // Albums
  static const String albums = '/albums';
  static const String sharedAlbums = '/albums/shared';
  static String likedMedia(String mediaId) => '/albums/liked/media/$mediaId';
  static String album(String id) => '/albums/$id';
  static String albumMedia(String id) => '/albums/$id/media';
  static String albumMediaItem(String id, String mediaId) =>
      '/albums/$id/media/$mediaId';
  static String albumMembers(String id) => '/albums/$id/members';
}
