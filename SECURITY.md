# Security policy

Kura Vault exists to keep private media private, so reports are taken
seriously. The project has not had an independent security audit.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting instead: on the repository page go to
**Security → Report a vulnerability**. Include what you found, how to reproduce
it, and what an attacker could gain.

You should get an acknowledgement within a week. Please allow time for a fix
before disclosing publicly.

## What counts

Especially interesting:

- Anything that lets the server, the storage provider or a network attacker
  learn plaintext media, metadata, passphrases or keys.
- Weaknesses in the key derivation, envelope encryption or wire format.
- Bypassing authentication, the vault and album access checks, or the
  view/write split.
- Getting a key sealed to, or accepted from, someone the owner did not
  certify; anything that lets the server substitute a public key.
- Access that survives unsharing or restricting an account.
- One vault's existence or contents leaking to someone holding a different
  vault's passphrase.
- Key material or decrypted media surviving a vault lock in a client.

Out of scope: issues that need a compromised or unlocked device, weak
passphrases chosen by the user, and denial of service against a self-hosted
instance.

The design and its known limits are described in
[docs/security.md](docs/security.md).
