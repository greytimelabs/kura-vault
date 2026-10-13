import 'package:flutter/services.dart';

enum BiometricStatus {
  /// A fingerprint or face strong enough to guard a key is set up.
  available,

  /// The phone can do it, but nothing is enrolled.
  notEnrolled,

  /// No suitable sensor, or the device has no screen lock.
  unsupported,
}

/// The stored secret can no longer be released: fingerprints or faces on the
/// device changed since it was stored, or it was never there.
class BiometricInvalidated implements Exception {}

/// Too many failed attempts; the system refuses biometrics for now.
class BiometricLockedOut implements Exception {}

/// One small secret per account, released by the device's hardware only after
/// a fingerprint or face match. The check is made by the system, bound to the
/// key itself; this app never sees a yes or no it could be tricked into.
class BiometricChannel {
  static const _channel = MethodChannel('kura/biometric');

  const BiometricChannel();

  Future<BiometricStatus> status() async {
    try {
      return switch (await _channel.invokeMethod<String>('status')) {
        'available' => BiometricStatus.available,
        'notEnrolled' => BiometricStatus.notEnrolled,
        _ => BiometricStatus.unsupported,
      };
    } catch (_) {
      return BiometricStatus.unsupported;
    }
  }

  /// Whether something is stored for [id]. Never prompts.
  Future<bool> has(String id) async {
    try {
      return await _channel.invokeMethod<bool>('has', {'id': id}) ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Store [secret] for [id] after one biometric check. False when the user
  /// backed out. The caller zeroes its own copy of [secret].
  Future<bool> store(String id, Uint8List secret, {required String title}) async {
    try {
      final stored = await _channel.invokeMethod<bool>(
          'store', {'id': id, 'secret': secret, 'title': title});
      return stored ?? false;
    } on PlatformException catch (e) {
      throw _translate(e);
    }
  }

  /// Ask for a fingerprint or face and return the secret. Null when the user
  /// backed out. Throws [BiometricInvalidated] or [BiometricLockedOut].
  Future<Uint8List?> read(String id, {required String title}) async {
    try {
      final secret =
          await _channel.invokeMethod<Uint8List>('read', {'id': id, 'title': title});
      // What arrives from the platform is read-only; the caller gets a copy it
      // can zero when it is done
      return secret == null ? null : Uint8List.fromList(secret);
    } on PlatformException catch (e) {
      throw _translate(e);
    }
  }

  Future<void> delete(String id) async {
    try {
      await _channel.invokeMethod<void>('delete', {'id': id});
    } catch (_) {
      // Nothing stored, or no such channel on this platform
    }
  }

  static Object _translate(PlatformException e) => switch (e.code) {
        'invalidated' => BiometricInvalidated(),
        'lockout' => BiometricLockedOut(),
        _ => e,
      };
}
