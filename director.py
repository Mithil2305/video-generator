#!/usr/bin/env python3
"""Universal AI Creative Director: transforms text prompts into structured multi-scene animated video plans.

Supports all major animation categories:
- Storytelling & Entertainment (Sci-fi, fantasy, character drama, anime, cartoons)
- Educational & Explainer (Science, lessons, tutorials, whiteboard, concepts)
- Business & Marketing (Product launches, SaaS demos, campaigns)
- Cinematic & Creative (Visual poetry, surrealism, sci-fi sequences, music visualizers)
- Social Media (TikTok, Reels, Shorts, kinetic typography)
- Specialized & Professional (Data-driven charts, technical diagrams, architecture)

Integrations:
- Groq (llama-3.3-70b-versatile or custom GROQ_MODEL, ultra-fast)
- Anthropic Claude (claude-3-5-sonnet-20241022 or custom ANTHROPIC_MODEL)
- Local Intelligent Heuristic Director (deterministic offline fallback)
"""
import argparse, hashlib, json, logging, os, re, shutil, sys, urllib.request, urllib.error
from typing import Dict, Any, List, Optional, Tuple

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("director")

SKILL_ROOT = os.path.dirname(os.path.abspath(__file__))


def load_registry() -> Dict[str, Any]:
    reg_path = os.path.join(SKILL_ROOT, "engine", "registry.json")
    if os.path.exists(reg_path):
        try:
            with open(reg_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning(f"Could not read registry.json: {e}")
    return {
        "scene_types": ["story", "motion", "cinematic", "whiteboard", "kinetic", "text", "hero", "logo", "ui", "cards", "terminal", "chips"],
        "motion_templates": ["16-line-growth", "10-candlestick", "13-compare-bars"],
        "formats": {"16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350]},
        "sfx": ["whoosh", "swish", "riser", "boom", "pop", "click", "ding", "ping", "key1", "key2", "key3", "enter", "sparkle", "laser", "impact", "glitch", "shimmer"]
    }


REGISTRY = load_registry()


def load_env() -> Dict[str, str]:
    env = dict(os.environ)
    for search_dir in (SKILL_ROOT, os.getcwd()):
        p = os.path.join(search_dir, ".env")
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip("'\"")
    return env


ENV = load_env()

CATEGORIES = [
    "storytelling",
    "educational",
    "business",
    "cinematic",
    "social",
    "specialized",
]

STYLES = [
    "cinematic",
    "anime",
    "cartoon",
    "motion_graphics",
    "cyberpunk",
    "fantasy",
    "whiteboard",
    "minimalist",
    "documentary",
    "custom",
]

FORMATS = list(REGISTRY.get("formats", {}).keys()) or ["16:9", "9:16", "1:1", "4:5"]
AUDIO_MOODS = [
    "cinematic",
    "ambient",
    "synthwave",
    "playful",
    "lofi",
    "suspense",
    "corporate",
    "silent",
]


def has_word(text: str, words: List[str]) -> bool:
    """Matches whole words only, case-insensitively."""
    return any(re.search(rf"\b{re.escape(w)}\b", text, re.IGNORECASE) for w in words)


def derive_topic(prompt: str) -> str:
    """Derives a clean topic phrase without conversational prefixes."""
    cleaned = prompt.strip()
    cleaned = re.sub(
        r"^(explain how|explain|how to|teach me about|a video about|create a video about|tell a story about|show me how|understand)\s+",
        "", cleaned, flags=re.IGNORECASE
    )
    cleaned = cleaned.rstrip(".?! ")
    return cleaned if cleaned else prompt.strip()


def safe_truncate_title(text: str, max_chars: int = 40) -> str:
    """Truncates text at word boundaries to avoid mid-word truncation."""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    last_space = truncated.rfind(" ")
    if last_space > 15:
        truncated = truncated[:last_space]
    return truncated.strip() + "..."


def find_matching_asset_directory(prompt: str, explicit_path: Optional[str] = None) -> Optional[str]:
    """Finds an asset directory from explicit path or by matching prompt keywords against asset folders."""
    if explicit_path:
        candidates = [
            explicit_path,
            os.path.join(SKILL_ROOT, explicit_path),
            os.path.join(SKILL_ROOT, "assets", explicit_path),
            os.path.join(os.getcwd(), explicit_path),
        ]
        for c in candidates:
            if os.path.isdir(c):
                return os.path.abspath(c)
        log.warning(f"Specified assets directory not found: {explicit_path}")

    assets_root = os.path.join(SKILL_ROOT, "assets")
    if not os.path.isdir(assets_root):
        return None

    prompt_lower = prompt.lower()
    prompt_tokens = set(re.findall(r"\b[a-z0-9]+\b", prompt_lower))

    best_match = None
    for entry in os.listdir(assets_root):
        if entry.lower() in ("sfx", ".git") or entry.startswith("."):
            continue
        entry_path = os.path.join(assets_root, entry)
        if os.path.isdir(entry_path):
            folder_tokens = set(re.findall(r"\b[a-z0-9]+\b", entry.lower()))
            meaningful_tokens = {t for t in folder_tokens if t not in ("assets", "media", "clips", "video", "videos", "screenshots", "images", "screen")}
            if meaningful_tokens and (meaningful_tokens & prompt_tokens):
                best_match = entry_path
                break
            for t in meaningful_tokens:
                if t in prompt_lower:
                    best_match = entry_path
                    break
            if best_match:
                break

    return best_match


def index_assets(asset_dir: str) -> Dict[str, Any]:
    """Indexes video clips, images, and brand logos in the given asset directory."""
    if not os.path.isdir(asset_dir):
        return {}

    brand_name = None
    logo_file = None
    videos = []
    images = []
    all_assets = []

    dir_name = os.path.basename(asset_dir)
    brand_candidate = re.sub(r"[-_](assets|media|clips|video|app|screenshots|images)$", "", dir_name, flags=re.IGNORECASE)
    if brand_candidate:
        brand_name = brand_candidate.capitalize()

    SEMANTIC_CATALOG = {
        "dashboardpage": {
            "title": "Live Dashboard",
            "vo": "Your live dashboard tracks health scores, forecasts, and [key business trends.]",
            "text": "Live health scores. [Actionable forecasts.]",
            "cam": "push",
            "toasts": [{"at": 1.5, "title": "Store Health Score", "body": "94/100 -- All systems operating efficiently."}]
        },
        "actionspage": {
            "title": "Smart Alerts & Autopilot",
            "vo": "Smart alerts recommend exact actions -- with a [closed-loop ledger] to verify results.",
            "text": "Smart alerts and autopilot. [Closed-loop ledger.]",
            "cam": "tilt",
            "toasts": [{"at": 1.5, "title": "Autopilot Ledger", "body": "Action verified: Gross margin stabilized +3.2%"}]
        },
        "dailylogpage": {
            "title": "Daily Sales Voice Log",
            "vo": "Log your daily sales in seconds -- even by [voice.] Yukti parses it automatically.",
            "text": "Log by [voice.] Yukti parses it automatically.",
            "cam": "tilt",
            "toasts": [{"at": 1.5, "title": "Voice Log Saved", "body": "Sales parsed and categorized."}]
        },
        "askyuktipage": {
            "title": "Ask AI Queries",
            "vo": "Ask plain-English questions like *Why is revenue down?* -- and get instant [voice answers.]",
            "text": "Ask plain-English questions. [Hear answers back.]",
            "cam": "tilt",
            "typing": [{"at": 0.7, "x": 0.415, "y": 0.933, "text": "Why is revenue down this week?", "size": 0.017, "cps": 18}]
        },
        "premiumanalysispage": {
            "title": "Executive Deep-Dive",
            "vo": "Executive deep-dive reveals margin leaks, cost trends, and a [what-if simulator.]",
            "text": "Executive report: margin leaks, [what-if simulator.]",
            "cam": "pushleft"
        },
        "pricingpage": {
            "title": "Transparent Pricing & Trial",
            "vo": "No finance team needed. No expensive consultants. Start with a [seven-day free trial.]",
            "text": "7-day full access trial. [No finance team needed.]",
            "cam": "push"
        },
        "forecastpage": {
            "title": "Predictive Demand Forecasting",
            "vo": "AI-driven forecasting predicts demand shifts and prevents [costly stockouts.]",
            "text": "Predict demand shifts. [Prevent stockouts.]",
            "cam": "push"
        }
    }

    files = sorted(os.listdir(asset_dir))
    for fname in files:
        fpath = os.path.join(asset_dir, fname)
        if not os.path.isfile(fpath):
            continue
        ext = os.path.splitext(fname)[1].lower()
        stem = os.path.splitext(fname)[0]
        stem_lower = stem.lower()

        if any(w in stem_lower for w in ("logo", "mark", "icon")):
            logo_file = fname
            if "-" in stem:
                brand_name = stem.split("-")[0].capitalize()
            elif "_" in stem:
                brand_name = stem.split("_")[0].capitalize()
            continue

        is_vid = ext in (".mp4", ".webm", ".mov", ".m4v")
        is_img = ext in (".png", ".jpg", ".jpeg", ".webp", ".svg")
        if not (is_vid or is_img):
            continue

        meta = dict(SEMANTIC_CATALOG.get(stem_lower, {}))
        if not meta:
            words = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|\d+", stem)
            clean_title = " ".join(words) if words else stem
            meta = {
                "title": clean_title,
                "vo": f"Streamline your workflow with [{clean_title}] built for speed.",
                "text": f"Optimized [{clean_title}]",
                "cam": "push"
            }

        asset_item = {
            "file": fname,
            "stem": stem,
            "is_video": is_vid,
            "ext": ext,
            "size": os.path.getsize(fpath),
            **meta
        }

        if is_vid:
            videos.append(asset_item)
        else:
            images.append(asset_item)
        all_assets.append(asset_item)

    return {
        "source_dir": asset_dir,
        "brand_name": brand_name or "Product",
        "logo": logo_file,
        "videos": videos,
        "images": images,
        "all_assets": all_assets
    }


def build_asset_referenced_scenes(catalog: Dict[str, Any], title: str, topic: str, target_dur: float = 30.0) -> List[Dict[str, Any]]:
    """Builds a high-impact kinetic SaaS launch video plan referencing real UI assets."""
    brand = catalog.get("brand_name") or title or "Product"
    scenes: List[Dict[str, Any]] = []

    # Adaptive scene generation based on duration
    if target_dur <= 18.0:
        # Rapid 15s short video (Hook -> Logo -> 1 UI Highlight -> CTA)
        scenes.append({
            "type": "text",
            "id": "sc_01",
            "narrative_purpose": "Hook identifying core business problem",
            "vo": "Shop closed. [Where did the profit go?]",
            "bg": "dark",
            "size": "l",
            "dur": 3.0,
            "sfx": [{"name": "pop", "at": 0.2, "gain": 0.3}]
        })
        scenes.append({
            "type": "logo",
            "id": "sc_02",
            "narrative_purpose": "Brand identity",
            "vo": f"{brand}. Autonomous intelligence for your business.",
            "tagline": "Autonomous Decision Intelligence.",
            "bg": "dark",
            "dur": 3.0,
            "sfx": [{"name": "shimmer", "at": 0.5, "gain": 0.4}]
        })
        # 1 Key UI scene
        highlight = next((v for v in catalog.get("videos", []) if "dashboard" in v["stem"].lower()), None)
        if not highlight:
            highlight = catalog.get("all_assets", [None])[0]
        if highlight:
            scenes.append({
                "type": "ui",
                "id": "sc_03",
                "narrative_purpose": f"Demonstrate {highlight.get('title', highlight['stem'])}",
                "bg": "light",
                "src": f"assets/{highlight['file']}",
                "vo": highlight["vo"],
                "text": highlight["text"],
                "side": "top",
                "cam": highlight.get("cam", "push"),
                "dur": 5.0,
                "in": 0.0 if highlight["is_video"] else None,
                "speed": 1.0 if highlight["is_video"] else None,
                "toasts": highlight.get("toasts"),
                "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
            })
        clean_url = f"{brand.lower().replace(' ', '')}.pro"
        scenes.append({
            "type": "text",
            "id": "sc_04",
            "narrative_purpose": "Direct call to action",
            "bg": "dark",
            "vo": f"Start free today -- [{clean_url}]",
            "text": f"Start free today -- [{clean_url}]",
            "sub": clean_url,
            "dur": 3.0,
            "sfx": [{"name": "enter", "at": 0.4, "gain": 0.4}]
        })
        return scenes

    # 1. Hook scene (kinetic / text)
    scenes.append({
        "type": "text",
        "id": "sc_01",
        "narrative_purpose": "Hook identifying core business problem",
        "vo": "Shop closed. Sales were made. [Where did the profit go?]",
        "bg": "dark",
        "size": "l",
        "dur": 3.0,
        "sfx": [{"name": "pop", "at": 0.2, "gain": 0.3}]
    })

    # 2. Problem Agitation (for videos >= 25s)
    if target_dur >= 25.0:
        scenes.append({
            "type": "text",
            "id": f"sc_{len(scenes)+1:02d}",
            "narrative_purpose": "Problem agitation with data blindness",
            "mode": "type",
            "vo": "Revenue drops -- and traditional spreadsheets have no clue.",
            "bg": "dark",
            "size": "l",
            "dur": 3.0,
            "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
        })

    # 3. Hero reveal ("Meet")
    scenes.append({
        "type": "hero",
        "id": f"sc_{len(scenes)+1:02d}",
        "narrative_purpose": "Hero product reveal beat",
        "vo": "Meet",
        "bg": "glow",
        "dur": 1.5,
        "sfx": [{"name": "riser", "at": 0.3, "gain": 0.5}, {"name": "boom", "at": 1.2, "gain": 0.7}]
    })

    # 4. Logo Lockup
    scenes.append({
        "type": "logo",
        "id": f"sc_{len(scenes)+1:02d}",
        "narrative_purpose": "Brand identity and core value proposition",
        "vo": f"{brand}. Autonomous decision intelligence for modern businesses.",
        "tagline": "Autonomous Decision Intelligence|for Modern Businesses.",
        "bg": "dark",
        "dur": 3.5,
        "sfx": [{"name": "shimmer", "at": 0.5, "gain": 0.4}]
    })

    # 5. UI Feature Scenes using real assets
    candidate_order = ["dailylogpage", "dashboardpage", "askyuktipage", "actionspage", "premiumanalysispage", "pricingpage", "forecastpage"]
    selected_assets = []
    seen_stems = set()

    for key in candidate_order:
        matched_vids = [v for v in catalog.get("videos", []) if v["stem"].lower() == key]
        matched_imgs = [m for m in catalog.get("images", []) if m["stem"].lower() == key]
        item = matched_vids[0] if matched_vids else (matched_imgs[0] if matched_imgs else None)
        if item and item["stem"].lower() not in seen_stems:
            selected_assets.append(item)
            seen_stems.add(item["stem"].lower())

    for item in catalog.get("all_assets", []):
        if item["stem"].lower() not in seen_stems:
            selected_assets.append(item)
            seen_stems.add(item["stem"].lower())

    max_ui = 2 if target_dur <= 25 else (3 if target_dur <= 35 else (4 if target_dur <= 45 else 6))
    ui_items = selected_assets[:max_ui]

    for item in ui_items:
        sc: Dict[str, Any] = {
            "type": "ui",
            "id": f"sc_{len(scenes)+1:02d}",
            "narrative_purpose": f"Demonstrate {item.get('title', item['stem'])}",
            "bg": "light",
            "src": f"assets/{item['file']}",
            "vo": item["vo"],
            "text": item["text"],
            "side": "top",
            "cam": item.get("cam", "push"),
            "dur": 4.5,
            "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
        }
        if item["is_video"]:
            sc["in"] = 0.0
            sc["speed"] = 1.0
        if "toasts" in item:
            sc["toasts"] = item["toasts"]
        if "typing" in item:
            sc["typing"] = item["typing"]
        scenes.append(sc)

    # 6. Closing Brand Lockup
    scenes.append({
        "type": "logo",
        "id": f"sc_{len(scenes)+1:02d}",
        "narrative_purpose": "Brand reinforcement",
        "bg": "glow",
        "vo": f"{brand}. Run a smarter business.",
        "tagline": "Run a smarter business.",
        "hold": 1.5,
        "dur": 3.0,
        "sfx": [{"name": "ding", "at": 0.5, "gain": 0.4}]
    })

    # 7. Call To Action (text)
    clean_url = f"{brand.lower().replace(' ', '')}.pro"
    scenes.append({
        "type": "text",
        "id": f"sc_{len(scenes)+1:02d}",
        "narrative_purpose": "Direct call to action",
        "bg": "dark",
        "vo": f"Start free today -- [{clean_url}]",
        "text": f"Start free today -- [{clean_url}]",
        "sub": clean_url,
        "dur": 2.5,
        "sfx": [{"name": "enter", "at": 0.4, "gain": 0.4}]
    })

    return scenes

def detect_category_and_style(prompt: str) -> Tuple[str, str, str]:
    """Infers category, style, and audio mood with strict word matching and proper priority."""
    p = prompt.lower()

    # Category word groups
    social_words = ["tiktok", "reel", "reels", "short", "shorts", "viral", "hook", "meme", "trending", "caption", "scroll", "stop scrolling", "retention"]
    biz_words = ["product", "saas", "launch", "startup", "conversion", "pricing", "free trial", "revenue", "b2b", "roi", "leads", "app", "service"]
    edu_words = ["explain", "tutorial", "lesson", "how to", "science", "physics", "quantum", "math", "history", "diagram", "whiteboard", "teach", "why do"]
    data_words = ["chart", "candlestick", "leaderboard", "data", "metrics", "financial", "growth curve", "timeline", "trading", "crypto", "market", "volume", "comparison", "benchmark"]
    cine_words = ["cinematic", "poetry", "atmosphere", "moody", "ambient", "landscape", "noir", "surreal", "meditative"]

    # Priority order: social > business > educational > specialized > cinematic > storytelling
    if has_word(p, social_words):
        category = "social"
        style = "motion_graphics"
        mood = "synthwave"
    elif has_word(p, biz_words) or find_matching_asset_directory(prompt):
        category = "business"
        style = "motion_graphics"
        mood = "corporate"
    elif has_word(p, edu_words):
        category = "educational"
        style = "whiteboard" if "whiteboard" in p else ("minimalist" if "minimal" in p else "cinematic")
        mood = "lofi"
    elif has_word(p, data_words):
        category = "specialized"
        style = "motion_graphics"
        mood = "corporate"
    elif has_word(p, cine_words):
        category = "cinematic"
        style = "cinematic"
        mood = "cinematic"
    else:
        category = "storytelling"
        if "anime" in p:
            style = "anime"
        elif "cartoon" in p or "whimsical" in p or "children" in p:
            style = "cartoon"
        elif "cyberpunk" in p or "neon" in p:
            style = "cyberpunk"
        elif "fantasy" in p or "magic" in p:
            style = "fantasy"
        else:
            style = "cinematic"
        mood = "cinematic" if has_word(p, ["robot", "mars", "space"]) else "ambient"

    return category, style, mood


def rescale_durations(plan: Dict[str, Any], target_dur: float) -> Dict[str, Any]:
    """Rescales scene durations proportionally to fit target duration exactly."""
    scenes = plan.get("scenes", [])
    if not scenes:
        plan["target_duration"] = target_dur
        return plan
    total_dur = sum(s.get("dur", 5.0) for s in scenes)
    if total_dur > 0:
        ratio = target_dur / total_dur
        running = 0.0
        is_social = plan.get("category") == "social"
        for i, s in enumerate(scenes):
            if i == len(scenes) - 1:
                s["dur"] = max(1.0, round(target_dur - running, 1))
            else:
                d = max(1.0, round(s.get("dur", 5.0) * ratio, 1))
                if is_social and i == 0:
                    d = min(2.5, d)
                s["dur"] = d
                running += d
    plan["target_duration"] = target_dur
    return plan


def enforce_options(plan: Dict[str, Any], opts: Dict[str, Any]) -> Dict[str, Any]:
    """Applies user options authoritatively to the plan."""
    if opts.get("category"):
        plan["category"] = opts["category"]
    if opts.get("style"):
        plan["style"] = opts["style"]
    if opts.get("format"):
        plan["format"] = opts["format"]
    if opts.get("mood"):
        plan.setdefault("music", {})["mood"] = opts["mood"]
    if opts.get("duration"):
        rescale_durations(plan, float(opts["duration"]))
    if opts.get("assets"):
        plan["assets_source"] = opts["assets"]
    return plan


def get_motion_templates(implemented_only: bool = True) -> Dict[str, Dict[str, Any]]:
    """Retrieves motion templates from registry, filtering by implemented status if requested."""
    raw = REGISTRY.get("motion_templates", [])
    out = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                tid = item.get("id")
                if not tid:
                    continue
                if implemented_only and item.get("status") != "implemented":
                    continue
                out[tid] = item
            elif isinstance(item, str):
                out[item] = {"id": item, "status": "implemented", "schema": {}}
    elif isinstance(raw, dict):
        for tid, item in raw.items():
            if isinstance(item, dict):
                if implemented_only and item.get("status") != "implemented":
                    continue
                out[tid] = item
            else:
                out[tid] = {"id": tid, "status": "implemented", "schema": {}}
    return out


def validate_motion_data(template_id: str, data: Any, schema: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validates scene.data against the template schema."""
    if not schema:
        return True, None
    if data is None or not isinstance(data, dict):
        for key, rule in schema.items():
            if rule.get("required"):
                return False, f"[{template_id}] Missing required field: '{key}'"
        return True, None

    for key, rule in schema.items():
        val = data.get(key)
        if val is None:
            if rule.get("required"):
                return False, f"[{template_id}] Missing required field: '{key}'"
            continue
        expected_type = rule.get("type")
        if expected_type == "string" and not isinstance(val, str):
            return False, f"[{template_id}] Field '{key}' must be a string, got {type(val).__name__}"
        elif expected_type == "number" and not isinstance(val, (int, float)):
            return False, f"[{template_id}] Field '{key}' must be a number, got {type(val).__name__}"
        elif expected_type == "array" and not isinstance(val, list):
            return False, f"[{template_id}] Field '{key}' must be an array, got {type(val).__name__}"
        elif expected_type == "object" and not isinstance(val, dict):
            return False, f"[{template_id}] Field '{key}' must be an object, got {type(val).__name__}"
        elif expected_type == "boolean" and not isinstance(val, bool):
            return False, f"[{template_id}] Field '{key}' must be a boolean, got {type(val).__name__}"
    return True, None


def validate_plan_schema(plan: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validates plan against the schema and registry."""
    if not isinstance(plan, dict):
        return False, "Plan must be a JSON object"
    scenes = plan.get("scenes")
    if not isinstance(scenes, list) or len(scenes) == 0:
        return False, "Plan must contain a non-empty 'scenes' list"

    valid_types = set(REGISTRY.get("scene_types", []))
    motion_dict = get_motion_templates(implemented_only=True)
    valid_motion = set(motion_dict.keys())
    valid_formats = set(REGISTRY.get("formats", {}).keys())

    fmt = plan.get("format")
    if fmt and fmt not in valid_formats:
        return False, f"Unknown format '{fmt}', allowed: {sorted(valid_formats)}"

    for i, s in enumerate(scenes):
        if not isinstance(s, dict):
            return False, f"Scene {i} must be a JSON object"
        stype = s.get("type")
        if not stype or stype not in valid_types:
            return False, f"Scene {i} has invalid type '{stype}', allowed: {sorted(valid_types)}"
        dur = s.get("dur")
        if dur is None or not isinstance(dur, (int, float)) or dur <= 0 or dur > 60:
            return False, f"Scene {i} must have 0 < dur <= 60 (got {dur})"
        if stype == "motion":
            tmpl = s.get("template") or "16-line-growth"
            if tmpl not in valid_motion:
                return False, f"Scene {i} has unknown motion template '{tmpl}', allowed: {sorted(valid_motion)}"
            tmpl_info = motion_dict[tmpl]
            schema = tmpl_info.get("schema", {})
            s_data = s.get("data")
            if s_data is None:
                extracted = {k: s[k] for k in schema if k in s}
                s_data = extracted if extracted else None
            ok_m, err_m = validate_motion_data(tmpl, s_data, schema)
            if not ok_m:
                return False, f"Scene {i}: {err_m}"

    return True, None


def local_heuristic_director(prompt: str, options: Dict[str, Any]) -> Dict[str, Any]:
    # Asset discovery & cataloging
    asset_dir = find_matching_asset_directory(prompt, options.get("assets"))
    catalog = index_assets(asset_dir) if asset_dir else {}
    has_assets = bool(catalog.get("all_assets"))

    inferred_cat, inferred_style, inferred_mood = detect_category_and_style(prompt)
    if has_assets and not options.get("category"):
        inferred_cat = "business"
        inferred_style = "motion_graphics"
        inferred_mood = "corporate"

    category = options.get("category") or inferred_cat
    style = options.get("style") or inferred_style
    # DR-01: format resolves after category is known
    fmt = options.get("format") or ("9:16" if category == "social" else "16:9")
    target_dur = float(options.get("duration") or (15.0 if category == "social" else 30.0))
    mood = options.get("mood") or inferred_mood

    topic = derive_topic(prompt)
    title = options.get("title") or safe_truncate_title(topic, max_chars=40)

    # DR-04: Derive scene count from duration and category cut cadence
    cut_cadence = {
        "social": 2.5,
        "business": 4.0,
        "educational": 5.5,
        "storytelling": 6.0,
        "cinematic": 7.0,
        "specialized": 5.0
    }
    target_cuts = max(3, min(20, round(target_dur / cut_cadence.get(category, 5.0))))

    scenes = []
    continuity = {"characters": [], "environments": [], "props": []}

    theme_palettes = {
        "cinematic": {"accent": "#00E5FF", "dark": "#060910", "light": "#F2F5F8", "ink": "#0D1117", "paper": "#1A2230"},
        "cyberpunk": {"accent": "#FF007F", "dark": "#090314", "light": "#F5E9FF", "ink": "#18062B", "paper": "#2D0A4E"},
        "anime": {"accent": "#FF5964", "dark": "#0E131F", "light": "#FFFDF9", "ink": "#1E2638", "paper": "#E5E9F0"},
        "cartoon": {"accent": "#FFB703", "dark": "#1B2A4A", "light": "#F8F9FA", "ink": "#212529", "paper": "#E9ECEF"},
        "whiteboard": {"accent": "#2563EB", "dark": "#1E293B", "light": "#FFFFFF", "ink": "#0F172A", "paper": "#F8FAFC"},
        "motion_graphics": {"accent": "#38BDF8", "dark": "#0B0F17", "light": "#F8FAFC", "ink": "#0F172A", "paper": "#1E293B"},
        "fantasy": {"accent": "#A78BFA", "dark": "#0D0A1A", "light": "#FDFCF7", "ink": "#1F1A3A", "paper": "#2E2452"},
        "minimalist": {"accent": "#E2E8F0", "dark": "#0A0A0A", "light": "#FFFFFF", "ink": "#171717", "paper": "#262626"}
    }
    active_theme = theme_palettes.get(style, theme_palettes["cinematic"])

    if has_assets and catalog.get("brand_name", "").lower() == "yukti":
        active_theme = {
            "accent": "#329CDA",
            "dark": "#080F1A",
            "light": "#F6F9FC",
            "ink": "#0B0E14",
            "paper": "#E4EEF6"
        }

    if category == "storytelling":
        # DR-07: Only trigger robot/mars if explicitly requested in prompt
        is_robot_mars = has_word(prompt.lower(), ["robot", "mars"])
        if is_robot_mars:
            continuity["characters"].append({
                "id": "char_unit7",
                "name": "Unit 7",
                "type": "sentient_robot",
                "description": "Weathered bronze and matte titanium frame with a luminous cyan optic lens.",
                "palette": ["#4F6D7A", "#C0D6DF", "#D8B18A", "#00E5FF"]
            })
            continuity["environments"].append({
                "id": "env_mars",
                "name": "The Crimson Solitude",
                "description": "Desolate Martian canyons under deep terracotta skies.",
                "palette": ["#8C2D19", "#3D1308", "#E07A5F", "#2A9D8F"]
            })
            scenes = [
                {
                    "type": "story",
                    "id": "sc_01",
                    "narrative_purpose": "Establish vast isolation",
                    "camera": "pan_left",
                    "character": "Unit 7 alone against the horizon",
                    "vo": "Across the crimson silence, Unit Seven wandered without purpose.",
                    "text": "The Crimson Silence",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "whoosh", "at": 0.2, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_02",
                    "narrative_purpose": "Sensor anomaly detection",
                    "camera": "zoom_in",
                    "character": "Unit 7 sensor flashing",
                    "vo": "Until an unexpected sensor signal broke the stillness.",
                    "text": "[Signal Detected]",
                    "bg": "dark",
                    "dur": 5.5,
                    "sfx": [{"name": "ping", "at": 0.8, "gain": 0.5}]
                },
                {
                    "type": "cinematic",
                    "id": "sc_03",
                    "narrative_purpose": "The discovery",
                    "camera": "drift",
                    "vo": "Not an echo. Life, blossoming in the forgotten soil.",
                    "text": "Life. Against all odds.",
                    "bg": "dark",
                    "dur": 6.5,
                    "sfx": [{"name": "boom", "at": 1.2, "gain": 0.5}]
                },
                {
                    "type": "story",
                    "id": "sc_04",
                    "narrative_purpose": "Transformation into guardian",
                    "camera": "zoom_out",
                    "character": "Unit 7 sheltering the blossom",
                    "vo": "For the first time on the barren planet... the quiet was no longer lonely.",
                    "text": "No longer alone.",
                    "bg": "dark",
                    "dur": 7.0,
                    "sfx": [{"name": "whoosh", "at": 0.5, "gain": 0.3}]
                }
            ]
        else:
            scenes = [
                {
                    "type": "cinematic",
                    "id": "sc_01",
                    "narrative_purpose": "Establish atmospheric world setting",
                    "camera": "zoom_in",
                    "vo": f"In a world where everything was about to change.",
                    "text": f"{title}",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "whoosh", "at": 0.1, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_02",
                    "narrative_purpose": "Introduce central journey",
                    "camera": "pan_right",
                    "vo": f"Every step forward unveiled new horizons.",
                    "text": "The Journey Begins",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "riser", "at": 0.5, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_03",
                    "narrative_purpose": "Climactic resolution",
                    "camera": "drift",
                    "vo": "And there, at the horizon of tomorrow, destiny was forged.",
                    "text": "Destiny Awaits",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "boom", "at": 1.2, "gain": 0.6}]
                }
            ]

    elif category == "educational":
        # DR-08: Only use growth chart if data/growth is mentioned in prompt
        has_chart_request = has_word(prompt, ["chart", "growth", "curve", "metric", "metrics", "data", "stats"])
        scenes = [
            {
                "type": "whiteboard",
                "id": "sc_01",
                "narrative_purpose": "Introduce the core question or concept",
                "camera": "static",
                "vo": f"Have you ever wondered how {topic.lower()} works?",
                "text": f"Understanding: {title}",
                "bg": "light",
                "dur": 5.5,
                "sfx": [{"name": "pop", "at": 0.3, "gain": 0.3}]
            }
        ]
        if has_chart_request:
            scenes.append({
                "type": "motion",
                "template": "16-line-growth",
                "id": "sc_02",
                "narrative_purpose": "Illustrate data and growth principles",
                "vo": "The underlying principles follow an observable curve.",
                "text": "Observed Dynamics",
                "data": {
                    "points": [10, 25, 45, 80, 120],
                    "title": "Observed Dynamics"
                },
                "bg": "dark",
                "dur": 6.0,
                "sfx": [{"name": "ding", "at": 1.2, "gain": 0.4}]
            })
        else:
            scenes.append({
                "type": "whiteboard",
                "id": "sc_02",
                "narrative_purpose": "Break down mechanism and key relationships",
                "vo": "At its heart, the phenomenon connects through fundamental principles.",
                "text": "The Underlying Mechanism",
                "bg": "light",
                "dur": 6.0,
                "sfx": [{"name": "ding", "at": 1.0, "gain": 0.4}]
            })
        scenes.append({
            "type": "whiteboard",
            "id": "sc_03",
            "narrative_purpose": "Synthesize takeaway",
            "camera": "zoom_out",
            "vo": "When all parts connect, the picture becomes clear.",
            "text": "The Complete Picture",
            "bg": "light",
            "dur": 5.5,
            "sfx": [{"name": "ding", "at": 0.8, "gain": 0.4}]
        })

    elif category == "cinematic":
        scenes = [
            {
                "type": "cinematic",
                "id": "sc_01",
                "narrative_purpose": "Deep atmospheric emergence",
                "camera": "drift",
                "vo": "Beyond the noise of the world, silence possesses a voice.",
                "text": f"{title}",
                "bg": "dark",
                "dur": 7.0,
                "sfx": [{"name": "whoosh", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "cinematic",
                "id": "sc_02",
                "narrative_purpose": "Visual crescendo",
                "camera": "zoom_in",
                "vo": "Every shadow holds the promise of an awakening light.",
                "text": "In Silence, Awakening.",
                "bg": "dark",
                "dur": 7.0,
                "sfx": [{"name": "boom", "at": 2.5, "gain": 0.5}]
            }
        ]

    elif category == "social":
        # DR-04: Hook is always <= 2.5 s for social videos, multiple cuts
        scenes = [
            {
                "type": "kinetic",
                "id": "sc_01",
                "narrative_purpose": "0-second hook to stop the scroll",
                "camera": "push",
                "vo": f"Stop scrolling. Here is what you need to know about {topic.lower()}.",
                "text": "WAIT. [Watch This.]",
                "bg": "dark",
                "dur": 2.4,
                "sfx": [{"name": "boom", "at": 0.1, "gain": 0.5}]
            },
            {
                "type": "kinetic",
                "id": "sc_02",
                "narrative_purpose": "Rapid value delivery beat 1",
                "vo": "Most people overlook the key factor that defines this.",
                "text": "The Key Factor",
                "bg": "dark",
                "dur": 2.5,
                "sfx": [{"name": "pop", "at": 0.3, "gain": 0.4}]
            },
            {
                "type": "kinetic",
                "id": "sc_03",
                "narrative_purpose": "Rapid value delivery beat 2",
                "vo": "Once you understand this shift, everything changes.",
                "text": "Shift Your Perspective",
                "bg": "dark",
                "dur": 2.5,
                "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "kinetic",
                "id": "sc_04",
                "narrative_purpose": "Retention payoff & CTA",
                "camera": "zoom_in",
                "vo": "Save this insight and follow for more.",
                "text": "Save & Share. [Follow For More.]",
                "bg": "dark",
                "dur": 2.6,
                "sfx": [{"name": "ding", "at": 0.5, "gain": 0.4}]
            }
        ]

    elif category == "specialized":
        # DR-05: Truthful comparison without fabricated claims
        scenes = [
            {
                "type": "motion",
                "template": "10-candlestick",
                "id": "sc_01",
                "narrative_purpose": "Market structure analysis",
                "vo": "Market structure shifts before the trend becomes visible.",
                "text": "Market Analysis: [Trend Shift]",
                "data": {
                    "title": "Market Structure",
                    "metric": "+24.8%"
                },
                "bg": "dark",
                "dur": 5.5,
                "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "motion",
                "template": "13-compare-bars",
                "id": "sc_02",
                "narrative_purpose": "Metric comparison without fabricated claims",
                "vo": "Comparing baseline performance against current benchmarks.",
                "text": "Performance [Comparison]",
                "data": {
                    "bars": [
                        {"label": "Baseline", "value": 100},
                        {"label": "Benchmark", "value": 240}
                    ],
                    "unit": " pts"
                },
                "bg": "dark",
                "dur": 5.5,
                "sfx": [{"name": "ding", "at": 0.8, "gain": 0.4}]
            }
        ]

    else:  # Business / marketing
        if has_assets:
            scenes = build_asset_referenced_scenes(catalog, title, topic, target_dur)
        else:
            # DR-05: Clean truthful copy without invented stats
            scenes = [
                {
                    "type": "text",
                    "id": "sc_01",
                    "vo": f"A modern approach to {topic.lower()}.",
                    "bg": "dark",
                    "dur": 4.0,
                    "sfx": [{"name": "pop", "at": 0.2, "gain": 0.3}]
                },
                {
                    "type": "hero",
                    "id": "sc_02",
                    "vo": f"Introducing {title}.",
                    "bg": "glow",
                    "dur": 3.0,
                    "sfx": [{"name": "boom", "at": 1.0, "gain": 0.5}]
                },
                {
                    "type": "text",
                    "id": "sc_03",
                    "vo": "Built for teams that value speed and clarity.",
                    "sub": "Get started today",
                    "bg": "dark",
                    "dur": 4.0,
                    "sfx": [{"name": "ding", "at": 0.5, "gain": 0.4}]
                }
            ]

    brand_obj = {
        "name": catalog.get("brand_name") or title or "Product",
        "mark": f"assets/{catalog['logo']}" if catalog.get("logo") else None
    }

    # Ensure dynamic beat count aligns with duration if needed
    plan = {
        "title": title,
        "prompt": prompt,
        "category": category,
        "style": style,
        "format": fmt,
        "brand": brand_obj,
        "target_duration": target_dur,
        "quality": "draft-heuristic",
        "planner": "heuristic",
        "fps": 30,
        "theme": active_theme,
        "music": {
            "mood": mood,
            "bpm": 90 if mood == "cinematic" else (120 if mood == "synthwave" else 105),
            "gain": 0.38 if mood != "silent" else 0.0,
            "synth": True if mood != "silent" else False
        },
        "vo": {
            "pre": 0.12,
            "post": 0.28,
            "enabled": options.get("voiceover", True)
        },
        "continuity": continuity,
        "scenes": scenes
    }
    if has_assets and catalog.get("source_dir"):
        plan["assets_source"] = os.path.relpath(catalog["source_dir"], SKILL_ROOT)

    rescale_durations(plan, target_dur)
    return plan


def llm_creative_director(prompt: str, options: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Attempts planning via Groq or Anthropic LLM API with schema validation and error logging."""
    groq_key = ENV.get("GROQ_API_KEY") or ENV.get("GROQ_API")
    anthropic_key = ENV.get("ANTHROPIC_API_KEY") or ENV.get("ANTHROPIC_API")

    groq_model = ENV.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    anthropic_model = ENV.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

    valid_types = ", ".join(REGISTRY.get("scene_types", []))
    impl_motion = get_motion_templates(implemented_only=True)
    valid_motion = ", ".join(impl_motion.keys())
    motion_schemas_summary = []
    for mid, mdef in impl_motion.items():
        fields = [f"{k}: {v.get('type')}{' (required)' if v.get('required') else ''}" for k, v in mdef.get("schema", {}).items()]
        motion_schemas_summary.append(f"  - {mid}: data: {{{', '.join(fields)}}}")
    motion_docs = "\n".join(motion_schemas_summary)
    valid_moods = ", ".join(AUDIO_MOODS)
    valid_formats = ", ".join(FORMATS)

    system_prompt = f"""You are Universal Animated Video Director.
You transform an arbitrary user prompt into a structured, creative animated video plan (JSON).
Do NOT invent fake statistics, customer results, or ungrounded numeric claims.
Support diverse genres: storytelling, educational, cinematic, social, specialized, business.

Scene types: {valid_types}
Available implemented motion templates and schemas:
{motion_docs}
Music moods: {valid_moods}
Formats: {valid_formats}

Return ONLY valid JSON with keys: title, category, style, format, theme, music, continuity, scenes.
Each scene must have: id, type, dur (0 < dur <= 60), vo (optional spoken narration), text (optional on-screen text).
When creating 'motion' scenes, specify 'template' from the implemented list above and provide valid 'data' strictly adhering to the template's schema."""

    asset_dir = find_matching_asset_directory(prompt, options.get("assets"))
    if asset_dir:
        cat = index_assets(asset_dir)
        lines = []
        for a in cat.get("all_assets", []):
            lines.append(f"- assets/{a['file']} ({'video' if a['is_video'] else 'image'}): {a.get('title', a['stem'])}")
        if cat.get("logo"):
            lines.append(f"- assets/{cat['logo']} (brand logo)")
        if lines:
            system_prompt += "\n\nAvailable real product UI assets in assets/:\n" + "\n".join(lines) + "\nWhen creating 'ui' scenes, set 'src' to an appropriate asset from the list above. Set 'brand.mark' to the logo asset if available.\n"

    user_message = f"User Request: {prompt}\nOptions: {json.dumps(options)}"

    # Try Groq
    if groq_key:
        try:
            req_data = {
                "model": groq_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                "temperature": 0.7,
                "response_format": {"type": "json_object"}
            }
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/chat/completions",
                data=json.dumps(req_data).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "UniversalAnimatedVideoGenerator/2.0"
                }
            )
            with urllib.request.urlopen(req, timeout=12) as res:
                body = json.loads(res.read().decode("utf-8"))
                content = body["choices"][0]["message"]["content"]
                plan = json.loads(content)
                ok, err = validate_plan_schema(plan)
                if ok:
                    plan["planner"] = "groq"
                    plan["quality"] = "final"
                    return plan
                else:
                    log.warning(f"Groq plan schema validation failed: {err}")
        except Exception as e:
            log.warning(f"LLM planner groq failed: {e}; trying fallback")

    # Try Anthropic
    if anthropic_key:
        try:
            req_data = {
                "model": anthropic_model,
                "max_tokens": 4096,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}]
            }
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=json.dumps(req_data).encode("utf-8"),
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                    "User-Agent": "UniversalAnimatedVideoGenerator/2.0"
                }
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                body = json.loads(res.read().decode("utf-8"))
                text = body["content"][0]["text"]
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if m:
                    plan = json.loads(m.group(0))
                    ok, err = validate_plan_schema(plan)
                    if ok:
                        plan["planner"] = "anthropic"
                        plan["quality"] = "final"
                        return plan
                    else:
                        log.warning(f"Anthropic plan schema validation failed: {err}")
        except Exception as e:
            log.warning(f"LLM planner anthropic failed: {e}; using offline heuristic")

    return None


