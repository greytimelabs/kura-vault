import 'dart:typed_data';
import 'package:equatable/equatable.dart';

class VaultCryptoState extends Equatable {
  final String? activeVaultId;
  final Uint8List? kek;
  final Uint8List? cacheKey;
  final bool isUnlocked;

  const VaultCryptoState({
    this.activeVaultId,
    this.kek,
    this.cacheKey,
    this.isUnlocked = false,
  });

  VaultCryptoState copyWith({
    String? activeVaultId,
    Uint8List? kek,
    Uint8List? cacheKey,
    bool? isUnlocked,
  }) {
    return VaultCryptoState(
      activeVaultId: activeVaultId ?? this.activeVaultId,
      kek: kek ?? this.kek,
      cacheKey: cacheKey ?? this.cacheKey,
      isUnlocked: isUnlocked ?? this.isUnlocked,
    );
  }

  @override
  List<Object?> get props => [activeVaultId, isUnlocked];
}
