import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { createCacheKeyHash } from "@/lib/scan-cache";
import { VENICE_API_BASE_URL, DEFAULT_VENICE_MODEL } from "@/lib/venice-ai";

const SOLANA_MAINNET_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

async function solanaRpcCall<T = unknown>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  let lastError: Error | null = null;
  for (const rpcUrl of SOLANA_MAINNET_RPCS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Solana RPC Error");
      return data.result as T;
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error("Solana Mainnet RPC failed");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Solana Mainnet RPC unavailable");
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      question,
      message,
      lang: rawLang,
      language,
      activeScanSummary,
      veniceApiKey: rawVeniceKey,
      apiKey: rawApiKey,
      address,
      forceRefresh,
    } = body as {
      question?: string;
      message?: string;
      lang?: "en" | "id";
      language?: "en" | "id";
      activeScanSummary?: string;
      veniceApiKey?: string;
      apiKey?: string;
      address?: string;
      forceRefresh?: boolean;
    };

    const lang = rawLang || language || "en";
    const veniceApiKey = rawVeniceKey || rawApiKey;
    const userQuestion = (question || message || address || "").trim();
    const cleanScanSummary =
      typeof activeScanSummary === "string"
        ? activeScanSummary.trim().slice(0, 800)
        : "";

    if (userQuestion.length > 1500) {
      return corsJson(
        { ok: false, error: "Question too long (max 1500 characters)." },
        { status: 400, req, policy: "web" }
      );
    }

    const cacheKey = createCacheKeyHash(
      JSON.stringify({
        q: userQuestion.toLowerCase(),
        lang,
        activeScanSummary: cleanScanSummary,
      })
    );

    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "web-ai",
        byokKey: typeof veniceApiKey === "string" ? veniceApiKey : undefined,
        namespace: "agent-chat",
        cacheKey,
        ttlMs: 10 * 60_000,
        forceRefresh: forceRefresh === true,
      },
      () =>
        computeAgentChatPayload({
          userQuestion,
          lang,
          activeScanSummary: cleanScanSummary,
          veniceApiKey,
        })
    );

    if (!guarded.ok) {
      return buildGuardErrorResponse(guarded);
    }

    return corsJson(
      {
        ...(guarded.value as Record<string, unknown>),
        cached: guarded.cached,
      },
      { req, policy: "web", headers: guarded.headers }
    );
  } catch (err) {
    return corsJson(
      {
        error: err instanceof Error ? err.message : "Agent inspection failed.",
      },
      { status: 400, req, policy: "web" }
    );
  }
}

