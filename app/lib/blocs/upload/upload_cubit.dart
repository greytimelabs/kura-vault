import 'dart:async';
import 'dart:typed_data';
import 'package:image_picker/image_picker.dart' show XFile;
import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import '../../core/network/api_error.dart';
import '../../core/platform/media_channel.dart';
import '../../core/storage/temp_files.dart';
import '../crypto/vault_crypto_cubit.dart';
import 'upload_state.dart';

/// What the queue needs from the platform, so tests can stand in for it.
typedef PhotoProcessor = Future<ProcessedPhoto> Function(Uint8List original);

/// Encrypts and uploads picked photos, two at a time. Runs only while the app
/// is in front: the keys it needs live in memory and go when the app locks.
class UploadCubit extends Cubit<UploadState> {
  /// A photo is encrypted in one piece, in memory. Larger files, and videos,
  /// are for the web client or the migration tool.
  static const int maxUploadBytes = 100 * 1024 * 1024;
  static const int _concurrency = 2;

  static final _imageName =
      RegExp(r'\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$', caseSensitive: false);
  static final _videoName = RegExp(r'\.(mp4|m4v|mov|webm|mkv|avi)$', caseSensitive: false);

  final ApiClient _apiClient;
  final VaultCryptoCubit _crypto;
  final PhotoProcessor _process;
  final Dio _storage;

  /// Called once a batch for a vault has settled, to refresh what is on screen.
  void Function(String vaultId)? onBatchDone;

  int _nextId = 1;
  int _running = 0;
  final Map<int, CancelToken> _cancels = {};

  UploadCubit({
    required ApiClient apiClient,
    required VaultCryptoCubit crypto,
    PhotoProcessor process = MediaChannel.process,
    Dio? storage,
  })  : _apiClient = apiClient,
        _crypto = crypto,
        _process = process,
        // Upload links are pre-signed: no token goes to the storage host
        _storage = storage ?? Dio(BaseOptions(connectTimeout: const Duration(seconds: 15))),
        super(const UploadState());

  /// `photo`, `video`, or null when the file is neither.
  static String? mediaTypeOf(XFile file) {
    final mime = file.mimeType ?? '';
    if (mime.startsWith('video/') || (mime.isEmpty && _videoName.hasMatch(file.name))) {
      return 'video';
    }
    if (mime.startsWith('image/') || (mime.isEmpty && _imageName.hasMatch(file.name))) {
      return 'photo';
    }
    return null;
  }

  /// A system picker or the camera is opening or has closed. While one is in
  /// front the app must not lock under it.
  void setPicking(bool picking) {
    if (state.picking != picking) emit(UploadState(items: state.items, picking: picking));
  }

  /// False once the vault is no longer the open one: its key is gone.
  bool canUploadTo(String vaultId) =>
      _crypto.state.isUnlocked && _crypto.state.activeVaultId == vaultId;

  /// Delete picked copies that will not be uploaded after all.
  void discard(List<XFile> files) {
    for (final file in files) {
      unawaited(TempFiles.discard(file.path));
    }
  }

  /// Queue the photos among [files]. Returns how many were neither photos nor
  /// videos and were left out; their temporary copies are deleted here.
  int enqueue(List<XFile> files, {required String vaultId, String? albumId}) {
    final items = <UploadItem>[];
    var skipped = 0;
    for (final file in files) {
      if (mediaTypeOf(file) == null) {
        skipped++;
        unawaited(TempFiles.discard(file.path));
        continue;
      }
      items.add(UploadItem(
        id: _nextId++,
        file: file,
        name: file.name,
        vaultId: vaultId,
        albumId: albumId,
      ));
    }
    if (items.isNotEmpty) {
      emit(UploadState(items: [...state.items, ...items], picking: state.picking));
      _pump();
    }
    return skipped;
  }

  void retry(int id) {
    _patch(id, (item) => item.copyWith(status: UploadStatus.queued, progress: 0));
    _pump();
  }

  /// Remove finished and failed rows, and the plaintext copies of the failed ones.
  void clearSettled() {
    for (final item in state.items.where((i) => !i.isActive)) {
      unawaited(TempFiles.discard(item.file.path));
    }
    emit(UploadState(items: state.items.where((i) => i.isActive).toList(), picking: state.picking));
  }

  /// Stop everything. Called when the vault locks or closes: the key the
  /// uploads need is gone.
  void cancelAll() {
    for (final cancel in _cancels.values) {
      cancel.cancel();
    }
    for (final item in state.items) {
      unawaited(TempFiles.discard(item.file.path));
    }
    if (state.items.isNotEmpty) emit(UploadState(picking: state.picking));
    unawaited(MediaChannel.keepAwake(false));
  }

  void _patch(int id, UploadItem Function(UploadItem item) change) {
    if (isClosed) return;
    emit(UploadState(
      items: [for (final item in state.items) item.id == id ? change(item) : item],
      picking: state.picking,
    ));
  }

  void _pump() {
    while (_running < _concurrency) {
      final next = state.items
          .where((i) => i.status == UploadStatus.queued && !_cancels.containsKey(i.id))
          .firstOrNull;
      if (next == null) return;

      final cancel = CancelToken();
      _cancels[next.id] = cancel;
      _running++;
      if (_running == 1) unawaited(MediaChannel.keepAwake(true));

      _uploadOne(next, cancel).then((_) {
        _patch(next.id, (item) => item.copyWith(status: UploadStatus.done, progress: 1));
        // Encrypted and stored: the plaintext copy has no further use
        unawaited(TempFiles.discard(next.file.path));
      }, onError: (Object error) {
        // Cancelled, or the vault locked under it: the row is already gone
        if (cancel.isCancelled || error is StateError && !_crypto.state.isUnlocked) return;
        _patch(next.id,
            (item) => item.copyWith(status: UploadStatus.failed, error: _describe(error)));
      }).whenComplete(() {
        _cancels.remove(next.id);
        _running--;
        if (_running == 0) unawaited(MediaChannel.keepAwake(false));
        // Refresh the grids once the batch settles rather than after every file
        if (!state.items.any((i) => i.vaultId == next.vaultId && i.isActive)) {
          onBatchDone?.call(next.vaultId);
        }
        _pump();
      });
    }
  }

