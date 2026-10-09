class ApiEndpoints {
  // TODO: Configure from env/build config
  static const String baseUrl = 'http://localhost:3000/api/v1';
  // static const String baseUrl = 'http://192.168.1.8:3000/api/v1';

  // Auth
  static const String register = '/auth/register';
  static const String login = '/auth/login';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';

  // Vaults
  static const String vaults = '/vaults';
  static String vaultInvite(String id) => '/vaults/$id/invite';

  // Media
  static const String media = '/media';
  static const String uploadInit = '/media/upload/init';
  static const String uploadComplete = '/media/upload/complete';
  static String mediaUrls(String id) => '/media/$id/urls';
  static String mediaVaultAccess(String id) => '/media/$id/vault-access';

  // Albums
  static const String albums = '/albums';
  static String albumMedia(String id) => '/albums/$id/media';
  static String albumMediaRemove(String albumId, String mediaId) => '/albums/$albumId/media/$mediaId';
  static String likedMedia(String mediaId) => '/albums/liked/media/$mediaId';
}
