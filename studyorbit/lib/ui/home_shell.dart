import 'package:flutter/material.dart';

import 'app_scope.dart';
import 'calendar_screen.dart';
import 'capture_sheet.dart';
import 'history_screen.dart';
import 'settings_screen.dart';
import 'tasks_screen.dart';
import 'tonight_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  static const _titles = ['Tonight', 'Tasks', 'Calendar', 'History'];

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    if (!state.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_tab]),
        actions: [
          IconButton(
            tooltip: 'Settings & privacy',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const SettingsScreen())),
          ),
        ],
      ),
      body: IndexedStack(index: _tab, children: const [
        TonightScreen(),
        TasksScreen(),
        CalendarScreen(),
        HistoryScreen(),
      ]),
      floatingActionButton: _tab == 3
          ? null
          : FloatingActionButton.extended(
              onPressed: () => showCaptureSheet(context),
              icon: const Icon(Icons.add),
              label: const Text('Add'),
            ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.nights_stay_outlined), label: 'Tonight'),
          NavigationDestination(
              icon: Icon(Icons.checklist), label: 'Tasks'),
          NavigationDestination(
              icon: Icon(Icons.calendar_month_outlined), label: 'Calendar'),
          NavigationDestination(
              icon: Icon(Icons.history), label: 'History'),
        ],
      ),
    );
  }
}
