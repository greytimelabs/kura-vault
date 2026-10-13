import 'dart:typed_data';
import '../platform/biometric_channel.dart';
import '../storage/secure_storage_service.dart';

/// Why fingerprint or face unlock is, or is not, on offer for an account.
enum BiometricOffer {
  /// Switched on and usable right now.
  ready,

  /// Switched on, but the master passphrase has not been typed for
  /// [BiometricUnlock.passphraseEvery]: it is asked for again first.
  passphraseDue,

  /// Not switched on for this account, or no longer usable on this device.
  off,
}

/// Unlocking an account with a fingerprint or face instead of typing the
/// master passphrase. Optional, per account, on this device only, and off
/// until the user switches it on.
///
/// What is kept is the account's master key (what the passphrase derives to),
/// never the passphrase and never a vault key. It can only be released by the
/// device's hardware after a biometric match ([BiometricChannel]). Vault
/// passphrases are still typed.
///
/// The passphrase is asked for again:
///  - every [passphraseEvery], so it is not forgotten and a stolen phone has
///    a time limit;
///  - after a fingerprint or face is added or changed on the device (the
///    system destroys the stored key);
///  - after signing out or removing the account.
class BiometricUnlock {
  static const passphraseEvery = Duration(days: 7);

  final BiometricChannel _channel;
  final SecureStorageService _storage;
  final DateTime Function() _now;

  BiometricUnlock({
    required SecureStorageService storage,
    BiometricChannel channel = const BiometricChannel(),
    DateTime Function() now = DateTime.now,
  })  : _storage = storage,
        _channel = channel,
        _now = now;

  static String _enabledKey(String accountId) => 'acct.$accountId.biometric';
  static String _typedAtKey(String accountId) => 'acct.$accountId.passphrase_at';

  Future<BiometricStatus> deviceStatus() => _channel.status();

  /// Whether the user switched it on for this account.
  Future<bool> isEnabled(String accountId) async =>
      await _storage.read(_enabledKey(accountId)) == '1';

  Future<BiometricOffer> offerFor(String accountId) async {
    if (!await isEnabled(accountId)) return BiometricOffer.off;
    if (await _channel.status() != BiometricStatus.available ||
        !await _channel.has(accountId)) {
      // Biometrics were removed from the device, or the stored key is gone
      await disable(accountId);
      return BiometricOffer.off;
    }

    final typedAt = int.tryParse(await _storage.read(_typedAtKey(accountId)) ?? '');
    if (typedAt == null) return BiometricOffer.passphraseDue;
    final since = _now().millisecondsSinceEpoch - typedAt;
    // A clock set backwards does not buy more time
    if (since < 0 || since >= passphraseEvery.inMilliseconds) {
      return BiometricOffer.passphraseDue;
    }
    return BiometricOffer.ready;
  }

  /// Switch it on: [masterKey] goes behind one biometric check. False when
  /// the user backed out of the check. The caller zeroes [masterKey].
  Future<bool> enable(String accountId, Uint8List masterKey) async {
    final stored = await _channel.store(
      accountId,
      masterKey,
      title: 'Turn on fingerprint or face unlock',
    );
    if (!stored) return false;
    await _storage.write(_enabledKey(accountId), '1');
    // Switching it on took the passphrase a moment ago
    await notePassphraseTyped(accountId);
    return true;
  }

  /// Switch it off and destroy the stored key. Also called when the account
  /// signs out or is removed.
  Future<void> disable(String accountId) async {
    await _channel.delete(accountId);
    await _storage.delete(_enabledKey(accountId));
    await _storage.delete(_typedAtKey(accountId));
  }

  /// The master passphrase was just typed and was right.
  Future<void> notePassphraseTyped(String accountId) async {
    if (!await isEnabled(accountId)) return;
    await _storage.write(
        _typedAtKey(accountId), _now().millisecondsSinceEpoch.toString());
  }

  /// Ask for a fingerprint or face and return the master key. Null when the
  /// user backed out, or when it is not on offer. Throws
  /// [BiometricInvalidated] (and switches itself off) when fingerprints or
  /// faces changed, and [BiometricLockedOut] after too many attempts.
  Future<Uint8List?> readMasterKey(String accountId) async {
    if (await offerFor(accountId) != BiometricOffer.ready) return null;
    try {
      return await _channel.read(accountId, title: 'Unlock Kura Vault');
    } on BiometricInvalidated {
      await disable(accountId);
      rethrow;
    }
  }
}
