import 'package:equatable/equatable.dart';

enum MediaStatus { initial, loading, loaded, loadingMore, error }

class MediaItem {
  final String id;
  final String mediaType;
  final String? capturedAt;
  final String? yearMonth;
  final int? width;
  final int? height;
  final double? aspectRatio;
  final int? durationSeconds;
  final String thumbIv;
  final String encryptedDek;
  final String dekNonce;
  final String? encryptedMeta;
  final String? metaNonce;
  final String thumbUrl;
  final bool isLiked; // in this device's Liked album for the current vault

  MediaItem({
    required this.id,
    required this.mediaType,
    this.capturedAt,
    this.yearMonth,
    this.width,
    this.height,
    this.aspectRatio,
    this.durationSeconds,
    required this.thumbIv,
    required this.encryptedDek,
    required this.dekNonce,
    this.encryptedMeta,
    this.metaNonce,
    required this.thumbUrl,
    this.isLiked = false,
  });

  factory MediaItem.fromJson(Map<String, dynamic> json) => MediaItem(
        id: json['id'] as String,
        mediaType: json['mediaType'] as String,
        capturedAt: json['capturedAt'] as String?,
        yearMonth: json['yearMonth'] as String?,
        width: json['width'] as int?,
        height: json['height'] as int?,
        aspectRatio: (json['aspectRatio'] as num?)?.toDouble(),
        durationSeconds: json['durationSeconds'] as int?,
        thumbIv: json['thumbIv'] as String,
        encryptedDek: json['encryptedDek'] as String,
        dekNonce: json['dekNonce'] as String,
        encryptedMeta: json['encryptedMeta'] as String?,
        metaNonce: json['metaNonce'] as String?,
        thumbUrl: json['thumbUrl'] as String,
        isLiked: json['isLiked'] as bool? ?? false,
      );

  MediaItem copyWith({bool? isLiked}) => MediaItem(
        id: id,
        mediaType: mediaType,
        capturedAt: capturedAt,
        yearMonth: yearMonth,
        width: width,
        height: height,
        aspectRatio: aspectRatio,
        durationSeconds: durationSeconds,
        thumbIv: thumbIv,
        encryptedDek: encryptedDek,
        dekNonce: dekNonce,
        encryptedMeta: encryptedMeta,
        metaNonce: metaNonce,
        thumbUrl: thumbUrl,
        isLiked: isLiked ?? this.isLiked,
      );
}

class MediaState extends Equatable {
  final MediaStatus status;
  final List<MediaItem> items;
  final int total;
  final int page;
  final int totalPages;
  final String? errorMessage;

  const MediaState({
    this.status = MediaStatus.initial,
    this.items = const [],
    this.total = 0,
    this.page = 1,
    this.totalPages = 1,
    this.errorMessage,
  });

  bool get hasMore => page < totalPages;

  MediaState copyWith({
    MediaStatus? status,
    List<MediaItem>? items,
    int? total,
    int? page,
    int? totalPages,
    String? errorMessage,
  }) {
    return MediaState(
      status: status ?? this.status,
      items: items ?? this.items,
      total: total ?? this.total,
      page: page ?? this.page,
      totalPages: totalPages ?? this.totalPages,
      errorMessage: errorMessage,
    );
  }

  // `items` (not its length) so replacing one item, e.g. a like toggle, emits a new state.
  @override
  List<Object?> get props =>
      [status, items, total, page, totalPages, errorMessage];
}
