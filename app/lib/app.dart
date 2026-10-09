import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'blocs/auth/auth_cubit.dart';
import 'blocs/vault/vault_cubit.dart';
import 'blocs/media/media_cubit.dart';
import 'blocs/album/album_cubit.dart';
import 'blocs/crypto/vault_crypto_cubit.dart';
import 'core/auth/auth_manager.dart';
import 'core/network/api_client.dart';
import 'core/storage/secure_storage_service.dart';
import 'core/storage/cache_service.dart';
import 'routing/app_router.dart';

class KuraVaultApp extends StatefulWidget {
  const KuraVaultApp({super.key});

  @override
  State<KuraVaultApp> createState() => _KuraVaultAppState();
}

class _KuraVaultAppState extends State<KuraVaultApp> {
  late final SecureStorageService _secureStorage;
  late final ApiClient _apiClient;
  late final AuthManager _authManager;
  late final CacheService _cacheService;
  late final AuthCubit _authCubit;

  @override
  void initState() {
    super.initState();
    _secureStorage = SecureStorageService();
    _apiClient = ApiClient(secureStorage: _secureStorage);
    _authManager = AuthManager(_secureStorage);
    _cacheService = CacheService();
    _authCubit = AuthCubit(
      apiClient: _apiClient,
      authManager: _authManager,
      secureStorage: _secureStorage,
    )..checkAuth();
  }

  @override
  void dispose() {
    _authCubit.close();
    _cacheService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = createRouter(_authCubit);

    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider.value(value: _apiClient),
        RepositoryProvider.value(value: _secureStorage),
        RepositoryProvider.value(value: _cacheService),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider.value(value: _authCubit),
          BlocProvider(create: (_) => VaultCryptoCubit()),
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
          routerConfig: router,
        ),
      ),
    );
  }
}
