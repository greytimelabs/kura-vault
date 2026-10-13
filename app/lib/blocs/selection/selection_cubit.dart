import 'package:flutter_bloc/flutter_bloc.dart';

/// The photos picked in the grid on screen, to file into or out of an album.
class SelectionState {
  /// Tapping a photo selects it instead of opening it.
  final bool active;
  final Set<String> ids;

  const SelectionState({this.active = false, this.ids = const {}});
}

/// A selection belongs to the screen it was made on: every screen that shows
/// one clears it when it goes away.
class SelectionCubit extends Cubit<SelectionState> {
  SelectionCubit() : super(const SelectionState());

  /// Enter selection mode with nothing picked yet.
  void start() {
    if (!state.active) emit(const SelectionState(active: true));
  }

  /// Pick or unpick one photo, entering selection mode if needed.
  void toggle(String id) {
    final ids = {...state.ids};
    if (!ids.remove(id)) ids.add(id);
    emit(SelectionState(active: true, ids: ids));
  }

  void clear() {
    if (state.active || state.ids.isNotEmpty) emit(const SelectionState());
  }
}
