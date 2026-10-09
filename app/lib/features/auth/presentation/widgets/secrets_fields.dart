import 'package:flutter/material.dart';

/// The two secrets every account has. The password signs in to the server.
/// The master passphrase never leaves this device: it unlocks the account's keys.
class SecretsFields extends StatelessWidget {
  final TextEditingController password;
  final TextEditingController confirmPassword;
  final TextEditingController passphrase;
  final TextEditingController confirmPassphrase;
  final bool enabled;

  const SecretsFields({
    super.key,
    required this.password,
    required this.confirmPassword,
    required this.passphrase,
    required this.confirmPassphrase,
    this.enabled = true,
  });

  static const int minPassphraseLength = 12;

  // The same rule the server enforces, so the form can say so before sending
  static final _passwordRule =
      RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$');

  static String? validatePassword(String? value) =>
      _passwordRule.hasMatch(value ?? '')
          ? null
          : 'At least 12 characters with upper and lower case, a number and a symbol';

  @override
  Widget build(BuildContext context) {
    InputDecoration decoration(String label, {String? helper}) => InputDecoration(
          labelText: label,
          helperText: helper,
          helperMaxLines: 2,
          errorMaxLines: 2,
          border: const OutlineInputBorder(),
        );

    return Column(
      children: [
        TextFormField(
          controller: password,
          enabled: enabled,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: decoration('Password', helper: 'Signs you in to this server.'),
          validator: validatePassword,
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: confirmPassword,
          enabled: enabled,
          obscureText: true,
          decoration: decoration('Confirm password'),
          validator: (value) => value == password.text ? null : 'Passwords do not match',
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: passphrase,
          enabled: enabled,
          obscureText: true,
          // Not a login: keep password managers from saving it next to the password
          enableSuggestions: false,
          autocorrect: false,
          decoration: decoration(
            'Master passphrase',
            helper: 'Unlocks your keys on this device. It is never sent to the server.',
          ),
          validator: (value) {
            if ((value ?? '').length < minPassphraseLength) {
              return 'Use at least $minPassphraseLength characters';
            }
            // The server sees the password: the passphrase must never be the same
            if (value == password.text) return 'Must be different from the password';
            return null;
          },
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: confirmPassphrase,
          enabled: enabled,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          decoration: decoration('Confirm master passphrase'),
          validator: (value) => value == passphrase.text ? null : 'Passphrases do not match',
        ),
        const SizedBox(height: 16),
        Text(
          'There is no way to recover or reset the master passphrase, not even for '
          'the server owner. If it is lost, everything only this account can open '
          'is lost with it.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
