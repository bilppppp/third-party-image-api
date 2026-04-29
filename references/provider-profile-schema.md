# Provider Profile Schema

Provider profiles are JSON files. They describe how to call one image API provider without storing secrets.

## Top Level

```json
{
  "name": "provider-name",
  "version": 1,
  "auth": { "type": "bearer", "env": "PROVIDER_API_KEY" },
  "operations": {
    "generate": {},
    "edit": {}
  }
}
```

- `name`: letters, digits, dash, or underscore. Used as `<provider>`.
- `version`: must be `1`.
- `auth`: one of the auth shapes below.
- `operations.generate`: text-to-image.
- `operations.edit`: image edit or reference-image generation.

## Auth

```json
{ "type": "none" }
{ "type": "bearer", "env": "PROVIDER_API_KEY" }
{ "type": "bearer", "env": "PROVIDER_API_KEY", "header": "Authorization", "prefix": "Bearer " }
{ "type": "header", "env": "PROVIDER_API_KEY", "header": "X-API-Key" }
{ "type": "query", "env": "PROVIDER_API_KEY", "query": "api_key" }
```

Store only the environment variable name. Never store the real key.

## Operation

```json
{
  "method": "POST",
  "url": "https://api.example.com/v1/images",
  "request": {
    "type": "json",
    "headers": {},
    "query": {},
    "body": { "prompt": "{{prompt}}" }
  },
  "response": { "type": "imageUrl", "path": "data.0.url" }
}
```

Request `type` values:

- `json`: sends JSON.
- `form`: sends `application/x-www-form-urlencoded`.
- `multipart`: sends `multipart/form-data`; use `{{ref:0:file}}` for image file fields.

Response `type` values:

- `imageUrl`: read a URL from JSON and download it.
- `base64`: read a base64 string from JSON and save it as an image.
- `binary`: save the HTTP response body directly.
- `poll`: read a task id, poll until success, then extract an image from the poll result.

The runner uses long request and download timeouts by default because image APIs often exceed ordinary HTTP timeouts. If an official API asks for fields such as `response_format`, `size`, `quality`, or `n`, put them directly in the request body instead of relying on hidden defaults.

## Placeholders

- `{{prompt}}`
- `{{size}}`
- `{{ar}}`
- `{{quality}}`
- `{{provider}}`
- `{{operation}}`
- `{{taskId}}` for poll URLs.
- `{{ref:0:file}}` for multipart image upload.
- `{{ref:0:base64}}` for base64 image content.
- `{{ref:0:dataUrl}}` for `data:image/...;base64,...`.
- `{{ref:0:path}}` for the local reference path.

Reference indexes start at 0.

## Poll Response

```json
{
  "type": "poll",
  "taskIdPath": "id",
  "poll": {
    "method": "GET",
    "url": "https://api.example.com/v1/jobs/{{taskId}}",
    "intervalMs": 2000,
    "timeoutMs": 1800000,
    "statusPath": "status",
    "successValues": ["done"],
    "failureValues": ["failed"],
    "result": { "type": "imageUrl", "path": "result.url" }
  }
}
```

`result` supports `imageUrl` and `base64`.

## Adaptation Checklist

Before installing a profile, compare it against `adapter-lessons.md`:

- Does the API return image URLs, base64, direct bytes, or an async job id?
- If docs show multiple similar endpoints, which exact endpoint was tested and what did it return?
- Does the API need `response_format: "url"` or an equivalent field?
- Does auth belong in a header, body field, or query string? If query, does polling need the same query token?
- Does the API accept `aspectRatio`, or must the agent convert ratios into concrete `size` values before calling?
- Does the API return business errors inside a successful HTTP response, such as `success: false`, `code`, or `message`?
- For edits, does it require repeated image fields, `image[]`, a mask field, square input images, or a separate final output size?
- Does the downloaded output have transparency that may need post-processing outside this generic runner?
