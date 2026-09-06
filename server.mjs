import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicRoot = join(root, "public");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".fit": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function getOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sendFile(response, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicRoot, requested));
  if (!filePath.startsWith(`${publicRoot}/`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  sendFile(response, filePath);
});

const port = Number(getOption("--port", process.env.PORT || 4173));
const host = process.env.HOST || "127.0.0.1";

server.listen(port, host, () => {
  console.log(`FIT dashboard running at http://${host}:${port}`);
  console.log("FIT files are parsed in the browser and never uploaded; GPS map tiles load directly from OpenStreetMap.");
});
