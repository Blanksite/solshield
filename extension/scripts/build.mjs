import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionDir, "..");
const distDir = path.join(extensionDir, "dist");
const testDappDistDir = path.join(extensionDir, "dist-test-dapp");
const publicDir = path.join(extensionDir, "public");
const iconsSrcDir = path.join(publicDir, "icons");
const iconsOutDir = path.join(distDir, "icons");
const releaseZipPath = path.join(
  repoRoot,
  "public",
  "downloads",
  "solshield-browser-guard-v0.3.0.zip"
);

const requireFromRoot = createRequire(path.join(repoRoot, "package.json"));
const esbuild = requireFromRoot("esbuild");

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing required extension asset: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Standard CRC32 table for reproducible PKZIP archive creation
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function collectFiles(rootDir, currentDir = rootDir) {
  const out = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(rootDir, full));
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, full).replace(/\\/g, "/");
      out.push({ full, rel });
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function createZipArchive(sourceDir, outZipPath) {
  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.full);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(file.rel, "utf8");
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // deflate compression
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12); // reproducible fixed date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuf, compressed);
    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outZipPath), { recursive: true });
  fs.writeFileSync(outZipPath, Buffer.concat([...localParts, centralDirBuf, eocd]));
}

async function runBuild() {
  ensureCleanDir(distDir);
  ensureCleanDir(testDappDistDir);
  fs.mkdirSync(iconsOutDir, { recursive: true });

  const commonOptions = {
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome120"],
    loader: {
      ".png": "dataurl",
    },
    alias: {
      "@core": path.join(repoRoot, "src", "lib"),
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    logLevel: "silent",
  };

  const extensionEntries = [
    { in: "inject.ts", out: "inject.js", needsBuffer: false },
    { in: "content.ts", out: "content.js", needsBuffer: false },
    { in: "background.ts", out: "background.js", needsBuffer: false },
    { in: "popup.ts", out: "popup.js", needsBuffer: false },
    { in: "options.ts", out: "options.js", needsBuffer: false },
  ];

  for (const entry of extensionEntries) {
    await esbuild.build({
      ...commonOptions,
      entryPoints: [path.join(extensionDir, "src", entry.in)],
      outfile: path.join(distDir, entry.out),
    });
  }

  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join(extensionDir, "src", "test-dapp.ts")],
    outfile: path.join(testDappDistDir, "test-dapp.js"),
    inject: [path.join(extensionDir, "src", "buffer-shim.ts")],
  });

  for (const staticFile of ["manifest.json", "popup.html", "options.html"]) {
    copyIfExists(path.join(publicDir, staticFile), path.join(distDir, staticFile));
  }
  copyIfExists(
    path.join(publicDir, "test-dapp.html"),
    path.join(testDappDistDir, "test-dapp.html")
  );

  for (const iconName of ["icon16.png", "icon48.png", "icon128.png"]) {
    copyIfExists(path.join(iconsSrcDir, iconName), path.join(iconsOutDir, iconName));
  }

  createZipArchive(distDir, releaseZipPath);

  console.log(
    `[SolShield Extension] Built ${extensionEntries.length} MV3 bundles into ${distDir}, test dApp into ${testDappDistDir}, and release ZIP at ${releaseZipPath}`
  );
}

runBuild().catch((err) => {
  console.error("[SolShield Extension] Build failed:", err);
  process.exit(1);
});
