import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/crypto/aad.dart';
import 'package:kura_vault/core/crypto/crypto_service.dart';
import 'package:kura_vault/core/crypto/identity_crypto.dart';
import 'package:kura_vault/core/crypto/key_derivation.dart';

bool _isAllZero(Uint8List b) => b.every((x) => x == 0);

/// A user as their own device and the server see them.
class _User {
  final String id;
  final String username;
  final VaultCryptoCubit cubit = VaultCryptoCubit();
  late AccountMaterial material;
  String? keyCert;

  _User(this.id, this.username);

  UserKeys get keys => UserKeys(
        userId: id,
        username: username,
        publicEncKey: material.publicEncKey,
        publicSignKey: material.publicSignKey,
        keyCert: keyCert,
      );

  AccountKeys get account => AccountKeys(
        id: id,
        kdfSalt: material.kdfSalt,
        encryptedPrivateKeys: material.encryptedPrivateKeys,
        privateKeysNonce: material.privateKeysNonce,
        publicEncKey: material.publicEncKey,
        publicSignKey: material.publicSignKey,
      );
}

/// Build a vault exactly the way a creating client does: a random vault key,
/// encrypted under the vault passphrase, then sealed to the creator.
Future<({VaultInfo info, Uint8List key})> makeVault({
  required String id,
  required String passphrase,
  required _User creator,
  String? label,
}) async {
  final key = CryptoService.generateKey();
  final salt = KeyDerivation.generateSalt();
  final passphraseKey = await KeyDerivation.deriveKek(passphrase: passphrase, salt: salt);
  final iv = CryptoService.generateIv();
  final inner = Uint8List.fromList([
    ...iv,
    ...CryptoService.encrypt(
      plaintext: key,
      key: passphraseKey,
      iv: iv,
      aad: Aad.vaultKeyPassphrase(id, creator.id),
    ),
  ]);
  final sealed = await IdentityCrypto.seal(
    recipientPk: b64d(creator.material.publicEncKey),
    plaintext: inner,
    aad: Aad.vaultKey(id, creator.id),
  );

  String? labelEnc;
  String? labelNonce;
  if (label != null) {
    final ln = CryptoService.generateIv();
    labelEnc = b64e(CryptoService.encrypt(
      plaintext: Uint8List.fromList(label.codeUnits),
      key: key,
      iv: ln,
      aad: Aad.vaultLabel(id),
    ));
    labelNonce = b64e(ln);
  }

  return (
    info: VaultInfo(
      id: id,
      role: 'creator',
      permission: 'write',
      wrappedKey: b64e(sealed),
      kdfSalt: b64e(salt),
      labelEncrypted: labelEnc,
      labelNonce: labelNonce,
    ),
    key: key,
  );
}

