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

  /// Fetch all vaults from API. Returns the list for passphrase unlock flow.
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
}
