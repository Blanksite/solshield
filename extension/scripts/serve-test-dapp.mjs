import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist-test-dapp");
const port = Number(process.env.EXT_TEST_PORT || 4178);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  const fileName = urlPath === "/" ? "test-dapp.html" : path.basename(urlPath);
  const target = path.join(distDir, fileName);

  if (!target.startsWith(distDir) || !fs.existsSync(target)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found. Run `npm run ext:build` first.");
    return;
  }

  const ext = path.extname(target);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `SolShield Extension Test dApp running at http://127.0.0.1:${port}/test-dapp.html`
  );
});
