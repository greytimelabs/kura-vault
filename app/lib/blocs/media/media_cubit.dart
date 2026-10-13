import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import 'media_state.dart';

class MediaCubit extends Cubit<MediaState> {
  final ApiClient _apiClient;

  MediaCubit({required ApiClient apiClient})
      : _apiClient = apiClient,
        super(const MediaState());

  static const int _pageSize = 50;

  /// The most items one delete request may name.
  static const int deleteBatch = 100;

  /// What the loaded list is of, so more of it can be fetched from anywhere.
  ({String vaultId, String? albumId, String? yearMonth})? _query;

  /// Pages whose links are being renewed, so a screenful of expired
  /// thumbnails asks once.
  final Map<int, Future<void>> _renewing = {};

  /// Load first page of media for a vault.
  Future<void> loadMedia({
    required String vaultId,
    String? albumId,
    String? yearMonth,
  }) async {
    _query = (vaultId: vaultId, albumId: albumId, yearMonth: yearMonth);
    _renewing.clear();
    emit(state.copyWith(status: MediaStatus.loading));
    try {
      final response = await _apiClient.dio.get(
        ApiEndpoints.media,
        queryParameters: {
          'vaultId': vaultId,
          'page': 1,
          'limit': _pageSize,
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
          'limit': _pageSize,
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

  /// Fetch the loaded list again from its first page, keeping what is on
  /// screen until it arrives. Used after uploads.
  Future<void> reload() async {
    final query = _query;
    if (query == null) return;
    try {
      final response = await _apiClient.dio.get(
        ApiEndpoints.media,
        queryParameters: {
          'vaultId': query.vaultId,
          'page': 1,
          'limit': _pageSize,
          'albumId': ?query.albumId,
          'yearMonth': ?query.yearMonth,
        },
      );
      if (_query != query) return;
      final data = response.data['data'] as Map<String, dynamic>;
      _renewing.clear();
      emit(state.copyWith(
        status: MediaStatus.loaded,
        items: [
          for (final m in data['data'] as List<dynamic>)
            MediaItem.fromJson(m as Map<String, dynamic>),
        ],
        total: data['total'] as int,
        page: data['page'] as int,
        totalPages: data['totalPages'] as int,
      ));
    } catch (_) {
      // What is on screen stays
    }
  }

  /// The next page of whatever list is loaded.
  Future<void> loadNext() async {
    final query = _query;
    if (query == null) return;
    await loadMore(
        vaultId: query.vaultId, albumId: query.albumId, yearMonth: query.yearMonth);
  }

  /// Thumbnail links live for a minute. Fetch the item's page again and take
  /// the fresh links; returns the item's new thumbnail link, or null when it
  /// is no longer in the list.
  Future<String?> renewThumb(String mediaId) async {
    final query = _query;
    final index = state.items.indexWhere((m) => m.id == mediaId);
    if (query == null || index == -1) return null;
    final page = index ~/ _pageSize + 1;

    await (_renewing[page] ??= () async {
      try {
        final response = await _apiClient.dio.get(
          ApiEndpoints.media,
          queryParameters: {
            'vaultId': query.vaultId,
            'page': page,
            'limit': _pageSize,
            'albumId': ?query.albumId,
            'yearMonth': ?query.yearMonth,
          },
        );
        final data = response.data['data'] as Map<String, dynamic>;
        final fresh = {
          for (final m in data['data'] as List<dynamic>)
            (m as Map<String, dynamic>)['id'] as String: MediaItem.fromJson(m),
        };
        // Another list was loaded meanwhile: these links are not for it
        if (_query != query) return;
        emit(state.copyWith(items: [
          for (final item in state.items)
            // Keep the heart as it is on screen; only the links are new
            fresh[item.id]?.copyWith(isLiked: item.isLiked) ?? item,
        ]));
      } catch (_) {
        // The tile shows its broken state
      } finally {
        // Asked again only once these links have had time to expire too
        Future<void>.delayed(const Duration(seconds: 30), () => _renewing.remove(page));
      }
    }());

    return state.items.where((m) => m.id == mediaId).firstOrNull?.thumbUrl;
  }

  /// Links to an item's preview and original. They live for 60 seconds, so
  /// they are requested right before use.
  Future<({String previewUrl, String originalUrl, String previewIv, String originalIv})>
      urls(String mediaId) async {
    final response = await _apiClient.dio.get(ApiEndpoints.mediaUrls(mediaId));
    final data = response.data['data'] as Map<String, dynamic>;
    return (
      previewUrl: data['previewUrl'] as String,
      originalUrl: data['originalUrl'] as String,
      previewIv: data['previewIv'] as String,
      originalIv: data['originalIv'] as String,
    );
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

  /// Erase items for good, on the server and in the loaded list. Throws when
  /// the server refuses; whatever was deleted before that is gone from the
  /// list anyway.
  Future<void> deleteItems(List<String> ids) async {
    final deleted = <String>{};
    try {
      for (var start = 0; start < ids.length; start += deleteBatch) {
        final batch = ids.skip(start).take(deleteBatch).toList();
        await _apiClient.dio.post(ApiEndpoints.mediaDelete, data: {'ids': batch});
        deleted.addAll(batch);
      }
    } finally {
      if (deleted.isNotEmpty) {
        final items = [
          for (final item in state.items)
            if (!deleted.contains(item.id)) item,
        ];
        emit(state.copyWith(
          items: items,
          total: state.total - (state.items.length - items.length),
        ));
        await _refill();
      }
    }
  }

  /// After items were taken out, the loaded list is shorter than the pages it
  /// was built from, and the next page would skip what moved up into the gap.
  /// Fetch the pages that are now incomplete again and append what is missing.
  Future<void> _refill() async {
    final query = _query;
    if (query == null) return;
    try {
      for (var page = state.items.length ~/ _pageSize + 1; page <= state.page; page++) {
        final response = await _apiClient.dio.get(
          ApiEndpoints.media,
          queryParameters: {
            'vaultId': query.vaultId,
            'page': page,
            'limit': _pageSize,
            'albumId': ?query.albumId,
            'yearMonth': ?query.yearMonth,
          },
        );
        if (_query != query) return;
        final data = response.data['data'] as Map<String, dynamic>;
        final have = {for (final item in state.items) item.id};
        final totalPages = data['totalPages'] as int;
        emit(state.copyWith(
          items: [
            ...state.items,
            for (final m in data['data'] as List<dynamic>)
              if (!have.contains((m as Map<String, dynamic>)['id']))
                MediaItem.fromJson(m),
          ],
          total: data['total'] as int,
          totalPages: totalPages,
          // Fewer pages exist now than were loaded
          page: state.page > totalPages && totalPages > 0 ? totalPages : state.page,
        ));
        if (page >= totalPages) break;
      }
      _renewing.clear();
    } catch (_) {
      // The list is right as far as it goes; a reload brings the rest
    }
  }

  void _replaceItem(MediaItem item) {
    final index = state.items.indexWhere((m) => m.id == item.id);
    if (index == -1) return;
    final items = [...state.items];
    items[index] = item;
    emit(state.copyWith(items: items));
  }

  /// Forget everything loaded. Used when the account changes.
  void reset() {
    _query = null;
    _renewing.clear();
    emit(const MediaState());
  }
}
