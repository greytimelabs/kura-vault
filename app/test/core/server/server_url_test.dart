import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/server/server_url.dart';

void main() {
  group('normalisation', () {
    test('assumes https when no scheme is typed', () {
      final url = ServerUrl.parse('vault.example.com');
      expect(url.value, 'https://vault.example.com');
      expect(url.isInsecure, isFalse);
      expect(url.schemeGiven, isFalse);
    });

    test('strips whitespace, trailing slashes and the API prefix', () {
      expect(ServerUrl.parse('  https://Vault.Example.com/  ').value,
          'https://vault.example.com');
      expect(ServerUrl.parse('https://vault.example.com/api/v1').value,
          'https://vault.example.com');
      expect(ServerUrl.parse('https://vault.example.com/api/v1/').value,
          'https://vault.example.com');
    });

    test('keeps a port and a sub-path', () {
      expect(ServerUrl.parse('https://example.com:8443/vault/').value,
          'https://example.com:8443/vault');
    });

    test('keeps IPv6 brackets', () {
      expect(ServerUrl.parse('http://[::1]:3000').value, 'http://[::1]:3000');
    });
  });

  group('rejected input', () {
    for (final input in ['', '   ', 'ftp://example.com', 'https://', 'https://user:pw@example.com']) {
      test('"$input"', () {
        expect(() => ServerUrl.parse(input), throwsA(isA<ServerUrlException>()));
      });
    }
  });

  group('http', () {
    const allowed = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://10.0.2.2:3000',
      'http://172.16.0.5',
      'http://172.31.255.1',
      'http://192.168.1.8:3000',
      'http://169.254.10.10',
      'http://[::1]:3000',
      'http://[fd12:3456::1]',
      'http://[fe80::1]',
    ];
    for (final input in allowed) {
      test('allowed with a warning: $input', () {
        expect(ServerUrl.parse(input).isInsecure, isTrue);
      });
    }

    const refused = [
      'http://example.com',
      'http://vault.local',
      'http://8.8.8.8',
      'http://172.15.0.1',
      'http://172.32.0.1',
      'http://192.169.1.1',
      'http://11.0.0.1',
      'http://[2001:db8::1]',
    ];
    for (final input in refused) {
      test('refused: $input', () {
        expect(() => ServerUrl.parse(input), throwsA(isA<ServerUrlException>()));
      });
    }
  });

  group('http fallback', () {
    test('offered for a local address typed without a scheme', () {
      final url = ServerUrl.parse('192.168.1.8:3000');
      expect(url.value, 'https://192.168.1.8:3000');
      expect(url.httpFallback?.value, 'http://192.168.1.8:3000');
    });

    test('not offered when the user typed https themselves', () {
      expect(ServerUrl.parse('https://192.168.1.8:3000').httpFallback, isNull);
    });

    test('never offered for a public host', () {
      expect(ServerUrl.parse('vault.example.com').httpFallback, isNull);
    });
  });
}
