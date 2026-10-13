import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart' show XFile;
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/blocs/upload/upload_cubit.dart';
import 'package:kura_vault/blocs/upload/upload_state.dart';
import 'package:kura_vault/core/platform/media_channel.dart';
import '../support/fake_network.dart';

const _mediaId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late VaultCryptoCubit crypto;
  late String vaultId;
  late String albumId;
  final original = Uint8List.fromList(List.generate(4000, (i) => i % 256));
  final thumb = Uint8List.fromList([1, 2, 3]);
  final preview = Uint8List.fromList([4, 5, 6, 7]);

  setUpAll(() async {
    crypto = VaultCryptoCubit();
    await crypto.createAccount(userId: 'owner', username: 'owner', passphrase: 'owner master');
    final made = await crypto.createVault(passphrase: 'vault passphrase', label: 'Family');
    crypto.selectVault(made.match, [made.match]);
    vaultId = made.vault.id;
    albumId = crypto.createAlbum(vaultId: vaultId, name: 'Trip').id;
  });

  tearDownAll(() => crypto.lock());

  Future<ProcessedPhoto> process(Uint8List bytes) async => ProcessedPhoto(
        thumb: thumb,
        preview: preview,
        width: 4000,
        height: 3000,
        capturedAt: DateTime.utc(2024, 3, 5, 10, 30),
        gpsLatitude: 12.5,
      );

  /// The API and the storage host, each recording what it was sent.
  Future<(UploadCubit, FakeNetwork api, FakeNetwork storage)> queue({
    Future<ProcessedPhoto> Function(Uint8List)? processor,
    int storageStatus = 200,
  }) async {
    final api = FakeNetwork()
      ..handler = (o) => o.uri.path.endsWith('/upload/init')
          ? FakeNetwork.json(201, {
              'data': {
                'mediaId': _mediaId,
                'uploadUrls': {
                  'thumb': 'https://storage.example.com/t',
                  'preview': 'https://storage.example.com/p',
                  'original': 'https://storage.example.com/o',
                },
              },
            })
          : FakeNetwork.json(201, {
              'data': {'id': _mediaId},
            });
    final storage = FakeNetwork()..handler = (_) => FakeNetwork.json(storageStatus, {});
    final uploads = UploadCubit(
      apiClient: await signedInClient(api),
      crypto: crypto,
      process: processor ?? process,
      storage: Dio()..httpClientAdapter = storage,
    );
    return (uploads, api, storage);
  }

  Future<void> settled(UploadCubit uploads) async {
    for (var i = 0; i < 200 && uploads.state.active > 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(uploads.state.active, 0, reason: 'uploads did not settle');
  }

  test('a photo goes up encrypted, bound to the id the server issued', () async {
    final (uploads, api, storage) = await queue();
    final refreshed = <String>[];
    uploads.onBatchDone = refreshed.add;

    final skipped = uploads.enqueue(
      [
        XFile.fromData(original, path: 'IMG_1.jpg', mimeType: 'image/jpeg', length: original.length),
        XFile.fromData(Uint8List(3), path: 'notes.txt', mimeType: 'text/plain', length: 3),
      ],
      vaultId: vaultId,
      albumId: albumId,
    );
    expect(skipped, 1);
    await settled(uploads);
    expect(uploads.state.items.single.status, UploadStatus.done);
    expect(refreshed, [vaultId]);

    // The server names the item before anything is encrypted
    final calls = api.requests.where((r) => r.method == 'POST').map((r) => r.uri.path).toList();
    expect(calls.first, endsWith('/media/upload/init'));
    expect(calls.last, endsWith('/media/upload/complete'));
    expect(api.sent('POST', '/media/upload/init').single.data, {
      'vaultId': vaultId,
      'albumId': albumId,
      'mediaType': 'photo',
      'fileSizeBytes': original.length,
    });

    // Storage gets three opaque blobs and no credentials
    expect(storage.requests.map((r) => r.uri.path), unorderedEquals(['/t', '/p', '/o']));
    for (final put in storage.requests) {
      expect(put.method, 'PUT');
      expect(put.headers[Headers.contentTypeHeader], 'application/octet-stream');
      expect(put.headers.keys.map((k) => k.toLowerCase()), isNot(contains('authorization')));
    }

    final body = api.sent('POST', '/media/upload/complete').single.data as Map;
    expect(body['mediaId'], _mediaId);
    expect(body['capturedAt'], '2024-03-05T10:30:00.000Z');
    expect(body['width'], 4000);
    expect(body['height'], 3000);
    // Nothing readable: no name, no location, no key
    final text = body.values.join(' ');
    expect(text, isNot(contains('IMG_1')));
    expect(text, isNot(contains('12.5')));

    // What was stored opens again, through the vault key and through the album key
    for (final ref in [
      MediaKeyRef(
          scope: 'vault',
          vaultId: vaultId,
          wrapped: body['keyWrappedVault'] as String,
          nonce: body['keyNonceVault'] as String),
      MediaKeyRef(
          scope: 'album',
          vaultId: vaultId,
          albumId: albumId,
          wrapped: body['keyWrappedAlbum'] as String,
          nonce: body['keyNonceAlbum'] as String),
    ]) {
      expect(
        crypto.decryptMeta(
            mediaId: _mediaId,
            key: ref,
            encrypted: body['encryptedMeta'] as String,
            nonce: body['metaNonce'] as String),
        '{"filename":"IMG_1.jpg","gpsLatitude":12.5}',
      );
    }

    uploads.clearSettled();
    expect(uploads.state.items, isEmpty);
    await uploads.close();
  });

  test('videos, oversized files and unreadable images are refused before any request', () async {
    final (uploads, api, storage) = await queue(
      processor: (bytes) async => bytes.length == 7 ? throw UnsupportedImageException() : await process(bytes),
    );

    uploads.enqueue(
      [
        XFile.fromData(Uint8List(5), path: 'clip.mp4', mimeType: 'video/mp4', length: 5),
        XFile.fromData(Uint8List(5), path: 'huge.jpg', mimeType: 'image/jpeg', length: UploadCubit.maxUploadBytes + 1),
        XFile.fromData(Uint8List(7), path: 'odd.heic', length: 7),
      ],
      vaultId: vaultId,
    );
    await settled(uploads);

    expect(uploads.state.items.map((i) => i.status), everyElement(UploadStatus.failed));
    expect(uploads.state.items.map((i) => i.error), [
      'Videos can be uploaded from the web client',
      'Larger than 100 MB. Use the web client or the migration tool.',
      'This device cannot read this image format',
    ]);
    expect(api.requests, isEmpty);
    expect(storage.requests, isEmpty);
    expect(uploads.state.summary, '0 uploaded, 3 failed');
    await uploads.close();
  });

  test('a storage failure is reported and the upload is never completed', () async {
    final (uploads, api, _) = await queue(storageStatus: 403);

    uploads.enqueue(
      [XFile.fromData(original, path: 'IMG_2.jpg', mimeType: 'image/jpeg', length: original.length)],
      vaultId: vaultId,
    );
    await settled(uploads);

    final item = uploads.state.items.single;
    expect(item.status, UploadStatus.failed);
    expect(item.error, 'Storage rejected the upload (403)');
    expect(api.sent('POST', '/media/upload/complete'), isEmpty);
    // No album: the key is wrapped under the vault key only
    expect((api.sent('POST', '/media/upload/init').single.data as Map).containsKey('albumId'), false);
    await uploads.close();
  });

  test('cancelling clears the queue, and the app stays unlocked only while there is work', () async {
    final (uploads, _, _) = await queue();
    expect(uploads.state.keepsUnlocked, false);

    uploads.setPicking(true);
    expect(uploads.state.keepsUnlocked, true);
    uploads.setPicking(false);

    uploads.enqueue(
      [XFile.fromData(original, path: 'IMG_3.jpg', mimeType: 'image/jpeg', length: original.length)],
      vaultId: vaultId,
    );
    expect(uploads.state.keepsUnlocked, true);

    uploads.cancelAll();
    expect(uploads.state.items, isEmpty);
    expect(uploads.state.keepsUnlocked, false);
    expect(uploads.canUploadTo(vaultId), true);
    expect(uploads.canUploadTo('another-vault'), false);
    await uploads.close();
  });

  test('EXIF dates are read as the camera wrote them', () {
    expect(MediaChannel.parseExifDate(null, null), isNull);
    expect(MediaChannel.parseExifDate('garbage', null), isNull);
    // A camera with no clock set
    expect(MediaChannel.parseExifDate('0000:00:00 00:00:00', null), isNull);
    // No time zone recorded: the time on the camera's clock, read as local time
    expect(MediaChannel.parseExifDate('2024:03:05 10:30:00', null), DateTime(2024, 3, 5, 10, 30));
    // With one: an exact moment
    expect(MediaChannel.parseExifDate('2024:03:05 10:30:00', '+02:00'), DateTime.utc(2024, 3, 5, 8, 30));
    expect(MediaChannel.parseExifDate('2024:03:05 10:30:00', '-05:30'), DateTime.utc(2024, 3, 5, 16, 0));
  });

  test('files are told apart by type, then by name', () {
    XFile f(String name, [String? mime]) => XFile.fromData(Uint8List(1), path: name, mimeType: mime);
    expect(UploadCubit.mediaTypeOf(f('a.bin', 'image/heic')), 'photo');
    expect(UploadCubit.mediaTypeOf(f('a.HEIC')), 'photo');
    expect(UploadCubit.mediaTypeOf(f('a.mov')), 'video');
    expect(UploadCubit.mediaTypeOf(f('a.jpg', 'video/mp4')), 'video');
    expect(UploadCubit.mediaTypeOf(f('a.pdf', 'application/pdf')), isNull);
    expect(UploadCubit.mediaTypeOf(f('a')), isNull);
  });
}
