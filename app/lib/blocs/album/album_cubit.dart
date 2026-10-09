import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import 'album_state.dart';

class AlbumCubit extends Cubit<AlbumState> {
  final ApiClient _apiClient;

  AlbumCubit({required ApiClient apiClient})
      : _apiClient = apiClient,
        super(const AlbumState());

  /// Load albums for a vault.
  Future<void> loadAlbums(String vaultId) async {
    emit(state.copyWith(status: AlbumStatus.loading));
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

  /// Create a new album.
  Future<void> createAlbum({
    required String vaultId,
    required String nameEncrypted,
    required String nameNonce,
  }) async {
    try {
      await _apiClient.dio.post(ApiEndpoints.albums, data: {
        'vaultId': vaultId,
        'nameEncrypted': nameEncrypted,
        'nameNonce': nameNonce,
      });
      // Reload albums
      await loadAlbums(vaultId);
    } catch (e) {
      emit(state.copyWith(
        status: AlbumStatus.error,
        errorMessage: e.toString(),
      ));
    }
  }
}
