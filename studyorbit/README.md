# StudyOrbit

A phone app for high-school students: put in today's homework by **photo,
voice or typing**, check what the app understood, and get an evening plan from
**4:00 to 9:00 PM** with study blocks, breaks, dinner and free time.

Built from the StudyOrbit business plan (精简版). This folder is a
self-contained Flutter app and shares nothing with the Lacuna web app around it.

## What is in this first version

| Plan feature | Where |
| --- | --- |
| Photo input (board, worksheet, screenshot) | `lib/services/capture.dart` — Google ML Kit, on the phone |
| Voice input | `lib/services/capture.dart` — on-device speech only |
| Text input, task recognition | `lib/logic/task_parser.dart` |
| Confirm / fix before saving | `lib/ui/draft_review_screen.dart` — guesses outlined in red |
| Priority (deadline, weak subjects, difficulty, time, tomorrow's classes) | `lib/logic/prioritizer.dart` |
| 4:00–9:00 evening plan, re-plans from "now" | `lib/logic/planner.dart` |
| Task splitting | `lib/logic/task_splitter.dart` |
| Preview for tomorrow / review of today | from the class timetable in Settings |
| Study timer, break reminders | `lib/ui/focus_screen.dart` |
| Calendar, history | `lib/ui/calendar_screen.dart`, `lib/ui/history_screen.dart` |
| Privacy: delete photos, transcripts, history, everything | Settings → Privacy |

All data is stored on the phone (`lib/data/app_state.dart`). There is no
server and no account yet.

**Not built yet:** the large-language-model understanding mentioned in the plan
(today the reading is rule-based, see the comment at the top of
`task_parser.dart`), notifications while the app is closed, encrypted backup,
subscriptions, and family/parent accounts.

## Running it

You need the Flutter SDK (3.47 or newer).

```bash
flutter pub get
flutter test             # 39 tests for the parser, priorities, planner and app
flutter run              # on a connected phone or simulator
flutter run -d chrome    # quick look in a browser (no camera or voice there)
```

iOS needs a Mac with Xcode; the minimum iOS version is 15.5 because of ML Kit.
