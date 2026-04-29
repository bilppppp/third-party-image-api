# Provider Examples

Use these examples as templates when converting official docs.

## JSON Request Returning Image URL

```json
{
  "name": "example-url",
  "version": 1,
  "auth": { "type": "bearer", "env": "EXAMPLE_API_KEY" },
  "operations": {
    "generate": {
      "method": "POST",
      "url": "https://api.example.com/v1/images",
      "request": {
        "type": "json",
        "body": {
          "prompt": "{{prompt}}",
          "size": "{{size}}"
        }
      },
      "response": { "type": "imageUrl", "path": "data.0.url" }
    }
  }
}
```

## Multipart Edit Returning Base64

```json
{
  "name": "example-edit",
  "version": 1,
  "auth": { "type": "header", "env": "EXAMPLE_API_KEY", "header": "X-API-Key" },
  "operations": {
    "edit": {
      "method": "POST",
      "url": "https://api.example.com/v1/image-edits",
      "request": {
        "type": "multipart",
        "body": {
          "prompt": "{{prompt}}",
          "image": "{{ref:0:file}}"
        }
      },
      "response": { "type": "base64", "path": "image" }
    }
  }
}
```

## Async Job With Polling

```json
{
  "name": "example-poll",
  "version": 1,
  "auth": { "type": "bearer", "env": "EXAMPLE_API_KEY" },
  "operations": {
    "generate": {
      "method": "POST",
      "url": "https://api.example.com/v1/jobs",
      "request": {
        "type": "json",
        "body": { "prompt": "{{prompt}}" }
      },
      "response": {
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
    }
  }
}
```

## Query Auth With Nested Image URL

Use this pattern for relay APIs that pass tokens as query parameters and wrap the image URL inside nested response objects.

```json
{
  "name": "example-relay",
  "version": 1,
  "auth": { "type": "query", "env": "EXAMPLE_RELAY_TOKEN", "query": "token" },
  "operations": {
    "generate": {
      "method": "POST",
      "url": "https://api.example.com/v1/images/generations",
      "request": {
        "type": "json",
        "body": {
          "model": "gpt-image-2",
          "prompt": "{{prompt}}",
          "n": "1",
          "size": "{{size}}",
          "resolution": "1k"
        }
      },
      "response": { "type": "imageUrl", "path": "data.data.0.url" }
    }
  }
}
```

If the same provider has a task endpoint instead, use `response.type: "poll"` and confirm the polling URL also receives the query token.
