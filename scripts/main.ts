import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const SKILL_NAME = "third-party-image-api";
const DEFAULT_TIMEOUT_MS = 1_800_000;

type OperationName = "generate" | "edit";
type RequestType = "json" | "form" | "multipart";
type ResponseType = "imageUrl" | "base64" | "binary" | "poll";

type Env = Record<string, string | undefined>;

type AuthProfile =
  | { type: "none"; env?: string; header?: string; prefix?: string; query?: string }
  | { type: "bearer"; env: string; header?: string; prefix?: string; query?: string }
  | { type: "header"; env: string; header: string; prefix?: string; query?: string }
  | { type: "query"; env: string; query: string; header?: string; prefix?: string };

type RequestProfile = {
  type: RequestType;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
};

type ImageResultProfile = {
  type: Exclude<ResponseType, "poll">;
  path?: string;
};

type PollProfile = {
  method?: string;
  url: string;
  intervalMs?: number;
  timeoutMs?: number;
  statusPath: string;
  successValues: string[];
  failureValues?: string[];
  result: ImageResultProfile;
};

type ResponseProfile =
  | ImageResultProfile
  | {
      type: "poll";
      taskIdPath: string;
      poll: PollProfile;
    };

type OperationProfile = {
  method: string;
  url: string;
  request: RequestProfile;
  response: ResponseProfile;
};

type ProviderProfile = {
  name: string;
  version: number;
  auth: AuthProfile;
  operations: Partial<Record<OperationName, OperationProfile>>;
};

type CliDeps = {
  env?: Env;
  fetch?: typeof globalThis.fetch;
  stdout?: (line: string) => void;
};

type CallArgs = {
  provider: string;
  operation: OperationName;
  prompt: string;
  output: string;
  refs: string[];
  size?: string;
  ar?: string;
  quality?: string;
};

type RenderContext = {
  provider: string;
  operation: OperationName;
  prompt: string;
  refs: string[];
  size?: string;
  ar?: string;
  quality?: string;
  taskId?: string;
};

type FilePart = {
  kind: "file";
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
};

type RequestBuild = {
  url: string;
  init: RequestInit;
};

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<Record<string, unknown>> {
  const env = { ...process.env, ...(deps.env || {}) };
  const fetcher = deps.fetch || globalThis.fetch;
  const stdout = deps.stdout || (() => undefined);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    stdout(usage());
    return { ok: true };
  }
  if (command === "providers") return runProviderCommand(argv.slice(1), env, stdout);
  if (command === "call") return runCall(parseCallArgs(argv.slice(1)), env, fetcher);
  throw new Error(`Unknown command: ${command}`);
}

