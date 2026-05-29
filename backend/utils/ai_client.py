"""
Unified AI vision client supporting Gemini (primary) and OpenRouter (fallback).
Gemini Flash is the default provider.
Handles provider selection, retry logic, and response parsing.
"""

import os
import json
import httpx
import logging
import base64
import io
from typing import Optional
from PIL import Image

logger = logging.getLogger(__name__)

# ── Provider config ──
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")  # "gemini" or "openrouter"

# OpenRouter
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-flash-2.5")

# Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"



async def call_vision_model(
    prompt: str,
    image_data_url: str,
    max_tokens: int = 500,
    temperature: float = 0.1,
) -> str:
    """
    Send a vision request to the AI provider.
    Tries NVIDIA NIM first (if configured), falls back to OpenRouter.
    Returns the raw text content from the model response.
    """
    providers = _get_provider_order()

    last_error = None
    for provider in providers:
        try:
            result = await _call_provider(
                provider, prompt, image_data_url, max_tokens, temperature
            )
            if result:
                return result
        except Exception as e:
            logger.warning(f"Provider {provider} failed: {e}")
            last_error = e
            continue

    raise Exception(f"All AI providers failed. Last error: {last_error}")


def _get_provider_order() -> list:
    """Determine provider priority order."""
    primary = AI_PROVIDER.lower()
    providers = []
    
    if primary == "gemini" and GEMINI_API_KEY:
        providers.append("gemini")
    elif primary == "openrouter" and OPENROUTER_API_KEY:
        providers.append("openrouter")
        
    if GEMINI_API_KEY and "gemini" not in providers:
        providers.append("gemini")
    if OPENROUTER_API_KEY and "openrouter" not in providers:
        providers.append("openrouter")
        
    return providers if providers else ["gemini"]


async def _call_provider(
    provider: str,
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> Optional[str]:
    """Call a specific provider and return the response content."""
    if provider == "gemini":
        return await _call_gemini(prompt, image_data_url, temperature)
    elif provider == "openrouter":
        return await _call_openrouter(prompt, image_data_url, max_tokens, temperature)
    else:
        raise ValueError(f"Unknown provider: {provider}")





async def _call_openrouter(
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """Call OpenRouter API with Gemini Flash vision model."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://alaiy-catalog.local",
        "X-Title": "Alaiy Garment Catalog",
    }

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url},
                    },
                ],
            }
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            OPENROUTER_BASE_URL, headers=headers, json=payload
        )
        response.raise_for_status()
        result = response.json()

    content = result["choices"][0]["message"]["content"]
    logger.info(f"[OpenRouter] Response received ({len(content)} chars)")
    return _clean_response(content)


def _clean_response(content: str) -> str:
    """Strip markdown code blocks and whitespace from model response."""
    content = content.strip()
    # Strip code blocks if model ignores instructions
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:])  # remove first line
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


def parse_json_response(content: str) -> list | dict:
    """Parse a JSON response (object or array) from the model, handling common issues."""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Try python's literal eval in case it returned python dict/list syntax
        import ast
        try:
            val = ast.literal_eval(content)
            if isinstance(val, (dict, list)):
                return val
        except Exception:
            pass

        # Try to extract a JSON array first [ ... ]
        import re
        array_match = re.search(r'\[\s*\{.*\}\s*\]', content, re.DOTALL)
        if array_match:
            json_str = array_match.group()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                try:
                    val = ast.literal_eval(json_str)
                    if isinstance(val, list):
                        return val
                except Exception:
                    pass

        # Try to extract a JSON object next { ... }
        object_match = re.search(r'\{.*\}', content, re.DOTALL)
        if object_match:
            json_str = object_match.group()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                try:
                    val = ast.literal_eval(json_str)
                    if isinstance(val, dict):
                        return val
                except Exception:
                    pass
        logger.error(f"Failed to parse JSON from: {content[:200]}")
        raise






async def _call_gemini(prompt: str, image_data_url: str, temperature: float = 0.1) -> str:
    """Call Google Gemini API."""
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set.")
        
    print(f"\n[GEMINI VISION] Sending request to Gemini using model {GEMINI_MODEL}")
    
    import re
    match = re.match(r'data:(image/\w+);base64,(.*)', image_data_url)
    if not match:
        raise ValueError("Invalid image_data_url format for Gemini")
        
    mime_type = match.group(1)
    base64_data = match.group(2)
    
    url = f"{GEMINI_API_URL}/{GEMINI_MODEL}:streamGenerateContent?key={GEMINI_API_KEY}"
    
    payload = {
        "contents": [
          {
            "role": "user",
            "parts": [
              {
                "text": prompt
              },
              {
                "inlineData": {
                  "mimeType": mime_type,
                  "data": base64_data
                }
              }
            ]
          }
        ],
        "generationConfig": {
          "temperature": temperature
        }
    }
    
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
        
        if response.status_code != 200:
            logger.error(f"[GEMINI VISION] Error {response.status_code}: {response.text}")
            response.raise_for_status()
            
        result = response.json()
        
    content = ""
    # streamGenerateContent typically returns a list of JSON objects
    if isinstance(result, list):
        for chunk in result:
            try:
                parts = chunk.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                for p in parts:
                    if "text" in p:
                        content += p["text"]
            except Exception:
                pass
    elif isinstance(result, dict):
        try:
            parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            for p in parts:
                if "text" in p:
                    content += p["text"]
        except Exception:
            pass
            
    print(f"[GEMINI VISION] Response received ({len(content)} chars)")
    return _clean_response(content)
