/// The one thing a student puts into StudyOrbit: a piece of school work with
/// a subject, a deadline and a guess at how long it takes.
///
/// Kept as a plain class with hand-written JSON so the whole data layer has
/// no code generation step — the team can read and change it directly.
library;

enum TaskType {
  homework('Homework'),
  quizCorrection('Quiz correction'),
  exam('Exam prep'),
  project('Project / report'),
  review('Review'),
  preview('Preview'),
  reading('Reading');

  const TaskType(this.label);
  final String label;

  static TaskType byName(String? name) => TaskType.values
      .firstWhere((t) => t.name == name, orElse: () => TaskType.homework);
}

enum TaskStatus { todo, done }

/// Where the task came from. Kept so a wrong deadline can be traced back to
/// the photo it was read from (plan §14: "show the source image").
enum TaskSource { text, voice, photo }

class TaskStep {
  TaskStep({required this.title, required this.minutes, this.done = false});

  String title;
  int minutes;
  bool done;

  Map<String, dynamic> toJson() =>
      {'title': title, 'minutes': minutes, 'done': done};

  factory TaskStep.fromJson(Map<String, dynamic> j) => TaskStep(
        title: j['title'] as String? ?? '',
        minutes: (j['minutes'] as num?)?.toInt() ?? 15,
        done: j['done'] as bool? ?? false,
      );
}

class Task {
  Task({
    required this.id,
    required this.subject,
    required this.title,
    required this.type,
    required this.due,
    required this.estMinutes,
    this.difficulty = 2,
    List<TaskStep>? steps,
    this.status = TaskStatus.todo,
    this.locked = false,
    this.source = TaskSource.text,
    this.sourceImagePath,
    this.sourceText,
    DateTime? createdAt,
    this.completedAt,
    this.minutesSpent = 0,
    this.deferredUntil,
  })  : steps = steps ?? [],
        createdAt = createdAt ?? DateTime.now();

  final String id;
  String subject;
  String title;
  TaskType type;

  /// Date the work is due. Only the day matters; time-of-day is ignored.
  DateTime due;
  int estMinutes;

  /// 1 = easy, 2 = normal, 3 = hard. Feeds the priority score.
  int difficulty;
  List<TaskStep> steps;
  TaskStatus status;

  /// A locked task is scheduled first and never pushed out by re-planning —
  /// the student's own decision wins over the planner's (plan §14).
  bool locked;
  TaskSource source;
  String? sourceImagePath;

  /// What the student said or what the camera read, kept so they can check
  /// the draft against it.
  String? sourceText;
  final DateTime createdAt;
  DateTime? completedAt;
  int minutesSpent;

  /// Set when the student postpones a task: the planner leaves it out of
  /// every evening before this day. The deadline itself does not move.
  DateTime? deferredUntil;

  bool get isOpen => status != TaskStatus.done;

  /// Minutes still to do: unfinished steps if the task was split, otherwise
  /// the estimate minus time already logged.
  int get remainingMinutes {
    if (steps.isNotEmpty) {
      return steps.where((s) => !s.done).fold(0, (a, s) => a + s.minutes);
    }
    final left = estMinutes - minutesSpent;
    return left < 5 ? 5 : left;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'subject': subject,
        'title': title,
        'type': type.name,
        'due': due.toIso8601String(),
        'estMinutes': estMinutes,
        'difficulty': difficulty,
        'steps': steps.map((s) => s.toJson()).toList(),
        'status': status.name,
        'locked': locked,
        'source': source.name,
        'sourceImagePath': sourceImagePath,
        'sourceText': sourceText,
        'createdAt': createdAt.toIso8601String(),
        'completedAt': completedAt?.toIso8601String(),
        'minutesSpent': minutesSpent,
        'deferredUntil': deferredUntil?.toIso8601String(),
      };

