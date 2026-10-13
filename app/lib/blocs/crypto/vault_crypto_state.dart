import 'dart:typed_data';
import 'package:equatable/equatable.dart';

/// What is unlocked. The keys themselves are never part of the state: they
/// stay inside VaultCryptoCubit.
class VaultCryptoState extends Equatable {
  /// The master passphrase has been entered: the account's private keys are in memory.
  final bool accountUnlocked;

  /// The vault that is open, or the vault of the one album that is open.
  final String? activeVaultId;
  final String? activeLabel;

  /// Set when only this album is shared with the user: there is no timeline
  /// and no album list, just the album.
  final String? albumOnlyId;
  final bool canWrite;

  /// Created the open vault: may share it and its albums.
  final bool isCreator;

  /// Key for the on-disk thumbnail cache of whatever is open.
  final Uint8List? cacheKey;

  const VaultCryptoState({
    this.accountUnlocked = false,
    this.activeVaultId,
    this.activeLabel,
    this.albumOnlyId,
    this.canWrite = false,
    this.isCreator = false,
    this.cacheKey,
  });

  /// Has the whole vault and may change it: create albums, move items
  /// between them. Someone with one album shared can only add to that album.
  bool get canOrganise => canWrite && albumOnlyId == null;

  /// A vault or shared album is open.
  bool get isUnlocked => activeVaultId != null;

  @override
  List<Object?> get props =>
      [accountUnlocked, activeVaultId, activeLabel, albumOnlyId, canWrite, isCreator];
}
