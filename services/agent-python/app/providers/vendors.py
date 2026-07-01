"""Concrete providers: Anthropic, OpenAI, and a deterministic heuristic provider
used for $0 dev/eval and fully-offline demo runs."""
from __future__ import annotations

from .base import LLMResponse, Provider, approx_tokens


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str):
        import anthropic  # lazy import so the package is optional
        self._client = anthropic.Anthropic(api_key=api_key)

    def complete(self, *, system: str, prompt: str, model: str,
                 json_mode: bool = False, max_tokens: int = 1024) -> LLMResponse:
        msg = self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system + ("\nRespond with a single JSON object and nothing else." if json_mode else ""),
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")
        usage = getattr(msg, "usage", None)
        ti = getattr(usage, "input_tokens", approx_tokens(system, prompt))
        to = getattr(usage, "output_tokens", approx_tokens(text))
        return LLMResponse(text=text, model=model, tokens_in=ti, tokens_out=to, raw=msg)


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str):
        import openai
        self._client = openai.OpenAI(api_key=api_key)

    def complete(self, *, system: str, prompt: str, model: str,
                 json_mode: bool = False, max_tokens: int = 1024) -> LLMResponse:
        kwargs = {"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": prompt}]}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = self._client.chat.completions.create(**kwargs)
        text = resp.choices[0].message.content or ""
        u = resp.usage
        return LLMResponse(text=text, model=model,
                           tokens_in=getattr(u, "prompt_tokens", approx_tokens(system, prompt)),
                           tokens_out=getattr(u, "completion_tokens", approx_tokens(text)), raw=resp)

    def embed(self, texts: list[str], model: str) -> list[list[float]]:
        resp = self._client.embeddings.create(model=model, input=texts)
        return [d.embedding for d in resp.data]


class GroqProvider:
    """Groq's free tier, OpenAI-compatible API (same client as fintech siblings
    CredAgent/FraudPulse). Used as the $0 'real model' path — genuine LLM reasoning
    with no per-token cost, instead of the deterministic heuristic fallback."""
    name = "groq"

    def __init__(self, api_key: str):
        import openai  # Groq speaks the OpenAI chat-completions wire format
        self._client = openai.OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")

    def complete(self, *, system: str, prompt: str, model: str,
                 json_mode: bool = False, max_tokens: int = 1024) -> LLMResponse:
        kwargs = {"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": prompt}]}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = self._client.chat.completions.create(**kwargs)
        text = resp.choices[0].message.content or ""
        u = resp.usage
        return LLMResponse(text=text, model=model,
                           tokens_in=getattr(u, "prompt_tokens", approx_tokens(system, prompt)),
                           tokens_out=getattr(u, "completion_tokens", approx_tokens(text)), raw=resp)


class HeuristicProvider:
    """Deterministic, $0, offline. The router prefers structured Python logic over
    this for each capability, but complete() exists so the abstraction is total."""
    name = "heuristic-local"

    def complete(self, *, system: str, prompt: str, model: str,
                 json_mode: bool = False, max_tokens: int = 1024) -> LLMResponse:
        text = "{}" if json_mode else "[heuristic] " + prompt[:120]
        return LLMResponse(text=text, model="heuristic-local",
                           tokens_in=approx_tokens(system, prompt), tokens_out=approx_tokens(text))