  static void _check(CancelToken cancel) {
    if (cancel.isCancelled) throw StateError('Cancelled');
  }

  Future<void> _uploadOne(UploadItem item, CancelToken cancel) async {
    final type = mediaTypeOf(item.file);
    if (type == null) throw const _Refused('Not a photo');
    if (type == 'video') {
      throw const _Refused('Videos can be uploaded from the web client');
    }
    final size = await item.file.length();
    if (size > maxUploadBytes) {
      throw const _Refused('Larger than 100 MB. Use the web client or the migration tool.');
    }

    _patch(item.id, (i) => i.copyWith(status: UploadStatus.processing));
    final original = await item.file.readAsBytes();
    final ProcessedPhoto processed;
    try {
      processed = await _process(original);
    } on UnsupportedImageException {
      throw const _Refused('This device cannot read this image format');
    }
    final capturedAt = processed.capturedAt ?? await item.file.lastModified();
    _check(cancel);

    // The server issues the item's id first: every ciphertext made below is bound to it
    final init = await _apiClient.dio.post(
      ApiEndpoints.mediaUploadInit,
      cancelToken: cancel,
      data: {
        'vaultId': item.vaultId,
        'albumId': ?item.albumId,
        'mediaType': 'photo',
        'fileSizeBytes': size,
      },
    );
    final data = init.data['data'] as Map<String, dynamic>;
    final mediaId = data['mediaId'] as String;
    final urls = data['uploadUrls'] as Map<String, dynamic>;
    _check(cancel);

    _patch(item.id, (i) => i.copyWith(status: UploadStatus.encrypting));
    final encrypted = await _crypto.encryptMedia(
      mediaId: mediaId,
      vaultId: item.vaultId,
      albumId: item.albumId,
      thumb: processed.thumb,
      preview: processed.preview,
      original: original,
      meta: {
        'filename': item.name,
        'gpsLatitude': ?processed.gpsLatitude,
        'gpsLongitude': ?processed.gpsLongitude,
      },
    );
    _check(cancel);

    _patch(item.id, (i) => i.copyWith(status: UploadStatus.uploading, progress: 0));
    final tiers = [
      (url: urls['thumb'] as String, data: encrypted.thumb.data),
      (url: urls['preview'] as String, data: encrypted.preview.data),
      (url: urls['original'] as String, data: encrypted.original.data),
    ];
    final total = tiers.fold<int>(0, (sum, tier) => sum + tier.data.length);
    final sent = List<int>.filled(tiers.length, 0);
    await Future.wait([
      for (var i = 0; i < tiers.length; i++)
        _storage.put<void>(
          tiers[i].url,
          data: Stream.value(tiers[i].data),
          cancelToken: cancel,
          options: Options(headers: {
            // Part of the signature: storage rejects the upload if this differs
            Headers.contentTypeHeader: 'application/octet-stream',
            Headers.contentLengthHeader: tiers[i].data.length,
          }),
          onSendProgress: (count, _) {
            sent[i] = count;
            _patch(item.id,
                (it) => it.copyWith(progress: sent.fold<int>(0, (a, b) => a + b) / total));
          },
        ),
    ]);

    // The item's key goes up wrapped under the vault key (when this account
    // holds it) and under the album key (when uploading into an album), never bare
    await _apiClient.dio.post(
      ApiEndpoints.mediaUploadComplete,
      cancelToken: cancel,
      data: {
        'mediaId': mediaId,
        'vaultId': item.vaultId,
        'albumId': ?item.albumId,
        'mediaType': 'photo',
        'capturedAt': capturedAt.toUtc().toIso8601String(),
        'fileSizeBytes': size,
        'width': processed.width,
        'height': processed.height,
        if (encrypted.vaultKey != null) ...{
          'keyWrappedVault': encrypted.vaultKey!.wrapped,
          'keyNonceVault': encrypted.vaultKey!.nonce,
        },
        if (encrypted.albumKey != null) ...{
          'keyWrappedAlbum': encrypted.albumKey!.wrapped,
          'keyNonceAlbum': encrypted.albumKey!.nonce,
        },
        'thumbIv': encrypted.thumb.iv,
        'previewIv': encrypted.preview.iv,
        'originalIv': encrypted.original.iv,
        'encryptedMeta': encrypted.encryptedMeta,
        'metaNonce': encrypted.metaNonce,
      },
    );
  }

  static String _describe(Object error) {
    if (error is _Refused) return error.message;
    // The storage host, not the API: its refusals say nothing about permissions
    if (error is DioException && error.requestOptions.method == 'PUT') {
      final status = error.response?.statusCode;
      return status == null
          ? 'Upload failed. Check your connection.'
          : 'Storage rejected the upload ($status)';
    }
    if (apiStatus(error) == 403) return 'You do not have permission to upload here';
    return apiErrorMessage(error, 'Upload failed');
  }

  @override
  Future<void> close() {
    cancelAll();
    return super.close();
  }
}

/// A file this app will not upload, with the reason to show.
class _Refused implements Exception {
  final String message;
  const _Refused(this.message);
}
