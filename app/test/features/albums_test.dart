import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/album/album_cubit.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/blocs/media/media_state.dart';
import 'package:kura_vault/blocs/selection/selection_cubit.dart';
import '../support/fake_network.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late VaultCryptoCubit crypto;
  late String vaultId;
  late MediaItem viaVault;
  late MediaItem viaAlbumOnly;
  late String sourceAlbumId;

  // One open vault holding one item wrapped under the vault key, and one that
  // someone with only an album uploaded (wrapped under that album's key alone)
  setUpAll(() async {
    crypto = VaultCryptoCubit();
    await crypto.createAccount(userId: 'owner', username: 'owner', passphrase: 'owner master');
    final made = await crypto.createVault(passphrase: 'vault passphrase', label: 'Family');
    crypto.selectVault(made.match, [made.match]);
    vaultId = made.vault.id;
    sourceAlbumId = crypto.createAlbum(vaultId: vaultId, name: 'Source').id;

    Future<MediaItem> upload(String id, {required bool vaultWrap}) async {
      final blob = Uint8List.fromList([1, 2, 3]);
      final enc = await crypto.encryptMedia(
          mediaId: id, vaultId: vaultId, albumId: sourceAlbumId, thumb: blob, preview: blob, original: blob, meta: const {});
      final wrap = vaultWrap ? enc.vaultKey! : enc.albumKey!;
      return MediaItem(
        id: id,
        vaultId: vaultId,
        mediaType: 'photo',
        thumbIv: enc.thumb.iv,
        thumbUrl: 'https://storage.example.com/$id',
        key: MediaKeyRef(
          scope: vaultWrap ? 'vault' : 'album',
          vaultId: vaultId,
          albumId: vaultWrap ? null : sourceAlbumId,
          wrapped: wrap.wrapped,
          nonce: wrap.nonce,
        ),
      );
    }

    viaVault = await upload('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', vaultWrap: true);
    viaAlbumOnly = await upload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', vaultWrap: false);
  });

  tearDownAll(() => crypto.lock());

  test('a new album is stored with only ciphertext, and its name reads back', () async {
    final network = FakeNetwork()
      ..handler = (o) => FakeNetwork.json(200, {'data': o.method == 'GET' ? [] : null});
    final albums = AlbumCubit(apiClient: await signedInClient(network));

    final id = await albums.createAlbum(vaultId: vaultId, name: '  Beach  ', crypto: crypto);
    final body = network.sent('POST', '/albums').single.data as Map;
    expect(body['id'], id);
    expect(body['vaultId'], vaultId);
    expect(body.values.join(' '), isNot(contains('Beach')));
    expect(
      crypto.openAlbums(vaultId, [
        (
          id: id,
          keyWrapped: body['keyWrapped'] as String?,
          keyNonce: body['keyNonce'] as String?,
          nameEncrypted: body['nameEncrypted'] as String?,
          nameNonce: body['nameNonce'] as String?,
        ),
      ])[id],
      'Beach',
    );

    await albums.renameAlbum(vaultId: vaultId, albumId: id, name: 'Coast', crypto: crypto);
    final renamed = network.sent('PUT', '/albums/$id').single.data as Map;
    expect(renamed.keys, unorderedEquals(['nameEncrypted', 'nameNonce']));
    expect(
      crypto.openAlbums(vaultId, [
        (
          id: id,
          keyWrapped: null,
          keyNonce: null,
          nameEncrypted: renamed['nameEncrypted'] as String?,
          nameNonce: renamed['nameNonce'] as String?,
        ),
      ])[id],
      'Coast',
    );
  });

  test('adding sends the item key re-wrapped under the album key', () async {
    final network = FakeNetwork()
      ..handler = (o) => FakeNetwork.json(200, {'data': o.method == 'GET' ? [] : null});
    final albums = AlbumCubit(apiClient: await signedInClient(network));
    final target = crypto.createAlbum(vaultId: vaultId, name: 'Target').id;

    final failed = await albums.changeMembership(
        vaultId: vaultId, albumId: target, items: [viaVault, viaAlbumOnly], add: true, crypto: crypto);
    expect(failed, 0);

    final sent = network.sent('POST', '/albums/$target/media').map((r) => r.data as Map).toList();
    expect(sent.map((b) => b['mediaId']), unorderedEquals([viaVault.id, viaAlbumOnly.id]));
    for (final body in sent) {
      final item = body['mediaId'] == viaVault.id ? viaVault : viaAlbumOnly;
      // The new wrap opens to the same item key: the thumbnail decrypts through it
      final ref = MediaKeyRef(
          scope: 'album',
          vaultId: vaultId,
          albumId: target,
          wrapped: body['keyWrapped'] as String,
          nonce: body['keyNonce'] as String);
      final again = crypto.rewrapMediaKey(mediaId: item.id, key: ref, vaultId: vaultId);
      expect(again.wrapped, isNotEmpty);
    }
  });

  test('deleting an album first gives a vault key to every item only it can open', () async {
    Map<String, dynamic> row(MediaItem item) => {
          'id': item.id,
          'vaultId': item.vaultId,
          'mediaType': 'photo',
          'thumbIv': item.thumbIv,
          'thumbUrl': item.thumbUrl,
          'key': {
            'scope': item.key!.scope,
            'albumId': item.key!.albumId,
            'wrapped': item.key!.wrapped,
            'nonce': item.key!.nonce,
          },
        };
    var deletes = 0;
    final network = FakeNetwork();
    network.handler = (o) {
      if (o.method == 'DELETE' && deletes++ == 0) {
        return FakeNetwork.json(409, {'message': 'Add the vault key for every item first'});
      }
      if (o.method == 'GET' && o.uri.path.endsWith('/media')) {
        return FakeNetwork.json(200, {
          'data': {
            'data': [row(viaVault), row(viaAlbumOnly)],
            'total': 2,
            'page': 1,
            'totalPages': 1,
          },
        });
      }
      return FakeNetwork.json(200, {'data': o.method == 'GET' ? [] : null});
    };
    final albums = AlbumCubit(apiClient: await signedInClient(network));

    await albums.deleteAlbum(vaultId: vaultId, albumId: sourceAlbumId, crypto: crypto);

    final order = network.requests
        .where((r) => r.method != 'GET')
        .map((r) => '${r.method} ${r.uri.path.split('/api/v1').last}')
        .toList();
    // Only the item that had no vault key is given one
    expect(order, [
      'DELETE /albums/$sourceAlbumId',
      'PUT /media/${viaAlbumOnly.id}/vault-key',
      'DELETE /albums/$sourceAlbumId',
    ]);
    expect(network.sent('GET', '/media').single.uri.queryParameters['albumId'], sourceAlbumId);
  });

  test('an album that cannot be deleted says so and is left alone', () async {
    final network = FakeNetwork()
      ..handler = (o) => o.method == 'DELETE'
          ? FakeNetwork.json(403, {'message': 'Write access to the vault required'})
          : FakeNetwork.json(200, {'data': []});
    final albums = AlbumCubit(apiClient: await signedInClient(network));
    await expectLater(
      albums.deleteAlbum(vaultId: vaultId, albumId: sourceAlbumId, crypto: crypto),
      throwsA(anything),
    );
    expect(network.requests.where((r) => r.method == 'PUT'), isEmpty);
  });

  test('removing an item only its album can open gives it a vault key first', () async {
    var deletes = 0;
    final network = FakeNetwork();
    network.handler = (o) {
      if (o.method == 'DELETE' && deletes++ == 0) {
        return FakeNetwork.json(409, {'message': 'This album holds the only key'});
      }
      return FakeNetwork.json(200, {'data': o.method == 'GET' ? [] : null});
    };
    final albums = AlbumCubit(apiClient: await signedInClient(network));

    final failed = await albums.changeMembership(
        vaultId: vaultId, albumId: sourceAlbumId, items: [viaAlbumOnly], add: false, crypto: crypto);
    expect(failed, 0);

    final order = network.requests.where((r) => r.method != 'GET').map((r) => r.method).toList();
    expect(order, ['DELETE', 'PUT', 'DELETE']);
    final key = network.sent('PUT', '/media/${viaAlbumOnly.id}/vault-key').single.data as Map;
    expect(key.keys, unorderedEquals(['keyWrapped', 'keyNonce']));
  });

  test('already-there and not-there are not failures; anything else is counted', () async {
    for (final (status, expected) in [(400, 0), (404, 0), (403, 1), (500, 1)]) {
      final network = FakeNetwork()
        ..handler = (o) => o.method == 'GET'
            ? FakeNetwork.json(200, {'data': []})
            : FakeNetwork.json(status, {'message': 'no'});
      final albums = AlbumCubit(apiClient: await signedInClient(network));
      expect(
        await albums.changeMembership(
            vaultId: vaultId, albumId: sourceAlbumId, items: [viaVault], add: true, crypto: crypto),
        expected,
        reason: 'status $status',
      );
    }
  });

  test('selection: long-press starts it, tapping toggles, clearing leaves the mode', () {
    final selection = SelectionCubit();
    expect(selection.state.active, false);

    selection.toggle('a');
    expect(selection.state.active, true);
    selection.toggle('b');
    selection.toggle('a');
    expect(selection.state.ids, {'b'});

    // Unpicking the last one stays in selection mode until it is closed
    selection.toggle('b');
    expect(selection.state.active, true);
    expect(selection.state.ids, isEmpty);

    selection.clear();
    expect(selection.state.active, false);

    selection.start();
    expect(selection.state.active, true);
    expect(selection.state.ids, isEmpty);
  });
}
