import 'dart:typed_data';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/platform/biometric_channel.dart';
import 'package:kura_vault/core/security/biometric_unlock.dart';
import 'package:kura_vault/core/storage/secure_storage_service.dart';

/// The device's side: a store that hands a secret back only "after a match".
class _FakeDevice implements BiometricChannel {
  BiometricStatus deviceStatus = BiometricStatus.available;
  final Map<String, Uint8List> stored = {};

  /// What the person at the prompt does next.
  bool userConfirms = true;
  bool lockedOut = false;
  int prompts = 0;

  /// A fingerprint or face was added: the system destroys every key.
  void enrolAnother() => stored.clear();

  @override
  Future<BiometricStatus> status() async => deviceStatus;

  @override
  Future<bool> has(String id) async => stored.containsKey(id);

  @override
  Future<bool> store(String id, Uint8List secret, {required String title}) async {
    prompts++;
    if (!userConfirms) return false;
    stored[id] = Uint8List.fromList(secret);
    return true;
  }

  @override
  Future<Uint8List?> read(String id, {required String title}) async {
    final secret = stored[id];
    if (secret == null) throw BiometricInvalidated();
    prompts++;
    if (lockedOut) throw BiometricLockedOut();
    return userConfirms ? Uint8List.fromList(secret) : null;
  }

