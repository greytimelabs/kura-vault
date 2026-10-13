import 'package:equatable/equatable.dart';

enum AlbumStatus { initial, loading, loaded, error }

class AlbumItem {
  final String id;
  final String kind; // 'regular', or 'liked' (this account's likes)
  final String? nameEncrypted; // under the album key; null for the Liked album
  final String? nameNonce;
  final String? keyWrapped; // the album key under the vault key; null for Liked
  final String? keyNonce;
  final String? coverMediaId;
  final int sortOrder;
  final int mediaCount;

  AlbumItem({
    required this.id,
    this.kind = 'regular',
    this.nameEncrypted,
    this.nameNonce,
    this.keyWrapped,
    this.keyNonce,
    this.coverMediaId,
    this.sortOrder = 0,
    this.mediaCount = 0,
  });

  bool get isLiked => kind == 'liked';

  factory AlbumItem.fromJson(Map<String, dynamic> json) => AlbumItem(
        id: json['id'] as String,
        kind: json['kind'] as String? ?? 'regular',
        nameEncrypted: json['nameEncrypted'] as String?,
        nameNonce: json['nameNonce'] as String?,
        keyWrapped: json['keyWrapped'] as String?,
        keyNonce: json['keyNonce'] as String?,
        coverMediaId: json['coverMediaId'] as String?,
        sortOrder: json['sortOrder'] as int? ?? 0,
        mediaCount: json['mediaCount'] as int? ?? 0,
      );
}

class AlbumState extends Equatable {
  final AlbumStatus status;
  final List<AlbumItem> albums;
  final String? errorMessage;

  const AlbumState({
    this.status = AlbumStatus.initial,
    this.albums = const [],
    this.errorMessage,
  });

  AlbumState copyWith({
    AlbumStatus? status,
    List<AlbumItem>? albums,
    String? errorMessage,
  }) {
    return AlbumState(
      status: status ?? this.status,
      albums: albums ?? this.albums,
      errorMessage: errorMessage,
    );
  }

  // `albums` (not its length) so a rename or a changed count emits a new state.
  @override
  List<Object?> get props => [status, albums, errorMessage];
}
