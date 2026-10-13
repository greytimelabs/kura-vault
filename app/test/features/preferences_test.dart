import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/storage/preferences.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('defaults are the system theme and the web client\'s lock time', () async {
    SharedPreferences.setMockInitialValues({});
    final preferences = Preferences();
    await preferences.load();
    expect(preferences.state.theme, ThemeMode.system);
    expect(preferences.state.autoLockMinutes, 15);
  });

  test('choices are saved and read back', () async {
    SharedPreferences.setMockInitialValues({});
    final preferences = Preferences();
    await preferences.setTheme(ThemeMode.dark);
    await preferences.setAutoLockMinutes(1);

    final again = Preferences();
    await again.load();
    expect(again.state.theme, ThemeMode.dark);
    expect(again.state.autoLockMinutes, 1);

    await again.setTheme(ThemeMode.system);
    final third = Preferences();
    await third.load();
    expect(third.state.theme, ThemeMode.system);
  });

  test('there is no "never": a lock time that is not offered is refused', () async {
    SharedPreferences.setMockInitialValues({'autolock_minutes': 0, 'theme': 'purple'});
    final preferences = Preferences();
    await preferences.load();
    expect(preferences.state.autoLockMinutes, 15);
    expect(preferences.state.theme, ThemeMode.system);

    await preferences.setAutoLockMinutes(600);
    expect(preferences.state.autoLockMinutes, 15);
  });
}
