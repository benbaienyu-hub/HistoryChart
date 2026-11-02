import 'package:flutter/material.dart';

import 'data/app_state.dart';
import 'ui/app_scope.dart';
import 'ui/home_shell.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState()..load();
  runApp(StudyOrbitApp(state: state));
}

class StudyOrbitApp extends StatelessWidget {
  const StudyOrbitApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'StudyOrbit',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        home: const HomeShell(),
      ),
    );
  }
}
