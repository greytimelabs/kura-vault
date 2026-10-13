import 'package:image_picker/image_picker.dart' show XFile;

enum UploadStatus { queued, processing, encrypting, uploading, done, failed }

class UploadItem {
  final int id;

  /// The picked file: a plaintext copy in this app's temporary storage, kept
  /// only until the upload is done or dismissed.
  final XFile file;
  final String name;
  final String vaultId;

  /// Album to put the photo in as it is uploaded.
  final String? albumId;
  final UploadStatus status;

  /// 0 to 1, meaningful while uploading.
  final double progress;
  final String? error;

  const UploadItem({
    required this.id,
    required this.file,
    required this.name,
    required this.vaultId,
    this.albumId,
    this.status = UploadStatus.queued,
    this.progress = 0,
    this.error,
  });

  bool get isActive => status != UploadStatus.done && status != UploadStatus.failed;

  UploadItem copyWith({UploadStatus? status, double? progress, String? error}) => UploadItem(
        id: id,
        file: file,
        name: name,
        vaultId: vaultId,
        albumId: albumId,
        status: status ?? this.status,
        progress: progress ?? this.progress,
        error: error,
      );
}

class UploadState {
  final List<UploadItem> items;

  /// A system picker or the camera, opened from here, is in front.
  final bool picking;

  const UploadState({this.items = const [], this.picking = false});

  int get active => items.where((i) => i.isActive).length;
  int get failed => items.where((i) => i.status == UploadStatus.failed).length;
  int get done => items.where((i) => i.status == UploadStatus.done).length;

  /// Locking now would throw work away, or lock the app under a picker.
  bool get keepsUnlocked => picking || active > 0;

  String get summary => active > 0
      ? 'Uploading $active of ${items.length}'
      : failed > 0
          ? '$done uploaded, $failed failed'
          : '$done uploaded';
}
