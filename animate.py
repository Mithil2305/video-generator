#!/usr/bin/env python3
"""End-to-End Universal Animated Video Generator CLI.

Executes the complete production lifecycle:
1. Creative Brief & AI Planning (director.py)
2. Audio & Timing Preparation (audio.py / vo.py)
3. Headless Chrome Frame-by-Frame Rendering (render.mjs)
4. Multi-Stream Audio Muxing (audio.py mix)
5. Quality Validation (validator.py)

Usage:
  python animate.py "A lonely robot discovering a garden on Mars" --dur 30 --style cinematic
  python animate.py "How quantum computers work" --category educational --style whiteboard
  python animate.py "Cryptocurrency market shift" --category specialized --style motion_graphics
"""
import argparse, json, os, shutil, subprocess, sys, time
from typing import Optional, Dict, Any

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SKILL_ROOT = os.path.dirname(os.path.abspath(__file__))
from director import create_project, CATEGORIES, STYLES, FORMATS, AUDIO_MOODS, REGISTRY, ENV
from validator import validate_project_video


def run_process(cmd: list, cwd: Optional[str] = None, timeout: int = 180) -> bool:
    print(f"  > {' '.join(cmd)}")
    try:
        p = subprocess.run(cmd, cwd=cwd or SKILL_ROOT, timeout=timeout)
        return p.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"  ✗ Process timed out after {timeout}s: {' '.join(cmd)}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ✗ Process execution error: {e}", file=sys.stderr)
        return False


def run_doctor() -> bool:
    """Performs environment and dependency health checks (PK-05, Cross-cutting)."""
    print("\n" + "=" * 60)
    print("🩺 Video Generator Doctor: System & Dependency Check")
    print("=" * 60)
    all_ok = True

    # 1. Python version
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    py_ok = sys.version_info >= (3, 9)
    print(f"  [{'PASS' if py_ok else 'FAIL'}] Python version: {py_ver} (>= 3.9 required)")
    all_ok = all_ok and py_ok

    # 2. Node.js
    node_ok = False
    try:
        p = subprocess.run(["node", "-v"], capture_output=True, text=True, timeout=10)
        if p.returncode == 0:
            print(f"  [PASS] Node.js: {p.stdout.strip()}")
            node_ok = True
    except Exception:
        pass
    if not node_ok:
        print("  [FAIL] Node.js: not found in PATH")
        all_ok = False

    # 3. FFmpeg and FFprobe
    for tool in ("ffmpeg", "ffprobe"):
        tool_ok = False
        try:
            p = subprocess.run([tool, "-version"], capture_output=True, text=True, timeout=10)
            if p.returncode == 0:
                ver_line = p.stdout.splitlines()[0] if p.stdout else tool
                print(f"  [PASS] {tool}: {ver_line[:50]}")
                tool_ok = True
        except Exception:
            pass
        if not tool_ok:
            print(f"  [FAIL] {tool}: not found in PATH")
            all_ok = False

    # 4. Chrome / Chromium Detection
    chrome_candidates = [
        os.environ.get("CHROME"),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe") if os.environ.get("LOCALAPPDATA") else None,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium"
    ]
    chrome_found = next((c for c in chrome_candidates if c and os.path.exists(c)), None)
    if chrome_found:
        print(f"  [PASS] Chrome executable: {chrome_found}")
    else:
        print("  [FAIL] Chrome executable: not found. Set CHROME or run `npx playwright install chromium`")
        all_ok = False

    # 5. Core Python Libraries
    for pkg in ("numpy", "scipy", "requests"):
        try:
            __import__(pkg)
            print(f"  [PASS] Python package '{pkg}': installed")
        except ImportError:
            print(f"  [FAIL] Python package '{pkg}': missing (pip install -r requirements.txt)")
            all_ok = False

    # 6. Optional Whisper
    try:
        __import__("faster_whisper")
        print("  [PASS] Optional 'faster-whisper': installed (exact word timing available)")
    except ImportError:
        print("  [WARN] Optional 'faster-whisper': not installed (estimates used unless installed)")

    # 7. Registry check
    reg_ok = bool(REGISTRY.get("scene_types") and REGISTRY.get("motion_templates"))
    print(f"  [{'PASS' if reg_ok else 'FAIL'}] Registry schema: {len(REGISTRY.get('scene_types', []))} scene types, {len(REGISTRY.get('motion_templates', []))} motion templates")
    all_ok = all_ok and reg_ok

    print("=" * 60)
    print(f"Doctor status: {'SYSTEM HEALTHY' if all_ok else 'ATTENTION REQUIRED'}\n")
    return all_ok


