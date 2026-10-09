import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'aad.dart';
import 'crypto_service.dart';
import 'models.dart';

/// A user's identity: an X25519 key to receive vault and album keys, and an
/// Ed25519 key to sign what they share. Raw keys are 32 bytes everywhere.
/// Must produce and read the same bytes as web/src/lib/crypto/identity.ts.
class IdentityCrypto {
  static final _x25519 = X25519();
  static final _ed25519 = Ed25519();
  static final _hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 32);

  static Future<Uint8List> encPublicOf(Uint8List encSk) async {
    final pair = await _x25519.newKeyPairFromSeed(encSk);
    return Uint8List.fromList((await pair.extractPublicKey()).bytes);
  }

  static Future<Uint8List> signPublicOf(Uint8List signSk) async {
    final pair = await _ed25519.newKeyPairFromSeed(signSk);
    return Uint8List.fromList((await pair.extractPublicKey()).bytes);
  }

  static Future<Uint8List> _sealKey({
    required Uint8List sk,
    required Uint8List peerPk,
    required Uint8List ephPk,
    required Uint8List recipientPk,
  }) async {
    final shared = await _x25519.sharedSecretKey(
      keyPair: await _x25519.newKeyPairFromSeed(sk),
      remotePublicKey: SimplePublicKey(peerPk, type: KeyPairType.x25519),
    );
    final sharedBytes = Uint8List.fromList(await shared.extractBytes());
    try {
      // A low-order public key gives an all-zero secret that anyone can compute
      if (sharedBytes.every((b) => b == 0)) {
        throw ArgumentError('Invalid public key');
      }
      final key = await _hkdf.deriveKey(
        secretKey: SecretKey(sharedBytes),
        nonce: [...ephPk, ...recipientPk],
        info: Aad.sealInfo,
      );
      return Uint8List.fromList(await key.extractBytes());
    } finally {
      CryptoService.zero(sharedBytes);
    }
  }

  /// Encrypt to a public key: ephemeral X25519, HKDF-SHA256, AES-256-GCM.
  /// Output is ephPk(32) ‖ iv(12) ‖ ciphertext+tag. [ephSk] and [iv] exist for
  /// test vectors only.
  static Future<Uint8List> seal({
    required Uint8List recipientPk,
    required Uint8List plaintext,
    required Uint8List aad,
    Uint8List? ephSk,
    Uint8List? iv,
  }) async {
    if (recipientPk.length != 32) throw ArgumentError('Invalid public key');
    final eph = ephSk ?? CryptoService.randomBytes(32);
    final ephPk = await encPublicOf(eph);
    final key = await _sealKey(
        sk: eph, peerPk: recipientPk, ephPk: ephPk, recipientPk: recipientPk);
    final nonce = iv ?? CryptoService.generateIv();
    try {
      final encrypted = CryptoService.encrypt(
          plaintext: plaintext, key: key, iv: nonce, aad: aad);
      return Uint8List.fromList([...ephPk, ...nonce, ...encrypted]);
    } finally {
      CryptoService.zero(key);
      if (ephSk == null) CryptoService.zero(eph);
    }
  }

  /// Open something sealed to [encPk]. Throws when it was not sealed to this
  /// key or for this purpose.
  static Future<Uint8List> open({
    required Uint8List encSk,
    required Uint8List encPk,
    required Uint8List sealed,
    required Uint8List aad,
  }) async {
    if (sealed.length < 32 + 12 + 16) throw ArgumentError('Invalid sealed data');
    final ephPk = sealed.sublist(0, 32);
    final iv = sealed.sublist(32, 44);
    final key = await _sealKey(
        sk: encSk, peerPk: ephPk, ephPk: ephPk, recipientPk: encPk);
    try {
      return CryptoService.decrypt(
          ciphertext: sealed.sublist(44), key: key, iv: iv, aad: aad);
    } finally {
      CryptoService.zero(key);
    }
  }

  static Future<Uint8List> sign(Uint8List signSk, Uint8List message) async {
    final pair = await _ed25519.newKeyPairFromSeed(signSk);
    return Uint8List.fromList((await _ed25519.sign(message, keyPair: pair)).bytes);
  }

  static Future<bool> verify(
      Uint8List signPk, Uint8List signature, Uint8List message) async {
    if (signPk.length != 32 || signature.length != 64) return false;
    try {
      return await _ed25519.verify(
        message,
        signature: Signature(signature,
            publicKey: SimplePublicKey(signPk, type: KeyPairType.ed25519)),
      );
    } catch (_) {
      return false;
    }
  }

  static Future<Uint8List> sha256(Uint8List data) async =>
      Uint8List.fromList((await Sha256().hash(data)).bytes);

  // ── Certificates and grants ──

  static Future<String> signCert(Uint8List ownerSignSk, UserKeys user) async {
    final message = Aad.cert(
        user.userId, user.username, user.publicEncKey, user.publicSignKey);
    return b64e(await sign(ownerSignSk, message));
  }

  /// True when the owner certified exactly these keys for exactly this user.
  static Future<bool> verifyCert(Uint8List ownerSignPk, UserKeys user) async {
    final cert = user.keyCert;
    if (cert == null) return false;
    try {
      final message = Aad.cert(
          user.userId, user.username, user.publicEncKey, user.publicSignKey);
      return await verify(ownerSignPk, b64d(cert), message);
    } catch (_) {
      return false;
    }
  }

  static Future<Uint8List> _grantMessage(String kind, String resourceId,
      String recipientId, String granterId, Uint8List sealed) async {
    return Aad.grant(
        kind, resourceId, recipientId, granterId, b64e(await sha256(sealed)));
  }

  static Future<String> signGrant({
    required Uint8List signSk,
    required String kind,
    required String resourceId,
    required String recipientId,
    required String granterId,
    required Uint8List sealed,
  }) async {
    return b64e(await sign(signSk,
        await _grantMessage(kind, resourceId, recipientId, granterId, sealed)));
  }

  static Future<bool> verifyGrant({
    required Uint8List granterSignPk,
    required String signature,
    required String kind,
    required String resourceId,
    required String recipientId,
    required String granterId,
    required Uint8List sealed,
  }) async {
    try {
      return await verify(granterSignPk, b64d(signature),
          await _grantMessage(kind, resourceId, recipientId, granterId, sealed));
    } catch (_) {
      return false;
    }
  }

  // ── The private bundle ──

  /// Encrypt the private keys under the master key. [iv] is for test vectors.
  static ({String encrypted, String nonce}) encryptBundle({
    required Uint8List masterKey,
    required String userId,
    required Uint8List encSk,
    required Uint8List signSk,
    required Uint8List ownerSignPk,
    Uint8List? iv,
  }) {
    final nonce = iv ?? CryptoService.generateIv();
    final plain = Uint8List.fromList(utf8.encode(jsonEncode({
      'v': 1,
      'encSk': b64e(encSk),
      'signSk': b64e(signSk),
      'ownerSignPk': b64e(ownerSignPk),
    })));
    try {
      final encrypted = CryptoService.encrypt(
          plaintext: plain,
          key: masterKey,
          iv: nonce,
          aad: Aad.userKeys(userId));
      return (encrypted: b64e(encrypted), nonce: b64e(nonce));
    } finally {
      CryptoService.zero(plain);
    }
  }

  /// Throws on a wrong master passphrase. The caller must zero the private bytes.
  static ({Uint8List encSk, Uint8List signSk, Uint8List ownerSignPk})
      decryptBundle({
    required Uint8List masterKey,
    required String userId,
    required String encrypted,
    required String nonce,
  }) {
    final plain = CryptoService.decrypt(
      ciphertext: b64d(encrypted),
      key: masterKey,
      iv: b64d(nonce),
      aad: Aad.userKeys(userId),
    );
    try {
      final parsed = jsonDecode(utf8.decode(plain)) as Map<String, dynamic>;
      if (parsed['v'] != 1) throw const FormatException('Unsupported key bundle');
      return (
        encSk: b64d(parsed['encSk'] as String),
        signSk: b64d(parsed['signSk'] as String),
        ownerSignPk: b64d(parsed['ownerSignPk'] as String),
      );
    } finally {
      CryptoService.zero(plain);
    }
  }

  // ── Invites ──

  static Future<Uint8List> _hkdfNoSalt(Uint8List secret, Uint8List info) async {
    final key = await _hkdf.deriveKey(
      secretKey: SecretKey(secret),
      // RFC 5869: no salt means a salt of zeros
      nonce: Uint8List(32),
      info: info,
    );
    return Uint8List.fromList(await key.extractBytes());
  }

  /// What the invitee shows the server to prove they hold the link. The server
  /// stores only its SHA-256.
  static Future<Uint8List> inviteAuthToken(Uint8List secret) =>
      _hkdfNoSalt(secret, Aad.inviteAuthInfo);

  /// HMAC over the invitee's identity under a key only the link holders know.
  /// The server never sees the link's secret, so it cannot produce this for
  /// keys of its own.
  static Future<Uint8List> inviteBinding(Uint8List secret, UserKeys user) async {
    final bindKey = await _hkdfNoSalt(secret, Aad.inviteBindInfo);
    try {
      final mac = await Hmac.sha256().calculateMac(
        Aad.binding(
            user.userId, user.username, user.publicEncKey, user.publicSignKey),
        secretKey: SecretKey(bindKey),
      );
      return Uint8List.fromList(mac.bytes);
    } finally {
      CryptoService.zero(bindKey);
    }
  }

  /// Compare without leaking where two values differ.
  static bool equalBytes(Uint8List a, Uint8List b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}
