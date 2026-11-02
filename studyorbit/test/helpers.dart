import 'package:studyorbit/models/task.dart';

int _n = 0;

/// A task with sensible defaults, so each test only states what it is about.
Task task({
  String subject = 'Math',
  String title = 'Homework',
  TaskType type = TaskType.homework,
  required DateTime due,
  int minutes = 30,
  int difficulty = 2,
  bool locked = false,
  List<TaskStep>? steps,
}) =>
    Task(
      id: 't${_n++}',
      subject: subject,
      title: title,
      type: type,
      due: due,
      estMinutes: minutes,
      difficulty: difficulty,
      locked: locked,
      steps: steps,
    );
