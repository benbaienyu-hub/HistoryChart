import 'package:flutter/widgets.dart';

import '../data/app_state.dart';

/// Hands the one [AppState] to every screen and rebuilds them when it
/// changes. Flutter's built-in InheritedNotifier does this without adding a
/// state-management package.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child})
      : super(notifier: state);

  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// For button handlers, which should not subscribe to rebuilds.
  static AppState read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
