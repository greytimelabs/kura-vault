import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// The system pickers and the camera hand this app a plaintext COPY of each
/// chosen photo, in its cache or temporary folder. Those copies are the only
/// unencrypted files this app ever has on disk, so they are deleted as soon as
/// they have been encrypted, and anything a crash left behind is swept at start.
class TempFiles {
  static final _uuidName = RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      caseSensitive: false);
  static final _imageName = RegExp(
      r'\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$',
      caseSensitive: false);

  static Future<List<Directory>> _roots() async {
    final roots = <String, Directory>{};
    for (final dir in [Directory.systemTemp, await getTemporaryDirectory()]) {
      roots[dir.absolute.path] = dir;
    }
    return roots.values.toList();
  }

  /// Delete a picked file, if it is a copy inside this app's own temporary
  /// storage. A file the user still owns elsewhere is never touched.
  static Future<void> discard(String path) async {
    try {
      final file = File(path).absolute;
      final roots = await _roots();
      if (!roots.any((root) => file.path.startsWith('${root.absolute.path}/'))) return;
      if (await file.exists()) await file.delete();
      // The pickers put each copy in a folder of its own
      final parent = file.parent;
      if (_uuidName.hasMatch(parent.uri.pathSegments.where((s) => s.isNotEmpty).last) &&
          await parent.list().isEmpty) {
        await parent.delete();
      }
    } catch (_) {
      // The sweep at next start gets it
    }
  }

  /// Remove every picker and camera copy left in temporary storage. Only
  /// what those leave is matched: the encrypted thumbnail cache lives in a
  /// folder of its own and is not touched.
  static Future<void> sweep() async {
    try {
      for (final root in await _roots()) {
        if (!await root.exists()) continue;
        await for (final entity in root.list(followLinks: false)) {
          final name = entity.uri.pathSegments.where((s) => s.isNotEmpty).last;
          try {
            if (entity is Directory && _uuidName.hasMatch(name)) {
              await entity.delete(recursive: true);
            } else if (entity is File &&
                (name.startsWith('image_picker') || _imageName.hasMatch(name))) {
              await entity.delete();
            }
          } catch (_) {}
        }
      }
    } catch (_) {
      // Best effort: a failed sweep must not keep the app from starting
    }
  }
}
