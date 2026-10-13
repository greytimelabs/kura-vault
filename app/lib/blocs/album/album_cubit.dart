import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import '../../core/network/api_error.dart';
import '../crypto/vault_crypto_cubit.dart';
import '../media/media_state.dart';
import 'album_state.dart';

class AlbumCubit extends Cubit<AlbumState> {
  final ApiClient _apiClient;

  AlbumCubit({required ApiClient apiClient})
      : _apiClient = apiClient,
        super(const AlbumState());

  /// Load albums for a vault. [quiet] keeps what is on screen while it loads.
  Future<void> loadAlbums(String vaultId, {bool quiet = false}) async {
    if (!quiet) emit(state.copyWith(status: AlbumStatus.loading));
    try {
      final response = await _apiClient.dio.get(
        ApiEndpoints.albums,
        queryParameters: {'vaultId': vaultId},
      );

      final data = response.data['data'] as List<dynamic>;
      final albums = data
          .map((a) => AlbumItem.fromJson(a as Map<String, dynamic>))
          .toList();

      emit(state.copyWith(status: AlbumStatus.loaded, albums: albums));
    } catch (e) {
      emit(state.copyWith(
        status: AlbumStatus.error,
        errorMessage: e.toString(),
      ));
    }
  }

  /// Make an album: a fresh key wrapped under the vault key, with the name
  /// encrypted under the album key. Returns the new album's id.
  Future<String> createAlbum({
    required String vaultId,
    required String name,
    required VaultCryptoCubit crypto,
  }) async {
    final album = crypto.createAlbum(vaultId: vaultId, name: name.trim());
    await _apiClient.dio.post(ApiEndpoints.albums, data: {
      'id': album.id,
      'vaultId': vaultId,
      'nameEncrypted': album.nameEncrypted,
      'nameNonce': album.nameNonce,
      'keyWrapped': album.keyWrapped,
      'keyNonce': album.keyNonce,
    });
    await loadAlbums(vaultId, quiet: true);
    return album.id;
  }

  /// Needs the album's key to be loaded already (it is, once the album list
  /// has been shown).
  Future<void> renameAlbum({
    required String vaultId,
    required String albumId,
    required String name,
    required VaultCryptoCubit crypto,
  }) async {
    final encrypted = crypto.encryptAlbumName(albumId: albumId, name: name.trim());
    await _apiClient.dio.put(ApiEndpoints.album(albumId), data: {
      'nameEncrypted': encrypted.encrypted,
      'nameNonce': encrypted.nonce,
    });
    await loadAlbums(vaultId, quiet: true);
  }

  /// Put one item in an album: its key is re-wrapped under the album key.
  Future<void> _addOne(String albumId, MediaItem item, VaultCryptoCubit crypto) async {
    final ref = item.key;
    if (ref == null) throw StateError('This item cannot be decrypted with the keys you hold');
    final key = crypto.rewrapMediaKey(mediaId: item.id, key: ref, albumId: albumId);
    await _apiClient.dio.post(ApiEndpoints.albumMedia(albumId), data: {
      'mediaId': item.id,
      'keyWrapped': key.wrapped,
      'keyNonce': key.nonce,
    });
  }

  Future<void> _removeOne(String albumId, MediaItem item, VaultCryptoCubit crypto) async {
    try {
      await _apiClient.dio.delete(ApiEndpoints.albumMediaItem(albumId, item.id));
    } catch (e) {
      final ref = item.key;
      if (apiStatus(e) != 409 || ref == null) rethrow;
      // Uploaded by someone who had only this album, so the album holds the
      // only copy of its key. Give it a vault-wrapped key first, then take it out.
      final key = crypto.rewrapMediaKey(mediaId: item.id, key: ref, vaultId: item.vaultId);
      await _apiClient.dio.put(ApiEndpoints.mediaVaultKey(item.id), data: {
        'keyWrapped': key.wrapped,
        'keyNonce': key.nonce,
      });
      await _apiClient.dio.delete(ApiEndpoints.albumMediaItem(albumId, item.id));
    }
  }

  /// Add [items] to an album, or take them out. Returns how many could not be
  /// changed. The API takes one photo per request.
  Future<int> changeMembership({
    required String vaultId,
    required String albumId,
    required List<MediaItem> items,
    required bool add,
    required VaultCryptoCubit crypto,
  }) async {
    var failed = 0;
    final queue = [...items];
    Future<void> worker() async {
      while (queue.isNotEmpty) {
        final item = queue.removeAt(0);
        try {
          await (add ? _addOne(albumId, item, crypto) : _removeOne(albumId, item, crypto));
        } catch (e) {
          // "Already in this album" / "not in this album" leave things as the user wanted
          final status = apiStatus(e);
          if (status != 400 && status != 404) failed++;
        }
      }
    }

    await Future.wait([worker(), worker(), worker()]);
    await loadAlbums(vaultId, quiet: true);
    return failed;
  }

  /// Delete an album; its items stay in the vault. Items uploaded by someone
  /// who had only this album are given their vault-wrapped key first, or
  /// nobody could decrypt them afterwards.
  Future<void> deleteAlbum({
    required String vaultId,
    required String albumId,
    required VaultCryptoCubit crypto,
  }) async {
    try {
      await _apiClient.dio.delete(ApiEndpoints.album(albumId));
    } catch (e) {
      if (apiStatus(e) != 409) rethrow;
      for (var page = 1;; page++) {
        final response = await _apiClient.dio.get(
          ApiEndpoints.media,
          queryParameters: {'vaultId': vaultId, 'albumId': albumId, 'page': page, 'limit': 100},
        );
        final data = response.data['data'] as Map<String, dynamic>;
        for (final m in data['data'] as List<dynamic>) {
          final item = MediaItem.fromJson(m as Map<String, dynamic>);
          final ref = item.key;
          if (ref == null || ref.scope != 'album') continue;
          final key = crypto.rewrapMediaKey(mediaId: item.id, key: ref, vaultId: vaultId);
          await _apiClient.dio.put(ApiEndpoints.mediaVaultKey(item.id), data: {
            'keyWrapped': key.wrapped,
            'keyNonce': key.nonce,
          });
        }
        if (page >= (data['totalPages'] as int)) break;
      }
      await _apiClient.dio.delete(ApiEndpoints.album(albumId));
    }
    await loadAlbums(vaultId, quiet: true);
  }

  /// Forget everything loaded. Used when the account changes.
  void reset() => emit(const AlbumState());
}
