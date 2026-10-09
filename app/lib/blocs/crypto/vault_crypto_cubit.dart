import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/crypto/crypto_service.dart';
import '../../core/crypto/key_derivation.dart';
import '../../core/crypto/cache_crypto.dart';
import 'vault_crypto_state.dart';

/// A vault whose verification token decrypted under the entered passphrase.
///
/// Holds a live KEK. Every MatchedVault returned by [VaultCryptoCubit.findMatches]
/// must eventually be either committed via [VaultCryptoCubit.selectVault] or
/// zeroed via [VaultCryptoCubit.discardMatches] — never simply dropped.
class MatchedVault {
  final String vaultId;
  final Uint8List kek;

  /// Decrypted vault label, or a neutral positional fallback ("Vault 1")
  /// when the vault has no label. Never the vault UUID: that is a stable
  /// identifier an observer could correlate against the database or GET /vaults.
  final String label;

  MatchedVault({
    required this.vaultId,
    required this.kek,
    required this.label,
  });
}

/// Manages vault encryption state.
/// KEK and cache key live here in memory only.
class VaultCryptoCubit extends Cubit<VaultCryptoState> {
  VaultCryptoCubit() : super(const VaultCryptoState());

  /// Max Argon2id derivations in flight at once. Each allocates 64MB
  /// (memoryKB = 65536), so an unbounded fan-out over N vaults would peak
  /// at N * 64MB.
  static const int _maxConcurrentDerivations = 4;

  /// Derive a candidate KEK for EVERY vault and return all that verify.
  ///
  /// Because each vault has a distinct random salt, the same passphrase derives
  /// a different KEK per vault — so one passphrase can legitimately match more
  /// than one vault. That is not a cryptographic collision; each match is
  /// verified independently against its own vault UUID.
  ///
  /// There is deliberately NO early exit. Beyond being required to find every
  /// match, a full scan means unlock latency does not reveal which vault matched.
  ///
  /// Returns matches in [vaults] order (stable, mirrors the API's sortOrder).
  /// An empty list means the passphrase was wrong.
  Future<List<MatchedVault>> findMatches({
    required String passphrase,
    required List<VaultInfo> vaults,
  }) async {
    final matches = <MatchedVault>[];

    for (var i = 0; i < vaults.length; i += _maxConcurrentDerivations) {
      final batch = vaults.skip(i).take(_maxConcurrentDerivations).toList();

      final keks = await Future.wait(
        batch.map(
          (v) => KeyDerivation.deriveKek(
            passphrase: passphrase,
            salt: _base64ToBytes(v.kekSalt),
          ),
        ),
      );

      for (var j = 0; j < batch.length; j++) {
        final vault = batch[j];
        final kek = keks[j];

        final isMatch = CryptoService.verifyKek(
          kek: kek,
          kekVerify: _base64ToBytes(vault.kekVerify),
          kekVerifyNonce: _base64ToBytes(vault.kekVerifyNonce),
          expectedVaultId: vault.id,
        );

        if (isMatch) {
          matches.add(MatchedVault(
            vaultId: vault.id,
            kek: kek,
            label: decryptLabel(vault, kek) ?? 'Vault ${matches.length + 1}',
          ));
        } else {
          // Zero non-matching candidate KEKs immediately rather than
          // leaving them for the GC.
          _zero(kek);
        }
      }
    }

    return matches;
  }

  /// Decrypt a vault's label with its KEK. Returns null when the vault has no
  /// label or the ciphertext fails to decrypt.
  String? decryptLabel(VaultInfo vault, Uint8List kek) {
    final labelEncrypted = vault.labelEncrypted;
    final labelNonce = vault.labelNonce;
    if (labelEncrypted == null || labelNonce == null) return null;

    try {
      final plaintext = CryptoService.decrypt(
        ciphertext: _base64ToBytes(labelEncrypted),
        key: kek,
        iv: _base64ToBytes(labelNonce),
      );
      final label = utf8.decode(plaintext).trim();
      return label.isEmpty ? null : label;
    } catch (_) {
      return null;
    }
  }

  /// Commit [chosen] as the active vault and zero the KEKs of every other match.
  void selectVault(MatchedVault chosen, List<MatchedVault> allMatches) {
    for (final m in allMatches) {
      if (!identical(m, chosen)) _zero(m.kek);
    }

    emit(VaultCryptoState(
      activeVaultId: chosen.vaultId,
      kek: chosen.kek,
      cacheKey: CacheCrypto.deriveCacheKey(chosen.kek),
      isUnlocked: true,
    ));
  }

  /// Zero every match without unlocking. Call this whenever the picker is
  /// dismissed, so live KEKs are never stranded in memory.
  void discardMatches(List<MatchedVault> matches) {
    for (final m in matches) {
      _zero(m.kek);
    }
  }

  /// Lock the vault - wipe all secrets from memory.
  void lock() {
    if (state.kek != null) {
      _zero(state.kek!);
    }
    if (state.cacheKey != null) {
      _zero(state.cacheKey!);
    }
    emit(const VaultCryptoState());
  }

  /// Decrypt a photo's DEK and then decrypt the photo.
  Uint8List decryptMedia({
    required Uint8List encryptedBlob,
    required String encryptedDekB64,
    required String dekNonceB64,
    required String ivB64,
  }) {
    if (!state.isUnlocked || state.kek == null) {
      throw StateError('Vault is locked');
    }

    final dek = CryptoService.unwrapDek(
      encryptedDek: _base64ToBytes(encryptedDekB64),
      kek: state.kek!,
      nonce: _base64ToBytes(dekNonceB64),
    );

    final plaintext = CryptoService.decrypt(
      ciphertext: encryptedBlob,
      key: dek,
      iv: _base64ToBytes(ivB64),
    );

    // Zero DEK immediately
    _zero(dek);

    return plaintext;
  }

  static void _zero(Uint8List bytes) => bytes.fillRange(0, bytes.length, 0);

  Uint8List _base64ToBytes(String b64) =>
      Uint8List.fromList(base64.decode(b64));
}

/// Simple data class for vault info from API.
class VaultInfo {
  final String id;
  final String kekSalt;
  final String kekVerify;
  final String kekVerifyNonce;
  final String? labelEncrypted;
  final String? labelNonce;

  VaultInfo({
    required this.id,
    required this.kekSalt,
    required this.kekVerify,
    required this.kekVerifyNonce,
    this.labelEncrypted,
    this.labelNonce,
  });

  factory VaultInfo.fromJson(Map<String, dynamic> json) => VaultInfo(
        id: json['id'] as String,
        kekSalt: json['kekSalt'] as String,
        kekVerify: json['kekVerify'] as String,
        kekVerifyNonce: json['kekVerifyNonce'] as String,
        labelEncrypted: json['labelEncrypted'] as String?,
        labelNonce: json['labelNonce'] as String?,
      );
}
