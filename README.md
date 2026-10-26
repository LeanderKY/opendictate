# OpenDictate

**Hold a key. Speak. Clean text appears in any app.**
Free, open source, and 100 % local. No account, no subscription, no audio leaves your PC.

▶ **[Watch the 40-second intro](https://github.com/LeanderKY/opendictate/releases/download/v1.0/opendictate-intro.mp4)** · [Download v1.0](https://github.com/LeanderKY/opendictate/releases/tag/v1.0)

OpenDictate is a voice-dictation tool for Windows in the spirit of Wispr Flow and Superwhisper. It uses Whisper for speech recognition and a small local language model to turn how you *speak* into how you'd *write*: filler words go, self-corrections resolve, lists become lists.

> „Ich treff mich morgen, nein, übermorgen mit Anna“ → **„Ich treffe mich übermorgen mit Anna.“**
> „yo what's up, yo what's up in the hood“ → **„Yo, what's up in the hood?“**

## Why

| | OpenDictate | Typical cloud dictation apps |
|---|---|---|
| Price | Free forever | Monthly subscription |
| Where your voice goes | Nowhere. Runs on your GPU | Their servers |
| Works offline | Yes | No |
| You can teach it your style | Yes, with plain rules and examples | Limited |
| Source code | MIT licensed, read every line | Closed |
| Platforms | Windows (for now) | Usually Mac, Windows, mobile |

Cloud apps are more polished and run on more platforms. OpenDictate is for people who'd rather own their tools.

## Speed

Measured on an RTX 4070 (12 GB), time from releasing the key to text:

| What you said | Time |
|---|---|
| A clean sentence (fast path, no LLM needed) | **~0.2 s** |
| 10 s of messy speech with a correction and a list | **~0.8 s** |

The fast path skips the language model entirely when the transcript has no filler words, corrections, repetitions or lists. Only messy speech pays for cleanup.

## Features

- **Push to talk** with any key or combo (default: right Ctrl). A small bar at the bottom of the screen shows your level while recording and never steals focus.
- **Cleanup you control.** Self-corrections: keep only the final version, or keep everything. Filler words on/off. Lists on/off.
- **Teach it.** Write rules in plain language („Wenn ich ‚neuer Absatz' sage, mach einen Zeilenumbruch“). Or fix any past dictation in *History → Teach*; it becomes an example the model follows from then on.
- **Per-app style.** Casual in Discord, proper in Outlook, exact code terms in VS Code.
- **Dictionary** for names and jargon Whisper would otherwise misspell.
- **Guided setup.** Detects your GPU, picks models that fit, starts Ollama, downloads the model with a progress bar, tests your mic and your key. Every step is skippable.

## Install

**You need:** Windows 10/11, [Python 3.11+](https://www.python.org/downloads/) (tick *Add python.exe to PATH*), and for cleanup [Ollama](https://ollama.com/download). An NVIDIA GPU is strongly recommended; it works on CPU, just slower.

1. Download this repo (*Code → Download ZIP*) and unzip it.
2. Double-click **`start.bat`**. The first start installs everything into `%LOCALAPPDATA%\OpenDictate` (a few minutes, ~1.5 GB).
3. The setup window opens and walks you through the rest.

Keep the console window open; closing it quits OpenDictate. Running `start.bat` again while it's running just reopens the window.

## How it works

```
key down → record mic → key up
  → faster-whisper large-v3-turbo (GPU)          ~0.2–0.3 s
  → clean already?  ── yes ──────────────────────────────┐
        │ no                                             │
        → local LLM via Ollama (qwen3:8b by default)  ~0.5 s
  → paste into the active window  ←─────────────────────┘
```

For each cleanup the model gets: fixed ground rules (only clean, never answer, never invent), your behaviour settings with matching examples, your own rules, your own examples (last, so they weigh the most), then the transcript. Static parts come first so Ollama reuses its prompt cache between dictations.

Default models by GPU memory: ≥10 GB `qwen3:8b`, ≥6 GB `gemma3:4b`, less `gemma3:1b`. Change them anytime in Settings.

## Privacy

Audio is recorded only while you hold the key, kept in memory, and discarded after transcription. Settings, examples and history live in `data/` next to the app. The UI is served on `127.0.0.1` only and protected by a random per-session token. The only network traffic is the one-time model download.

## Files

| Path | What |
|---|---|
| `start.bat` | Installer and launcher |
| `app.py` | Local server for the UI, recording bar, startup |
| `engine.py` | Recording, transcription, cleanup, pasting |
| `ui/` | Interface (plain HTML/CSS/JS, no build step) |
| `data/` | Your settings, examples and history (git-ignored) |

For development: `OPENDICTATE_DATA`, `OPENDICTATE_PORT` and `OPENDICTATE_NO_HOTKEY=1` let you run a second instance without touching your own data.

## Roadmap

- English UI (currently German)
- macOS support
- Streaming transcription while you speak
- Tray icon instead of a console window

## License

MIT. Use it, fork it, ship it.