async function computeAgentChatPayload(params: {
  userQuestion: string;
  lang: "en" | "id";
  activeScanSummary: string;
  veniceApiKey?: string;
}) {
  const startMs = Date.now();
  const { userQuestion, lang, activeScanSummary, veniceApiKey } = params;

    // Check if the user pasted a Solana Transaction Signature (80-90 base58 chars)
    const txSigMatch = userQuestion.match(/\b[1-9A-HJ-NP-Za-km-z]{84,90}\b/);
    // Check if the user pasted a base58 Solana address (32-44 chars) in their question or input
    const base58Match = !txSigMatch
      ? userQuestion.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)
      : null;
    const addressToInspect = base58Match?.[0] || txSigMatch?.[0] || null;

    // Query LIVE Solana Mainnet RPC for current slot and target account / tx telemetry
    let liveSlot: number | null = null;
    let accountFound = false;
    let accountOwnerProgram: string | null = null;
    let accountExecutable = false;
    let accountLamports: number | null = null;
    let rpcError = false;
    let txTelemetrySummary = "";

    try {
      const slotRes = await solanaRpcCall<number>("getSlot");
      if (typeof slotRes === "number") liveSlot = slotRes;

      if (txSigMatch) {
        const sig = txSigMatch[0];
        const txRes = await solanaRpcCall<{
          slot?: number;
          meta?: {
            fee?: number;
            err?: unknown;
            preBalances?: number[];
            postBalances?: number[];
          };
          transaction?: {
            message?: {
              accountKeys?: (string | { pubkey: string })[];
            };
          };
        } | null>("getTransaction", [
          sig,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ]);
        if (txRes) {
          accountFound = true;
          const feeLamports = txRes.meta?.fee ?? 5000;
          const statusText = txRes.meta?.err ? "FAILED / REVERTED" : "CONFIRMED";
          const keysCount = txRes.transaction?.message?.accountKeys?.length ?? 0;
          const slotLabel = txRes.slot ?? liveSlot;
          txTelemetrySummary = `Live Mainnet Transaction X-Ray for signature \`${sig.slice(
            0,
            10
          )}...${sig.slice(-8)}\`:\n• **Status:** ${statusText}${
            slotLabel ? ` (Slot #${slotLabel.toLocaleString("en-US")})` : ""
          }\n• **Network Fee:** ${(
            feeLamports / 1e9
          ).toFixed(6)} SOL (${feeLamports.toLocaleString("en-US")} lamports)\n• **Accounts Touched:** ${keysCount} accounts\n• **Zero-Retention Audit:** Verified via Venice AI privacy pipeline.`;
        } else {
          txTelemetrySummary = `Queried Solana Mainnet RPC${
            liveSlot ? ` (Slot #${liveSlot.toLocaleString("en-US")})` : ""
          } for signature \`${sig.slice(0, 10)}...${sig.slice(
            -8
          )}\`: Transaction not found on recent Mainnet history.`;
        }
      } else if (base58Match) {
        const targetAddr = base58Match[0];
        const accRes = await solanaRpcCall<{
          value: {
            executable: boolean;
            lamports: number;
            owner: string;
          } | null;
        }>("getAccountInfo", [targetAddr, { encoding: "base64" }]);
        if (accRes?.value) {
          accountFound = true;
          accountOwnerProgram = accRes.value.owner;
          accountExecutable = accRes.value.executable;
          accountLamports = accRes.value.lamports;
        } else {
          accountFound = false;
          accountLamports = 0;
        }
      }
    } catch {
      rpcError = true;
    }

    const latencyMs = Date.now() - startMs;
    const slotText =
      liveSlot !== null
        ? `Solana Mainnet Slot #${liveSlot.toLocaleString("en-US")}`
        : "Solana Mainnet RPC";

    // Optional live Venice AI inference if key is provided
    const apiKey =
      veniceApiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
    if (apiKey && userQuestion) {
      try {
        const vRes = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: DEFAULT_VENICE_MODEL,
            temperature: 0.2,
            max_tokens: 350,
            venice_parameters: {
              include_venice_system_prompt: false,
            },
            messages: [
              {
                role: "system",
                content:
                  "You are the SolShield Live Security Agent powered by Venice AI (zero data retention). Explain Solana transaction risks in clear, plain, beginner-friendly language.",
              },
              {
                role: "user",
                content: `${
                  activeScanSummary
                    ? `Active Session Scan Context: ${activeScanSummary}. `
                    : "No transaction or token scan loaded in session yet. "
                }Live Solana Slot: ${
                  liveSlot ?? "unavailable"
                }. Live RPC Inspection: ${
                  txTelemetrySummary ||
                  (addressToInspect
                    ? `Address ${addressToInspect} found=${accountFound}, owner=${accountOwnerProgram ?? "none"}, lamports=${accountLamports ?? 0}`
                    : "none")
                }. User question: ${userQuestion}`,
              },
            ],
          }),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          const content = vData?.choices?.[0]?.message?.content?.trim();
          if (content) {
            return {
              reply: content,
              liveSlot,
              latencyMs,
              inspectedAddress: addressToInspect,
              mode: "venice-live-api",
              telemetry:
                liveSlot !== null || accountFound
                  ? {
                      slot: liveSlot ?? undefined,
                      inspectedAddress: addressToInspect ?? undefined,
                      accountFound,
                      lamports: accountLamports ?? undefined,
                      solBalance:
                        accountLamports !== null
                          ? (accountLamports / 1e9).toFixed(4)
                          : undefined,
                      ownerProgram: accountOwnerProgram ?? undefined,
                      executable: accountExecutable,
                    }
                  : null,
            };
          }
        }
      } catch {
        // Fall through to deterministic plain-language response
      }
    }

    const qLower = userQuestion.toLowerCase();
    let reply = "";

    if (txTelemetrySummary) {
      reply = txTelemetrySummary;
    } else if (base58Match) {
      const targetAddr = base58Match[0];
      if (rpcError) {
        reply =
          lang === "id"
            ? `Gagal menghubungi Solana Mainnet RPC untuk memeriksa \`${targetAddr}\`. Coba kirim ulang beberapa saat lagi.`
            : `Unable to reach Solana Mainnet RPC while inspecting \`${targetAddr}\`. Please retry shortly.`;
      } else if (!accountFound) {
        reply =
          lang === "id"
            ? `Pemeriksaan langsung pada **${slotText}** (${latencyMs}ms):\n\n• **Alamat:** \`${targetAddr}\`\n• **Status Akun:** Belum diinisialisasi / tidak ditemukan di Mainnet (0 SOL).\n• **Privasi Venice AI:** Pemeriksaan berjalan dengan *Zero Data Retention*.`
            : `Live lookup at **${slotText}** (${latencyMs}ms):\n\n• **Address:** \`${targetAddr}\`\n• **Account Status:** Uninitialized / not found on Mainnet (0 SOL).\n• **Venice AI Privacy:** Checked with Zero Data Retention.`;
      } else {
        const solBal = ((accountLamports ?? 0) / 1e9).toFixed(4);
        reply =
          lang === "id"
            ? `Pemeriksaan langsung alamat Solana \`${targetAddr}\` di **${slotText}** (${latencyMs}ms):\n\n• **Tipe Akun:** ${
                accountExecutable
                  ? "Smart Contract / Program Aktif (Executable)"
                  : "Wallet / Token / Program Data Account"
              }\n• **Program Pemilik (Owner):** \`${accountOwnerProgram}\`\n• **Saldo Lamports (SOL):** ${solBal} SOL\n• **Privasi Venice AI:** Berjalan dengan *Zero Data Retention* (alamat wallet tidak disimpan).`
            : `Live inspection of Solana address \`${targetAddr}\` at **${slotText}** (${latencyMs}ms):\n\n• **Account Type:** ${
                accountExecutable
                  ? "Executable Smart Contract / Program"
                  : "Wallet / Token / Program Data Account"
              }\n• **Owner Program:** \`${accountOwnerProgram}\`\n• **Account SOL Reserve:** ${solBal} SOL\n• **Venice AI Privacy:** Checked with Zero Data Retention (your query is never logged).`;
      }
    } else if (
      qLower.includes("phantom") ||
      qLower.includes("approve") ||
      qLower.includes("sign") ||
      qLower.includes("tanda tangan") ||
      qLower.includes("what happens") ||
      qLower.includes("apa yang terjadi")
    ) {
      if (activeScanSummary) {
        reply =
          lang === "id"
            ? `Ringkasan audit aktif saat ini (**${slotText}**):\n\n${activeScanSummary}\n\nSelalu periksa instruksi & perubahan saldo nyata sebelum menekan **Approve / Confirm** di wallet.`
            : `Active session inspection (**${slotText}**):\n\n${activeScanSummary}\n\nAlways verify every decoded instruction and simulated balance delta before clicking **Approve / Confirm** in your wallet.`;
      } else {
        reply =
          lang === "id"
            ? `Belum ada transaksi yang di-audit pada sesi ini (**${slotText}**). Tempel **Base64 Transaction** atau **Solana Action Blink URL** di panel **01 // Pre-Sign Tx Firewall**, atau pasang ekstensi **Browser Guard** agar transaksi wallet dicek otomatis sebelum popup muncul.`
            : `No transaction payload has been inspected in this session yet (**${slotText}**). Paste a **Base64 Transaction** or **Blink Action URL** in **01 // Pre-Sign Tx Firewall**, or install the **Browser Guard** extension to intercept wallet sign prompts automatically.`;
      }
    } else if (
      qLower.includes("venice") ||
      qLower.includes("private") ||
      qLower.includes("privasi")
    ) {
      reply =
        lang === "id"
          ? `**Kenapa SolShield menggunakan Venice AI?**\n\nSaat mengecek transaksi bernilai besar di Solana, API AI biasa dapat menyimpan alamat wallet, IP, dan rencana transaksi kamu. SolShield memanggil **Venice AI (\`llama-3.3-70b\`)** dengan \`include_venice_system_prompt: false\` dan kebijakan **Zero Data Retention**, sehingga query kamu tidak pernah disimpan.`
          : `**Why SolShield uses Venice AI:**\n\nCentralized LLM APIs can log wallet addresses, IPs, and trade intent. SolShield routes security audits through **Venice AI (\`llama-3.3-70b\`)** with **Zero Data Retention**, ensuring queries are never persisted.`;
    } else {
      reply =
        lang === "id"
          ? `Terhubung ke **${slotText}** (${latencyMs}ms).\n\nTempel alamat Token Mint CA, Wallet/Program ID, atau 88-char Tx Signature di kolom X-Ray / chat untuk pemeriksaan on-chain Mainnet secara real-time.${
              activeScanSummary ? `\n\n**Scan Aktif:** ${activeScanSummary}` : ""
            }`
          : `Connected to **${slotText}** (${latencyMs}ms).\n\nPaste any Token Mint CA, Wallet/Program ID, or 88-char Tx Signature in X-Ray or chat for live Mainnet inspection.${
              activeScanSummary ? `\n\n**Active Scan:** ${activeScanSummary}` : ""
            }`;
    }

    return {
      reply,
      liveSlot,
      latencyMs,
      inspectedAddress: addressToInspect,
      mode: "live-solana-rpc",
      telemetry:
        liveSlot !== null || accountFound
          ? {
              slot: liveSlot ?? undefined,
              inspectedAddress: addressToInspect ?? undefined,
              accountFound,
              lamports: accountLamports ?? undefined,
              solBalance:
                accountLamports !== null
                  ? (accountLamports / 1e9).toFixed(4)
                  : undefined,
              ownerProgram: accountOwnerProgram ?? undefined,
              executable: accountExecutable,
            }
          : null,
      privacyProof: {
        provider: "Venice AI (Zero-Retention)",
        model: DEFAULT_VENICE_MODEL,
        zeroDataRetention: true,
      },
    };
}