async function runProviderCommand(argv: string[], env: Env, stdout: (line: string) => void): Promise<Record<string, unknown>> {
  const command = argv[0];
  if (command === "validate") {
    const file = requireOption(argv, "--file");
    const profile = await readProfile(file);
    validateProviderProfile(profile);
    stdout(`Valid provider profile: ${profile.name}`);
    return { ok: true, provider: profile.name };
  }
  if (command === "install") {
    const file = requireOption(argv, "--file");
    const profile = await readProfile(file);
    validateProviderProfile(profile);
    const target = providerPath(env, profile.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(profile, null, 2)}\n`);
    stdout(`Installed provider profile: ${profile.name}`);
    return { ok: true, provider: profile.name, path: target };
  }
  if (command === "list") {
    const dir = providersDir(env);
    let providers: string[] = [];
    try {
      providers = (await readdir(dir))
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.basename(file, ".json"))
        .sort();
    } catch {
      providers = [];
    }
    if (providers.length > 0) stdout(providers.join("\n"));
    return { ok: true, providers };
  }
  throw new Error(`Unknown providers command: ${command || "(missing)"}`);
}

async function runCall(args: CallArgs, env: Env, fetcher: typeof globalThis.fetch): Promise<Record<string, unknown>> {
  const profile = await readProfile(providerPath(env, args.provider));
  validateProviderProfile(profile);
  const operation = profile.operations[args.operation];
  if (!operation) throw new Error(`Provider ${args.provider} does not define operation: ${args.operation}`);

  const context: RenderContext = {
    provider: profile.name,
    operation: args.operation,
    prompt: args.prompt,
    refs: args.refs,
    size: args.size,
    ar: args.ar,
    quality: args.quality,
  };
  const request = await buildRequest(profile, operation, context, env);
  const response = await fetchWithTimeout(fetcher, request.url, request.init);
  await assertOk(response, `Provider ${profile.name} ${args.operation} request failed`);
  const image = await extractImage(response, operation.response, profile, context, env, fetcher);

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, image);
  return { ok: true, provider: profile.name, operation: args.operation, output: args.output };
}

function parseCallArgs(argv: string[]): CallArgs {
  const args: Partial<CallArgs> = { operation: "generate", refs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--provider") args.provider = takeValue(argv, ++i, arg);
    else if (arg === "--operation") args.operation = parseOperation(takeValue(argv, ++i, arg));
    else if (arg === "--prompt") args.prompt = takeValue(argv, ++i, arg);
    else if (arg === "--output" || arg === "-o") args.output = takeValue(argv, ++i, arg);
    else if (arg === "--size") args.size = takeValue(argv, ++i, arg);
    else if (arg === "--ar") args.ar = takeValue(argv, ++i, arg);
    else if (arg === "--quality") args.quality = takeValue(argv, ++i, arg);
    else if (arg === "--ref" || arg === "--reference") {
      i += 1;
      if (!argv[i]) throw new Error(`Missing value for ${arg}`);
      while (i < argv.length && !argv[i]!.startsWith("-")) {
        args.refs!.push(argv[i]!);
        i += 1;
      }
      i -= 1;
    } else {
      throw new Error(`Unknown call option: ${arg}`);
    }
  }
  if (!args.provider) throw new Error("Missing --provider");
  if (!args.prompt) throw new Error("Missing --prompt");
  if (!args.output) throw new Error("Missing --output");
  return args as CallArgs;
}

function parseOperation(value: string): OperationName {
  if (value === "generate" || value === "edit") return value;
  throw new Error(`Unsupported operation: ${value}`);
}

async function buildRequest(profile: ProviderProfile, operation: OperationProfile, context: RenderContext, env: Env): Promise<RequestBuild> {
  const headers: Record<string, string> = { ...(operation.request.headers || {}) };
  const query: Record<string, string> = {};
  const urlTemplate = await renderText(operation.url, context);
  let body: BodyInit | undefined;

  if (operation.request.query) {
    const renderedQuery = await renderUnknown(operation.request.query, context);
    if (isRecord(renderedQuery)) {
      for (const [key, value] of Object.entries(renderedQuery)) {
        if (value !== undefined && value !== null) query[key] = String(value);
      }
    }
  }

  applyAuth(profile.auth, env, headers, query);

  if (operation.request.body !== undefined && operation.method.toUpperCase() !== "GET") {
    const renderedBody = await renderUnknown(operation.request.body, context);
    if (operation.request.type === "json") {
      headers["Content-Type"] ||= "application/json";
      body = JSON.stringify(renderedBody);
    } else if (operation.request.type === "form") {
      headers["Content-Type"] ||= "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      if (!isRecord(renderedBody)) throw new Error("Form request body must render to an object.");
      for (const [key, value] of Object.entries(renderedBody)) {
        if (value !== undefined && value !== null) params.set(key, String(value));
      }
      body = params;
    } else if (operation.request.type === "multipart") {
      const form = new FormData();
      if (!isRecord(renderedBody)) throw new Error("Multipart request body must render to an object.");
      for (const [key, value] of Object.entries(renderedBody)) appendFormValue(form, key, value);
      body = form;
    }
  }

  return {
    url: addQuery(urlTemplate, query),
    init: { method: operation.method, headers, body },
  };
}

function applyAuth(auth: AuthProfile, env: Env, headers: Record<string, string>, query: Record<string, string>): void {
  if (auth.type === "none") return;
  const value = auth.env ? env[auth.env] : undefined;
  if (!value) throw new Error(`Missing API key. Set ${auth.env} in the environment before calling this provider.`);
  if (auth.type === "bearer") {
    headers[auth.header || "Authorization"] = `${auth.prefix || "Bearer "}${value}`;
  } else if (auth.type === "header") {
    headers[auth.header] = `${auth.prefix || ""}${value}`;
  } else if (auth.type === "query") {
    query[auth.query] = value;
  }
}

async function extractImage(
  response: Response,
  responseProfile: ResponseProfile,
  profile: ProviderProfile,
  context: RenderContext,
  env: Env,
  fetcher: typeof globalThis.fetch
): Promise<Uint8Array> {
  if (responseProfile.type === "binary") return new Uint8Array(await response.arrayBuffer());

  const json = await response.json();
  throwIfBusinessError(json, profile.name);
  if (responseProfile.type === "poll") {
    const taskId = String(readPath(json, responseProfile.taskIdPath));
    return pollForImage(responseProfile.poll, profile, { ...context, taskId }, env, fetcher);
  }
  return extractImageFromJson(json, responseProfile, profile, context, env, fetcher);
}

async function pollForImage(
  poll: PollProfile,
  profile: ProviderProfile,
  context: RenderContext,
  env: Env,
  fetcher: typeof globalThis.fetch
): Promise<Uint8Array> {
  const timeoutMs = poll.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = poll.intervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const headers: Record<string, string> = {};
    const query: Record<string, string> = {};
    applyAuth(profile.auth, env, headers, query);
    const url = addQuery(await renderText(poll.url, context), query);
    const response = await fetchWithTimeout(fetcher, url, { method: poll.method || "GET", headers }, timeoutMs);
    await assertOk(response, `Provider ${profile.name} poll request failed`);
    const json = await response.json();
    throwIfBusinessError(json, profile.name);
    const status = String(readPath(json, poll.statusPath));
    if (poll.successValues.includes(status)) return extractImageFromJson(json, poll.result, profile, context, env, fetcher);
    if ((poll.failureValues || []).includes(status)) throw new Error(`Provider ${profile.name} job failed with status: ${status}`);
    await sleep(intervalMs);
  }
  throw new Error(`Provider ${profile.name} polling timed out.`);
}

function throwIfBusinessError(json: unknown, providerName: string): void {
  if (!isRecord(json)) return;
  const success = json.success;
  const status = json.status;
  const code = json.code;
  const message = firstString(json.message, json.error, isRecord(json.error) ? json.error.message : undefined);

  if (success === false || status === "failed" || status === "error") {
    const codeText = code !== undefined && code !== null ? ` code ${String(code)}` : "";
    const messageText = message ? `: ${redactSensitiveText(message)}` : "";
    throw new Error(`Provider ${providerName} returned a business error${codeText}${messageText}`);
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

async function extractImageFromJson(
  json: unknown,
  responseProfile: ImageResultProfile,
  profile: ProviderProfile,
  context: RenderContext,
  env: Env,
  fetcher: typeof globalThis.fetch
): Promise<Uint8Array> {
  if (responseProfile.type === "binary") throw new Error("Binary result cannot be extracted from JSON.");
  const value = responseProfile.path ? readPath(json, responseProfile.path) : json;
  if (responseProfile.type === "base64") return decodeBase64Image(String(value));
  if (responseProfile.type === "imageUrl") {
    const imageResponse = await fetchWithTimeout(fetcher, String(value), { headers: authDownloadHeaders(profile.auth, env) });
    await assertOk(imageResponse, `Provider ${profile.name} image download failed`);
    return new Uint8Array(await imageResponse.arrayBuffer());
  }
  throw new Error(`Unsupported image result type: ${responseProfile.type}`);
}

function authDownloadHeaders(auth: AuthProfile, env: Env): Record<string, string> {
  if (auth.type !== "bearer" && auth.type !== "header") return {};
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  applyAuth(auth, env, headers, query);
  return headers;
}

async function renderUnknown(value: unknown, context: RenderContext): Promise<unknown> {
  if (typeof value === "string") return renderStringValue(value, context);
  if (Array.isArray(value)) return Promise.all(value.map((item) => renderUnknown(item, context)));
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) output[key] = await renderUnknown(child, context);
    return output;
  }
  return value;
}

async function renderStringValue(value: string, context: RenderContext): Promise<string | FilePart> {
  const fileMatch = value.match(/^{{\s*ref:(\d+):file\s*}}$/);
  if (fileMatch) return readReferenceFile(context.refs, Number(fileMatch[1]));
  return renderText(value, context);
}

async function renderText(value: string, context: RenderContext): Promise<string> {
  let output = value;
  const replacements: Record<string, string | undefined> = {
    prompt: context.prompt,
    provider: context.provider,
    operation: context.operation,
    size: context.size,
    ar: context.ar,
    quality: context.quality,
    taskId: context.taskId,
  };
  for (const [key, replacement] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, replacement || "");
  }

  const refMatches = [...output.matchAll(/{{\s*ref:(\d+):(base64|dataUrl|path)\s*}}/g)];
  for (const match of refMatches) {
    const index = Number(match[1]);
    const mode = match[2];
    const refPath = context.refs[index];
    if (!refPath) throw new Error(`Missing reference image at index ${index}.`);
    if (mode === "path") {
      output = output.replace(match[0], refPath);
      continue;
    }
    const bytes = await readFile(refPath);
    const base64 = Buffer.from(bytes).toString("base64");
    output = output.replace(match[0], mode === "dataUrl" ? `data:${mimeType(refPath)};base64,${base64}` : base64);
  }
  return output;
}

async function readReferenceFile(refs: string[], index: number): Promise<FilePart> {
  const filePath = refs[index];
  if (!filePath) throw new Error(`Missing reference image at index ${index}.`);
  return {
    kind: "file",
    bytes: new Uint8Array(await readFile(filePath)),
    filename: path.basename(filePath),
    mimeType: mimeType(filePath),
  };
}

function appendFormValue(form: FormData, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(form, key, item);
    return;
  }
  if (isFilePart(value)) {
    form.append(key, new Blob([value.bytes], { type: value.mimeType }), value.filename);
    return;
  }
  form.append(key, value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value));
}

async function readProfile(filePath: string): Promise<ProviderProfile> {
  return JSON.parse(await readFile(filePath, "utf8")) as ProviderProfile;
}

export function validateProviderProfile(profile: ProviderProfile): void {
  if (!isRecord(profile)) throw new Error("Provider profile must be a JSON object.");
  if (!isProviderName(profile.name)) throw new Error("Provider profile requires a safe name.");
  if (profile.version !== 1) throw new Error("Provider profile version must be 1.");
  if (!isRecord(profile.auth) || typeof profile.auth.type !== "string") throw new Error("Provider profile requires auth.");
  if (profile.auth.type !== "none" && !profile.auth.env) throw new Error("Provider auth must name an environment variable.");
  if (profile.auth.type === "header" && !profile.auth.header) throw new Error("Header auth requires auth.header.");
  if (profile.auth.type === "query" && !profile.auth.query) throw new Error("Query auth requires auth.query.");
  if (!["none", "bearer", "header", "query"].includes(profile.auth.type)) throw new Error("Unsupported auth type.");
  if (!isRecord(profile.operations)) throw new Error("Provider profile requires operations.");
  for (const [name, operation] of Object.entries(profile.operations)) {
    if (name !== "generate" && name !== "edit") throw new Error(`Unsupported operation name: ${name}`);
    validateOperation(operation as OperationProfile, name);
  }
  rejectLikelySecrets(profile);
}

function validateOperation(operation: OperationProfile, name: string): void {
  if (!isRecord(operation)) throw new Error(`Operation ${name} must be an object.`);
  if (!operation.method || !operation.url) throw new Error(`Operation ${name} requires method and url.`);
  if (!isRecord(operation.request) || !["json", "form", "multipart"].includes(operation.request.type)) {
    throw new Error(`Operation ${name} requires request.type json, form, or multipart.`);
  }
  if (!isRecord(operation.response) || !["imageUrl", "base64", "binary", "poll"].includes(operation.response.type)) {
    throw new Error(`Operation ${name} requires a supported response.type.`);
  }
  if (operation.response.type === "poll") {
    if (!operation.response.taskIdPath || !isRecord(operation.response.poll)) throw new Error(`Operation ${name} poll response is incomplete.`);
    const poll = operation.response.poll as PollProfile;
    if (!poll.url || !poll.statusPath || !Array.isArray(poll.successValues) || !isRecord(poll.result)) {
      throw new Error(`Operation ${name} poll config is incomplete.`);
    }
  }
}

function rejectLikelySecrets(value: unknown, trail = "profile"): void {
  if (typeof value === "string") {
    if (looksLikeSecret(value)) throw new Error(`Provider profile appears to contain a secret at ${trail}. Store secrets in environment variables only.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectLikelySecrets(item, `${trail}.${index}`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) rejectLikelySecrets(child, `${trail}.${key}`);
  }
}

