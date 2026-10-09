/// Why a typed server address was rejected. [message] is shown to the user.
class ServerUrlException implements Exception {
  final String message;
  const ServerUrlException(this.message);

  @override
  String toString() => message;
}

/// A server address as typed by the user, cleaned up into the server root
/// (scheme, host, optional port and path; no trailing slash, no `/api/v1`).
class ServerUrl {
  final String value;

  /// True when the user typed `http://` or `https://` themselves.
  final bool schemeGiven;

  const ServerUrl._(this.value, {required this.schemeGiven});

  /// Plain http: credentials and tokens travel unencrypted.
  bool get isInsecure => value.startsWith('http://');

  /// Parse what the user typed. Without a scheme, https is assumed.
  ///
  /// http is accepted only for this machine and private network addresses,
  /// where TLS is often not set up; anywhere else it is refused.
  static ServerUrl parse(String input) {
    final text = input.trim();
    if (text.isEmpty) {
      throw const ServerUrlException('Enter your server address');
    }

    final schemeGiven = text.contains('://');
    final Uri uri;
    try {
      uri = Uri.parse(schemeGiven ? text : 'https://$text');
    } on FormatException {
      throw const ServerUrlException('That is not a valid address');
    }

    if (uri.scheme != 'https' && uri.scheme != 'http') {
      throw const ServerUrlException('The address must start with https://');
    }
    if (uri.host.isEmpty || uri.userInfo.isNotEmpty) {
      throw const ServerUrlException('That is not a valid address');
    }
    if (uri.scheme == 'http' && !isLocalHost(uri.host)) {
      throw const ServerUrlException(
        'http:// is only allowed for servers on your local network. Use https://',
      );
    }

    return ServerUrl._(_format(uri, uri.scheme), schemeGiven: schemeGiven);
  }

  /// The same address over http, for a local server typed without a scheme
  /// that did not answer over https. Null when http is not an option.
  ServerUrl? get httpFallback {
    if (schemeGiven || isInsecure) return null;
    final uri = Uri.parse(value);
    if (!isLocalHost(uri.host)) return null;
    return ServerUrl._(_format(uri, 'http'), schemeGiven: false);
  }

  static String _format(Uri uri, String scheme) {
    var path = uri.path;
    while (path.endsWith('/')) {
      path = path.substring(0, path.length - 1);
    }
    if (path.endsWith('/api/v1')) {
      path = path.substring(0, path.length - '/api/v1'.length);
    }
    final host = uri.host.contains(':') ? '[${uri.host}]' : uri.host.toLowerCase();
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '$scheme://$host$port$path';
  }

  /// localhost, loopback, and private or link-local IP addresses.
  static bool isLocalHost(String host) {
    final name = host.toLowerCase();
    if (name == 'localhost' || name.endsWith('.localhost')) return true;

    try {
      final b = Uri.parseIPv4Address(name);
      return b[0] == 127 ||
          b[0] == 10 ||
          (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
          (b[0] == 192 && b[1] == 168) ||
          (b[0] == 169 && b[1] == 254);
    } on FormatException {
      // not IPv4
    }

    try {
      final b = Uri.parseIPv6Address(name);
      final isLoopback = b.sublist(0, 15).every((x) => x == 0) && b[15] == 1;
      final isUniqueLocal = (b[0] & 0xfe) == 0xfc; // fc00::/7
      final isLinkLocal = b[0] == 0xfe && (b[1] & 0xc0) == 0x80; // fe80::/10
      return isLoopback || isUniqueLocal || isLinkLocal;
    } on FormatException {
      return false;
    }
  }
}
