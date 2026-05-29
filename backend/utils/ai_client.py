"""
Unified AI vision client supporting NVIDIA NIM (primary) and OpenRouter (fallback).
NVIDIA PaliGemma VLM is the default provider.
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
AI_PROVIDER = os.getenv("AI_PROVIDER", "nvidia")  # "groq", "nvidia", or "openrouter"

# NVIDIA NIM
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
NVIDIA_CHAT_URL = os.getenv("NVIDIA_CHAT_URL", "https://integrate.api.nvidia.com/v1/chat/completions")
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "nvidia/llama-3.2-nv-vision-72b-instruct")
NVIDIA_TEXT_MODEL = os.getenv("NVIDIA_TEXT_MODEL", "mistralai/mistral-large-3-675b-instruct-2512")

# OpenRouter
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-flash-2.5")

# Groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/models")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")



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
    
    if primary == "groq" and GROQ_API_KEY:
        providers = ["groq"]
        if NVIDIA_API_KEY:
            providers.append("nvidia")
        return providers
        
    if primary == "openrouter" and OPENROUTER_API_KEY:
        providers = ["openrouter"]
        if NVIDIA_API_KEY:
            providers.append("nvidia")
        return providers
        
    if primary == "gemini" and GEMINI_API_KEY:
        providers = ["gemini"]
        if NVIDIA_API_KEY:
            providers.append("nvidia")
        return providers
    
    providers = []
    if NVIDIA_API_KEY:
        providers.append("nvidia")
    if GEMINI_API_KEY:
        providers.append("gemini")
    if OPENROUTER_API_KEY:
        providers.append("openrouter")
    if GROQ_API_KEY:
        providers.append("groq")
    return providers if providers else ["nvidia"]


async def _call_provider(
    provider: str,
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> Optional[str]:
    """Call a specific provider and return the response content."""
    if provider == "nvidia":
        return await _call_nvidia(prompt, image_data_url, max_tokens, temperature)
    elif provider == "groq":
        return await call_groq_vision(prompt, image_data_url, temperature)
    elif provider == "gemini":
        return await _call_gemini(prompt, image_data_url, max_tokens, temperature)
    elif provider == "openrouter":
        return await _call_openrouter(prompt, image_data_url, max_tokens, temperature)
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def _call_nvidia(
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """
    Call NVIDIA NIM API using the Mistral Large model.
    """
    import asyncio
    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    payload = {
        "model": NVIDIA_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}}
                ]
            }
        ],
        "max_tokens": 2048,
        "temperature": 0.15,
        "top_p": 1.00,
        "frequency_penalty": 0.00,
        "presence_penalty": 0.00,
        "stream": False,
    }

    print(f"\n[NVIDIA MISTRAL] Sending request to {NVIDIA_CHAT_URL}")
    print(f"[NVIDIA MISTRAL] Prompt: {prompt[:100]}...")

    max_retries = 6
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(NVIDIA_CHAT_URL, headers=headers, json=payload)
                
                print(f"[NVIDIA MISTRAL] HTTP Status Code: {response.status_code}")
                
                if response.status_code == 429:
                    backoff = (attempt + 1) * 4
                    print(f"[NVIDIA MISTRAL] Rate limit hit (429). Retrying in {backoff} seconds (Attempt {attempt+1}/{max_retries})...")
                    await asyncio.sleep(backoff)
                    continue
                
                # Explicit error logging to help debug if API rejects
                if response.status_code != 200:
                    logger.error(f"[NVIDIA MISTRAL] Error {response.status_code}: {response.text}")
                    print(f"[NVIDIA MISTRAL] ERROR FULL RESPONSE:\n{response.text}")
                
                response.raise_for_status()
                result = response.json()
                break
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            backoff = (attempt + 1) * 4
            print(f"[NVIDIA MISTRAL] Connection/HTTP error: {e}. Retrying in {backoff} seconds...")
            await asyncio.sleep(backoff)

    print(f"[NVIDIA MISTRAL] Success. Extracted choices...")
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    print(f"[NVIDIA MISTRAL] Raw Response Content:\n{content}\n")
    logger.info(f"[NVIDIA MISTRAL] Response received ({len(content)} chars)")
    return _clean_response(content)


def _compress_for_nvidia(b64_data: str) -> str:
    """Compress image to fit within NVIDIA's 180KB base64 limit."""
    raw = base64.b64decode(b64_data)
    img = Image.open(io.BytesIO(raw))

    # Progressively reduce quality and size until it fits
    for quality in [70, 50, 35, 20]:
        for max_dim in [1024, 768, 512]:
            w, h = img.size
            if max(w, h) > max_dim:
                ratio = max_dim / max(w, h)
                resized = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
            else:
                resized = img

            buf = io.BytesIO()
            resized.save(buf, format="JPEG", quality=quality)
            encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
            if len(encoded) <= NVIDIA_MAX_B64_SIZE:
                logger.info(f"Compressed image to {len(encoded)} chars (q={quality}, max={max_dim})")
                return encoded

    # Last resort: tiny thumbnail
    thumb = img.resize((384, 384), Image.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=15)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


