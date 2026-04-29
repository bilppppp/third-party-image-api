# Image API Adaptation Lessons

These notes summarize practical pitfalls found while adapting Tuzi text-to-image/edit APIs and ALAPI-style relay APIs. Treat them as a checklist for other third-party image APIs; do not copy provider-specific values unless the target provider documents the same behavior.

## Start From Actual Wire Behavior

- Prefer official curl or HTTP examples over SDK-only examples.
- Confirm the real success response shape before writing a profile.
- Endpoint names can be misleading. A path named "sync" may still return a task id that needs polling, while a path named "async" may return a direct image URL. Trust observed request/response examples over names.
- If a provider offers both task-based and direct-image endpoints, create or choose the profile that matches the user's tolerance for waiting and the available response fields.
- Do not assume OpenAI-compatible APIs return `b64_json`; many return `data[].url` and require a second download.
- Relay providers may wrap payloads deeply, such as `data.data.0.url`; copy the exact response path from a real success response.
- If both base64 and URL forms are possible, keep base64 support and add URL support instead of replacing one with the other.
- Preserve useful error details, but redact keys, bearer tokens, and secret-looking strings.

## Timeouts

- Image generation and edits can take much longer than text APIs.
- Use long timeouts for both the generation/edit request and any follow-up image download.
- Keep long timeouts scoped to image calls; do not apply them to unrelated chat or text requests.
- For async APIs, configure polling with a realistic timeout and explicit success/failure statuses.
- Verify that polling requests use the same authentication mechanism as the initial request. Query-token providers often require the token on both the submit URL and the status URL.

## Request Fields

- Some providers require a response selector such as `response_format: "url"` to return downloadable image links.
- Some relay APIs require authentication as a query parameter rather than a header or body field. Use `auth.type: "query"` and never add the token to the JSON body unless the docs explicitly require it.
- Send provider-specific fields explicitly in the profile: `model`, `size`, `quality`, `n`, `response_format`, or equivalent names.
- Do not invent defaults from a different provider. If docs do not state a field, ask for a working example.
- Normalize model names only when the target API documents that alias; for example, a wrapper prefix may need to be removed before sending.

## Business Errors

- Some APIs return HTTP 200 with a JSON business failure, such as quota exhausted, missing token, or invalid model.
- The runner reports common business failures such as `success: false`, `status: "failed"`, `status: "error"`, `code`, and `message`, but it cannot infer every provider-specific schema. When docs show business error codes, record the common codes beside the profile and run a small real call when possible.
- If a call returns JSON with `success: false`, `code`, or `message` instead of an image path, treat it as a provider error even if the HTTP status is OK.
- For quota errors, report the provider message directly after redaction; do not keep retrying the same request.

## Size And Aspect Ratio

- Many APIs accept concrete `size` values but reject or ignore `aspectRatio`.
- Treat prompt ratios like `16:9`, `9:16`, `4:3`, `3:2`, or `2:1` as local planning input when the API needs `size`.
- Explicit `size` should win over ratio or direction words.
- Direction words such as landscape, portrait, horizontal, vertical, square are useful fallbacks only when no exact ratio is given.
- For arbitrary ratios, choose a legal width and height that obey provider limits such as multiples of 16, maximum edge, maximum ratio, and maximum pixels.
- Do not tell the user the ratio is unsupported if it can be converted into a valid size.

## Image Edit And Reference Images

- Check whether the API wants JSON base64 images or multipart file uploads.
- For multipart APIs, verify whether multiple references use repeated `image` fields or names such as `image[]`; this differs by provider.
- Verify mask field names and mask semantics. Alpha masks and black/white masks may mean opposite things across providers.
- Some edit APIs require the uploaded main image and mask to be square, while the requested output `size` can still be non-square.
- Do not confuse input normalization size with final output size. The uploaded image may be square, but the output can be `1536x1024`, `1024x1536`, or another target.
- If no output ratio is specified for an edit, preserving the first reference image ratio is often the least surprising default.
- Default quality values can affect stability. If docs or testing show a safer default, encode it in the provider profile.

## Output Handling

- Downloaded images may contain alpha transparency and show as black backgrounds in some viewers.
- If the provider often returns transparent PNGs, consider adding a provider-specific post-processing step to flatten onto white before final delivery.
- Only crop or resize returned edit results when necessary. If the returned image already matches the requested output size, keep it.
- Avoid using an internal content rectangle to crop every edit result; it is a fallback for square-return cases, not a default finishing step.

## Scope Control

- Keep provider-specific quirks scoped to that provider profile or a small provider-specific runner extension.
- Do not change unrelated chat, text, or non-image API behavior while adapting image calls.
- Validate text-to-image and image-to-image separately; a working generation endpoint does not prove the edit endpoint is correct.
- When a profile is based on partial docs, mark what is assumed and ask for a real response example before installing it for repeated use.
- For relay platforms, keep a note of which endpoint was actually tested, because docs may present multiple endpoints with similar names but incompatible response formats.
