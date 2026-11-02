/// The phone-hardware side of input: camera + on-device text recognition,
/// and on-device speech recognition.
///
/// Both run on the phone only (plan §4). Text recognition uses Google ML Kit's
/// bundled model, which reads images without uploading them. Speech asks the
/// operating system for on-device recognition and fails rather than falling
/// back to a cloud service — a student's voice leaving the phone is a bigger
/// problem than having to type.
library;

import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Camera and ML Kit exist only in the Android and iOS builds; the web build
/// (used for quick previews) hides those buttons.
bool get hasCameraOcr =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS);

class PhotoResult {
  PhotoResult(this.text, this.imagePath);
  final String text;

  /// Null once the photo has been deleted after reading.
  final String? imagePath;
}

class PhotoCapture {
  final _picker = ImagePicker();

  /// Returns null if the student cancelled.
  Future<PhotoResult?> captureAndRead(
      {required bool fromCamera, required bool deleteAfter}) async {
    final file = await _picker.pickImage(
      source: fromCamera ? ImageSource.camera : ImageSource.gallery,
      // Smaller images read just as well and take less space on the phone.
      maxWidth: 2000,
      imageQuality: 85,
    );
    if (file == null) return null;

    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      final result =
          await recognizer.processImage(InputImage.fromFilePath(file.path));
      // ML Kit returns blocks in reading order; one line per task is what
      // the parser expects, so keep its line breaks.
      final text = result.blocks.map((b) => b.text).join('\n');
      if (deleteAfter) {
        try {
          await File(file.path).delete();
        } catch (_) {}
        return PhotoResult(text, null);
      }
      return PhotoResult(text, file.path);
    } finally {
      await recognizer.close();
    }
  }
}

class VoiceCapture {
  final SpeechToText _speech = SpeechToText();
  bool _ready = false;

  Future<String?> init({required void Function(String) onError}) async {
    _ready = await _speech.initialize(
      onError: (e) => onError(e.errorMsg),
    );
    if (!_ready) {
      return 'Speech recognition is not available on this phone, or the '
          'microphone permission was refused.';
    }
    return null;
  }

  Future<void> start(void Function(String text, bool isFinal) onText) async {
    if (!_ready) return;
    await _speech.listen(
      onResult: (r) => onText(r.recognizedWords, r.finalResult),
      listenOptions: SpeechListenOptions(
        onDevice: true,
        partialResults: true,
        cancelOnError: true,
        listenMode: ListenMode.dictation,
        autoPunctuation: true,
        listenFor: const Duration(minutes: 2),
        pauseFor: const Duration(seconds: 5),
      ),
    );
  }

  Future<void> stop() => _speech.stop();

  bool get isListening => _speech.isListening;
}
