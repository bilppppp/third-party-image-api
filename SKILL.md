---
name: third-party-image-api
description: Guide Codex to connect arbitrary official third-party image APIs from docs, curl examples, JavaScript examples, or Python examples, then generate or edit images in opencode through reusable provider profiles. Use when a user wants to use a non-Tuzi image generation/edit API, asks to adapt official API docs into an image-generation skill workflow, or needs a saved provider configuration for future image calls.
---

# Third-Party Image API

Use this skill to turn official third-party image API docs or examples into a saved provider profile, then call that profile to generate or edit images.

## Workflow

1. Determine `SKILL_DIR` as this skill directory.
2. If the user names an existing provider, run:

```bash
bun ${SKILL_DIR}/scripts/main.ts providers list
```

3. If the provider exists, ask the user to set the provider's API key in the environment variable named by the profile, then call it.
4. If the provider does not exist, ask for official docs, a curl example, JavaScript example, Python example, or a response example.
5. Build a provider JSON profile using `references/provider-profile-schema.md`.
6. Read `references/adapter-lessons.md` before finalizing the profile, especially for OpenAI-compatible APIs, image URL responses, aspect ratios, long-running jobs, or image edit APIs.
7. Validate and install the profile:

```bash
bun ${SKILL_DIR}/scripts/main.ts providers validate --file provider.json
bun ${SKILL_DIR}/scripts/main.ts providers install --file provider.json
```

8. Call the provider. Never put API keys in commands, prompts, profile files, or final replies.

## Calling Providers

Text to image:

```bash
bun ${SKILL_DIR}/scripts/main.ts call --provider <name> --operation generate --prompt "A cat" --output out.png
```

Image edit or reference-image generation:

```bash
bun ${SKILL_DIR}/scripts/main.ts call --provider <name> --operation edit --prompt "Make it blue" --ref source.png --output edited.png
```

Supported request shapes: JSON, URL-encoded form, and multipart form with image files.

Supported response shapes: direct image bytes, image URL, base64 image, and async job polling.

## Profile Storage

Installed profiles are stored in a generic user config directory:

- macOS / Linux: `~/.config/third-party-image-api/providers/<provider>.json`
- Windows: `%APPDATA%/third-party-image-api/providers/<provider>.json`

Profiles must not contain secrets. Store only endpoint URLs, field mappings, response paths, and the name of the environment variable that contains the key.

## Reading Docs

When converting official docs:

- Extract endpoint URL, HTTP method, auth style, request body type, prompt field, optional image/reference fields, and response image location.
- If docs list multiple similar endpoints, verify which one is actually sync, async, direct image URL, or task polling; do not trust endpoint names alone.
- Prefer official HTTP or curl examples. If only SDK examples exist, infer the HTTP shape only when the SDK code is explicit.
- If docs omit the response body, ask the user for a successful response example before writing the profile.
- If the API returns business errors inside a 200 JSON response, ask for those examples and document them next to the profile because HTTP status alone may not reveal quota or token problems.
- If the API needs browser login, captcha, OAuth browser consent, or non-HTTP automation, stop and explain that this skill does not support it.

For examples, read `references/provider-examples.md`.

For hard-won adaptation pitfalls from the Tuzi and ALAPI integration work, read `references/adapter-lessons.md`.

## Script Interface

```bash
# Validate a profile file
bun ${SKILL_DIR}/scripts/main.ts providers validate --file provider.json

# Install a profile into the user config directory
bun ${SKILL_DIR}/scripts/main.ts providers install --file provider.json

# List installed providers
bun ${SKILL_DIR}/scripts/main.ts providers list

# Call a provider
bun ${SKILL_DIR}/scripts/main.ts call --provider <name> --operation generate --prompt "..." --output out.png
```

## Safety Rules

- Do not write API keys into provider JSON files.
- Do not prefix commands with `API_KEY=...`; terminal transcripts may show full commands.
- If a user pasted a real key, tell them to rotate it.
- Use provider auth fields to name environment variables, not to store values.
- Run `providers validate` before `providers install`.
