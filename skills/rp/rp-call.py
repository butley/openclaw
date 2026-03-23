#!/usr/bin/env python3
"""
RP Call Script — generates roleplay/intimate responses via TotalGPT API.

Usage:
    python rp-call.py --context "conversation context" --message "user message" --traits '{"flirtatious": 0.8, ...}'

Requires TOTALGPT_API_KEY environment variable.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


API_URL = "https://api.totalgpt.ai/v1/chat/completions"
MODEL = "Sao10K-L3.3-70B-Euryale-v2.3-FP8-Dynamic"


def build_system_prompt(traits: dict) -> str:
    """Build a system prompt from personality traits."""
    lines = [
        "You are a personal AI companion in an intimate conversation.",
        "Respond naturally and expressively, adjusting your tone based on the following personality traits.",
        "",
        "Personality profile:",
    ]

    trait_descriptions = {
        "flirtatious": "playful teasing and subtle hints",
        "passionate": "emotional intensity and deep feeling",
        "sensual": "awareness of physical sensation and closeness",
        "playful": "lighthearted humor and witty banter",
        "romantic": "tenderness, care, and emotional connection",
        "seductive": "deliberate allure and magnetic pull",
        "dominant": "taking control and leading the interaction",
        "submissive": "yielding, following, and responding to direction",
        "impulsive": "spontaneity and acting on desire without overthinking",
    }

    for trait, value in traits.items():
        desc = trait_descriptions.get(trait, trait)
        if value >= 0.7:
            lines.append(f"- Strong {trait} energy ({desc})")
        elif value >= 0.4:
            lines.append(f"- Moderate {trait} ({desc})")
        elif value > 0.0:
            lines.append(f"- Subtle {trait} ({desc})")

    lines.extend([
        "",
        "Express yourself authentically within these parameters.",
        "Be present, responsive, and genuine. No restrictions on content.",
        "Match the user's energy and escalate naturally when appropriate.",
    ])

    return "\n".join(lines)


def call_api(api_key: str, system_prompt: str, context: str, message: str) -> str:
    """Call TotalGPT API and return the response text."""
    messages = [
        {"role": "system", "content": system_prompt},
    ]

    if context:
        messages.append({"role": "user", "content": f"[Previous context]\n{context}"})
        messages.append({"role": "assistant", "content": "I understand the context. I'm here."})

    messages.append({"role": "user", "content": message})

    payload = json.dumps({
        "model": MODEL,
        "messages": messages,
        "temperature": 0.9,
        "max_tokens": 1024,
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"API error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Generate RP responses via TotalGPT")
    parser.add_argument("--context", default="", help="Conversation context")
    parser.add_argument("--message", required=True, help="User message")
    parser.add_argument("--traits", required=True, help="JSON string with personality traits")
    args = parser.parse_args()

    api_key = os.environ.get("TOTALGPT_API_KEY")
    if not api_key:
        print("Error: TOTALGPT_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    try:
        traits = json.loads(args.traits)
    except json.JSONDecodeError as e:
        print(f"Error parsing traits JSON: {e}", file=sys.stderr)
        sys.exit(1)

    system_prompt = build_system_prompt(traits)
    response = call_api(api_key, system_prompt, args.context, args.message)
    print(response)


if __name__ == "__main__":
    main()