  factory Task.fromJson(Map<String, dynamic> j) => Task(
        id: j['id'] as String,
        subject: j['subject'] as String? ?? 'General',
        title: j['title'] as String? ?? '',
        type: TaskType.byName(j['type'] as String?),
        due: DateTime.tryParse(j['due'] as String? ?? '') ?? DateTime.now(),
        estMinutes: (j['estMinutes'] as num?)?.toInt() ?? 30,
        difficulty: (j['difficulty'] as num?)?.toInt() ?? 2,
        steps: ((j['steps'] as List?) ?? [])
            .map((s) => TaskStep.fromJson(Map<String, dynamic>.from(s as Map)))
            .toList(),
        status: TaskStatus.values.firstWhere((s) => s.name == j['status'],
            orElse: () => TaskStatus.todo),
        locked: j['locked'] as bool? ?? false,
        source: TaskSource.values.firstWhere((s) => s.name == j['source'],
            orElse: () => TaskSource.text),
        sourceImagePath: j['sourceImagePath'] as String?,
        sourceText: j['sourceText'] as String?,
        createdAt: DateTime.tryParse(j['createdAt'] as String? ?? ''),
        completedAt: DateTime.tryParse(j['completedAt'] as String? ?? ''),
        minutesSpent: (j['minutesSpent'] as num?)?.toInt() ?? 0,
        deferredUntil: DateTime.tryParse(j['deferredUntil'] as String? ?? ''),
      );
}

/// One line in the history log: what changed, and when (plan §2 历史记录).
class HistoryEntry {
  HistoryEntry({required this.at, required this.action, required this.detail});

  final DateTime at;
  final String action;
  final String detail;

  Map<String, dynamic> toJson() =>
      {'at': at.toIso8601String(), 'action': action, 'detail': detail};

  factory HistoryEntry.fromJson(Map<String, dynamic> j) => HistoryEntry(
        at: DateTime.tryParse(j['at'] as String? ?? '') ?? DateTime.now(),
        action: j['action'] as String? ?? '',
        detail: j['detail'] as String? ?? '',
      );
}

/// Student preferences. The timetable is what lets the planner add tomorrow's
/// preview and today's review without the student typing them every day.
class Settings {
  Settings({
    Set<String>? weakSubjects,
    Map<int, List<String>>? timetable,
    this.deleteImagesAfterRecognition = true,
    this.focusMinutes = 25,
    this.breakMinutes = 5,
    this.dinnerStart = 18 * 60,
    this.dinnerMinutes = 30,
  })  : weakSubjects = weakSubjects ?? {},
        timetable = timetable ?? {};

  Set<String> weakSubjects;

  /// Weekday (DateTime.monday = 1 … sunday = 7) → that day's subjects.
  Map<int, List<String>> timetable;

  /// Plan §4: homework photos can be deleted once they have been read.
  bool deleteImagesAfterRecognition;
  int focusMinutes;
  int breakMinutes;

  /// Minutes after midnight.
  int dinnerStart;
  int dinnerMinutes;

  Map<String, dynamic> toJson() => {
        'weakSubjects': weakSubjects.toList(),
        'timetable':
            timetable.map((k, v) => MapEntry(k.toString(), v)),
        'deleteImagesAfterRecognition': deleteImagesAfterRecognition,
        'focusMinutes': focusMinutes,
        'breakMinutes': breakMinutes,
        'dinnerStart': dinnerStart,
        'dinnerMinutes': dinnerMinutes,
      };

  factory Settings.fromJson(Map<String, dynamic> j) => Settings(
        weakSubjects:
            ((j['weakSubjects'] as List?) ?? []).cast<String>().toSet(),
        timetable: ((j['timetable'] as Map?) ?? {}).map((k, v) => MapEntry(
            int.parse(k.toString()), (v as List).cast<String>().toList())),
        deleteImagesAfterRecognition:
            j['deleteImagesAfterRecognition'] as bool? ?? true,
        focusMinutes: (j['focusMinutes'] as num?)?.toInt() ?? 25,
        breakMinutes: (j['breakMinutes'] as num?)?.toInt() ?? 5,
        dinnerStart: (j['dinnerStart'] as num?)?.toInt() ?? 18 * 60,
        dinnerMinutes: (j['dinnerMinutes'] as num?)?.toInt() ?? 30,
      );
}