def ensure_voiceover(proj_dir: str, plan: dict, options: dict) -> bool:
    """PL-01: Generates voice-over and timeline for plans with spoken narration."""
    if options.get("no_vo"):
        print("  ✓ Voice-over explicitly disabled (--no-vo).")
        return True

    has_vo = any(s.get("vo") for s in plan.get("scenes", []))
    if not has_vo:
        return True

    # Check for timeline.json
    tl_path = os.path.join(proj_dir, "timeline.json")
    if os.path.exists(tl_path) and not options.get("force_vo"):
        return True

    provider = options.get("vo_provider") or os.environ.get("VO_PROVIDER") or ENV.get("VO_PROVIDER")
    if not provider:
        if ENV.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVENLABS_API_KEY"):
            provider = "eleven"
        elif ENV.get("FISH_API_KEY") or os.environ.get("FISH_API_KEY"):
            provider = "fish"
        elif sys.platform == "darwin":
            provider = "say"

    if not provider:
        if options.get("estimate_timing"):
            print("  Note: No voice-over provider configured. Using estimated word timing (--estimate-timing).")
            return True
        print(
            "  ✗ Error: Plan scenes contain voice narration, but no voice provider is configured.\n"
            "    Provide an API key (ELEVENLABS_API_KEY or FISH_API_KEY) in .env, set VO_PROVIDER=eleven|fish|say,\n"
            "    use --estimate-timing to allow estimated timing, or pass --no-vo for a silent video.",
            file=sys.stderr
        )
        return False

    vo_script = os.path.join(SKILL_ROOT, "vo.py")
    provider_cmd = [sys.executable, vo_script, provider, proj_dir]

    if provider == "eleven":
        provider_cmd += ["--voice", options.get("voice", "21m00Tcm4TlvDq8ikWAM")]
        if options.get("allow_estimated_timing") or options.get("estimate_timing"):
            provider_cmd.append("--allow-estimated-timing")
    elif provider == "fish":
        provider_cmd += ["--voice", options.get("voice", "default")]

    print(f"  Generating voice-over clips with provider '{provider}'...")
    if not run_process(provider_cmd, timeout=180):
        return False

    build_cmd = [sys.executable, vo_script, "build", proj_dir]
    if options.get("allow_estimated_timing") or options.get("estimate_timing"):
        build_cmd.append("--allow-estimated-timing")

    print("  Aligning spoken word timing and creating timeline.json...")
    if not run_process(build_cmd, timeout=120):
        return False

    if not os.path.exists(tl_path):
        print("  ✗ Error: voice-over expected but timeline.json was not produced.", file=sys.stderr)
        return False

    print("  ✓ Voice-over clips and timeline ready.")
    return True


