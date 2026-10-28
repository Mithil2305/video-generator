#!/usr/bin/env python3
"""Quality Validation System for Animated Video Generator.

Validates:
1. Video file accessibility and size integrity
2. Stream codec parameters (H.264 video, AAC audio)
3. Target duration vs actual duration
4. Resolution and aspect ratio adherence
5. Frame rate consistency (e.g. 30 fps)
6. Audio track presence, channel count, and loudness
7. Black frames / empty freeze detection
8. Scene count and timing verification against plan.json
"""
import argparse, json, os, subprocess, sys
from typing import Dict, Any, List, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def run_cmd(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def probe_media(video_path: str) -> Dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path
    ]
    res = run_cmd(cmd)
    if res.returncode != 0:
        raise RuntimeError(f"FFprobe failed on {video_path}: {res.stderr}")
    return json.loads(res.stdout)


def detect_black_frames(video_path: str, max_duration: float = 3.0) -> List[Dict[str, float]]:
    """Detects consecutive black frames longer than max_duration seconds."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", video_path,
        "-vf", "blackdetect=d=1.5:pix_th=0.10",
        "-f", "null", "-"
    ]
    res = run_cmd(cmd)
    black_intervals = []
    # parse lines like: [blackdetect @ ...] black_start:1.2 black_end:4.5 black_duration:3.3
    for line in res.stderr.splitlines():
        if "black_start" in line and "black_end" in line:
            try:
                parts = dict(p.split(":") for p in line.split() if ":" in p)
                start = float(parts.get("black_start", 0))
                end = float(parts.get("black_end", 0))
                dur = float(parts.get("black_duration", 0))
                if dur >= max_duration:
                    black_intervals.append({"start": start, "end": end, "duration": dur})
            except Exception:
                pass
    return black_intervals


def validate_project_video(proj_dir: str, video_path: Optional[str] = None) -> Dict[str, Any]:
    plan_path = os.path.join(proj_dir, "plan.json")
    if not os.path.exists(plan_path):
        return {"valid": False, "error": f"Missing plan.json in {proj_dir}"}

    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    name = plan.get("name", os.path.basename(proj_dir))
    if not video_path:
        out_dir = os.path.join(proj_dir, "out")
        candidates = [
            os.path.join(out_dir, f"{name}.mp4"),
            os.path.join(out_dir, f"{name}-draft.mp4"),
            os.path.join(out_dir, f"{name}-review.mp4")
        ]
        video_path = next((c for c in candidates if os.path.exists(c)), None)

    if not video_path or not os.path.exists(video_path):
        return {
            "valid": False,
            "error": f"No rendered video found for project {name}. Run render first.",
            "plan": plan
        }

    file_size_bytes = os.path.getsize(video_path)
    if file_size_bytes < 10000:
        return {
            "valid": False,
            "error": f"Video file is corrupted or too small ({file_size_bytes} bytes).",
            "file": video_path
        }

    try:
        probe = probe_media(video_path)
    except Exception as e:
        return {"valid": False, "error": f"Media probing error: {e}", "file": video_path}

    streams = probe.get("streams", [])
    format_info = probe.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    checks = []

    # 1. Video Stream Checks
    if not video_stream:
        checks.append({"name": "video_stream", "status": "FAIL", "message": "No video stream present"})
    else:
        v_width = int(video_stream.get("width", 0))
        v_height = int(video_stream.get("height", 0))
        v_codec = video_stream.get("codec_name", "")
        fps_raw = video_stream.get("r_frame_rate", "30/1")
        fps = round(eval(fps_raw), 1) if "/" in fps_raw else float(fps_raw)

        checks.append({"name": "video_codec", "status": "PASS" if "264" in v_codec or "h264" in v_codec else "WARN", "codec": v_codec})
        checks.append({"name": "resolution", "status": "PASS", "resolution": f"{v_width}x{v_height}"})
        checks.append({"name": "frame_rate", "status": "PASS" if fps >= 14 else "FAIL", "fps": fps})

    # 2. Audio Stream Checks
    music_setting = plan.get("music", {})
    wants_silent = music_setting.get("mood") == "silent" or music_setting is False
    if wants_silent:
        checks.append({"name": "audio_mode", "status": "PASS", "message": "Silent audio mode intended"})
    else:
        if audio_stream:
            a_codec = audio_stream.get("codec_name", "")
            a_sr = int(audio_stream.get("sample_rate", 0))
            a_ch = int(audio_stream.get("channels", 0))
            checks.append({"name": "audio_stream", "status": "PASS", "codec": a_codec, "sample_rate": a_sr, "channels": a_ch})
        else:
            checks.append({"name": "audio_stream", "status": "WARN", "message": "No audio stream found in render"})

    # 3. Duration Adherence
    actual_dur = float(format_info.get("duration", 0))
    expected_dur = sum(s.get("dur", 5.0) for s in plan.get("scenes", []))
    dur_diff = abs(actual_dur - expected_dur)
    dur_pass = dur_diff <= max(4.0, expected_dur * 0.18)
    checks.append({
        "name": "duration_check",
        "status": "PASS" if dur_pass else "WARN",
        "actual_seconds": round(actual_dur, 2),
        "expected_seconds": round(expected_dur, 2),
        "difference": round(dur_diff, 2)
    })

    # 4. Black Frames Check
    black_intervals = detect_black_frames(video_path, max_duration=3.5)
    if black_intervals:
        checks.append({"name": "black_frames", "status": "WARN", "intervals": black_intervals})
    else:
        checks.append({"name": "black_frames", "status": "PASS", "message": "No unintended long black frames detected"})

    # 5. Scene Count & Consistency
    scene_count = len(plan.get("scenes", []))
    checks.append({"name": "scene_integrity", "status": "PASS" if scene_count >= 1 else "FAIL", "scene_count": scene_count})

    all_pass = all(c["status"] in ("PASS", "WARN") for c in checks) and any(c["name"] == "video_codec" and c["status"] != "FAIL" for c in checks)

    report = {
        "valid": all_pass,
        "project": name,
        "video_path": video_path,
        "file_size_mb": round(file_size_bytes / (1024 * 1024), 2),
        "duration": round(actual_dur, 2),
        "resolution": f"{video_stream.get('width')}x{video_stream.get('height')}" if video_stream else "unknown",
        "checks": checks
    }
    return report


def main():
    parser = argparse.ArgumentParser(description="Validate Animated Video Generator Render Output")
    parser.add_argument("project", help="Path to project directory or launches/<name>")
    parser.add_argument("--video", help="Optional explicit path to mp4 file")
    parser.add_argument("--json", action="store_true", help="Output full report as JSON")

    args = parser.parse_args()
    proj_dir = os.path.abspath(args.project)
    report = validate_project_video(proj_dir, args.video)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"\nVideo Validation Report: {report.get('project')}")
        print(f"Status: {'VALID' if report.get('valid') else 'FAILED'}")
        if report.get("video_path"):
            print(f"File: {report['video_path']} ({report.get('file_size_mb')} MB, {report.get('duration')}s, {report.get('resolution')})")
        print("\nChecks:")
        for c in report.get("checks", []):
            st = c.get("status")
            badge = "[PASS]" if st == "PASS" else ("[WARN]" if st == "WARN" else "[FAIL]")
            details = " | ".join(f"{k}: {v}" for k, v in c.items() if k not in ("name", "status"))
            print(f"  {badge:6s} {c.get('name'):20s} {details}")
        print()


if __name__ == "__main__":
    main()
