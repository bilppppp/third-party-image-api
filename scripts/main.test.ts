import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./main";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  )
);

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "third-party-image-api-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function env(home: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { THIRD_PARTY_IMAGE_API_HOME: home, ...extra };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("provider management", () => {
  test("validates, installs, and lists provider profiles in the user config directory", async () => {
    const dir = await makeTempDir();
    const profilePath = join(dir, "example-url.json");
    await writeJson(profilePath, {
      name: "example-url",
      version: 1,
      auth: { type: "bearer", env: "EXAMPLE_IMAGE_KEY" },
      operations: {
        generate: {
          method: "POST",
          url: "https://api.example.test/images",
          request: { type: "json", body: { prompt: "{{prompt}}" } },
          response: { type: "imageUrl", path: "data.0.url" },
        },
      },
    });

    const configHome = join(dir, "config");
    await expect(
      runCli(["providers", "validate", "--file", profilePath], { env: env(configHome) })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runCli(["providers", "install", "--file", profilePath], { env: env(configHome) })
    ).resolves.toMatchObject({ ok: true });
    await expect(runCli(["providers", "list"], { env: env(configHome) })).resolves.toMatchObject({
      ok: true,
      providers: ["example-url"],
    });

    const installed = JSON.parse(await readFile(join(configHome, "providers", "example-url.json"), "utf8"));
    expect(installed.auth.env).toBe("EXAMPLE_IMAGE_KEY");
  });

  test("rejects provider profiles that contain likely secrets", async () => {
    const dir = await makeTempDir();
    const fakeSecret = `s${"k"}-testsecret1234567890`;
    const profilePath = join(dir, "leaky.json");
    await writeJson(profilePath, {
      name: "leaky",
      version: 1,
      auth: { type: "bearer", env: "LEAKY_KEY" },
      operations: {
        generate: {
          method: "POST",
          url: "https://api.example.test/images",
          request: {
            type: "json",
            headers: { Authorization: `Bearer ${fakeSecret}` },
            body: { prompt: "{{prompt}}" },
          },
          response: { type: "base64", path: "image" },
        },
      },
    });

    await expect(runCli(["providers", "validate", "--file", profilePath], { env: env(dir) })).rejects.toThrow(
      /secret/i
    );
  });
});

