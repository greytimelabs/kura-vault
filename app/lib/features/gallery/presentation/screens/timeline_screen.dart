import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../widgets/media_grid.dart';
import '../widgets/month_header.dart';

class TimelineScreen extends StatefulWidget {
  const TimelineScreen({super.key});

  @override
  State<TimelineScreen> createState() => _TimelineScreenState();
}

class _TimelineScreenState extends State<TimelineScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadInitial();
    _scrollController.addListener(_onScroll);
  }

  void _loadInitial() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<MediaCubit>().loadMedia(vaultId: vaultId);
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent * 0.7) {
      final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
      if (vaultId != null) {
        context.read<MediaCubit>().loadMore(vaultId: vaultId);
      }
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MediaCubit, MediaState>(
      builder: (context, state) {
        if (state.status == MediaStatus.loading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (state.status == MediaStatus.error) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(state.errorMessage ?? 'Error loading media'),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loadInitial,
                  child: const Text('Retry'),
                ),
              ],
            ),
          );
        }

        if (state.items.isEmpty) {
          return const Center(
            child: Text('No photos yet', style: TextStyle(fontSize: 18)),
          );
        }

        // Group items by yearMonth
        final grouped = <String, List<MediaItem>>{};
        for (final item in state.items) {
          final key = item.yearMonth ?? 'Unknown';
          grouped.putIfAbsent(key, () => []).add(item);
        }

        final months = grouped.keys.toList();

        return CustomScrollView(
          controller: _scrollController,
          slivers: [
            for (final month in months) ...[
              SliverToBoxAdapter(child: MonthHeader(yearMonth: month)),
              MediaGrid(items: grouped[month]!),
            ],
            if (state.status == MediaStatus.loadingMore)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ),
          ],
        );
      },
    );
  }
}
