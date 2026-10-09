import 'package:flutter/material.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';

/// Shown only when one passphrase matched MORE THAN ONE vault.
///
/// Lists only the matched vaults — never a vault that did not match, and never
/// a count. It is deliberately a modal sheet rather than a route: it holds live
/// KEKs, and a route with `extra` risks them surviving in navigator history.
///
/// Returns the chosen vault, or null if dismissed. The caller is responsible
/// for zeroing the KEKs of everything it does not commit.
class VaultPickerSheet extends StatelessWidget {
  final List<MatchedVault> matches;

  const VaultPickerSheet({super.key, required this.matches});

  static Future<MatchedVault?> show(
    BuildContext context,
    List<MatchedVault> matches,
  ) {
    return showModalBottomSheet<MatchedVault>(
      context: context,
      isScrollControlled: true,
      builder: (_) => VaultPickerSheet(matches: matches),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 8, 24, 16),
              // No count, no explanation of why this appeared — the list
              // length is already visible; restating it adds nothing.
              child: Text(
                'Select vault',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: matches.length,
                itemBuilder: (context, i) {
                  final match = matches[i];
                  return ListTile(
                    leading: const Icon(Icons.folder_outlined),
                    title: Text(match.label),
                    onTap: () => Navigator.of(context).pop(match),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
