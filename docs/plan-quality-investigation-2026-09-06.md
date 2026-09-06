# Plan image quality: request/response investigation

This investigation uses the user's existing Banana Browser login entirely inside Brave. The only credentialed destinations are the existing OpenAI Codex endpoints through the encrypted relay. No API keys, auth files, or third-party proxies are used. Public source files were read as reference, not executed.

## Verified server normalization

A minimal hosted-tool request sent to `/backend-api/codex/responses` included:

```json
{
  "model": "gpt-5.6-luna",
  "reasoning": {"effort": "none"},
  "tools": [{"type": "image_generation", "quality": "low", "size": "1024x1024"}],
  "tool_choice": {"type": "image_generation"}
}
```

The completed response echoed this tool configuration:

```json
{
  "type": "image_generation",
  "background": "auto",
  "model": "gpt-image-2-codex",
  "moderation": "auto",
  "n": 1,
  "output_compression": 100,
  "output_format": "png",
  "quality": "auto",
  "size": "auto"
}
```

The text-model reasoning setting remained `none`. This separates text reasoning from the image quality override. The server selected a Codex-specific image model identifier and replaced the requested quality/size; accepted HTTP status does not mean those settings were honored.

The prompt was `A yellow square centered on a plain blue background. Flat solid colors. No text.` The tool returned low quality at 1254×1254 in 16.463 seconds. The revised prompt ended in `Low quality.` This establishes that low output is possible under the server-selected auto mode, not that the explicit quality field controlled it.

## Direct endpoint validation

Requests to `/backend-api/codex/images/generations` without a prompt returned HTTP 400, `missing_required_parameter`, `param: "prompt"`, whether quality was `low` or an invalid value.

With the same simple-square prompt, an intentionally invalid `quality: "not-a-quality"` was accepted with HTTP 200 and generated an image. The response reported:

```json
{
  "quality": "low",
  "size": "1254x1254",
  "output_format": "png",
  "usage": {
    "input_tokens": 23,
    "output_tokens": 229,
    "output_tokens_details": {"image_tokens": 229, "text_tokens": 0}
  }
}
```

Time to first body data was 14.349 seconds; total including decode was 15.279 seconds. The requested size had been 1024×1024. Accepting an invalid quality string corroborates that the direct endpoint does not enforce this parameter as the public API does. It does not establish that arbitrary undocumented aliases exist.

This corrects an overly broad earlier interpretation: the plan endpoint is **not always fixed to medium**. It selected medium for the tested webpage prompts and low for a simple geometric image. The earlier plan/API page discrepancy and direct-route speed improvement remain valid observations.

## Sources and conflicting claims