def create_project(prompt: str, options: Optional[Dict[str, Any]] = None, target_dir: Optional[str] = None) -> Dict[str, Any]:
    """Master entry point: creates an animated video project from prompt and options."""
    opts = options or {}

    # Try LLM director first, fall back to local heuristic director
    plan = llm_creative_director(prompt, opts)
    if not plan:
        plan = local_heuristic_director(prompt, opts)

    # DR-02: Apply options authoritatively
    plan = enforce_options(plan, opts)

    # PL-04: Robust slug name + short hash to prevent collision
    title = plan.get("title") or prompt[:40]
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]
    name = f"{slug}-{hashlib.sha1(prompt.encode('utf-8')).hexdigest()[:6]}"
    plan["name"] = name
    if not plan.get("fps"):
        plan["fps"] = 30
    if not plan.get("format"):
        plan["format"] = "16:9"

    # Target folder
    proj_dir = target_dir or os.path.join(SKILL_ROOT, "launches", name)
    plan_path = os.path.join(proj_dir, "plan.json")

    # PL-04: Refuse to overwrite an existing different project unless --force
    if os.path.exists(plan_path) and not opts.get("force"):
        try:
            with open(plan_path, "r", encoding="utf-8") as f:
                existing_plan = json.load(f)
            if existing_plan.get("prompt") != prompt and not opts.get("force"):
                raise RuntimeError(
                    f"Project folder {proj_dir} already exists for a different prompt. Use --force to overwrite."
                )
        except Exception as e:
            if "already exists" in str(e):
                raise

    os.makedirs(proj_dir, exist_ok=True)
    proj_assets = os.path.join(proj_dir, "assets")
    os.makedirs(proj_assets, exist_ok=True)
    os.makedirs(os.path.join(proj_dir, "out"), exist_ok=True)

    # Discover and copy reference assets into project folder
    asset_dir = find_matching_asset_directory(prompt, opts.get("assets"))
    if asset_dir and os.path.isdir(asset_dir):
        copied = 0
        for fname in os.listdir(asset_dir):
            src_f = os.path.join(asset_dir, fname)
            dst_f = os.path.join(proj_assets, fname)
            if os.path.isfile(src_f):
                if not os.path.exists(dst_f) or os.path.getsize(src_f) != os.path.getsize(dst_f):
                    shutil.copy2(src_f, dst_f)
                    copied += 1
        if copied:
            log.info(f"Copied {copied} reference assets from {asset_dir} into {proj_assets}")
        plan["assets_source"] = os.path.relpath(asset_dir, SKILL_ROOT)

    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2)

    return {"plan": plan, "project_dir": proj_dir, "plan_path": plan_path}


