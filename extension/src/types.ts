import type { DomainEvaluation } from "../../src/lib/domain-guard";
import type {
  ExtensionRequestKind,
  ExtensionVerdict,
} from "../../src/lib/extension-verdict";

export interface SolShieldSettings {
  enabled: boolean;
  apiBaseUrl: string;
  network: "mainnet" | "devnet";
  customRpcUrl: string;
  strictMode: boolean;
  veniceApiKey: string;
  trustedDomains: string[];
  blockedDomains: string[];
}

export const DEFAULT_SETTINGS: SolShieldSettings = {
  enabled: true,
  apiBaseUrl: "http://localhost:3000",
  network: "mainnet",
  customRpcUrl: "",
  strictMode: false,
  veniceApiKey: "",
  trustedDomains: [],
  blockedDomains: [],
};

export interface ProviderProtectionStatus {
  legacyProvidersWrapped: string[];
  walletStandardWrapped: string[];
  frozenProviders: string[];
  updatedAt: number;
}

export interface VerdictHistoryEntry {
  id: string;
  timestamp: number;
  hostname: string;
  walletMethod: ExtensionRequestKind;
  decision: ExtensionVerdict["decision"];
  riskScore: number;
  headline: string;
  apiVerified: boolean;
  timeoutUnverified: boolean;
  userAction: "APPROVED" | "REJECTED";
  txCount: number;
}

export interface InterceptRequestPayload {
  requestId: string;
  walletName: string;
  walletMethod: ExtensionRequestKind;
  originUrl: string;
  hostname: string;
  base64Transactions?: string[];
  signMessageBytesBase64?: string;
  signMessagePreviewText?: string;
}

export interface InterceptDecisionResponse {
  requestId: string;
  allow: boolean;
  userAction: "APPROVED" | "REJECTED";
  verdict: ExtensionVerdict;
  errorMessage?: string;
}

export interface PopupStateSnapshot {
  settings: SolShieldSettings;
  history: VerdictHistoryEntry[];
  activeTab: {
    tabId: number | null;
    hostname: string | null;
    domainEvaluation: DomainEvaluation | null;
    providerStatus: ProviderProtectionStatus | null;
  };
}
