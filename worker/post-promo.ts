import fs from "fs";
import path from "path";
import { uploadEvidencePngToX, postReplyTweetOnX, type XBotAuthConfig } from "./x-client.js";
import { loadLocalEnvFiles } from "./env-loader.js";

loadLocalEnvFiles();

function getAuthConfig(): XBotAuthConfig {
  return {
    botHandle: (process.env.BOT_X_HANDLE?.trim() || "usesolshield").replace(/^@/, ""),
    bearerToken: process.env.X_BEARER_TOKEN?.trim() || undefined,
    oauth2UserToken: process.env.X_OAUTH2_ACCESS_TOKEN?.trim() || undefined,
    apiKey: process.env.X_API_KEY?.trim() || undefined,
    apiSecret: process.env.X_API_SECRET?.trim() || undefined,
    accessToken: process.env.X_ACCESS_TOKEN?.trim() || undefined,
    accessSecret: process.env.X_ACCESS_SECRET?.trim() || undefined,
    appPublicUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sol-shield.xyz",
    includeReplyUrl: true,
  };
}

const PROMOS: Record<number, { title: string; imageFile: string; text: string }> = {
  1: {
    title: "Robinhood & EVM Multichain Expansion",
    imageFile: "promo-1-robinhood.png",
    text: `Over the past few weeks, our DMs and mentions kept asking for one thing:

"Can SolShield bring the same zero-bullshit code audits to Robinhood and EVM tokens?"

You asked. We shipped.

SolShield BuildCheck now natively covers official Robinhood Crypto listings and Arbitrum Orbit L2 contracts. 🛡️

Drop any CA or audit live: https://sol-shield.xyz/buildcheck`,
  },
  2: {
    title: "Evidence Cards V2 & Zero Contradiction",
    imageFile: "promo-2-cards.png",
    text: `Evidence Cards V2 just went live across the @usesolshield engine.

We rebuilt the visual forensics renderer from scratch:
• Real token logos pulled straight from on-chain & DEX metadata
• Zero-contradiction logic: honest memes get clear meme badges; real products get live API receipts
• Clean Wrapped editorial aesthetics without emoji clutter

Clear signal. Zero fluff. 🛡️
https://sol-shield.xyz/buildcheck`,
  },
  3: {
    title: "24/7 Autonomous Bot on X",
    imageFile: "promo-3-bot.png",
    text: `Need a fast forensic sanity check before entering a position?

Drop any Solana mint, Robinhood Chain L2 CA, or GitHub repo into a reply and tag @usesolshield.

⚡ Sub-15s headless execution
🔒 Zero-data-retention Venice AI audit
📊 Pixel-perfect Wrapped Evidence Card delivered to your feed

Available 24/7. Completely free.`,
  },
};

async function main() {
  const arg = process.argv[2]?.trim() || "1";
  const num = parseInt(arg, 10);
  const promo = PROMOS[num];

  if (!promo) {
    console.error(`Invalid promo number: ${arg}. Choose 1, 2, or 3.`);
    process.exit(1);
  }

  const imgPath = path.resolve(process.cwd(), "worker/out", promo.imageFile);
  if (!fs.existsSync(imgPath)) {
    console.error(`Image not found at: ${imgPath}`);
    process.exit(1);
  }

  const config = getAuthConfig();
  console.log(`[Promo] Preparing to post Promo ${num}: "${promo.title}" as @${config.botHandle}...`);

  const pngBuffer = fs.readFileSync(imgPath);
  console.log(`[Media] Uploading banner ${promo.imageFile} (${(pngBuffer.length / 1024).toFixed(1)} KB)...`);
  const mediaId = await uploadEvidencePngToX(config, pngBuffer);
  console.log(`[Media] Uploaded mediaId: ${mediaId}`);

  console.log(`[Tweet] Posting tweet to X...`);
  const result = await postReplyTweetOnX(config, {
    text: promo.text,
    mediaId,
  });

  console.log(`[SUCCESS] Promo ${num} posted to X!`);
  console.log(`Tweet ID: ${result.tweetId}`);
  console.log(`View tweet: https://x.com/${config.botHandle}/status/${result.tweetId}`);
}

main().catch((err) => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
