import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../blocs/auth/auth_cubit.dart';
import '../blocs/auth/auth_state.dart';
import '../blocs/crypto/vault_crypto_cubit.dart';
import '../blocs/crypto/vault_crypto_state.dart';
import '../features/auth/presentation/screens/join_screen.dart';
import '../features/auth/presentation/screens/login_screen.dart';
import '../features/auth/presentation/screens/passphrase_screen.dart';
import '../features/auth/presentation/screens/server_screen.dart';
import '../features/auth/presentation/screens/setup_screen.dart';
import '../features/auth/presentation/screens/unlock_screen.dart';
import '../features/auth/presentation/widgets/account_switcher_sheet.dart';
import '../features/gallery/presentation/screens/timeline_screen.dart';
import '../features/gallery/presentation/screens/album_grid_screen.dart';
import '../features/gallery/presentation/screens/album_media_screen.dart';
import '../features/viewer/presentation/screens/photo_viewer_screen.dart';
import '../features/settings/presentation/screens/settings_screen.dart';

/// Re-runs the router's redirect when who is signed in changes, or what is
/// unlocked, and not on every state change (a login in progress must not move
/// the user).
class _SessionRefresh extends ChangeNotifier {
  late final StreamSubscription<AuthState> _auth;
  late final StreamSubscription<VaultCryptoState> _crypto;

  _SessionRefresh(AuthCubit auth, VaultCryptoCubit crypto) {
    var lastAuth = _authKey(auth.state);
    _auth = auth.stream.listen((state) {
      final next = _authKey(state);
      if (next != lastAuth) {
        lastAuth = next;
        notifyListeners();
      }
    });
    var lastCrypto = _cryptoKey(crypto.state);
    _crypto = crypto.stream.listen((state) {
      final next = _cryptoKey(state);
      if (next != lastCrypto) {
        lastCrypto = next;
        notifyListeners();
      }
    });
  }

  static String _authKey(AuthState s) =>
      '${s.initialized}|${s.activeId}|${s.isAuthenticated}|${s.accounts.isEmpty}';

  static String _cryptoKey(VaultCryptoState s) =>
      '${s.accountUnlocked}|${s.activeVaultId}|${s.albumOnlyId}';

  @override
  void dispose() {
    _auth.cancel();
    _crypto.cancel();
    super.dispose();
  }
}

GoRouter createRouter(AuthCubit authCubit, VaultCryptoCubit cryptoCubit) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _SessionRefresh(authCubit, cryptoCubit),
    redirect: (context, state) {
      final auth = authCubit.state;
      final crypto = cryptoCubit.state;
      final location = state.matchedLocation;
      final query = state.uri.queryParameters;

      // Saved accounts are still being read
      if (!auth.initialized) {
        return location == '/' ? null : '/';
      }

      // Joining and first-run setup create an account, so they are reachable
      // signed out, and stay put while the new account signs in and unlocks
      final isOnboarding = location == '/join' || location == '/setup';
      final isOnAuth = location == '/server' || location == '/login' || isOnboarding;
      if ((location == '/login' || location == '/setup') && query['server'] == null) {
        return '/server';
      }

      if (!auth.isAuthenticated) {
        if (isOnAuth) return null;
        final active = auth.active;
        return active == null
            ? '/server'
            : AccountSwitcherSheet.loginLocation(active);
      }

      // Signed in, keys not loaded: the master passphrase comes first
      if (!crypto.accountUnlocked) {
        if (isOnboarding || (isOnAuth && query['add'] == '1')) return null;
        return location == '/unlock' ? null : '/unlock';
      }

      // Unlocked, nothing open: choose what to open
      if (!crypto.isUnlocked) {
        if (isOnAuth && query['add'] == '1') return null;
        return location == '/passphrase' ? null : '/passphrase';
      }

      // Something is open. With only one album shared there is no timeline
      // and no album list: just that album.
      final albumOnly = crypto.albumOnlyId;
      final home = albumOnly == null ? '/gallery' : '/gallery/albums/$albumOnly';
      if (location == '/' || location == '/unlock' || location == '/passphrase' ||
          (isOnAuth && query['add'] != '1')) {
        return home;
      }
      if (albumOnly != null && (location == '/gallery' || location == '/gallery/albums')) {
        return home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
      GoRoute(
        path: '/server',
        builder: (context, state) => ServerScreen(
          adding: state.uri.queryParameters['add'] == '1',
          initialUrl: state.uri.queryParameters['url'],
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => LoginScreen(
          serverUrl: state.uri.queryParameters['server']!,
          username: state.uri.queryParameters['username'],
          adding: state.uri.queryParameters['add'] == '1',
        ),
      ),
      GoRoute(
        path: '/setup',
        builder: (context, state) => SetupScreen(
          serverUrl: state.uri.queryParameters['server']!,
        ),
      ),
      GoRoute(
        path: '/join',
        builder: (context, state) => JoinScreen(
          // A link the app was opened with arrives here whole, fragment included
          initialLink: state.uri.hasFragment ? '#${state.uri.fragment}' : null,
        ),
      ),
      GoRoute(
        path: '/unlock',
        builder: (context, state) => const UnlockScreen(),
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
          const _AccountButton(),
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

/// The active account's initial; opens the account switcher.
class _AccountButton extends StatelessWidget {
  const _AccountButton();

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);
    if (account == null) return const SizedBox.shrink();

    return IconButton(
      tooltip: '${account.username} · ${account.host}',
      onPressed: () => AccountSwitcherSheet.show(context),
      icon: CircleAvatar(
        radius: 14,
        child: Text(
          account.username.characters.first.toUpperCase(),
          style: const TextStyle(fontSize: 13),
        ),
      ),
    );
  }
}
