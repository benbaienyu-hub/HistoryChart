/// Everything the app knows, kept on the phone.
///
/// Stored as one JSON string in SharedPreferences (the phone's built-in
/// key–value storage). There is no server and no account: the plan (§4)
/// keeps homework data on the device, and a single file is the simplest
/// thing that survives the app being closed. A ChangeNotifier — Flutter's
/// own "tell the screens something changed" class — is enough state
/// management for an app this size, so no extra library is needed.
library;

import 'dart:convert';
import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../logic/dates.dart';
import '../models/task.dart';

class AppState extends ChangeNotifier {
  AppState({DateTime Function()? clock}) : clock = clock ?? DateTime.now;

  static const storageKey = 'studyorbit.v1';

  /// Injected so tests can pretend it is 4:00 PM on a Tuesday.
  final DateTime Function() clock;

  final List<Task> tasks = [];
  final List<HistoryEntry> history = [];
  Settings settings = Settings();
  bool loaded = false;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(storageKey);
    if (raw != null) {
      try {
        final j = jsonDecode(raw) as Map<String, dynamic>;
        tasks
          ..clear()
          ..addAll(((j['tasks'] as List?) ?? []).map(
              (t) => Task.fromJson(Map<String, dynamic>.from(t as Map))));
        history
          ..clear()
          ..addAll(((j['history'] as List?) ?? []).map((h) =>
              HistoryEntry.fromJson(Map<String, dynamic>.from(h as Map))));
        settings = Settings.fromJson(
            Map<String, dynamic>.from((j['settings'] as Map?) ?? {}));
      } catch (e) {
        // A corrupt save should not stop the app from opening. The bad copy
        // is kept under another key rather than overwritten, so it can still
        // be recovered by hand.
        debugPrint('StudyOrbit: could not read saved data: $e');
        await prefs.setString('$storageKey.corrupt', raw);
      }
    }
    loaded = true;
    notifyListeners();
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(storageKey, exportJson());
  }

  String exportJson() => jsonEncode({
        'version': 1,
        'tasks': tasks.map((t) => t.toJson()).toList(),
        'history': history.map((h) => h.toJson()).toList(),
        'settings': settings.toJson(),
      });

  void _changed() {
    notifyListeners();
    _save();
  }

  void _log(String action, String detail) {
    history.insert(0, HistoryEntry(at: clock(), action: action, detail: detail));
    // Keep the log from growing forever; a semester is plenty.
    if (history.length > 2000) history.removeRange(2000, history.length);
  }

  Task? byId(String? id) {
    if (id == null) return null;
    for (final t in tasks) {
      if (t.id == id) return t;
    }
    return null;
  }

  void addTasks(List<Task> newTasks) {
    tasks.addAll(newTasks);
    for (final t in newTasks) {
      _log('Added', '${t.subject} — ${t.title} (${t.source.name})');
    }
    _changed();
  }

  void updateTask(Task t, {String? note}) {
    _log('Edited', note ?? '${t.subject} — ${t.title}');
    _changed();
  }

  void deleteTask(Task t) {
    tasks.removeWhere((x) => x.id == t.id);
    _deleteImageFile(t.sourceImagePath);
    _log('Deleted', '${t.subject} — ${t.title}');
    _changed();
  }

  void setDone(Task t, bool done) {
    t.status = done ? TaskStatus.done : TaskStatus.todo;
    t.completedAt = done ? clock() : null;
    if (done) {
      for (final s in t.steps) {
        s.done = true;
      }
    }
    _log(done ? 'Completed' : 'Reopened', '${t.subject} — ${t.title}');
    _changed();
  }

  void setStepDone(Task t, int index, bool done) {
    if (index < 0 || index >= t.steps.length) return;
    t.steps[index].done = done;
    _log(done ? 'Step done' : 'Step reopened',
        '${t.title}: ${t.steps[index].title}');
    if (t.steps.every((s) => s.done)) {
      setDone(t, true);
      return;
    }
    _changed();
  }

  /// Moves the task out of tonight's plan. The deadline stays as it was —
  /// postponing work does not postpone when it is due.
  void postpone(Task t, {int days = 1}) {
    t.deferredUntil = dayOf(clock()).add(Duration(days: days));
    _log('Postponed', '${t.subject} — ${t.title} to ${shortDate(t.deferredUntil!, today: clock())}');
    _changed();
  }

  void toggleLock(Task t) {
    t.locked = !t.locked;
    _log(t.locked ? 'Locked' : 'Unlocked', '${t.subject} — ${t.title}');
    _changed();
  }

  void logStudy(Task? t, int minutes, String label) {
    if (minutes <= 0) return;
    if (t != null) t.minutesSpent += minutes;
    _log('Studied', '$minutes min · $label');
    _changed();
  }

  void updateSettings(void Function(Settings s) change) {
    change(settings);
    _changed();
  }

  // ---- Privacy controls (plan §4) -------------------------------------

  int get storedImageCount =>
      tasks.where((t) => t.sourceImagePath != null).length;

  void deleteAllImages() {
    for (final t in tasks) {
      _deleteImageFile(t.sourceImagePath);
      t.sourceImagePath = null;
    }
    _log('Privacy', 'Deleted all saved photos');
    _changed();
  }

  void deleteTranscripts() {
    for (final t in tasks) {
      t.sourceText = null;
    }
    _log('Privacy', 'Deleted all transcripts and recognised text');
    _changed();
  }

  void clearHistory() {
    history.clear();
    _changed();
  }

  Future<void> deleteEverything() async {
    for (final t in tasks) {
      _deleteImageFile(t.sourceImagePath);
    }
    tasks.clear();
    history.clear();
    settings = Settings();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(storageKey);
    await prefs.remove('$storageKey.corrupt');
    notifyListeners();
  }

  static void _deleteImageFile(String? path) {
    if (path == null || kIsWeb) return;
    try {
      final f = File(path);
      if (f.existsSync()) f.deleteSync();
    } catch (_) {
      // Already gone, or the OS cleared its cache; nothing to do.
    }
  }

  // ---- Numbers for the history screen --------------------------------

  int minutesStudiedSince(DateTime since) => history
      .where((h) => h.action == 'Studied' && !h.at.isBefore(since))
      .fold(0, (a, h) => a + (int.tryParse(h.detail.split(' ').first) ?? 0));

  int tasksCompletedSince(DateTime since) => tasks
      .where((t) => t.completedAt != null && !t.completedAt!.isBefore(since))
      .length;
}