def main():
    parser = argparse.ArgumentParser(description="Universal AI Animation Director")
    parser.add_argument("prompt", help="Creative prompt, story brief, or concept description")
    parser.add_argument("--category", choices=CATEGORIES, help="Video category")
    parser.add_argument("--style", choices=STYLES, help="Visual style preset")
    # DR-01: format default is None
    parser.add_argument("--format", choices=FORMATS, default=None, help="Aspect ratio (defaults to 9:16 for social, 16:9 otherwise)")
    parser.add_argument("--duration", type=float, default=30.0, help="Target duration in seconds")
    parser.add_argument("--mood", choices=AUDIO_MOODS, help="Audio music mood")
    parser.add_argument("--assets", help="Path to assets folder or asset set name (e.g. assets/yukti-assets)")
    parser.add_argument("--out", help="Custom output directory")
    parser.add_argument("--force", action="store_true", help="Force overwrite existing project folder")
    parser.add_argument("--json", action="store_true", help="Print raw plan JSON to stdout")

    args = parser.parse_args()
    options = {
        "category": args.category,
        "style": args.style,
        "format": args.format,
        "duration": args.duration,
        "mood": args.mood,
        "assets": args.assets,
        "force": args.force,
    }
    result = create_project(args.prompt, options, args.out)
    if args.json:
        print(json.dumps(result["plan"], indent=2))
    else:
        p = result["plan"]
        print(f"\n✨ Animated Video Plan Created: {p.get('name')}")
        print(f"   Category: {p.get('category')}  |  Style: {p.get('style')}  |  Format: {p.get('format')}  |  Mood: {p.get('music', {}).get('mood')}")
        print(f"   Planner: {p.get('planner')}  |  Quality: {p.get('quality', 'draft')}")
        print(f"   Scenes: {len(p.get('scenes', []))}  |  Project: {result['project_dir']}")
        print(f"   Plan saved to: {result['plan_path']}\n")
        for i, s in enumerate(p.get("scenes", [])):
            print(f"   [{i+1:02d}] {s.get('type', 'scene').upper():10s} ({s.get('dur', 0):.1f}s) : {(s.get('vo') or s.get('text') or s.get('narrative_purpose') or '')[:70]}")


if __name__ == "__main__":
    main()