  @override
  Future<void> delete(String id) async => stored.remove(id);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeDevice device;
  late SecureStorageService storage;
  late DateTime now;
  late BiometricUnlock biometrics;
  final key = Uint8List.fromList(List.generate(32, (i) => i));

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    device = _FakeDevice();
    storage = SecureStorageService();
    now = DateTime(2026, 10, 13, 9);
    biometrics = BiometricUnlock(storage: storage, channel: device, now: () => now);
  });

  test('is off until the user switches it on', () async {
    expect(await biometrics.isEnabled('a'), isFalse);
    expect(await biometrics.offerFor('a'), BiometricOffer.off);
    expect(await biometrics.readMasterKey('a'), isNull);
    expect(device.prompts, 0);

    // Typing the passphrase does not switch it on by itself
    await biometrics.notePassphraseTyped('a');
    expect(await biometrics.offerFor('a'), BiometricOffer.off);
  });

  test('once on, a match hands back exactly the key that was stored', () async {
    expect(await biometrics.enable('a', key), isTrue);
    expect(await biometrics.offerFor('a'), BiometricOffer.ready);
    expect(await biometrics.readMasterKey('a'), key);
    // Per account: another account on the same phone is untouched
    expect(await biometrics.offerFor('b'), BiometricOffer.off);
  });

  test('backing out of the check while switching on leaves it off', () async {
    device.userConfirms = false;
    expect(await biometrics.enable('a', key), isFalse);
    expect(await biometrics.isEnabled('a'), isFalse);
    expect(device.stored, isEmpty);
  });

  test('backing out of the check while unlocking returns nothing and keeps it on', () async {
    await biometrics.enable('a', key);
    device.userConfirms = false;
    expect(await biometrics.readMasterKey('a'), isNull);
    expect(await biometrics.offerFor('a'), BiometricOffer.ready);
  });

  test('the passphrase is asked for again after 7 days, and typing it renews', () async {
    await biometrics.enable('a', key);

    now = now.add(const Duration(days: 6, hours: 23));
    expect(await biometrics.offerFor('a'), BiometricOffer.ready);

    now = now.add(const Duration(hours: 1));
    expect(await biometrics.offerFor('a'), BiometricOffer.passphraseDue);
    final promptsBefore = device.prompts;
    expect(await biometrics.readMasterKey('a'), isNull);
    expect(device.prompts, promptsBefore, reason: 'no prompt while the passphrase is due');

    await biometrics.notePassphraseTyped('a');
    expect(await biometrics.offerFor('a'), BiometricOffer.ready);
    expect(await biometrics.readMasterKey('a'), key);
  });

  test('setting the clock back does not buy more time', () async {
    await biometrics.enable('a', key);
    now = now.subtract(const Duration(days: 30));
    expect(await biometrics.offerFor('a'), BiometricOffer.passphraseDue);
  });

  test('a new fingerprint or face on the phone switches it off', () async {
    await biometrics.enable('a', key);
    device.enrolAnother();
    expect(await biometrics.offerFor('a'), BiometricOffer.off);
    expect(await biometrics.isEnabled('a'), isFalse);
  });

  test('a key that turns out to be gone at the prompt switches it off and says why', () async {
    await biometrics.enable('a', key);
    // Still listed, but the hardware refuses to release it
    final gone = _GoneAtRead(device);
    biometrics = BiometricUnlock(storage: storage, channel: gone, now: () => now);
    await expectLater(biometrics.readMasterKey('a'), throwsA(isA<BiometricInvalidated>()));
    expect(await biometrics.isEnabled('a'), isFalse);
    expect(device.stored, isEmpty);
  });

  test('removing biometrics from the phone switches it off', () async {
    await biometrics.enable('a', key);
    device.deviceStatus = BiometricStatus.notEnrolled;
    expect(await biometrics.offerFor('a'), BiometricOffer.off);
    expect(device.stored, isEmpty);
  });

  test('too many attempts is reported and leaves it on', () async {
    await biometrics.enable('a', key);
    device.lockedOut = true;
    await expectLater(biometrics.readMasterKey('a'), throwsA(isA<BiometricLockedOut>()));
    expect(await biometrics.isEnabled('a'), isTrue);
  });

  test('switching off, as sign-out does, destroys the stored key', () async {
    await biometrics.enable('a', key);
    await biometrics.disable('a');
    expect(device.stored, isEmpty);
    expect(await biometrics.offerFor('a'), BiometricOffer.off);
    expect(await storage.read('acct.a.biometric'), isNull);
    expect(await storage.read('acct.a.passphrase_at'), isNull);
  });

  group('the stored key unlocks the account as the passphrase does', () {
    late VaultCryptoCubit crypto;
    late AccountKeys account;

    setUpAll(() async {
      crypto = VaultCryptoCubit();
      final material = await crypto.createAccount(
          userId: 'user-1', username: 'ada', passphrase: 'ada master passphrase');
      account = AccountKeys(
        id: 'user-1',
        kdfSalt: material.kdfSalt,
        encryptedPrivateKeys: material.encryptedPrivateKeys,
        privateKeysNonce: material.privateKeysNonce,
        publicEncKey: material.publicEncKey,
        publicSignKey: material.publicSignKey,
      );
      crypto.lock();
    });

    tearDownAll(() => crypto.close());

    test('only the right passphrase yields a key, and nothing is unlocked by asking', () async {
      expect(await VaultCryptoCubit.masterKeyFor(account: account, passphrase: 'not it'), isNull);
      final masterKey = await VaultCryptoCubit.masterKeyFor(
          account: account, passphrase: 'ada master passphrase');
      expect(masterKey, hasLength(32));
      expect(crypto.state.accountUnlocked, isFalse);
    });

    test('that key unlocks; a key for something else does not', () async {
      final masterKey = (await VaultCryptoCubit.masterKeyFor(
          account: account, passphrase: 'ada master passphrase'))!;

      expect(await crypto.unlockAccountWithKey(account: account, masterKey: Uint8List(32)), isFalse);
      expect(crypto.state.accountUnlocked, isFalse);

      expect(await crypto.unlockAccountWithKey(account: account, masterKey: masterKey), isTrue);
      expect(crypto.state.accountUnlocked, isTrue);
      // Unlocked the same account the passphrase would have: it can make a vault
      final made = await crypto.createVault(passphrase: 'vault passphrase', label: 'Family');
      crypto.discardMatches([made.match]);
      crypto.lock();
    });

    test('keys the server swapped are refused, as with the passphrase', () async {
      final masterKey = (await VaultCryptoCubit.masterKeyFor(
          account: account, passphrase: 'ada master passphrase'))!;
      final other = VaultCryptoCubit();
      final theirs = await other.createAccount(
          userId: 'user-2', username: 'eve', passphrase: 'eve master passphrase');
      other.lock();
      final swapped = AccountKeys(
        id: account.id,
        kdfSalt: account.kdfSalt,
        encryptedPrivateKeys: account.encryptedPrivateKeys,
        privateKeysNonce: account.privateKeysNonce,
        publicEncKey: theirs.publicEncKey,
        publicSignKey: theirs.publicSignKey,
      );
      await expectLater(
        crypto.unlockAccountWithKey(account: swapped, masterKey: masterKey),
        throwsA(isA<KeysNotYoursException>()),
      );
      expect(crypto.state.accountUnlocked, isFalse);
      await other.close();
    });
  });
}

/// A device that still lists the item but can no longer release it.
class _GoneAtRead implements BiometricChannel {
  final _FakeDevice _device;
  _GoneAtRead(this._device);

  @override
  Future<BiometricStatus> status() => _device.status();
  @override
  Future<bool> has(String id) => _device.has(id);
  @override
  Future<bool> store(String id, Uint8List secret, {required String title}) =>
      _device.store(id, secret, title: title);
  @override
  Future<Uint8List?> read(String id, {required String title}) async => throw BiometricInvalidated();
  @override
  Future<void> delete(String id) => _device.delete(id);
}