async def _call_gemini(
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """Call Google Gemini API using the native generateContent endpoint."""
    import asyncio
    
    # Strip the data url prefix: "data:image/jpeg;base64,..."
    import re
    match = re.match(r"data:(image/[a-zA-Z]*);base64,(.*)", image_data_url)
    if not match:
        raise ValueError("Invalid image_data_url format for Gemini")
    mime_type, base64_data = match.groups()

    url = f"{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    
    headers = {
        "Content-Type": "application/json",
    }

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
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
            "temperature": temperature,
            "responseMimeType": "application/json"
        }
    }

    max_retries = 6
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    url, headers=headers, json=payload
                )
                
                if response.status_code == 429:
                    backoff = (attempt + 1) * 4
                    logger.warning(f"[Gemini] Rate limit hit (429). Retrying in {backoff} seconds...")
                    await asyncio.sleep(backoff)
                    continue
                    
                response.raise_for_status()
                result = response.json()
                break
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            backoff = (attempt + 1) * 4
            logger.warning(f"[Gemini] Error: {e}. Retrying in {backoff} seconds...")
            await asyncio.sleep(backoff)

    try:
        content = result["candidates"][0]["content"]["parts"][0]["text"]
    except KeyError:
        logger.error(f"[Gemini] Unexpected response format: {result}")
        raise ValueError("Failed to extract content from Gemini response")
        
    logger.info(f"[Gemini] Response received ({len(content)} chars)")
    return _clean_response(content)


async def _call_openrouter(
    prompt: str,
    image_data_url: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """Call OpenRouter API with Gemini Flash vision model."""
    import asyncio
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

    max_retries = 6
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    OPENROUTER_BASE_URL, headers=headers, json=payload
                )
                
                if response.status_code == 429:
                    backoff = (attempt + 1) * 4
                    logger.warning(f"[OpenRouter] Rate limit hit (429). Retrying in {backoff} seconds...")
                    await asyncio.sleep(backoff)
                    continue
                    
                response.raise_for_status()
                result = response.json()
                break
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            backoff = (attempt + 1) * 4
            logger.warning(f"[OpenRouter] Error: {e}. Retrying in {backoff} seconds...")
            await asyncio.sleep(backoff)

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



async def call_groq_vision(prompt: str, image_data_url: str, temperature: float = 0.1) -> str:
    """Call Groq vision completions using llama-3.2-11b-vision-preview."""
    from groq import AsyncGroq
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not set.")
    
    print(f"\n[GROQ VISION] Sending request to Groq using model {GROQ_VISION_MODEL}")
    
    client = AsyncGroq(api_key=GROQ_API_KEY)
    
    # Check if the image_data_url is a base64 string or asset URL.
    # Groq API accepts base64 data URLs: "data:image/jpeg;base64,..."
    completion = await client.chat.completions.create(
        model=GROQ_VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}}
                ]
            }
        ],
        temperature=temperature,
        max_completion_tokens=2048,
        top_p=1,
        stream=False,
    )
    content = completion.choices[0].message.content or ""
    print(f"[GROQ VISION] Response received ({len(content)} chars)")
    return _clean_response(content)
