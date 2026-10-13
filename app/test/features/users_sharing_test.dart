import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/blocs/vault/vault_cubit.dart';
import 'package:kura_vault/features/sharing/data/members_api.dart';
import 'package:kura_vault/features/users/data/users_api.dart';
import '../support/fake_network.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const ownerId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';
  const inviteId = '33333333-3333-4333-8333-333333333333';

  late VaultCryptoCubit owner;
  late AccountMaterial memberKeys;
  late Map<String, dynamic> pendingRow;

  // One owner and one person who joined with the owner's invite, made once:
  // every key derivation costs an Argon2id run
  setUpAll(() async {
    owner = VaultCryptoCubit();
    await owner.createAccount(userId: ownerId, username: 'owner', passphrase: 'owner master');
    final invite = await owner.createInvite(inviteId);

    final member = VaultCryptoCubit();
    memberKeys = await member.createAccount(
      userId: memberId,
      username: 'sam',
      passphrase: 'member master',
      invite: InviteLink(inviteId: inviteId, secret: invite.secret, ownerSignKey: invite.ownerSignKey),
    );
    member.lock();

    pendingRow = {
      'userId': memberId,
      'username': 'sam',
      'publicEncKey': memberKeys.publicEncKey,
      'publicSignKey': memberKeys.publicSignKey,
      'keyCert': null,
      'role': 'member',
      'accessLevel': 'limited',
      'status': 'active',
      'verification': {
        'inviteId': inviteId,
        'ownerSecretEncrypted': invite.ownerSecretEncrypted,
        'keyBinding': memberKeys.keyBinding,
      },
    };
  });

  tearDownAll(() => owner.lock());

  Future<(FakeNetwork, UsersApi)> usersApi(Map<String, dynamic> row) async {
    final network = FakeNetwork()
      ..handler = (options) => options.method == 'GET'
          ? FakeNetwork.json(200, {
              'data': {
                'users': [row],
                'invites': [
                  {'id': inviteId, 'username': 'kim', 'accessLevel': 'full', 'expiresAt': 'x', 'expired': true},
                ],
              },
            })
          : FakeNetwork.json(200, {'data': null});
    return (network, UsersApi(await signedInClient(network)));
  }

  test('a user who joined with the invite is certified, and the certificate verifies', () async {
    final (network, api) = await usersApi(pendingRow);

    final list = await api.list();
    expect(list.users.single.isVerified, false);
    expect(list.invites.single.expired, true);

    expect(await certifyPendingUsers(api, owner), isEmpty);

    final sent = network.sent('PUT', '/users/$memberId/cert').single;
    final cert = (sent.data as Map)['keyCert'] as String;
    final certified = UserKeys(
      userId: memberId,
      username: 'sam',
      publicEncKey: memberKeys.publicEncKey,
      publicSignKey: memberKeys.publicSignKey,
      keyCert: cert,
    );
    expect(await owner.verifyUser(certified), true);
  });

  test('keys the server swapped are rejected and never certified', () async {
    // The server (or someone on the path) put its own key under the new user's name
    final attacker = VaultCryptoCubit();
    final other = await attacker.createAccount(userId: 'x', username: 'x', passphrase: 'attacker pass');
    attacker.lock();
    final (network, api) = await usersApi({...pendingRow, 'publicEncKey': other.publicEncKey});

    expect(await certifyPendingUsers(api, owner), ['sam']);
    expect(network.sent('PUT', '/users/$memberId/cert'), isEmpty);
    expect(rejectedKeysMessage(['sam']), contains('sam'));
  });

  test('user changes and invite cancellation send only what changed', () async {
    final (network, api) = await usersApi(pendingRow);

    await api.update(memberId, accessLevel: 'full');
    await api.update(memberId, status: 'restricted');
    await api.deleteInvite(inviteId);

    final patches = network.sent('PATCH', '/users/$memberId').map((r) => r.data).toList();
    expect(patches, [
      {'accessLevel': 'full'},
      {'status': 'restricted'},
    ]);
    expect(network.sent('DELETE', '/users/invites/$inviteId'), hasLength(1));
  });

  test('a new vault is stored wrapped, and shared only with a certified user', () async {
    final network = FakeNetwork();
    final client = await signedInClient(network);

    final made = await owner.createVault(passphrase: 'vault passphrase', label: 'Family');
    await VaultCubit(apiClient: client).createVault(made.vault);
    final body = network.sent('POST', '/vaults').single.data as Map;
    expect(body.keys, containsAll(['id', 'wrappedKey', 'kdfSalt', 'labelEncrypted', 'labelNonce']));
    // Nothing the server could read the vault or its name with
    expect(body.values.join(' '), isNot(contains('Family')));
    expect(body.values.join(' '), isNot(contains('vault passphrase')));

    owner.selectVault(made.match, [made.match]);
    final uncertified = UserKeys(
      userId: memberId,
      username: 'sam',
      publicEncKey: memberKeys.publicEncKey,
      publicSignKey: memberKeys.publicSignKey,
    );
    await expectLater(owner.shareVault(vaultId: made.vault.id, recipient: uncertified), throwsStateError);

    final cert = await owner.certifyUser(
      user: uncertified,
      inviteId: inviteId,
      ownerSecretEncrypted: (pendingRow['verification'] as Map)['ownerSecretEncrypted'] as String,
      keyBinding: memberKeys.keyBinding!,
    );
    final certified = UserKeys(
      userId: memberId,
      username: 'sam',
      publicEncKey: memberKeys.publicEncKey,
      publicSignKey: memberKeys.publicSignKey,
      keyCert: cert,
    );
    final grant = await owner.shareVault(vaultId: made.vault.id, recipient: certified);

    final members = MembersApi.vault(client, made.vault.id);
    await members.add(
        userId: memberId, permission: 'view', wrappedKey: grant.wrappedKey, grantSig: grant.grantSig);
    await members.update(memberId, 'write');
    await members.remove(memberId);

    final base = '/vaults/${made.vault.id}/members';
    expect(network.sent('POST', base).single.data, {
      'userId': memberId,
      'permission': 'view',
      'wrappedKey': grant.wrappedKey,
      'grantSig': grant.grantSig,
    });
    expect(network.sent('PATCH', '$base/$memberId').single.data, {'permission': 'write'});
    expect(network.sent('DELETE', '$base/$memberId'), hasLength(1));
    owner.closeVault();
  });
}
