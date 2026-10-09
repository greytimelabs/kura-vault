import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'blocs/auth/auth_cubit.dart';
import 'blocs/vault/vault_cubit.dart';
import 'blocs/media/media_cubit.dart';
import 'blocs/album/album_cubit.dart';
import 'blocs/crypto/vault_crypto_cubit.dart';
import 'blocs/auth/auth_state.dart';
import 'blocs/crypto/vault_crypto_state.dart';
import 'core/accounts/account_store.dart';
import 'core/network/api_client.dart';
import 'core/storage/secure_storage_service.dart';
import 'core/storage/cache_service.dart';
import 'routing/app_router.dart';

class KuraVaultApp extends StatefulWidget {
  const KuraVaultApp({super.key});

  @override
  State<KuraVaultApp> createState() => _KuraVaultAppState();
}

class _KuraVaultAppState extends State<KuraVaultApp> with WidgetsBindingObserver {
  /// Without input for this long, every key is wiped from memory.
  static const Duration autoLockAfter = Duration(minutes: 15);

  late final SecureStorageService _secureStorage;
  late final ApiClient _apiClient;
  late final AccountStore _accounts;
  late final CacheService _cacheService;
  late final AuthCubit _authCubit;
  late final VaultCryptoCubit _cryptoCubit;
  late final GoRouter _router;
  late final Timer _autoLockTimer;
  DateTime _lastActivity = DateTime.now();

  @override
  void initState() {
    super.initState();
    _secureStorage = SecureStorageService();
    _accounts = AccountStore(_secureStorage);
    _apiClient = ApiClient(accounts: _accounts);
    _cacheService = CacheService();
    _authCubit = AuthCubit(
      apiClient: _apiClient,
      accounts: _accounts,
    )..init();
    _cryptoCubit = VaultCryptoCubit();
    _router = createRouter(_authCubit, _cryptoCubit);

    WidgetsBinding.instance.addObserver(this);
    _autoLockTimer = Timer.periodic(const Duration(seconds: 15), (_) => _lockIfIdle());
  }

  /// Elapsed time is compared against a timestamp rather than one long timer,
  /// so an app that slept through the deadline locks the moment it wakes.
  void _lockIfIdle() {
    if (_cryptoCubit.state.accountUnlocked &&
        DateTime.now().difference(_lastActivity) >= autoLockAfter) {
      _cryptoCubit.lock();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Closing the app leaves nothing behind; coming back checks the clock
    if (state == AppLifecycleState.detached) {
      _cryptoCubit.lock();
    } else if (state == AppLifecycleState.resumed) {
      _lockIfIdle();
    }
  }

  /// What was open changed: the thumbnail cache follows the open vault's key,
  /// and nothing decrypted for the previous one may stay around.
  void _onSpaceChanged(BuildContext context, VaultCryptoState state) {
    _cacheService.dispose();
    context.read<MediaCubit>().reset();
    context.read<AlbumCubit>().reset();
    final cacheKey = state.cacheKey;
    if (state.isUnlocked && cacheKey != null) {
      unawaited(_cacheService.init(cacheKey));
    }
  }

  /// The active account changed or lost its login: nothing unlocked or loaded
  /// for the previous one may stay around.
  void _onAccountChanged(BuildContext context, AuthState state) {
    _cryptoCubit.lock();
    _cacheService.dispose();
    context.read<VaultCubit>().reset();
    context.read<MediaCubit>().reset();
    context.read<AlbumCubit>().reset();
    // Where to go next is the router's redirect: sign-in when signed out, the
    // master passphrase when signed in
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _autoLockTimer.cancel();
    _router.dispose();
    _cryptoCubit.lock();
    _cryptoCubit.close();
    _authCubit.close();
    _cacheService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider.value(value: _apiClient),
        RepositoryProvider.value(value: _secureStorage),
        RepositoryProvider.value(value: _cacheService),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider.value(value: _authCubit),
          BlocProvider.value(value: _cryptoCubit),
          BlocProvider(
            create: (_) => VaultCubit(apiClient: _apiClient),
          ),
          BlocProvider(
            create: (_) => MediaCubit(apiClient: _apiClient),
          ),
          BlocProvider(
            create: (_) => AlbumCubit(apiClient: _apiClient),
          ),
        ],
        child: BlocListener<AuthCubit, AuthState>(
          listenWhen: (prev, curr) =>
              prev.activeId != curr.activeId ||
              prev.isAuthenticated != curr.isAuthenticated,
          listener: _onAccountChanged,
          child: BlocListener<VaultCryptoCubit, VaultCryptoState>(
          listenWhen: (prev, curr) =>
              prev.activeVaultId != curr.activeVaultId ||
              prev.albumOnlyId != curr.albumOnlyId,
          listener: _onSpaceChanged,
          // Any touch counts as activity for the auto-lock
          child: Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => _lastActivity = DateTime.now(),
          child: MaterialApp.router(
          title: 'Kura Vault',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorSchemeSeed: Colors.blueGrey,
            useMaterial3: true,
            brightness: Brightness.light,
          ),
          darkTheme: ThemeData(
            colorSchemeSeed: Colors.blueGrey,
            useMaterial3: true,
            brightness: Brightness.dark,
          ),
          themeMode: ThemeMode.system,
          routerConfig: _router,
          ),
          ),
          ),
        ),
      ),
    );
  }
}
