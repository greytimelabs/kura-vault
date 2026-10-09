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

  // Vaults
  static const String vaults = '/vaults';

  // Media
  static const String media = '/media';
  static String mediaUrls(String id) => '/media/$id/urls';

  // Albums
  static const String albums = '/albums';
  static const String sharedAlbums = '/albums/shared';
  static String likedMedia(String mediaId) => '/albums/liked/media/$mediaId';
}