void main() {
  const idA = '11111111-1111-1111-1111-111111111111';
  const idB = '22222222-2222-2222-2222-222222222222';
  const idC = '33333333-3333-3333-3333-333333333333';

  late _User owner;
  late _User member;

  setUpAll(() async {
    owner = _User('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner');
    owner.material = await owner.cubit
        .createAccount(userId: owner.id, username: owner.username, passphrase: 'owner master');
    owner.keyCert = owner.material.keyCert;

    // The member joins from an invite link and the owner certifies their keys
    final invite = await owner.cubit.createInvite('99999999-9999-4999-8999-999999999999');
    final link = InviteLink(
      inviteId: '99999999-9999-4999-8999-999999999999',
      secret: invite.secret,
      ownerSignKey: invite.ownerSignKey,
    );
    member = _User('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mira.k');
    member.material = await member.cubit.createAccount(
      userId: member.id,
      username: member.username,
      passphrase: 'member master',
      invite: link,
    );
    member.keyCert = await owner.cubit.certifyUser(
      user: member.keys,
      inviteId: link.inviteId,
      ownerSecretEncrypted: invite.ownerSecretEncrypted,
      keyBinding: member.material.keyBinding!,
    );
  });

  group('account', () {
    test('the owner certifies themselves; a member trusts the owner from the link', () async {
      expect(owner.cubit.isTrustRoot, true);
      expect(member.cubit.isTrustRoot, false);
      expect(member.keyCert, isNotNull);
      expect(await member.cubit.verifyUser(owner.keys), true);
      expect(await owner.cubit.verifyUser(member.keys), true);
    });

    test('a wrong master passphrase unlocks nothing', () async {
      final device = VaultCryptoCubit();
      expect(await device.unlockAccount(account: member.account, passphrase: 'not it'), false);
      expect(device.state.accountUnlocked, false);
      expect(await device.unlockAccount(account: member.account, passphrase: 'member master'), true);
      expect(device.state.accountUnlocked, true);
      // Unlocked, but no vault is open yet
      expect(device.state.isUnlocked, false);
    });

    test('a server that swaps this account\'s public key is noticed', () async {
      final swapped = AccountKeys(
        id: member.id,
        kdfSalt: member.material.kdfSalt,
        encryptedPrivateKeys: member.material.encryptedPrivateKeys,
        privateKeysNonce: member.material.privateKeysNonce,
        publicEncKey: owner.material.publicEncKey,
        publicSignKey: member.material.publicSignKey,
      );
      await expectLater(
        VaultCryptoCubit().unlockAccount(account: swapped, passphrase: 'member master'),
        throwsA(isA<KeysNotYoursException>()),
      );
    });

    test('keys swapped before certification are refused', () async {
      final invite = await owner.cubit.createInvite('88888888-8888-4888-8888-888888888888');
      final joiner = _User('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'joiner');
      joiner.material = await joiner.cubit.createAccount(
        userId: joiner.id,
        username: joiner.username,
        passphrase: 'joiner master',
        invite: InviteLink(
          inviteId: '88888888-8888-4888-8888-888888888888',
          secret: invite.secret,
          ownerSignKey: invite.ownerSignKey,
        ),
      );
      // The server presents the owner's encryption key as the joiner's
      final tampered = UserKeys(
        userId: joiner.id,
        username: joiner.username,
        publicEncKey: owner.material.publicEncKey,
        publicSignKey: joiner.material.publicSignKey,
      );
      expect(
        await owner.cubit.certifyUser(
          user: tampered,
          inviteId: '88888888-8888-4888-8888-888888888888',
          ownerSecretEncrypted: invite.ownerSecretEncrypted,
          keyBinding: joiner.material.keyBinding!,
        ),
        isNull,
      );
    });
  });

  group('findMatches', () {
    test('same passphrase on two vaults returns BOTH matches', () async {
      // Distinct salts mean distinct passphrase keys, so each vault is checked on its own
      final a = await makeVault(id: idA, passphrase: 'shared-pass', creator: owner, label: 'Family');
      final b = await makeVault(id: idB, passphrase: 'shared-pass', creator: owner, label: 'Work');
      final c = await makeVault(id: idC, passphrase: 'other-pass', creator: owner, label: 'Private');

      final matches = await owner.cubit
          .findMatches(passphrase: 'shared-pass', vaults: [a.info, b.info, c.info]);

      expect(matches.map((m) => m.vaultId), [idA, idB]);
      expect(matches.map((m) => m.label), ['Family', 'Work']);
      expect(matches[0].key, a.key);
      owner.cubit.discardMatches(matches);
    });

    test('a wrong passphrase matches nothing', () async {
      final a = await makeVault(id: idA, passphrase: 'right-pass', creator: owner);
      expect(await owner.cubit.findMatches(passphrase: 'wrong-pass', vaults: [a.info]), isEmpty);
    });

    test('the vault passphrase alone is not enough: another account cannot open it', () async {
      final a = await makeVault(id: idA, passphrase: 'right-pass', creator: owner);
      // The member knows the passphrase and somehow got the row, but it is sealed to the owner
      expect(await member.cubit.findMatches(passphrase: 'right-pass', vaults: [a.info]), isEmpty);
    });

    test('a vault with no label gets a positional name, never its id', () async {
      final a = await makeVault(id: idA, passphrase: 'p', creator: owner);
      final matches = await owner.cubit.findMatches(passphrase: 'p', vaults: [a.info]);
      expect(matches.single.label, 'Vault 1');
      owner.cubit.discardMatches(matches);
    });

    test('selecting one match zeroes the keys of the others', () async {
      final a = await makeVault(id: idA, passphrase: 'p', creator: owner, label: 'A');
      final b = await makeVault(id: idB, passphrase: 'p', creator: owner, label: 'B');
      final matches = await owner.cubit.findMatches(passphrase: 'p', vaults: [a.info, b.info]);

      owner.cubit.selectVault(matches[0], matches);

      expect(owner.cubit.state.activeVaultId, idA);
      expect(owner.cubit.state.isCreator, true);
      expect(_isAllZero(matches[0].key), false);
      expect(_isAllZero(matches[1].key), true);
      owner.cubit.closeVault();
    });

    test('discarding matches zeroes every key and opens nothing', () async {
      final a = await makeVault(id: idA, passphrase: 'p', creator: owner);
      final matches = await owner.cubit.findMatches(passphrase: 'p', vaults: [a.info]);
      owner.cubit.discardMatches(matches);
      expect(_isAllZero(matches.single.key), true);
      expect(owner.cubit.state.isUnlocked, false);
    });
  });

  group('sharing', () {
    test('a shared vault opens for its recipient without the passphrase, and only for them', () async {
      final a = await makeVault(id: idA, passphrase: 'vault-pass', creator: owner, label: 'Family');
      final matches = await owner.cubit.findMatches(passphrase: 'vault-pass', vaults: [a.info]);
      owner.cubit.selectVault(matches.single, matches);

      final grant = await owner.cubit.shareVault(vaultId: idA, recipient: member.keys);
      final shared = VaultInfo(
        id: idA,
        role: 'member',
        permission: 'view',
        wrappedKey: grant.wrappedKey,
        grantSig: grant.grantSig,
        granter: owner.keys,
        labelEncrypted: a.info.labelEncrypted,
        labelNonce: a.info.labelNonce,
      );

      final spaces = await member.cubit.openShared(vaults: [shared], albums: []);
      expect(spaces.single.label, 'Family');
      expect(spaces.single.sharedBy, 'owner');
      member.cubit.openSpace(spaces.single);
      expect(member.cubit.state.activeVaultId, idA);
      expect(member.cubit.state.canWrite, false);
      expect(member.cubit.state.isCreator, false);

      // Unsigned, or signed for someone else's row: left out
      final unsigned = VaultInfo(id: idA, role: 'member', wrappedKey: grant.wrappedKey, granter: owner.keys);
      expect(await member.cubit.openShared(vaults: [unsigned], albums: []), isEmpty);
      // From a sender whose keys the owner never certified: left out
      final uncertified = VaultInfo(
        id: idA,
        role: 'member',
        wrappedKey: grant.wrappedKey,
        grantSig: grant.grantSig,
        granter: UserKeys(
          userId: owner.id,
          username: owner.username,
          publicEncKey: owner.material.publicEncKey,
          publicSignKey: owner.material.publicSignKey,
        ),
      );
      expect(await member.cubit.openShared(vaults: [uncertified], albums: []), isEmpty);

      member.cubit.closeVault();
      owner.cubit.closeVault();
    });

    test('nothing is shared with a user whose keys are not certified', () async {
      final a = await makeVault(id: idA, passphrase: 'vault-pass', creator: owner);
      final matches = await owner.cubit.findMatches(passphrase: 'vault-pass', vaults: [a.info]);
      owner.cubit.selectVault(matches.single, matches);

      final stranger = UserKeys(
        userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        username: 'stranger',
        publicEncKey: member.material.publicEncKey,
        publicSignKey: member.material.publicSignKey,
        // A certificate issued for someone else
        keyCert: member.keyCert,
      );
      await expectLater(
        owner.cubit.shareVault(vaultId: idA, recipient: stranger),
        throwsA(isA<StateError>()),
      );
      owner.cubit.closeVault();
    });
  });

  group('lock', () {
    test('closing a vault keeps the account unlocked; locking wipes everything', () async {
      final device = VaultCryptoCubit();
      await device.unlockAccount(account: owner.account, passphrase: 'owner master');
      final a = await makeVault(id: idA, passphrase: 'p', creator: owner);
      final matches = await device.findMatches(passphrase: 'p', vaults: [a.info]);
      device.selectVault(matches.single, matches);
      final key = matches.single.key;
      final cacheKey = device.state.cacheKey!;

      device.closeVault();
      expect(device.state.isUnlocked, false);
      expect(device.state.accountUnlocked, true);
      expect(_isAllZero(key), true);
      expect(_isAllZero(cacheKey), true);

      device.lock();
      expect(device.state.accountUnlocked, false);
      expect(() => device.shareVault(vaultId: idA, recipient: member.keys), throwsA(isA<StateError>()));
    });
  });

  test('random bytes come from the system CSPRNG, not the clock', () {
    final seen = <String>{};
    for (var i = 0; i < 200; i++) {
      seen.add(b64e(CryptoService.generateKey()));
    }
    // A clock-seeded generator repeats within the same microsecond
    expect(seen.length, 200);
    expect(CryptoService.generateIv().length, 12);
  });
}
