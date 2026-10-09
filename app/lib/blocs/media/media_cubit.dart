import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import 'media_state.dart';

class MediaCubit extends Cubit<MediaState> {
  final ApiClient _apiClient;

  MediaCubit({required ApiClient apiClient})
      : _apiClient = apiClient,
        super(const MediaState());

  /// Load first page of media for a vault.
  Future<void> loadMedia({
    required String vaultId,
    String? albumId,
    String? yearMonth,
  }) async {
    emit(state.copyWith(status: MediaStatus.loading));
    try {
      final response = await _apiClient.dio.get(
        ApiEndpoints.media,
        queryParameters: {
          'vaultId': vaultId,
          'page': 1,
          'limit': 50,
          if (albumId != null) 'albumId': albumId,
          if (yearMonth != null) 'yearMonth': yearMonth,
        },
      );

      final data = response.data['data'] as Map<String, dynamic>;
      final items = (data['data'] as List<dynamic>)
          .map((m) => MediaItem.fromJson(m as Map<String, dynamic>))
          .toList();

      emit(state.copyWith(
        status: MediaStatus.loaded,
        items: items,
        total: data['total'] as int,
        page: data['page'] as int,
        totalPages: data['totalPages'] as int,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: MediaStatus.error,
        errorMessage: e.toString(),
      ));
    }
  }

  /// Load next page (pagination).
  Future<void> loadMore({
    required String vaultId,
    String? albumId,
    String? yearMonth,
  }) async {
    if (!state.hasMore || state.status == MediaStatus.loadingMore) return;

    emit(state.copyWith(status: MediaStatus.loadingMore));
    try {
      final nextPage = state.page + 1;
      final response = await _apiClient.dio.get(
        ApiEndpoints.media,
        queryParameters: {
          'vaultId': vaultId,
          'page': nextPage,
          'limit': 50,
          if (albumId != null) 'albumId': albumId,
          if (yearMonth != null) 'yearMonth': yearMonth,
        },
      );

      final data = response.data['data'] as Map<String, dynamic>;
      final newItems = (data['data'] as List<dynamic>)
          .map((m) => MediaItem.fromJson(m as Map<String, dynamic>))
          .toList();

      emit(state.copyWith(
        status: MediaStatus.loaded,
        items: [...state.items, ...newItems],
        page: nextPage,
        total: data['total'] as int,
        totalPages: data['totalPages'] as int,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: MediaStatus.error,
        errorMessage: e.toString(),
      ));
    }
  }

  /// Like or unlike a loaded item. Flips the heart immediately and flips it back if the request fails.
  Future<void> toggleLike({
    required String vaultId,
    required String mediaId,
  }) async {
    final index = state.items.indexWhere((m) => m.id == mediaId);
    if (index == -1) return;

    final original = state.items[index];
    final liked = !original.isLiked;
    _replaceItem(original.copyWith(isLiked: liked));

    try {
      if (liked) {
        await _apiClient.dio.put(
          ApiEndpoints.likedMedia(mediaId),
          data: {'vaultId': vaultId},
        );
      } else {
        await _apiClient.dio.delete(
          ApiEndpoints.likedMedia(mediaId),
          queryParameters: {'vaultId': vaultId},
        );
      }
    } catch (_) {
      _replaceItem(original);
    }
  }

  void _replaceItem(MediaItem item) {
    final index = state.items.indexWhere((m) => m.id == item.id);
    if (index == -1) return;
    final items = [...state.items];
    items[index] = item;
    emit(state.copyWith(items: items));
  }
}
