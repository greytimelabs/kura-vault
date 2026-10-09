import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../blocs/auth/auth_cubit.dart';
import '../blocs/auth/auth_state.dart';
import '../features/auth/presentation/screens/login_screen.dart';
import '../features/auth/presentation/screens/passphrase_screen.dart';
import '../features/gallery/presentation/screens/timeline_screen.dart';
import '../features/gallery/presentation/screens/album_grid_screen.dart';
import '../features/gallery/presentation/screens/album_media_screen.dart';
import '../features/viewer/presentation/screens/photo_viewer_screen.dart';
import '../features/settings/presentation/screens/settings_screen.dart';

GoRouter createRouter(AuthCubit authCubit) {
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final authState = authCubit.state;
      final isLoggedIn = authState.status == AuthStatus.authenticated;
      final isOnAuth = state.matchedLocation == '/login';

      if (!isLoggedIn && !isOnAuth) {
        return '/login';
      }
      if (isLoggedIn && isOnAuth) {
        return '/passphrase';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        redirect: (_, __) => '/passphrase',
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/passphrase',
        builder: (context, state) => const PassphraseScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) {
          return _GalleryShell(child: child);
        },
        routes: [
          GoRoute(
            path: '/gallery',
            builder: (context, state) => const TimelineScreen(),
          ),
          GoRoute(
            path: '/gallery/albums',
            builder: (context, state) => const AlbumGridScreen(),
          ),
        ],
      ),
      // Outside the shell so the screen gets its own app bar with a back button
      GoRoute(
        path: '/gallery/albums/:albumId',
        builder: (context, state) => AlbumMediaScreen(
          albumId: state.pathParameters['albumId']!,
          isLikedAlbum: state.extra as bool? ?? false,
        ),
      ),
      GoRoute(
        path: '/viewer/:mediaId',
        builder: (context, state) {
          final mediaId = state.pathParameters['mediaId']!;
          return PhotoViewerScreen(mediaId: mediaId);
        },
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
    ],
  );
}

class _GalleryShell extends StatefulWidget {
  final Widget child;
  const _GalleryShell({required this.child});

  @override
  State<_GalleryShell> createState() => _GalleryShellState();
}

class _GalleryShellState extends State<_GalleryShell> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kura Vault'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: widget.child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() => _currentIndex = index);
          switch (index) {
            case 0:
              context.go('/gallery');
            case 1:
              context.go('/gallery/albums');
          }
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.photo_library_outlined),
            selectedIcon: Icon(Icons.photo_library),
            label: 'Timeline',
          ),
          NavigationDestination(
            icon: Icon(Icons.photo_album_outlined),
            selectedIcon: Icon(Icons.photo_album),
            label: 'Albums',
          ),
        ],
      ),
    );
  }
}
