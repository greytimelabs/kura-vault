import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Choices that are not secrets and belong to this device, not an account.
class PreferencesState {
  final ThemeMode theme;

  /// Minutes without input before every key is destroyed. There is no "never".
  final int autoLockMinutes;

  const PreferencesState({
    this.theme = ThemeMode.system,
    this.autoLockMinutes = Preferences.defaultAutoLockMinutes,
  });
}

class Preferences extends Cubit<PreferencesState> {
  static const autoLockOptions = [1, 5, 15];
  static const defaultAutoLockMinutes = 15;

  static const _theme = 'theme';
  static const _autoLock = 'autolock_minutes';
  static const _savedCopiesNotice = 'saved_copies_notice_shown';

  Preferences() : super(const PreferencesState());

  /// Read what was saved. Until this finishes the defaults apply, which are
  /// the strictest lock time and the system's theme.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final minutes = prefs.getInt(_autoLock);
      if (isClosed) return;
      emit(PreferencesState(
        theme: switch (prefs.getString(_theme)) {
          'light' => ThemeMode.light,
          'dark' => ThemeMode.dark,
          _ => ThemeMode.system,
        },
        // A value this build does not offer falls back to the default
        autoLockMinutes:
            autoLockOptions.contains(minutes) ? minutes! : defaultAutoLockMinutes,
      ));
    } catch (_) {
      // Preferences are never essential
    }
  }

  Future<void> setTheme(ThemeMode theme) async {
    emit(PreferencesState(theme: theme, autoLockMinutes: state.autoLockMinutes));
    try {
      final prefs = await SharedPreferences.getInstance();
      if (theme == ThemeMode.system) {
        await prefs.remove(_theme);
      } else {
        await prefs.setString(_theme, theme == ThemeMode.dark ? 'dark' : 'light');
      }
    } catch (_) {}
  }

  Future<void> setAutoLockMinutes(int minutes) async {
    if (!autoLockOptions.contains(minutes)) return;
    emit(PreferencesState(theme: state.theme, autoLockMinutes: minutes));
    try {
      await (await SharedPreferences.getInstance()).setInt(_autoLock, minutes);
    } catch (_) {}
  }

  /// Whether the user has been told that a saved copy is no longer protected.
  static Future<bool> savedCopiesNoticeShown() async =>
      (await SharedPreferences.getInstance()).getBool(_savedCopiesNotice) ?? false;

  static Future<void> setSavedCopiesNoticeShown() async =>
      (await SharedPreferences.getInstance()).setBool(_savedCopiesNotice, true);
}
