import 'package:equatable/equatable.dart';
import '../crypto/vault_crypto_cubit.dart';

enum VaultStatus { initial, loading, loaded, error }

class VaultState extends Equatable {
  final VaultStatus status;
  final List<VaultInfo> vaults;
  final String? errorMessage;

  const VaultState({
    this.status = VaultStatus.initial,
    this.vaults = const [],
    this.errorMessage,
  });

  VaultState copyWith({
    VaultStatus? status,
    List<VaultInfo>? vaults,
    String? errorMessage,
  }) {
    return VaultState(
      status: status ?? this.status,
      vaults: vaults ?? this.vaults,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => [status, vaults, errorMessage];
}
