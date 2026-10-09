import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_endpoints.dart';
import '../crypto/vault_crypto_cubit.dart';
import 'vault_state.dart';

class VaultCubit extends Cubit<VaultState> {
  final ApiClient _apiClient;

  VaultCubit({required ApiClient apiClient})
      : _apiClient = apiClient,
        super(const VaultState());

  /// The signed-in account, with its private keys as only the master
  /// passphrase can open them.
  Future<AccountKeys> fetchAccount() async {
    final response = await _apiClient.dio.get(ApiEndpoints.me);
    return AccountKeys.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  /// The vaults this account can open: its own and those shared with it.
  /// Nobody else's are ever listed.
  Future<List<VaultInfo>> fetchVaults() async {
    emit(state.copyWith(status: VaultStatus.loading));
    try {
      final response = await _apiClient.dio.get(ApiEndpoints.vaults);
      final data = response.data['data'] as List<dynamic>;
      final vaults = data
          .map((v) => VaultInfo.fromJson(v as Map<String, dynamic>))
          .toList();
      emit(state.copyWith(status: VaultStatus.loaded, vaults: vaults));
      return vaults;
    } catch (e) {
      emit(state.copyWith(
        status: VaultStatus.error,
        errorMessage: e.toString(),
      ));
      rethrow;
    }
  }

  /// Albums shared with this account on their own.
  Future<List<SharedAlbumInfo>> fetchSharedAlbums() async {
    final response = await _apiClient.dio.get(ApiEndpoints.sharedAlbums);
    return (response.data['data'] as List<dynamic>)
        .map((a) => SharedAlbumInfo.fromJson(a as Map<String, dynamic>))
        .toList();
  }

  /// Forget everything loaded. Used when the account changes.
  void reset() => emit(const VaultState());
}
