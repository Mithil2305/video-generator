# launch-video, a Claude Code skill

Makes kinetic-type product launch videos in code: words land on the voiceover, keyword pills, counters, a glowing
logo reveal, product UI with camera moves, cursor clicks and notification toasts. You record the voiceover yourself
(or use Fish Audio / ElevenLabs), and it renders an MP4 in about 20 seconds.

## Install

1. Put this `launch-video` folder in `~/.claude/skills/` (every project) or `<your project>/.claude/skills/` (one project).
2. Install the renderer and the Python bits once:
   ```bash
   cd ~/.claude/skills/launch-video/engine && npm install
   pip3 install numpy scipy requests sounddevice faster-whisper
   ```
   Needs Google Chrome and ffmpeg (`brew install ffmpeg`).
3. Optional keys go in `launch-video/.env` (copy `.env.example`): Fish Audio, ElevenLabs, Auphonic.
4. In Claude Code, say: "make a launch video for my product" (or run `/launch-video`).

The example in `examples/launch-skill` is the video that announced this skill.
