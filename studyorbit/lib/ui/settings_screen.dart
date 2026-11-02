import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../logic/task_parser.dart';
import 'app_scope.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<bool> _confirm(BuildContext context, String title, String body) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(d, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(d, true),
              child: const Text('Delete')),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _editDay(BuildContext context, int weekday) async {
    final state = AppScope.read(context);
    final chosen = {...?state.settings.timetable[weekday]};
    await showDialog<void>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, setD) => AlertDialog(
          title: Text('${weekdayNames[weekday - 1]} classes'),
          content: SingleChildScrollView(
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final s in knownSubjects)
                FilterChip(
                  label: Text(s),
                  selected: chosen.contains(s),
                  onSelected: (v) =>
                      setD(() => v ? chosen.add(s) : chosen.remove(s)),
                ),
            ]),
          ),
          actions: [
            FilledButton(
                onPressed: () => Navigator.pop(d), child: const Text('Done')),
          ],
        ),
      ),
    );
    state.updateSettings((s) => s.timetable[weekday] = chosen.toList()..sort());
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final st = state.settings;
    final text = Theme.of(context).textTheme;
    final dinner = TimeOfDay(hour: st.dinnerStart ~/ 60, minute: st.dinnerStart % 60);

    Widget header(String s) => Padding(
          padding: const EdgeInsets.fromLTRB(0, 20, 0, 6),
          child: Text(s, style: text.titleMedium),
        );

    Widget stepper(String label, int value, int min, int max, int step,
            void Function(int) set) =>
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            IconButton(
                onPressed: value > min ? () => set(value - step) : null,
                icon: const Icon(Icons.remove)),
            Text('$value min'),
            IconButton(
                onPressed: value < max ? () => set(value + step) : null,
                icon: const Icon(Icons.add)),
          ]),
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Settings & privacy')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          header('Weak subjects'),
          const Text('These get scheduled earlier, and get a short review on '
              'days you have the class.'),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final s in knownSubjects)
              FilterChip(
                label: Text(s),
                selected: st.weakSubjects.contains(s),
                onSelected: (v) => state.updateSettings(
                    (x) => v ? x.weakSubjects.add(s) : x.weakSubjects.remove(s)),
              ),
          ]),
          header('Class timetable'),
          const Text("Used to add tomorrow's preview and today's review to "
              'the plan automatically.'),
          for (var wd = 1; wd <= 7; wd++)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(weekdayNames[wd - 1]),
              subtitle: Text((st.timetable[wd] ?? const []).isEmpty
                  ? 'No classes'
                  : st.timetable[wd]!.join(', ')),
              trailing: const Icon(Icons.edit_outlined),
              onTap: () => _editDay(context, wd),
            ),
          header('Evening plan'),
          stepper('Focus block', st.focusMinutes, 10, 60, 5,
              (v) => state.updateSettings((x) => x.focusMinutes = v)),
          stepper('Break', st.breakMinutes, 0, 20, 5,
              (v) => state.updateSettings((x) => x.breakMinutes = v)),
          stepper('Dinner length', st.dinnerMinutes, 15, 90, 15,
              (v) => state.updateSettings((x) => x.dinnerMinutes = v)),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Dinner starts'),
            trailing: Text(dinner.format(context)),
            onTap: () async {
              final t = await showTimePicker(context: context, initialTime: dinner);
              if (t == null) return;
              final m = (t.hour * 60 + t.minute).clamp(16 * 60, 20 * 60);
              state.updateSettings((x) => x.dinnerStart = m);
            },
          ),
          header('Privacy'),
          const Text('Everything stays on this phone. Photos are read and '
              'voice is transcribed on the device; nothing is uploaded.'),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Delete photos after reading them'),
            subtitle: const Text('Keep this on unless you want to see the '
                'original photo next to each task.'),
            value: st.deleteImagesAfterRecognition,
            onChanged: (v) =>
                state.updateSettings((x) => x.deleteImagesAfterRecognition = v),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.hide_image_outlined),
            title: Text('Delete saved photos (${state.storedImageCount})'),
            onTap: () async {
              if (await _confirm(context, 'Delete all photos?',
                  'Tasks stay; only the photos they were read from are removed.')) {
                state.deleteAllImages();
              }
            },
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.subtitles_off_outlined),
            title: const Text('Delete transcripts and recognised text'),
            onTap: () async {
              if (await _confirm(context, 'Delete all transcripts?',
                  'Tasks stay; what you said and what the camera read is removed.')) {
                state.deleteTranscripts();
              }
            },
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.history_toggle_off),
            title: const Text('Clear history'),
            onTap: () async {
              if (await _confirm(context, 'Clear history?',
                  'Your log of added, finished and studied tasks is removed. '
                  'Tasks themselves stay.')) {
                state.clearHistory();
              }
            },
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.delete_forever,
                color: Theme.of(context).colorScheme.error),
            title: Text('Delete everything',
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
            subtitle: const Text('All tasks, photos, history and settings. '
                'Cannot be undone.'),
            onTap: () async {
              if (await _confirm(context, 'Delete everything?',
                  'This wipes StudyOrbit on this phone. It cannot be undone.')) {
                await state.deleteEverything();
                if (context.mounted) Navigator.pop(context);
              }
            },
          ),
        ],
      ),
    );
  }
}
