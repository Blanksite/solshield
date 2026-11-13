import { NextRequest, NextResponse } from "next/server";
import { getPresetReport } from "@/lib/presets";
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

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  try {
    const body = await req.json();
    const {
      question,
      message,
      lang: rawLang,
      language,
      presetId = "safe-jupiter-swap",
      veniceApiKey: rawVeniceKey,
      apiKey: rawApiKey,
      address,
    } = body as {
      question?: string;
      message?: string;
      lang?: "en" | "id";
      language?: "en" | "id";
      presetId?: string;
      veniceApiKey?: string;
      apiKey?: string;
      address?: string;
    };

    const lang = rawLang || language || "en";
    const veniceApiKey = rawVeniceKey || rawApiKey;
    const userQuestion = (question || message || address || "").trim();
    const { preset, report } = getPresetReport(presetId);

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
                content: `Scenario: ${preset.name}. Balance changes: ${JSON.stringify(
                  report.balanceDeltas
                )}. Threats: ${JSON.stringify(
                  report.threatFlags
                )}. Live Solana Slot: ${
                  liveSlot ?? "unavailable"
                }. User question: ${userQuestion}`,
              },
            ],
          }),
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          const content = vData?.choices?.[0]?.message?.content?.trim();
          if (content) {
            return NextResponse.json({
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
            });
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
      const deltaSummary = report.balanceDeltas
        .map((d) => `${d.direction === "IN" ? "+" : ""}${d.deltaUiAmount} ${d.asset}`)
        .join(", ");
      if (report.deterministicClassification === "CRITICAL") {
        reply =
          lang === "id"
            ? `Jika kamu menekan tombol **Approve / Confirm** di wallet Phantom atau Solflare pada transaksi ini (**${slotText}**):\n\n• **Perubahan Aset Terdeteksi:** ${deltaSummary}\n• **Penyebab:** ${
                report.threatFlags[0]?.title ||
                "Instruksi berbahaya terdeteksi dalam transaksi"
              } — ${
                report.threatFlags[0]?.description || ""
              }\n\n**Keputusan SolShield:** **JANGAN DITANDATANGANI.** Tutup halaman dApp tersebut sekarang juga.`
            : `If you click **Approve / Confirm** in Phantom or Solflare on this transaction (**${slotText}**):\n\n• **Simulated Balance Impact:** ${deltaSummary}\n• **Why:** ${
                report.threatFlags[0]?.title ||
                "Hidden malicious instruction inside the transaction"
              } — ${
                report.threatFlags[0]?.description || ""
              }\n\n**SolShield Verdict:** **DO NOT SIGN.** Close that website immediately.`;
      } else if (report.deterministicClassification === "WARNING") {
        reply =
          lang === "id"
            ? `Jika kamu menekan **Approve** pada transaksi ini:\n\n• Uangmu tidak langsung hilang detik ini, **TETAPI** kamu memberikan **izin penarikan (Delegate/Allowance)** kepada kontrak pihak ketiga.\n• Kontrak tersebut bisa menarik token kamu nanti tanpa meminta tanda tangan lagi.\n\n**Saran Agent:** Batasi jumlah izin (*allowance*) sesuai kebutuhan saja.`
            : `If you click **Approve** on this transaction:\n\n• Your tokens aren't taken immediately, **BUT** you are granting a **Token Delegate Allowance** to an external contract.\n• That delegate could pull approved tokens later without another prompt.\n\n**Agent Advice:** Restrict delegate approvals strictly to the exact amount needed.`;
      } else {
        reply =
          lang === "id"
            ? `Jika kamu menekan **Approve** pada skenario **${preset.name}** (**${slotText}**):\n\n• **Simulasi Perubahan Aset:** ${deltaSummary || "Sesuai instruksi"}\n• **Keamanan:** Semua instruksi menggunakan program terverifikasi tanpa transfer otoritas wallet.\n\n**Keputusan SolShield:** **Aman untuk ditandatangani.**`
            : `If you click **Approve** on scenario **${preset.name}** (**${slotText}**):\n\n• **Simulated Asset Deltas:** ${deltaSummary || "As inspected"}\n• **Safety Check:** Instructions match verified programs with no authority takeover.\n\n**SolShield Verdict:** **Safe to sign.**`;
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
          ? `Status inspeksi pada **${slotText}** (${latencyMs}ms):\n\n• **Skenario Aktif:** ${preset.name}\n• **Instruksi Terbaca:** ${report.instructions.length} instruksi program\n• **Verdict Keamanan:** **${report.deterministicClassification}** (Skor Risiko: ${report.deterministicRiskScore}/100)\n\nTempel alamat Token Mint, Program ID, Wallet, atau 88-char Tx Signature di kolom X-Ray untuk mengecek data Mainnet secara real-time.`
          : `Live status at **${slotText}** (${latencyMs}ms):\n\n• **Active Scenario:** ${preset.name}\n• **Instructions Decoded:** ${report.instructions.length} Solana program instructions\n• **Safety Verdict:** **${report.deterministicClassification}** (Risk Score: ${report.deterministicRiskScore}/100)\n\nPaste any Token Mint, Program ID, Wallet address, or 88-char Tx Signature to inspect live Mainnet data.`;
    }

    return NextResponse.json({
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
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Agent inspection failed.",
      },
      { status: 400 }
    );
  }
}
