# Third-Party Image API Skill

`third-party-image-api` is a Codex/opencode skill for connecting official third-party image generation APIs from docs or examples. It helps turn a provider's curl, JavaScript, Python, or HTTP documentation into a reusable provider profile, then calls that profile to generate or edit images.

## What It Does

- Converts official API docs into reusable provider JSON profiles.
- Supports text-to-image and image edit/reference-image calls.
- Supports JSON, URL-encoded form, and multipart form requests.
- Supports direct image bytes, image URLs, base64 images, and async polling results.
- Stores provider profiles in a generic user config directory.
- Keeps API keys out of provider files, commands, logs, and final replies.

## Files

- `SKILL.md` - Main skill workflow for Codex/opencode.
- `scripts/main.ts` - CLI for validating, installing, listing, and calling providers.
- `references/provider-profile-schema.md` - Provider profile format.
- `references/provider-examples.md` - Example profiles for common API shapes.
- `references/adapter-lessons.md` - Practical lessons from real Tuzi and ALAPI integrations.
- `agents/openai.yaml` - UI metadata for opencode skill discovery.

## Quick Start

Install or validate a provider profile:

```bash
cd third-party-image-api
bun scripts/main.ts providers validate --file provider.json
bun scripts/main.ts providers install --file provider.json
```

List installed providers:

```bash
bun scripts/main.ts providers list
```

Generate an image:

```bash
bun scripts/main.ts call \
  --provider example-provider \
  --operation generate \
  --prompt "A cinematic moonlit garden" \
  --size 1024x1024 \
  --output out.png
```

Edit an image or use a reference image:

```bash
bun scripts/main.ts call \
  --provider example-provider \
  --operation edit \
  --prompt "Make the coat blue" \
  --ref source.png \
  --output edited.png
```

## Provider Profile Storage

Installed profiles are saved outside the repo:

- macOS / Linux: `~/.config/third-party-image-api/providers/<provider>.json`
- Windows: `%APPDATA%/third-party-image-api/providers/<provider>.json`

Profiles store endpoint URLs, request fields, response paths, and environment variable names. They must not store real API keys.

## Secrets

Do not put API keys directly in shell commands or provider JSON files. Put keys in environment variables, then reference only the variable name in the provider profile:

```json
{
  "auth": {
    "type": "query",
    "env": "EXAMPLE_API_TOKEN",
    "query": "token"
  }
}
```

## Example Provider

`alapi-gpt-image-2.json` is an example profile for an ALAPI-style relay API that uses query-parameter authentication and nested image URL responses. It contains no real token.

## Provider Links

- Tuzi API: https://api.tu-zi.com/register?aff=qjG3
- ALAPI: https://www.alapi.cn/aff/itpgq3

## Development

Run checks:

```bash
cd scripts
bun run check
```

The tests cover provider install/list/validate, JSON calls, multipart edits, form requests, binary responses, image URL downloads, polling, redaction, and business-error reporting.
