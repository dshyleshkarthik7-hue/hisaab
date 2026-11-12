"""Optional external LLM provider for Hisaab Mitra fluency.

Keys stay server-side. Free tiers may use content for training — never send
identifiable financial profiles to free endpoints.
Falls back to None when no key is configured so Mitra stays grounded/rule-based.
"""
from __future__ import annotations
import json
import os
import urllib.request
from typing import Any

PROVIDER = os.environ.get("HISAAB_LLM_PROVIDER", "").strip().lower()  # gemini | groq | none
API_KEY = os.environ.get("HISAAB_LLM_API_KEY", "").strip()
MODEL = os.environ.get("HISAAB_LLM_MODEL", "").strip()


def available() -> bool:
    return bool(PROVIDER and API_KEY and PROVIDER in ("gemini", "groq"))


def _system_prompt() -> str:
    return (
        "You are Hisaab Mitra, a bilingual (English and Telugu) financial education guide for India. "
        "You ONLY explain verified facts and calculation results provided in the user message. "
        "Never invent tax slabs, interest rates, GST rates, or investment returns. "
        "If data is missing, say so and point to Income Tax Department, RBI, CBIC or SEBI. "
        "Do not give personalised investment advice. Keep answers clear and concise."
    )


def complete(user_message: str, grounded_context: str) -> dict[str, Any] | None:
    if not available():
        return None
    try:
        if PROVIDER == "gemini":
            return _gemini(user_message, grounded_context)
        if PROVIDER == "groq":
            return _groq(user_message, grounded_context)
    except Exception as exc:
        return {"error": str(exc), "provider": PROVIDER}
    return None


def _gemini(user_message: str, grounded_context: str) -> dict[str, Any]:
    model = MODEL or "gemini-2.0-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={API_KEY}"
    )
    payload = {
        "system_instruction": {"parts": [{"text": _system_prompt()}]},
        "contents": [{
            "role": "user",
            "parts": [{"text": f"Grounded context:\n{grounded_context}\n\nUser question:\n{user_message}"}],
        }],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    return {"provider": "gemini", "model": model, "text": text}


def _groq(user_message: str, grounded_context: str) -> dict[str, Any]:
    model = MODEL or "llama-3.3-70b-versatile"
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 800,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": f"Grounded context:\n{grounded_context}\n\nUser question:\n{user_message}"},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {"provider": "groq", "model": model, "text": text}