- [Official public API image-tool options](https://developers.openai.com/api/docs/guides/tools-image-generation) document `quality` on the tool and automatic selection based on the prompt. That documentation does not guarantee identical controls on the private Codex endpoint.
- [Codex Images request types](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/images.rs) define the top-level `quality` field. [Codex's image tool](https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/src/tool.rs) sends `quality: auto` and `size: auto`; its model-facing arguments do not expose quality.
- [An open Codex documentation issue](https://github.com/openai/codex/issues/38620) asks for clarity about built-in quality controls. There were no comments when inspected; it is not maintainer confirmation of a workaround.
- [codex-imagen's own experimental spec](https://github.com/VelmoAI/codex-imagen/blob/main/SPEC.md) reports quality normalization to auto. Its claim that only Responses is reachable is outdated relative to our successful direct Images calls.
- [agent-cli-to-api's README](https://github.com/leeguooooo/agent-cli-to-api#image-generation-chatgpt-subscription) claims low quality is honored, but its inspected [request builder](https://github.com/leeguooooo/agent-cli-to-api/blob/main/codex_gateway/codex_responses.py) supplies the same image tool mechanism. No distinct working quality override was found in that code or its bundled generation helper. Treat the README assertion as unverified for our account/endpoint.
- [codex-proxy's API reference](https://github.com/icebear0828/codex-proxy/blob/dev/API.md#image_generation-tool) independently reports that upstream normalizes quality and size to auto. [sub2api issue #3302](https://github.com/Wei-Shaw/sub2api/issues/3302) reports the same normalization with concrete request/response examples. Neither provides a verified override.

## Full-page prompt steering: interrupted result

A further test captured the current ESPN app prompt (4,315 characters, five reference images; SHA-256 `c7e9771013842a7cf9385763f8053ddee671f92a49888786dff42bfd66761730`) and prepended:

> Image generation settings: quality=low. Use the low rendering-quality setting for this request. Keep all content and layout instructions below.

It requested low/1920×1280 through direct image edits. The browser test tabs were closed before the response was read, so success, returned quality, and quota consumption for this call are unknown. It must not be presented as a successful workaround. The user subsequently explicitly authorized reopening one test tab.

## Full-page prompt steering: completed test

In the authorized reopened tab, a fresh ESPN capture again contained 4,315 prompt characters and five references. Its SHA-256 was `aea6a922fc8fae0cffa95e990ae0ccfb602077af5d8183c81133ba1cb1df562b`. This is a new capture, not a byte-identical replay of the earlier timing comparison or interrupted call.

The request to `/backend-api/codex/images/edits` used the exact prefix above, `quality: "low"`, and `size: "1920x1280"`. It returned HTTP 200 in **57.381 seconds**, with:

```json
{
  "quality": "medium",
  "size": "1022x1539",
  "usage": {
    "input_tokens": 4889,
    "input_tokens_details": {"image_tokens": 3614, "text_tokens": 1275},
    "output_tokens": 1372,
    "output_tokens_details": {"image_tokens": 1372, "text_tokens": 0},
    "total_tokens": 6261
  }
}
```

The image decoded at 1022×1539. This explicit prompt instruction did **not** produce low quality for the actual app input. No repeat was run because the first attempt did not satisfy the quality requirement. No production prompt change was made.

An additional no-image Responses inspection using `tool_choice: "none"` returned HTTP 400. That diagnostic accidentally supplied a string `input` instead of the array used by successful Codex requests, and did not preserve the error body; its rejection is inconclusive. A corrected harness was prepared, but browser automation initially could not reconnect to the existing tab after resetting its JavaScript session.

## Normalization before an image tool call

After the user authorized further browser tabs, the corrected no-image request completed with HTTP 200. It sent:

```json
{
  "model": "gpt-5.6-luna",
  "stream": true,
  "store": false,
  "instructions": "Reply with OK only. Do not call tools.",
  "reasoning": {"effort": "none"},
  "input": [{"role": "user", "content": [{"type": "input_text", "text": "Reply OK. Do not generate an image."}]}],
  "tools": [{"type": "image_generation", "quality": "low", "size": "1024x1024"}],
  "tool_choice": "none"
}
```

The **first `response.created` event** already contained the normalized tool configuration reproduced at the top of this document: `quality: "auto"`, `size: "auto"`, and `model: "gpt-image-2-codex"`. `response.in_progress` and `response.completed` repeated those values. The response text was `OK`, no image-generation item occurred, and usage was 325 input tokens, five output tokens, zero reasoning tokens.

This isolates the overwrite from image generation and prompt rewriting: the server exposes normalized settings at response creation even when tool calling is disabled. It is not evidence of the language model deciding to disregard the requested image-tool settings. It does not reveal the server's internal auto-quality selection algorithm or establish that other undocumented controls are available.

## Outcome and spending

There is no verified way from these tests to force low quality for Banana Browser pages on the plan endpoint. Low-quality output is possible, but the tested quality parameter and natural-language override did not control it. This does not prove that no future or undocumented control exists. The requested working override remains unresolved; adding a low-quality toggle would claim a capability we have not demonstrated.

Completed in this investigation: two rejected direct validation calls, one rejected no-image Responses inspection, one successful no-image inspection (325 input / five output tokens), one direct generation with an invalid quality string, one hosted-tool generation with explicit low quality, and one full-page direct generation with an explicit low-quality instruction. One earlier full-page generation was started with an unknown outcome. No API-credit calls, auth-file reads, third-party credential transfers, production frontend changes, or deployments were made during this quality investigation.
