import 'package:flutter/services.dart';

/// The two derived tiers of a photo, and what its EXIF says about it.
class ProcessedPhoto {
  final Uint8List thumb;
  final Uint8List preview;
  final int width;
  final int height;

  /// When it was taken, when the file says. Null means "use the file's date".
  final DateTime? capturedAt;
  final double? gpsLatitude;
  final double? gpsLongitude;

  const ProcessedPhoto({
    required this.thumb,
    required this.preview,
    required this.width,
    required this.height,
    this.capturedAt,
    this.gpsLatitude,
    this.gpsLongitude,
  });
}

/// The device cannot decode this file as an image.
class UnsupportedImageException implements Exception {}

/// Image work the platform does better than Dart can: decoding every format
/// the device knows (HEIC included), resizing, JPEG encoding, EXIF.
class MediaChannel {
  static const _channel = MethodChannel('kura/media');

  /// Thumbnail and preview JPEGs for [original], at the same sizes and quality
  /// as the web client makes them. Nothing is written to disk.
  static Future<ProcessedPhoto> process(Uint8List original) async {
    final Map<Object?, Object?>? out;
    try {
      out = await _channel.invokeMethod<Map<Object?, Object?>>('process', {'bytes': original});
    } on PlatformException {
      throw UnsupportedImageException();
    }
    if (out == null) throw UnsupportedImageException();
    return ProcessedPhoto(
      thumb: out['thumb'] as Uint8List,
      preview: out['preview'] as Uint8List,
      width: out['width'] as int,
      height: out['height'] as int,
      capturedAt: parseExifDate(out['exifDate'] as String?, out['exifOffset'] as String?),
      gpsLatitude: (out['gpsLatitude'] as num?)?.toDouble(),
      gpsLongitude: (out['gpsLongitude'] as num?)?.toDouble(),
    );
  }

  /// Keep the screen on, so it turning off does not pause uploads.
  static Future<void> keepAwake(bool on) async {
    try {
      await _channel.invokeMethod<void>('keepAwake', on);
    } catch (_) {
      // Uploads still work; they just pause with the screen
    }
  }

  /// EXIF writes `2024:03:05 10:30:00` with the time zone, if at all, in a
  /// separate `+02:00`. Without one it is the time on the camera's clock, read
  /// as this device's local time, as the web client does.
  static DateTime? parseExifDate(String? date, String? offset) {
    if (date == null) return null;
    final m = RegExp(r'^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})').firstMatch(date.trim());
    if (m == null) return null;
    final parts = [for (var i = 1; i <= 6; i++) int.parse(m.group(i)!)];
    // Cameras with no clock set write zeros
    if (parts[0] < 1900 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) {
      return null;
    }
    final zone = offset == null ? null : RegExp(r'^([+-])(\d{2}):(\d{2})$').firstMatch(offset.trim());
    if (zone == null) {
      return DateTime(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    }
    final minutes = int.parse(zone.group(2)!) * 60 + int.parse(zone.group(3)!);
    final utc = DateTime.utc(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    return utc.subtract(Duration(minutes: zone.group(1) == '-' ? -minutes : minutes));
  }
}
