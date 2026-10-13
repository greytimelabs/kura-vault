import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/media/media_cubit.dart';
import 'package:kura_vault/core/format.dart';
import '../support/fake_network.dart';

Map<String, dynamic> _item(String id, String link, {bool liked = false}) => {
      'id': id,
      'vaultId': 'v1',
      'mediaType': 'photo',
      'thumbIv': 'iv',
      'thumbUrl': link,
      'isLiked': liked,
      'key': null,
    };

Map<String, dynamic> _page(List<Map<String, dynamic>> items, {int page = 1, int totalPages = 1}) => {
      'data': {'data': items, 'total': items.length, 'page': page, 'limit': 50, 'totalPages': totalPages},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('expired thumbnail links are renewed once per page, keeping the list as it is', () async {
    var generation = 1;
    final network = FakeNetwork();
    network.handler = (o) => o.method == 'GET'
        ? FakeNetwork.json(200, _page([_item('a', 'link-a-$generation'), _item('b', 'link-b-$generation')]))
        : FakeNetwork.json(200, {'data': null});
    final media = MediaCubit(apiClient: await signedInClient(network));

    await media.loadMedia(vaultId: 'v1', albumId: 'album-1');
    await media.toggleLike(vaultId: 'v1', mediaId: 'a');
    expect(media.state.items.first.isLiked, true);

    generation = 2;
    network.requests.clear();
    // A screenful of tiles finds its links expired at the same moment
    final fresh = await Future.wait([media.renewThumb('a'), media.renewThumb('b')]);

    expect(fresh, ['link-a-2', 'link-b-2']);
    final asked = network.sent('GET', '/media').toList();
    expect(asked, hasLength(1));
    // The same list is asked for again: same vault, same album, that page
    expect(asked.single.queryParameters, {'vaultId': 'v1', 'albumId': 'album-1', 'page': 1, 'limit': 50});
    // The heart set on screen survives; only the links changed
    expect(media.state.items.first.isLiked, true);

    expect(await media.renewThumb('not-in-the-list'), isNull);
  });

  test('the next page is fetched for whatever list is loaded', () async {
    final network = FakeNetwork();
    network.handler = (o) {
      final page = o.queryParameters['page'] as int;
      return FakeNetwork.json(200, _page([_item('item-$page', 'l')], page: page, totalPages: 2));
    };
    final media = MediaCubit(apiClient: await signedInClient(network));

    await media.loadNext(); // nothing loaded: nothing to continue
    expect(network.requests, isEmpty);

    await media.loadMedia(vaultId: 'v1', albumId: 'album-1');
    await media.loadNext();
    expect(media.state.items.map((m) => m.id), ['item-1', 'item-2']);
    expect(network.requests.last.queryParameters['albumId'], 'album-1');

    media.reset();
    await media.loadNext();
    expect(network.requests, hasLength(2));
  });

  test('durations and dates read the way the web client shows them', () {
    expect(formatDuration(5), '0:05');
    expect(formatDuration(65), '1:05');
    expect(formatDuration(3723), '1:02:03');
    expect(formatDuration(-4), '0:00');
    expect(formatDateTime(null), isNull);
    expect(formatDateTime('not a date'), isNull);
    expect(formatDateTime('2024-03-05T10:30:00.000Z'), contains('2024'));
  });
}
