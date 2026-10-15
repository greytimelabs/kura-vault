import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wrapper around flutter_secure_storage (Keychain / EncryptedSharedPreferences).
class SecureStorageService {
  // Readable only while the device is unlocked, and never part of a backup or
  // a transfer to another device: a restored phone has to sign in again.
  static const _deviceOnly =
      IOSOptions(accessibility: KeychainAccessibility.unlocked_this_device);

  // What earlier builds wrote with. Reads find an item whichever way it was
  // saved and the next write moves it to [_deviceOnly], but a delete only
  // matches the setting it is given.
  static const _legacy = IOSOptions();

  final FlutterSecureStorage _storage;

  SecureStorageService()
      : _storage = const FlutterSecureStorage(
          // Storage the keystore can no longer decrypt (a reinstall, a wiped
          // or replaced keystore key) is cleared instead of failing every
          // read: the user signs in again rather than the app never starting
          aOptions: AndroidOptions(
            encryptedSharedPreferences: true,
            resetOnError: true,
          ),
          iOptions: _deviceOnly,
        );

  Future<String?> read(String key) => _storage.read(key: key);

  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  Future<void> delete(String key) async {
    await _storage.delete(key: key);
    await _storage.delete(key: key, iOptions: _legacy);
  }
}