describe("provider calls", () => {
  test("calls a JSON provider, downloads an image URL, and sends auth from env", async () => {
    const dir = await makeTempDir();
    let auth = "";
    let body: Record<string, unknown> = {};
    const fakeFetch: typeof globalThis.fetch = async (url, init) => {
      if (String(url) === "https://provider.test/images") {
        auth = (init?.headers as Record<string, string>).Authorization;
        body = JSON.parse(String(init?.body));
        return Response.json({ data: [{ url: "https://provider.test/image.png" }] });
      }
      if (String(url) === "https://provider.test/image.png") {
        return new Response(png, { headers: { "content-type": "image/png" } });
      }
      return new Response("not found", { status: 404 });
    };

    const providerPath = join(dir, "url-provider.json");
    await writeJson(providerPath, {
      name: "url-provider",
      version: 1,
      auth: { type: "bearer", env: "URL_PROVIDER_KEY" },
      operations: {
        generate: {
          method: "POST",
          url: "https://provider.test/images",
          request: { type: "json", body: { prompt: "{{prompt}}", size: "{{size}}" } },
          response: { type: "imageUrl", path: "data.0.url" },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    const output = join(dir, "out.png");
    const apiToken = "runtime-token";
    await runCli(
      ["call", "--provider", "url-provider", "--operation", "generate", "--prompt", "moon", "--size", "1024x1024", "--output", output],
      { env: env(configHome, { URL_PROVIDER_KEY: apiToken }), fetch: fakeFetch }
    );

    expect(auth).toBe(`Bearer ${apiToken}`);
    expect(body).toEqual({ prompt: "moon", size: "1024x1024" });
    expect(await readFile(output)).toEqual(Buffer.from(png));
  });

  test("calls a multipart edit provider with a reference image and saves base64 output", async () => {
    const dir = await makeTempDir();
    let prompt = "";
    let fileSize = 0;
    const fakeFetch: typeof globalThis.fetch = async (_url, init) => {
      const form = init?.body as FormData;
      prompt = String(form.get("prompt"));
      const image = form.get("image");
      fileSize = image instanceof File ? image.size : 0;
      return Response.json({ image: Buffer.from(png).toString("base64") });
    };

    const ref = join(dir, "ref.png");
    await writeFile(ref, png);
    const providerPath = join(dir, "base64-edit.json");
    await writeJson(providerPath, {
      name: "base64-edit",
      version: 1,
      auth: { type: "none" },
      operations: {
        edit: {
          method: "POST",
          url: "https://provider.test/edit",
          request: {
            type: "multipart",
            body: { prompt: "{{prompt}}", image: "{{ref:0:file}}" },
          },
          response: { type: "base64", path: "image" },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    const output = join(dir, "edited.png");
    await runCli(
      ["call", "--provider", "base64-edit", "--operation", "edit", "--prompt", "make blue", "--ref", ref, "--output", output],
      { env: env(configHome), fetch: fakeFetch }
    );

    expect(prompt).toBe("make blue");
    expect(fileSize).toBe(png.byteLength);
    expect(await readFile(output)).toEqual(Buffer.from(png));
  });

  test("calls a urlencoded form provider and saves a binary image response", async () => {
    const dir = await makeTempDir();
    let contentType = "";
    let formBody = "";
    const fakeFetch: typeof globalThis.fetch = async (_url, init) => {
      contentType = (init?.headers as Record<string, string>)["Content-Type"];
      formBody = String(init?.body);
      return new Response(png, { headers: { "content-type": "image/png" } });
    };

    const providerPath = join(dir, "binary-form.json");
    await writeJson(providerPath, {
      name: "binary-form",
      version: 1,
      auth: { type: "none" },
      operations: {
        generate: {
          method: "POST",
          url: "https://provider.test/binary",
          request: { type: "form", body: { prompt: "{{prompt}}", aspect: "{{ar}}" } },
          response: { type: "binary" },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    const output = join(dir, "binary.png");
    await runCli(
      ["call", "--provider", "binary-form", "--operation", "generate", "--prompt", "cat", "--ar", "1:1", "--output", output],
      { env: env(configHome), fetch: fakeFetch }
    );

    expect(contentType).toBe("application/x-www-form-urlencoded");
    expect(formBody).toBe("prompt=cat&aspect=1%3A1");
    expect(await readFile(output)).toEqual(Buffer.from(png));
  });

  test("polls an async provider until an image URL is ready", async () => {
    const dir = await makeTempDir();
    let polls = 0;
    const fakeFetch: typeof globalThis.fetch = async (url, init) => {
      if (String(url) === "https://provider.test/jobs" && init?.method === "POST") return Response.json({ id: "job-1" });
      if (String(url) === "https://provider.test/jobs/job-1") {
        polls += 1;
        if (polls === 1) return Response.json({ status: "running" });
        return Response.json({ status: "done", result: { url: "https://provider.test/ready.png" } });
      }
      if (String(url) === "https://provider.test/ready.png") return new Response(png, { headers: { "content-type": "image/png" } });
      return new Response("not found", { status: 404 });
    };

    const providerPath = join(dir, "poll-provider.json");
    await writeJson(providerPath, {
      name: "poll-provider",
      version: 1,
      auth: { type: "none" },
      operations: {
        generate: {
          method: "POST",
          url: "https://provider.test/jobs",
          request: { type: "json", body: { prompt: "{{prompt}}" } },
          response: {
            type: "poll",
            taskIdPath: "id",
            poll: {
              method: "GET",
              url: "https://provider.test/jobs/{{taskId}}",
              intervalMs: 1,
              timeoutMs: 1000,
              statusPath: "status",
              successValues: ["done"],
              failureValues: ["failed"],
              result: { type: "imageUrl", path: "result.url" },
            },
          },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    const output = join(dir, "poll.png");
    await runCli(["call", "--provider", "poll-provider", "--operation", "generate", "--prompt", "async", "--output", output], {
      env: env(configHome),
      fetch: fakeFetch,
    });

    expect(polls).toBe(2);
    expect(await readFile(output)).toEqual(Buffer.from(png));
  });

  test("redacts secrets from failed API responses", async () => {
    const dir = await makeTempDir();
    const secret = `s${"k"}-testsecret1234567890`;
    const fakeFetch: typeof globalThis.fetch = async () =>
      Response.json({ error: { key: secret, message: `Bearer ${secret}` } }, { status: 401 });

    const providerPath = join(dir, "error-provider.json");
    await writeJson(providerPath, {
      name: "error-provider",
      version: 1,
      auth: { type: "bearer", env: "ERROR_PROVIDER_KEY" },
      operations: {
        generate: {
          method: "POST",
          url: "https://provider.test/error",
          request: { type: "json", body: { prompt: "{{prompt}}" } },
          response: { type: "base64", path: "image" },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    let message = "";
    try {
      await runCli(["call", "--provider", "error-provider", "--operation", "generate", "--prompt", "x", "--output", join(dir, "x.png")], {
        env: env(configHome, { ERROR_PROVIDER_KEY: secret }),
        fetch: fakeFetch,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("[redacted]");
    expect(message).not.toContain(secret);
  });

  test("reports provider business errors from successful JSON responses", async () => {
    const dir = await makeTempDir();
    const fakeFetch: typeof globalThis.fetch = async () =>
      Response.json({ success: false, code: 10005, message: "quota exhausted" });

    const providerPath = join(dir, "business-error.json");
    await writeJson(providerPath, {
      name: "business-error",
      version: 1,
      auth: { type: "none" },
      operations: {
        generate: {
          method: "POST",
          url: "https://provider.test/business-error",
          request: { type: "json", body: { prompt: "{{prompt}}" } },
          response: { type: "imageUrl", path: "data.data.0.url" },
        },
      },
    });
    const configHome = join(dir, "config");
    await runCli(["providers", "install", "--file", providerPath], { env: env(configHome) });

    await expect(
      runCli(["call", "--provider", "business-error", "--operation", "generate", "--prompt", "x", "--output", join(dir, "x.png")], {
        env: env(configHome),
        fetch: fakeFetch,
      })
    ).rejects.toThrow(/quota exhausted/);
  });
});
