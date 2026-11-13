import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionDir, "..");
const distDir = path.join(extensionDir, "dist");
const publicDir = path.join(extensionDir, "public");
const iconsOutDir = path.join(distDir, "icons");

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

async function runBuild() {
  ensureCleanDir(distDir);
  fs.mkdirSync(iconsOutDir, { recursive: true });

  const commonOptions = {
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome120"],
    alias: {
      "@core": path.join(repoRoot, "src", "lib"),
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    logLevel: "silent",
  };

  const entryPoints = [
    { in: "inject.ts", out: "inject.js", needsBuffer: false },
    { in: "content.ts", out: "content.js", needsBuffer: false },
    { in: "background.ts", out: "background.js", needsBuffer: false },
    { in: "popup.ts", out: "popup.js", needsBuffer: false },
    { in: "options.ts", out: "options.js", needsBuffer: false },
    { in: "test-dapp.ts", out: "test-dapp.js", needsBuffer: true },
  ];

  for (const entry of entryPoints) {
    const srcPath = path.join(extensionDir, "src", entry.in);
    const outPath = path.join(distDir, entry.out);
    await esbuild.build({
      ...commonOptions,
      entryPoints: [srcPath],
      outfile: outPath,
      ...(entry.needsBuffer
        ? { inject: [path.join(extensionDir, "src", "buffer-shim.ts")] }
        : {}),
    });
  }

  for (const staticFile of [
    "manifest.json",
    "popup.html",
    "options.html",
    "test-dapp.html",
  ]) {
    copyIfExists(path.join(publicDir, staticFile), path.join(distDir, staticFile));
  }

  const brandIconSrc = path.join(repoRoot, "public", "logo.png");
  for (const iconName of ["icon16.png", "icon48.png", "icon128.png"]) {
    copyIfExists(brandIconSrc, path.join(iconsOutDir, iconName));
  }

  console.log(
    `[SolShield Extension] Built ${entryPoints.length} bundles + static MV3 assets into ${distDir}`
  );
}

runBuild().catch((err) => {
  console.error("[SolShield Extension] Build failed:", err);
  process.exit(1);
});
