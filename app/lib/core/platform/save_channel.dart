import 'package:flutter/services.dart';

/// Hands a decrypted file to the device, outside this app. From there it is an
/// ordinary file: other apps, device backups and cloud photo sync can read it.
class SaveChannel {
  static const _channel = MethodChannel('kura/save');

  /// Add a photo to the device's photo gallery. Throws [PlatformException]
  /// with code `denied` when the user refuses the permission it needs.
  static Future<void> toGallery({
    required Uint8List bytes,
    required String name,
    required String mimeType,
  }) =>
      _channel.invokeMethod<void>('gallery', {
        'bytes': bytes,
        'name': name,
        'mimeType': mimeType,
      });

  /// Ask where to put the file with the system's save dialog. False when the
  /// user cancelled.
  static Future<bool> toFiles({
    required Uint8List bytes,
    required String name,
    required String mimeType,
  }) async {
    final saved = await _channel.invokeMethod<bool>('files', {
      'bytes': bytes,
      'name': name,
      'mimeType': mimeType,
    });
    return saved ?? false;
  }
}
