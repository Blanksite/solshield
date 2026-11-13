import { describe, it, expect } from "vitest";
import {
  evaluateDomainSafety,
  normalizeHostname,
} from "../src/lib/domain-guard";

describe("M2 Domain Guard & Dual-Lane Hostname Sanitization", () => {
  it("strips protocol, userinfo, port, path, and wallet query params to bare ASCII hostname", () => {
    expect(
      normalizeHostname(
        "https://user:pass@app.jup.ag:8443/swap/SOL-USDC?wallet=CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx#confirm"
      )
    ).toBe("app.jup.ag");

    expect(normalizeHostname("  HTTPS://SOL-SHIELD.XYZ/audit  ")).toBe(
      "sol-shield.xyz"
    );
    expect(normalizeHostname("not valid host")).toBeNull();
  });

  it("trusts curated verified Solana dApps and their real subdomains", () => {
    const jup = evaluateDomainSafety("https://app.jup.ag/swap");
    expect(jup.status).toBe("VERIFIED");
    expect(jup.isAllowlisted).toBe(true);
    expect(jup.riskScore).toBe(0);

    const solShield = evaluateDomainSafety("sol-shield.xyz");
    expect(solShield.status).toBe("VERIFIED");
    expect(solShield.closestVerifiedBrand).toBe("SolShield");
  });

  it("allows localhost origins cleanly as DEV_LOCAL", () => {
    const local = evaluateDomainSafety("http://127.0.0.1:4178/test-dapp.html");
    expect(local.status).toBe("DEV_LOCAL");
    expect(local.riskLevel).toBe("LOW");
  });

  it("blocks typosquats, homoglyphs, subdomain spoofing, and punycode phishing", () => {
    const spoofedSub = evaluateDomainSafety("jup.ag.claim-airdrop.xyz");
    expect(spoofedSub.status).toBe("TYPOSQUAT_CRITICAL");
    expect(spoofedSub.isAllowlisted).toBe(false);
    expect(spoofedSub.riskScore).toBeGreaterThanOrEqual(70);

    const homoglyph = evaluateDomainSafety("ph4ntom-airdrop.top");
    expect(homoglyph.status).toBe("TYPOSQUAT_CRITICAL");

    const punycode = evaluateDomainSafety("xn--jup-9ka.ag");
    expect(punycode.isPunycode).toBe(true);
    expect(punycode.status).toBe("TYPOSQUAT_CRITICAL");
  });

  it("respects custom user blocklist and allowlist overrides", () => {
    const blocked = evaluateDomainSafety("custom-drainer.io", {
      blockedDomains: ["custom-drainer.io"],
    });
    expect(blocked.status).toBe("TYPOSQUAT_CRITICAL");
    expect(blocked.riskScore).toBe(95);

    const trusted = evaluateDomainSafety("internal-swap.example", {
      trustedDomains: ["internal-swap.example"],
    });
    expect(trusted.status).toBe("VERIFIED");
    expect(trusted.isAllowlisted).toBe(true);
  });
});