def generate_animated_video(prompt: str, options: dict) -> dict:
    t_start = time.time()
    print("\n" + "=" * 70)
    print("🎬 UNIVERSAL ANIMATED VIDEO GENERATOR")
    print("=" * 70)
    print(f"Prompt: \"{prompt}\"")
    print(f"Options: {json.dumps(options, indent=2)}\n")

    # Step 1: AI Creative Direction & Storyboarding
    print("[1/4] Planning Scene Storyboard...")
    plan_res = create_project(prompt, options)
    proj_dir = plan_res["project_dir"]
    plan = plan_res["plan"]
    name = plan["name"]
    print(f"  ✓ Storyboard planned: {len(plan['scenes'])} scenes in {proj_dir}")
    print(f"    Category: {plan.get('category')} | Style: {plan.get('style')} | Format: {plan.get('format')}")
    print(f"    Planner: {plan.get('planner')} | Quality: {plan.get('quality', 'draft')}")

    # Step 2: Audio Synthesis & Bed Pre-generation & Voice-Over (PL-01)
    print("\n[2/4] Preparing Audio, Voice-Over & Sound Design...")
    # Build SFX kit if missing/outdated (PL-06)
    run_process([sys.executable, os.path.join(SKILL_ROOT, "audio.py"), "sfx"], timeout=60)

    # PL-01: Ensure voice-over is generated if scenes require narration
    vo_ok = ensure_voiceover(proj_dir, plan, options)
    if not vo_ok:
        return {"success": False, "error": "Voice-over generation failed", "project": proj_dir}
    print("  ✓ Audio sound effects, voice-over, and music bed ready.")

    # Step 3: Frame-by-Frame Rendering with Headless Chrome & FFmpeg
    print("\n[3/4] Rendering Animation Frames (Playwright + FFmpeg)...")
    render_script = os.path.join(SKILL_ROOT, "engine", "render.mjs")
    render_args = ["node", render_script, proj_dir]
    if options.get("draft"):
        render_args.append("--draft")
    if options.get("estimate_timing"):
        render_args.append("--estimate-timing")

    render_ok = run_process(render_args, timeout=300)
    if not render_ok:
        print("  ✗ Rendering encountered an error.", file=sys.stderr)
        return {"success": False, "error": "Render process failed", "project": proj_dir}

    # Step 4: Quality Validation (VA-01, VA-02)
    print("\n[4/4] Validating Video Quality & Stream Integrity...")
    val_report = validate_project_video(proj_dir)
    is_valid = val_report.get("valid", False)

    elapsed = time.time() - t_start
    print("\n" + "=" * 70)
    if is_valid:
        print(f"🎉 SUCCESS: Video Rendered & Validated in {elapsed:.1f}s!")
        print(f"📁 Video File: {val_report.get('video_path')}")
        print(f"📊 Specs: {val_report.get('resolution')} | {val_report.get('duration')}s | {val_report.get('file_size_mb')} MB")
    else:
        print(f"❌ VALIDATION FAILED in {elapsed:.1f}s.")
        print(f"📁 Video File: {val_report.get('video_path')}")
        for c in val_report.get("checks", []):
            if c.get("status") == "FAIL":
                print(f"  [FAIL] {c.get('name')}: {c.get('message', '')} {c.get('expected', '')}")
    print("=" * 70 + "\n")

    return {
        "success": is_valid,
        "project": proj_dir,
        "plan": plan,
        "video": val_report.get("video_path"),
        "validation": val_report,
        "elapsed_seconds": round(elapsed, 1)
    }


def main():
    parser = argparse.ArgumentParser(description="Generate any animated video from prompt")
    parser.add_argument("prompt", nargs="?", default="", help="Text prompt, concept, or script")
    parser.add_argument("--category", choices=CATEGORIES, help="Video category")
    parser.add_argument("--style", choices=STYLES, help="Visual style preset")
    # DR-01: default is None
    parser.add_argument("--format", choices=FORMATS, default=None, help="Aspect ratio (defaults to 9:16 for social, 16:9 otherwise)")
    parser.add_argument("--duration", type=float, default=30.0, help="Target duration in seconds")
    parser.add_argument("--mood", choices=AUDIO_MOODS, help="Audio music mood")
    parser.add_argument("--draft", action="store_true", help="Render draft preview (half size, faster)")
    # PL-01: Voice-over options
    parser.add_argument("--no-vo", action="store_true", help="Disable voice-over (make silent or music-only video)")
    parser.add_argument("--vo-provider", choices=["eleven", "fish", "say"], help="Voice-over provider")
    parser.add_argument("--voice", help="Voice ID or name")
    parser.add_argument("--estimate-timing", action="store_true", help="Allow estimated timing fallback without failing")
    parser.add_argument("--allow-estimated-timing", action="store_true", help="Allow estimated timing during vo build")
    # PL-05: Validation options
    parser.add_argument("--allow-warnings", action="store_true", help="Treat non-fatal validation warnings as success")
    parser.add_argument("--force", action="store_true", help="Overwrite existing project folder")
    # Assets option
    parser.add_argument("--assets", help="Path to assets folder or asset group name (e.g. assets/yukti-assets)")
    # Health checks
    parser.add_argument("--doctor", action="store_true", help="Run system and dependency health checks")

    args = parser.parse_args()

    if args.doctor:
        ok = run_doctor()
        sys.exit(0 if ok else 1)

    if not args.prompt:
        parser.print_help()
        sys.exit(1)

    options = {
        "category": args.category,
        "style": args.style,
        "format": args.format,
        "duration": args.duration,
        "mood": args.mood,
        "draft": args.draft,
        "no_vo": args.no_vo,
        "vo_provider": args.vo_provider,
        "voice": args.voice,
        "estimate_timing": args.estimate_timing,
        "allow_estimated_timing": args.allow_estimated_timing,
        "force": args.force,
        "assets": args.assets,
    }
    res = generate_animated_video(args.prompt, options)

    # PL-05: Exit non-zero when validation fails
    if not res.get("success"):
        if not args.allow_warnings:
            sys.exit(1)


if __name__ == "__main__":
    main()