function looksLikeSecret(value: string): boolean {
  return (
    /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
    /Bearer\s+(?!\{\{)[A-Za-z0-9._-]{8,}/i.test(value) ||
    /(?:api[_-]?key|token|secret)=((?!\{\{)[^&\s]{8,})/i.test(value)
  );
}

function readPath(source: unknown, rawPath: string): unknown {
  const normalized = rawPath.replace(/\[(\d+)]/g, ".$1");
  let current = source;
  for (const part of normalized.split(".").filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else if (isRecord(current) && part in current) {
      current = current[part];
    } else {
      throw new Error(`Could not find response path: ${rawPath}`);
    }
  }
  return current;
}

function decodeBase64Image(value: string): Uint8Array {
  const base64 = value.includes(",") && value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return new Uint8Array(Buffer.from(base64, "base64"));
}

async function fetchWithTimeout(
  fetcher: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function assertOk(response: Response, message: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${message}: HTTP ${response.status}${text ? ` ${redactSensitiveText(text)}` : ""}`);
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(
      /(^|[^A-Za-z0-9_])(["']?(?:api[_-]?key|apikey|secret|token|key)["']?\s*[:=]\s*)(["']?)([^"',\s}]+)/gi,
      (_match, prefix: string, label: string, quote: string) => `${prefix}${label}${quote}[redacted]`
    )
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

function addQuery(rawUrl: string, query: Record<string, string>): string {
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function providersDir(env: Env): string {
  return path.join(configHome(env), "providers");
}

function providerPath(env: Env, provider: string): string {
  if (!isProviderName(provider)) throw new Error("Provider name must use letters, digits, dashes, or underscores.");
  return path.join(providersDir(env), `${provider}.json`);
}

function configHome(env: Env): string {
  if (env.THIRD_PARTY_IMAGE_API_HOME) return env.THIRD_PARTY_IMAGE_API_HOME;
  if (process.platform === "win32") {
    return path.join(env.APPDATA || path.join(homedir(), "AppData", "Roaming"), SKILL_NAME);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), SKILL_NAME);
}

function requireOption(argv: string[], option: string): string {
  const index = argv.indexOf(option);
  if (index === -1) throw new Error(`Missing ${option}`);
  return takeValue(argv, index + 1, option);
}

function takeValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value) throw new Error(`Missing value for ${option}`);
  return value;
}

function isProviderName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFilePart(value: unknown): value is FilePart {
  return isRecord(value) && value.kind === "file" && value.bytes instanceof Uint8Array;
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  return "image/png";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage(): string {
  return `Usage:
  bun scripts/main.ts providers validate --file provider.json
  bun scripts/main.ts providers install --file provider.json
  bun scripts/main.ts providers list
  bun scripts/main.ts call --provider <name> --operation generate --prompt "A cat" --output out.png
  bun scripts/main.ts call --provider <name> --operation edit --prompt "Make blue" --ref source.png --output out.png`;
}

if (import.meta.main) {
  try {
    const result = await runCli(Bun.argv.slice(2), { stdout: (line) => console.log(line) });
    if (Object.keys(result).length > 1) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSensitiveText(message));
    process.exit(1);
  }
}
