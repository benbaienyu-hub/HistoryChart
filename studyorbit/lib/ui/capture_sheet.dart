import 'package:flutter/material.dart';

import '../logic/task_parser.dart';
import '../models/task.dart';
import '../services/capture.dart';
import 'app_scope.dart';
import 'draft_review_screen.dart';

/// The three ways in (plan §2): photo, voice, typing. Each produces text,
/// the text becomes drafts, and the drafts always go through the review
/// screen — nothing is saved until the student has looked at it.
Future<void> showCaptureSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hasCameraOcr) ...[
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              subtitle: const Text('Board, worksheet, or class website'),
              onTap: () {
                Navigator.pop(sheet);
                _fromPhoto(context, fromCamera: true);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose a photo or screenshot'),
              onTap: () {
                Navigator.pop(sheet);
                _fromPhoto(context, fromCamera: false);
              },
            ),
          ],
          ListTile(
            leading: const Icon(Icons.mic_none),
            title: const Text('Say it'),
            subtitle: const Text('"Math page 45 due tomorrow, 30 minutes"'),
            onTap: () {
              Navigator.pop(sheet);
              _fromVoice(context);
            },
          ),
          ListTile(
            leading: const Icon(Icons.keyboard_outlined),
            title: const Text('Type it'),
            subtitle: const Text('One task per line'),
            onTap: () {
              Navigator.pop(sheet);
              _fromText(context);
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

void _review(BuildContext context, String text, TaskSource source,
    {String? imagePath}) {
  final state = AppScope.read(context);
  final drafts = parseTasks(text, now: state.clock(), source: source);
  if (imagePath != null) {
    for (final d in drafts) {
      d.task.sourceImagePath = imagePath;
    }
  }
  Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => DraftReviewScreen(
        drafts: drafts, sourceText: text, imagePath: imagePath, source: source),
  ));
}

Future<void> _fromPhoto(BuildContext context, {required bool fromCamera}) async {
  final state = AppScope.read(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    final result = await PhotoCapture().captureAndRead(
        fromCamera: fromCamera,
        deleteAfter: state.settings.deleteImagesAfterRecognition);
    if (result == null || !context.mounted) return;
    if (result.text.trim().isEmpty) {
      messenger.showSnackBar(const SnackBar(
          content: Text("Couldn't find any text. Try a closer, sharper photo.")));
      return;
    }
    _review(context, result.text, TaskSource.photo, imagePath: result.imagePath);
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Photo reading failed: $e')));
  }
}

Future<void> _fromText(BuildContext context) async {
  final controller = TextEditingController();
  final text = await showDialog<String>(
    context: context,
    builder: (d) => AlertDialog(
      title: const Text('Type your tasks'),
      content: TextField(
        controller: controller,
        autofocus: true,
        minLines: 4,
        maxLines: 10,
        decoration: const InputDecoration(
          hintText: 'Math p.45 #1-20 due tomorrow 30 min\n'
              'Bio test Friday\n'
              'History essay due 11/14, 2 hours',
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        FilledButton(
            onPressed: () => Navigator.pop(d, controller.text),
            child: const Text('Next')),
      ],
    ),
  );
  if (text == null || text.trim().isEmpty || !context.mounted) return;
  _review(context, text, TaskSource.text);
}

Future<void> _fromVoice(BuildContext context) async {
  final text = await showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const _VoiceDialog(),
  );
  if (text == null || text.trim().isEmpty || !context.mounted) return;
  _review(context, text, TaskSource.voice);
}

class _VoiceDialog extends StatefulWidget {
  const _VoiceDialog();

  @override
  State<_VoiceDialog> createState() => _VoiceDialogState();
}

class _VoiceDialogState extends State<_VoiceDialog> {
  final _voice = VoiceCapture();
  final _controller = TextEditingController();
  String? _error;
  bool _listening = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final err = await _voice.init(onError: (msg) {
      if (!mounted) return;
      setState(() {
        _listening = false;
        _error = msg.contains('language') || msg.contains('network')
            ? 'On-device speech recognition is not set up on this phone. '
                'StudyOrbit does not send your voice online, so please type '
                'instead — or install the offline speech pack in your phone '
                'settings.'
            : 'Speech stopped ($msg). You can edit the text below.';
      });
    });
    if (!mounted) return;
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() => _listening = true);
    await _voice.start((words, isFinal) {
      if (!mounted) return;
      setState(() {
        _controller.text = words;
        if (isFinal) _listening = false;
      });
    });
  }

  @override
  void dispose() {
    _voice.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(children: [
        Icon(_listening ? Icons.mic : Icons.mic_none,
            color: _listening ? Theme.of(context).colorScheme.error : null),
        const SizedBox(width: 8),
        Text(_listening ? 'Listening…' : 'Check what you said'),
      ]),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Say each task with its subject, due date and how long '
              'it takes. Say "and then" between tasks.'),
          const SizedBox(height: 12),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          // The transcript is editable: speech recognition makes mistakes,
          // and fixing a word here is easier than re-recording (plan §14).
          TextField(controller: _controller, minLines: 3, maxLines: 8),
        ],
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        if (!_listening)
          TextButton(
              onPressed: () {
                setState(() => _error = null);
                _start();
              },
              child: const Text('Record again')),
        FilledButton(
          onPressed: () async {
            await _voice.stop();
            if (context.mounted) Navigator.pop(context, _controller.text);
          },
          child: const Text('Next'),
        ),
      ],
    );
  }
}
