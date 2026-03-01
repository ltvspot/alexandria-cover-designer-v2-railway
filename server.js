const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const CGI_TIMEOUT_MS = 300000;
const OPENROUTER_PROXY_PATH = "/api/openrouter/chat/completions";
const OPENROUTER_UPSTREAM_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_PROXY_TIMEOUT_MS = 180000;

// Map of CGI routes to their Python scripts
const CGI_ROUTES = {
  "/cgi-bin/catalog.py": path.join(ROOT_DIR, "cgi-bin", "catalog.py"),
  "/cgi-bin/settings.py": path.join(ROOT_DIR, "cgi-bin", "settings.py"),
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath, method) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 500, { error: "Failed to read file" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(data);
  });
}

function resolveStaticPath(urlPathname) {
  const safePath = decodeURIComponent(urlPathname || "/");
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = normalized === "/" ? "/index.html" : normalized;
  const absolutePath = path.join(ROOT_DIR, requestedPath);
  return absolutePath;
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let candidatePath;
  try {
    candidatePath = resolveStaticPath(pathname);
  } catch {
    sendJson(res, 400, { error: "Invalid path" });
    return;
  }

  if (!candidatePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(candidatePath, (statErr, stats) => {
    if (!statErr && stats.isFile()) {
      sendFile(res, candidatePath, req.method);
      return;
    }

    const indexPath = path.join(ROOT_DIR, "index.html");
    sendFile(res, indexPath, req.method);
  });
}

function splitCgiOutput(outputBuffer) {
  let headerEnd = outputBuffer.indexOf(Buffer.from("\r\n\r\n"));
  let separatorLength = 4;

  if (headerEnd === -1) {
    headerEnd = outputBuffer.indexOf(Buffer.from("\n\n"));
    separatorLength = 2;
  }

  if (headerEnd === -1) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: outputBuffer,
    };
  }

  const headerText = outputBuffer.slice(0, headerEnd).toString("utf8");
  const body = outputBuffer.slice(headerEnd + separatorLength);
  const headers = {};
  let statusCode = 200;

  for (const line of headerText.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!name) continue;

    if (name.toLowerCase() === "status") {
      const codeMatch = value.match(/^(\d{3})/);
      if (codeMatch) statusCode = Number(codeMatch[1]);
    } else {
      headers[name] = value;
    }
  }

  return { statusCode, headers, body };
}

function findCgiRoute(pathname) {
  for (const [route, scriptPath] of Object.entries(CGI_ROUTES)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      const pathInfo = pathname.slice(route.length) || "";
      return { scriptPath, pathInfo };
    }
  }
  return null;
}

function readRequestBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handleOpenRouterProxy(req, res) {
  sendCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const openRouterKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!openRouterKey) {
    sendJson(res, 503, { error: "OPENROUTER_API_KEY is not configured on server" });
    return;
  }

  let bodyBuffer;
  try {
    bodyBuffer = await readRequestBody(req);
  } catch (e) {
    sendJson(res, 413, { error: e.message || "Payload too large" });
    return;
  }

  if (bodyBuffer.length === 0) {
    sendJson(res, 400, { error: "Request body is required" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENROUTER_UPSTREAM_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://alexandria-cover-designer.app",
        "X-Title": "Alexandria Cover Designer",
      },
      body: bodyBuffer,
    });

    const responseBody = await upstream.arrayBuffer();
    const responseBuffer = Buffer.from(responseBody);

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Content-Length": responseBuffer.length,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(responseBuffer);
  } catch (e) {
    if (e && e.name === "AbortError") {
      sendJson(res, 504, { error: "OpenRouter proxy timed out" });
      return;
    }
    sendJson(res, 502, { error: `OpenRouter proxy error: ${e.message}` });
  } finally {
    clearTimeout(timeout);
  }
}

function handleCgi(req, res, scriptPath, pathInfo, queryString) {
  const env = {
    ...process.env,
    REQUEST_METHOD: req.method || "GET",
    PATH_INFO: pathInfo,
    CONTENT_TYPE: req.headers["content-type"] || "",
    QUERY_STRING: queryString || "",
    CONTENT_LENGTH: req.headers["content-length"] || "",
  };

  const python = spawn("python3", [scriptPath], {
    cwd: ROOT_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  let finished = false;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    python.kill("SIGKILL");
  }, CGI_TIMEOUT_MS);

  python.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  python.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  req.pipe(python.stdin);

  python.on("error", (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    sendJson(res, 500, { error: `Failed to start CGI process: ${err.message}` });
  });

  python.on("close", (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);

    if (timedOut) {
      sendJson(res, 504, { error: `CGI script timed out after ${Math.round(CGI_TIMEOUT_MS / 1000)} seconds` });
      return;
    }

    const stdout = Buffer.concat(stdoutChunks);
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

    if (stdout.length === 0 && code !== 0) {
      sendJson(res, 500, { error: stderr || `CGI process exited with code ${code}` });
      return;
    }

    const parsed = splitCgiOutput(stdout);
    const headers = {
      ...parsed.headers,
      "Access-Control-Allow-Origin": "*",
      "Content-Length": parsed.body.length,
    };

    res.writeHead(parsed.statusCode, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(parsed.body);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;
  const queryString = requestUrl.search ? requestUrl.search.slice(1) : "";

  if (pathname === OPENROUTER_PROXY_PATH) {
    handleOpenRouterProxy(req, res);
    return;
  }

  // Check if this is a CGI route
  const cgiMatch = findCgiRoute(pathname);
  if (cgiMatch) {
    handleCgi(req, res, cgiMatch.scriptPath, cgiMatch.pathInfo, queryString);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  process.stdout.write(`Server listening on port ${PORT}\n`);
});
