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
- Groq (llama-3.3-70b-versatile, ultra-fast)
- Anthropic Claude
- Local Intelligent Heuristic Director (deterministic offline fallback)
"""
import argparse, json, os, re, sys, urllib.request, urllib.error
from typing import Dict, Any, List, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SKILL_ROOT = os.path.dirname(os.path.abspath(__file__))


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

FORMATS = ["16:9", "9:16", "1:1", "4:5"]
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


def detect_category_and_style(prompt: str) -> tuple[str, str, str]:
    """Infers category, style, and audio mood from a natural language prompt."""
    p = prompt.lower()
    
    # Category detection
    if any(w in p for w in ["explain", "tutorial", "lesson", "how to", "science", "physics", "quantum", "math", "history", "diagram", "whiteboard", "teach", "why do"]):
        category = "educational"
        style = "whiteboard" if "whiteboard" in p else ("minimalist" if "minimal" in p else "cinematic")
        mood = "lofi"
    elif any(w in p for w in ["product", "saas", "launch", "startup", "app", "conversion", "pricing", "free trial", "revenue", "b2b", "roi", "leads"]):
        category = "business"
        style = "motion_graphics"
        mood = "corporate"
    elif any(w in p for w in ["tiktok", "reel", "short", "viral", "hook", "meme", "trending", "caption", "scroll", "stop scrolling", "retention"]):
        category = "social"
        style = "motion_graphics"
        mood = "synthwave"
    elif any(w in p for w in ["cinematic", "poetry", "atmosphere", "moody", "ambient", "landscape", "noir", "surreal", "meditative"]):
        category = "cinematic"
        style = "cinematic"
        mood = "cinematic"
    elif any(w in p for w in ["chart", "candlestick", "leaderboard", "data", "metrics", "financial", "growth curve", "timeline", "trading", "crypto", "market", "volume", "comparison", "benchmark"]):
        category = "specialized"
        style = "motion_graphics"
        mood = "corporate"
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
        mood = "cinematic" if "robot" in p or "mars" in p or "space" in p else "ambient"

    return category, style, mood


def local_heuristic_director(prompt: str, options: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic, rich offline AI director that generates high quality storyboards without external APIs."""
    inferred_cat, inferred_style, inferred_mood = detect_category_and_style(prompt)
    category = options.get("category") or inferred_cat
    style = options.get("style") or inferred_style
    fmt = options.get("format") or ("9:16" if category == "social" else "16:9")
    target_dur = float(options.get("duration") or 30.0)
    mood = options.get("mood") or inferred_mood
    title = options.get("title") or (prompt[:40].strip() + ("..." if len(prompt) > 40 else ""))

    # Clean name for directory
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "-", title.lower()).strip("-")[:28] or "animated-video"

    # Narrative generation by category
    scenes = []
    continuity = {"characters": [], "environments": [], "props": []}

    # Theme palette based on style
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

    if category == "storytelling":
        # Check for robot / mars or character elements
        is_robot_mars = any(w in prompt.lower() for w in ["robot", "mars", "garden", "flower", "lonely"])
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
                "description": "Desolate Martian canyons under deep terracotta skies, revealing a hidden geodesic dome.",
                "palette": ["#8C2D19", "#3D1308", "#E07A5F", "#2A9D8F"]
            })
            scenes = [
                {
                    "type": "story",
                    "id": "sc_01",
                    "narrative_purpose": "Establish the vast, empty isolation of the Red Planet",
                    "visual_description": "Vast Martian plains of rust and crimson sand under a twin-moon twilight. Wind sculpts dust waves across towering mesas.",
                    "environment": "Martian Canyons at Twilight",
                    "camera": "pan_left",
                    "character": "Unit 7 alone against the horizon",
                    "animation_technique": "procedural_canvas",
                    "particles": "dust",
                    "lighting": "Terracotta dusk with long shadows",
                    "vo": "Four hundred days across the crimson silence. Unit Seven wandered without purpose.",
                    "text": "Sol 412: The Crimson Silence",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "whoosh", "at": 0.2, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_02",
                    "narrative_purpose": "The discovery: anomaly on the optic sensors",
                    "visual_description": "Unit 7's single cyan optic sensor pulses. At the base of a shattered obsidian crater, a gentle bioluminescent green glow breaks through the rust.",
                    "environment": "Obsidian Crater Rift",
                    "camera": "zoom_in",
                    "character": "Unit 7 tilts head, sensor flashing rapidly",
                    "animation_technique": "character_motion",
                    "particles": "spores",
                    "lighting": "Cyan sensor spotlight on dark soil",
                    "vo": "Until an unexpected sensor signal broke the stillness.",
                    "text": "[Signal Detected] Coordinates 14.8° N",
                    "bg": "dark",
                    "dur": 5.5,
                    "sfx": [{"name": "ping", "at": 0.8, "gain": 0.5}, {"name": "swish", "at": 1.5, "gain": 0.3}]
                },
                {
                    "type": "cinematic",
                    "id": "sc_03",
                    "narrative_purpose": "The encounter: an impossibly delicate Martian blossom",
                    "visual_description": "Close-up on a fragile, translucent blossom thriving inside an ancient geodesic pocket. Its petals breathe with emerald light.",
                    "environment": "Hidden Garden Sanctuary",
                    "camera": "drift",
                    "animation_technique": "particle_system",
                    "particles": "fireflies",
                    "lighting": "Emerald bioluminescence reflecting off metallic fingers",
                    "vo": "Not an echo. Not a glitch. Life, blossoming in the forgotten soil.",
                    "text": "Life. Against all odds.",
                    "bg": "dark",
                    "dur": 6.5,
                    "sfx": [{"name": "riser", "at": 0.5, "gain": 0.4}, {"name": "boom", "at": 2.2, "gain": 0.5}]
                },
                {
                    "type": "story",
                    "id": "sc_04",
                    "narrative_purpose": "Transformation: from desolate machine to devoted guardian",
                    "visual_description": "Unit 7 shields the tiny flower from a rising wind with mechanical palms, its optical glow warming to gold.",
                    "environment": "Protected Sanctuary",
                    "camera": "zoom_out",
                    "character": "Unit 7 sheltering the blossom with both hands",
                    "animation_technique": "character_motion",
                    "particles": "dust",
                    "lighting": "Warm golden sunrise breaking over Martian peaks",
                    "vo": "For the first time on the barren planet... the quiet was no longer lonely.",
                    "text": "No longer alone.",
                    "bg": "dark",
                    "dur": 7.0,
                    "sfx": [{"name": "whoosh", "at": 0.5, "gain": 0.3}]
                }
            ]
        else:
            # Generic narrative
            scenes = [
                {
                    "type": "cinematic",
                    "id": "sc_01",
                    "narrative_purpose": "Establish atmospheric world setting",
                    "visual_description": f"Cinematic wide establishing perspective portraying the world of '{prompt}'.",
                    "camera": "zoom_in",
                    "lighting": "Atmospheric cinematic lighting with anamorphic glow",
                    "vo": f"In a world where everything was about to change.",
                    "text": f"{title}",
                    "bg": "dark",
                    "dur": 5.0,
                    "sfx": [{"name": "whoosh", "at": 0.1, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_02",
                    "narrative_purpose": "Introduce central conflict and protagonist",
                    "visual_description": "Protagonist confronts the unfolding mystery as environmental energy builds.",
                    "camera": "pan_right",
                    "animation_technique": "character_motion",
                    "lighting": "Dramatic contrast with vivid highlights",
                    "vo": "Every step forward unveiled secrets long thought forgotten.",
                    "text": "The Journey Begins",
                    "bg": "dark",
                    "dur": 6.0,
                    "sfx": [{"name": "riser", "at": 0.5, "gain": 0.4}]
                },
                {
                    "type": "story",
                    "id": "sc_03",
                    "narrative_purpose": "Climactic resolution and emotional payoff",
                    "visual_description": "The revelation culminates in radiant illumination and sweeping transformation.",
                    "camera": "drift",
                    "animation_technique": "particle_system",
                    "lighting": "Warm dawn illumination filling the frame",
                    "vo": "And there, at the horizon of tomorrow, destiny was forged.",
                    "text": "Destiny Awaits",
                    "bg": "dark",
                    "dur": 6.5,
                    "sfx": [{"name": "boom", "at": 1.2, "gain": 0.6}]
                }
            ]

    elif category == "educational":
        scenes = [
            {
                "type": "whiteboard",
                "id": "sc_01",
                "narrative_purpose": "Introduce core question or scientific phenomenon",
                "visual_description": "Hand-drawn schematic lines rapidly sketch the central concept onto clean parchment.",
                "camera": "static",
                "animation_technique": "whiteboard_draw",
                "concept": prompt,
                "vo": f"Have you ever wondered how {prompt.lower()} really works?",
                "text": f"Understanding: {title}",
                "bg": "light",
                "dur": 5.5,
                "sfx": [{"name": "pop", "at": 0.3, "gain": 0.3}]
            },
            {
                "type": "motion",
                "template": "16-line-growth",
                "id": "sc_02",
                "narrative_purpose": "Break down mechanism and key relationships",
                "visual_description": "An evolving trajectory with glowing metric nodes traces the exponential principle.",
                "camera": "static",
                "animation_technique": "gsap_motion",
                "vo": "At its heart, the phenomenon follows an elegant and measurable curve.",
                "text": "Core Principles & Growth",
                "bg": "dark",
                "dur": 6.0,
                "sfx": [{"name": "ding", "at": 1.2, "gain": 0.4}]
            },
            {
                "type": "whiteboard",
                "id": "sc_03",
                "narrative_purpose": "Synthesize takeaway and broader significance",
                "visual_description": "Interconnected concept nodes link together with animated arrows forming the complete picture.",
                "camera": "zoom_out",
                "animation_technique": "whiteboard_draw",
                "vo": "When all parts connect, the complex becomes remarkably simple.",
                "text": "Key Takeaway: The Unified Picture",
                "bg": "light",
                "dur": 6.0,
                "sfx": [{"name": "ding", "at": 0.8, "gain": 0.4}]
            }
        ]

    elif category == "cinematic":
        scenes = [
            {
                "type": "cinematic",
                "id": "sc_01",
                "narrative_purpose": "Deep atmospheric emergence",
                "visual_description": "Slow anamorphic lens sweep through layered atmospheric haze and floating dust motes.",
                "camera": "drift",
                "particles": "dust",
                "lighting": "Deep indigo with high-key cyan rim light",
                "vo": "Beyond the noise of the world, silence possesses a voice.",
                "text": f"{title}",
                "bg": "dark",
                "dur": 7.0,
                "sfx": [{"name": "whoosh", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "cinematic",
                "id": "sc_02",
                "narrative_purpose": "Visual poetry crescendo",
                "visual_description": "Geometric light beams pierce through shadows, revealing radiant geometric structures.",
                "camera": "zoom_in",
                "particles": "stars",
                "lighting": "Golden volumetric rays piercing deep shadows",
                "vo": "Every shadow holds the promise of an awakening light.",
                "text": "In Silence, Awakening.",
                "bg": "dark",
                "dur": 7.0,
                "sfx": [{"name": "riser", "at": 1.0, "gain": 0.4}, {"name": "boom", "at": 3.5, "gain": 0.5}]
            }
        ]

    elif category == "social":
        scenes = [
            {
                "type": "kinetic",
                "id": "sc_01",
                "narrative_purpose": "0-second hook to stop the scroll",
                "visual_description": "High-impact kinetic text explosion with vibrant chromatic aberration.",
                "camera": "push",
                "animation_technique": "kinetic_type",
                "vo": f"Stop scrolling. Here is what you need to know about {prompt.lower()}.",
                "text": f"WAIT. [Watch This.]",
                "bg": "dark",
                "dur": 3.8,
                "sfx": [{"name": "boom", "at": 0.1, "gain": 0.5}]
            },
            {
                "type": "motion",
                "template": "06-notification",
                "id": "sc_02",
                "narrative_purpose": "Rapid value delivery beat",
                "visual_description": "Obsidian floating notification toast sliding in with verified badges and metrics.",
                "camera": "static",
                "animation_technique": "gsap_motion",
                "vo": "Most people miss the one detail that changes everything.",
                "text": "The Secret [Revealed]",
                "bg": "dark",
                "dur": 4.5,
                "sfx": [{"name": "pop", "at": 0.4, "gain": 0.4}]
            },
            {
                "type": "kinetic",
                "id": "sc_03",
                "narrative_purpose": "High retention payoff & CTA",
                "visual_description": "Pulsing accent pill with clear takeaway and follow action.",
                "camera": "zoom_in",
                "animation_technique": "kinetic_type",
                "vo": "Save this video before it disappears. Follow for more.",
                "text": "Save & Share. [Follow For More.]",
                "bg": "dark",
                "dur": 4.2,
                "sfx": [{"name": "ding", "at": 0.5, "gain": 0.4}]
            }
        ]

    elif category == "specialized":
        scenes = [
            {
                "type": "motion",
                "template": "10-candlestick",
                "id": "sc_01",
                "narrative_purpose": "Market and metric reality analysis",
                "visual_description": "Dynamic financial candlestick graph plotting real-time volatility and support floors.",
                "camera": "static",
                "animation_technique": "gsap_motion",
                "vo": "Market structure shifts before the crowd notices.",
                "text": "Market Analysis: [Volatility Floor]",
                "bg": "dark",
                "dur": 5.5,
                "sfx": [{"name": "swish", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "motion",
                "template": "13-compare-bars",
                "id": "sc_02",
                "narrative_purpose": "Direct metric comparison",
                "visual_description": "Before and after comparison columns blooming with silver metallic gradients.",
                "camera": "static",
                "animation_technique": "gsap_motion",
                "vo": "Comparing raw baseline against optimized performance: a 10x difference.",
                "text": "10x Performance [Surge]",
                "bg": "dark",
                "dur": 5.5,
                "sfx": [{"name": "ding", "at": 0.8, "gain": 0.4}]
            }
        ]

    else:  # Business / marketing
        scenes = [
            {
                "type": "text",
                "id": "sc_01",
                "vo": f"What if you could transform how you handle {prompt.lower()}?",
                "bg": "dark",
                "dur": 4.5,
                "sfx": [{"name": "pop", "at": 0.2, "gain": 0.3}]
            },
            {
                "type": "hero",
                "id": "sc_02",
                "vo": "Introducing",
                "bg": "glow",
                "dur": 2.2,
                "sfx": [{"name": "riser", "at": 0.1, "gain": 0.4}, {"name": "boom", "at": 1.2, "gain": 0.6}]
            },
            {
                "type": "logo",
                "id": "sc_03",
                "vo": f"{title}. Intelligent automation built for results.",
                "tagline": "Intelligent automation|built for results.",
                "bg": "dark",
                "dur": 4.5
            },
            {
                "type": "motion",
                "template": "16-line-growth",
                "id": "sc_04",
                "vo": "Watch your efficiency and revenue accelerate from day one.",
                "text": "Accelerate [Your Growth]",
                "bg": "dark",
                "dur": 5.0,
                "sfx": [{"name": "ding", "at": 1.0, "gain": 0.4}]
            },
            {
                "type": "text",
                "id": "sc_05",
                "vo": "Start your [free trial] today.",
                "sub": "Get started now",
                "bg": "dark",
                "dur": 4.0
            }
        ]

    # Adjust durations to match target_dur approximately
    total_dur = sum(s.get("dur", 5.0) for s in scenes)
    if total_dur > 0:
        ratio = target_dur / total_dur
        for s in scenes:
            s["dur"] = round(s.get("dur", 5.0) * ratio, 1)

    plan = {
        "name": safe_name,
        "title": title,
        "prompt": prompt,
        "category": category,
        "style": style,
        "format": fmt,
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
    return plan


def llm_creative_director(prompt: str, options: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Attempts planning via Groq or Anthropic LLM API, falling back to local heuristic director on error."""
    groq_key = ENV.get("GROQ_API")
    anthropic_key = ENV.get("ANTHROPIC_API")

    system_prompt = """You are Antigravity Universal Animation Director.
You transform an arbitrary user prompt into a structured, highly creative animated video plan (JSON).
NEVER restrict the video to a product launch or marketing ad unless the user explicitly asks for one.
Support diverse genres:
1. Storytelling / Entertainment (narrative, character journey, emotional beats, atmosphere)
2. Educational / Explainer (step-by-step breakdown, whiteboard, science visuals)
3. Cinematic / Creative (visual poetry, surrealism, sci-fi sequences)
4. Social Media (kinetic typography, rapid hooks, 9:16 format)
5. Specialized / Data (charts, candlestick, comparisons, timeline)
6. Business / Marketing (only when requested)

Available scene types:
- 'story': Character narrative, animated environment, particles (dust/stars/embers/spores/fireflies), camera (pan_left/pan_right/zoom_in/zoom_out/drift), dialogue or narration.
- 'motion': Motion graphics templates ('16-line-growth', '10-candlestick', '13-compare-bars', '06-notification', '07-chat-sim', '08-prompt-bar', '02-three-step', '15-bar-3d', '22-kinetic-headline', '27-cinematic-hud-overlay').
- 'cinematic': Sweeping visual scenes, deep atmospheric lighting, letterboxing, anamorphic flares.
- 'whiteboard': Hand-drawn sketches, educational diagrams, progressive node reveals.
- 'kinetic': High-energy kinetic typography, bold keyword pills [pill], word reveals.
- 'text', 'hero', 'logo', 'ui', 'cards', 'terminal', 'chips': for SaaS/product videos.

Music moods: 'cinematic', 'ambient', 'synthwave', 'playful', 'lofi', 'suspense', 'corporate', 'silent'.
Formats: '16:9', '9:16', '1:1', '4:5'.

Return ONLY valid JSON with keys: name, title, category, style, format, theme, music, continuity, scenes.
Do not wrap in markdown quotes if possible, or provide raw JSON."""

    user_message = f"User Request: {prompt}\nOptions: {json.dumps(options)}"

    # Try Groq first (very fast)
    if groq_key:
        try:
            req_data = {
                "model": "llama-3.3-70b-versatile",
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
                    "User-Agent": "AntigravityVideoGenerator/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=12) as res:
                body = json.loads(res.read().decode("utf-8"))
                content = body["choices"][0]["message"]["content"]
                plan = json.loads(content)
                if "scenes" in plan and len(plan["scenes"]) > 0:
                    return plan
        except Exception as e:
            # Fall through to Anthropic or local
            pass

    # Try Anthropic Claude if available
    if anthropic_key:
        try:
            req_data = {
                "model": "claude-3-5-sonnet-20241022",
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
                    "User-Agent": "AntigravityVideoGenerator/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                body = json.loads(res.read().decode("utf-8"))
                text = body["content"][0]["text"]
                # Extract JSON substring
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if m:
                    plan = json.loads(m.group(0))
                    if "scenes" in plan and len(plan["scenes"]) > 0:
                        return plan
        except Exception as e:
            pass

    # Local fallback
    return None


def create_project(prompt: str, options: Optional[Dict[str, Any]] = None, target_dir: Optional[str] = None) -> Dict[str, Any]:
    """Master entry point: creates an animated video project from prompt and options."""
    opts = options or {}
    
    # Try LLM director first, fall back to local heuristic director
    plan = llm_creative_director(prompt, opts)
    if not plan:
        plan = local_heuristic_director(prompt, opts)

    # Ensure required fields
    if not plan.get("name"):
        plan["name"] = "animated-video"
    if not plan.get("fps"):
        plan["fps"] = 30
    if not plan.get("format"):
        plan["format"] = opts.get("format", "16:9")

    # Target folder
    name = plan["name"]
    proj_dir = target_dir or os.path.join(SKILL_ROOT, "launches", name)
    os.makedirs(proj_dir, exist_ok=True)
    os.makedirs(os.path.join(proj_dir, "assets"), exist_ok=True)
    os.makedirs(os.path.join(proj_dir, "out"), exist_ok=True)

    plan_path = os.path.join(proj_dir, "plan.json")
    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2)

    return {"plan": plan, "project_dir": proj_dir, "plan_path": plan_path}


def main():
    parser = argparse.ArgumentParser(description="Universal AI Animation Director")
    parser.add_argument("prompt", help="Creative prompt, story brief, or concept description")
    parser.add_argument("--category", choices=CATEGORIES, help="Video category")
    parser.add_argument("--style", choices=STYLES, help="Visual style preset")
    parser.add_argument("--format", choices=FORMATS, default="16:9", help="Aspect ratio")
    parser.add_argument("--duration", type=float, default=30.0, help="Target duration in seconds")
    parser.add_argument("--mood", choices=AUDIO_MOODS, help="Audio music mood")
    parser.add_argument("--out", help="Custom output directory")
    parser.add_argument("--json", action="store_true", help="Print raw plan JSON to stdout")

    args = parser.parse_args()
    options = {
        "category": args.category,
        "style": args.style,
        "format": args.format,
        "duration": args.duration,
        "mood": args.mood,
    }
    result = create_project(args.prompt, options, args.out)
    if args.json:
        print(json.dumps(result["plan"], indent=2))
    else:
        p = result["plan"]
        print(f"\n✨ Animated Video Plan Created: {p.get('name')}")
        print(f"   Category: {p.get('category')}  |  Style: {p.get('style')}  |  Format: {p.get('format')}  |  Mood: {p.get('music', {}).get('mood')}")
        print(f"   Scenes: {len(p.get('scenes', []))}  |  Project: {result['project_dir']}")
        print(f"   Plan saved to: {result['plan_path']}\n")
        for i, s in enumerate(p.get("scenes", [])):
            print(f"   [{i+1:02d}] {s.get('type', 'scene').upper():10s} ({s.get('dur', 0):.1f}s) : {(s.get('vo') or s.get('text') or s.get('narrative_purpose') or '')[:70]}")


if __name__ == "__main__":
    main()
