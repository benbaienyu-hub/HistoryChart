import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:studyorbit/data/app_state.dart';
import 'package:studyorbit/logic/task_parser.dart';
import 'package:studyorbit/main.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('typing homework puts it into tonight\'s plan', (tester) async {
    // 3:30 PM on a Tuesday, so the whole 4–9 window is ahead.
    final state = AppState(clock: () => DateTime(2026, 11, 3, 15, 30));
    await state.load();
    await tester.pumpWidget(StudyOrbitApp(state: state));
    await tester.pumpAndSettle();

    expect(find.textContaining('Nothing to do tonight'), findsOneWidget);

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Type it'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byType(TextField), 'Math p.45 due tomorrow 30 min');
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();

    // The review screen shows what was understood before anything is saved.
    expect(find.text('Check 1 task(s)'), findsOneWidget);
    expect(state.tasks, isEmpty);
    await tester.tap(find.text('Add 1 to my plan'));
    await tester.pumpAndSettle();

    expect(state.tasks.single.subject, 'Math');
    expect(find.text('Math p.45'), findsOneWidget);
    expect(find.text('Dinner'), findsOneWidget);
  });

  test('saved tasks, settings and history survive restarting the app',
      () async {
    final now = DateTime(2026, 11, 3, 15, 30);
    final first = AppState(clock: () => now);
    await first.load();
    first.addTasks([parseLine('Bio test Friday', now: now)!.task]);
    first.updateSettings((s) => s.weakSubjects.add('Biology'));
    await Future<void>.delayed(Duration.zero); // let the save finish

    final second = AppState(clock: () => now);
    await second.load();
    expect(second.tasks.single.subject, 'Biology');
    expect(second.tasks.single.due, DateTime(2026, 11, 6));
    expect(second.settings.weakSubjects, {'Biology'});
    expect(second.history.first.action, 'Added');
  });

  test('"delete everything" really removes the saved copy', () async {
    final now = DateTime(2026, 11, 3, 15, 30);
    final first = AppState(clock: () => now);
    await first.load();
    first.addTasks([parseLine('Math hw', now: now)!.task]);
    await Future<void>.delayed(Duration.zero);
    await first.deleteEverything();

    final second = AppState(clock: () => now);
    await second.load();
    expect(second.tasks, isEmpty);
    expect(second.history, isEmpty);
  });
}
