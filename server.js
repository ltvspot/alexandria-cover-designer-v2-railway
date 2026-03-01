const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = __dirname;
const CGI_SCRIPT = path.join(ROOT_DIR, "cgi-bin", "catalog.py");
const PORT = Number(process.env.PORT) || 3000;
const CGI_TIMEOUT_MS = 120000;

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

function handleCgi(req, res, pathname, queryString) {
  const pathInfo = pathname.replace("/cgi-bin/catalog.py", "") || "";
  const env = {
    ...process.env,
    REQUEST_METHOD: req.method || "GET",
    PATH_INFO: pathInfo,
    CONTENT_TYPE: req.headers["content-type"] || "",
    QUERY_STRING: queryString || "",
    CONTENT_LENGTH: req.headers["content-length"] || "",
  };

  const python = spawn("python3", [CGI_SCRIPT], {
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
      sendJson(res, 504, { error: "CGI script timed out after 120 seconds" });
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

  if (pathname === "/cgi-bin/catalog.py" || pathname.startsWith("/cgi-bin/catalog.py/")) {
    handleCgi(req, res, pathname, queryString);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  process.stdout.write(`Server listening on port ${PORT}\n`);
});
