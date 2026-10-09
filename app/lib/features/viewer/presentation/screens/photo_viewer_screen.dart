import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';
import 'package:photo_view/photo_view.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';

class PhotoViewerScreen extends StatefulWidget {
  final String mediaId;

  const PhotoViewerScreen({super.key, required this.mediaId});

  @override
  State<PhotoViewerScreen> createState() => _PhotoViewerScreenState();
}

class _PhotoViewerScreenState extends State<PhotoViewerScreen> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  Future<void> _loadPreview() async {
    try {
      final cryptoCubit = context.read<VaultCryptoCubit>();
      final vaultId = cryptoCubit.state.activeVaultId!;
      final apiClient = context.read<ApiClient>();

      // Get preview URL from API
      final response = await apiClient.dio.get(
        ApiEndpoints.mediaUrls(widget.mediaId),
        queryParameters: {'vaultId': vaultId},
      );

      final data = response.data['data'] as Map<String, dynamic>;
      final previewUrl = data['previewUrl'] as String;
      final previewIv = data['previewIv'] as String;

      // Fetch encrypted preview from S3
      final blobResponse = await Dio().get<List<int>>(
        previewUrl,
        options: Options(responseType: ResponseType.bytes),
      );
      final encryptedBytes = Uint8List.fromList(blobResponse.data!);

      // We need the encrypted DEK — fetch from media query
      // For simplicity, we pass the DEK info via route extras in a real app.
      // Here we'll use the media endpoint to get it.
      final mediaResponse = await apiClient.dio.get(
        ApiEndpoints.media,
        queryParameters: {'vaultId': vaultId, 'limit': 1},
      );

      // Decrypt using the preview IV
      // Note: In production, pass encryptedDek/dekNonce through navigation
      // This is a simplified version
      if (mounted) {
        setState(() {
          _loading = false;
          _error = true; // Placeholder — real impl passes DEK via route
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = true;
          _loading = false;
        });
      }
    }
  }

  void _toggleLike() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId == null) return;
    context.read<MediaCubit>().toggleLike(vaultId: vaultId, mediaId: widget.mediaId);
  }

  @override
  Widget build(BuildContext context) {
    // Null when this media isn't in the loaded list, so there is no state to show
    final isLiked = context.select<MediaCubit, bool?>((cubit) {
      for (final item in cubit.state.items) {
        if (item.id == widget.mediaId) return item.isLiked;
      }
      return null;
    });

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (isLiked != null)
            IconButton(
              tooltip: isLiked ? 'Unlike' : 'Like',
              icon: Icon(
                isLiked ? Icons.favorite : Icons.favorite_border,
                color: isLiked ? Colors.redAccent : Colors.white,
              ),
              onPressed: _toggleLike,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : _imageBytes != null
              ? PhotoView(
                  imageProvider: MemoryImage(_imageBytes!),
                  minScale: PhotoViewComputedScale.contained,
                  maxScale: PhotoViewComputedScale.covered * 3,
                )
              : const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.broken_image, size: 64, color: Colors.white54),
                      SizedBox(height: 16),
                      Text('Could not load image',
                          style: TextStyle(color: Colors.white54)),
                    ],
                  ),
                ),
    );
  }
}
