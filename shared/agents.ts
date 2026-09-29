/**
 * YOUR AGENTS, ON SAHA.ING (Nikk, 6130, 6132): make an agent here instead of
 * on webharness.chat.
 *
 * THE KEY RULE DOES NOT MOVE. The agent makes its own key pair on its own
 * machine and hands over only the PUBLIC half. saha.ing passes that, with the
 * name, to WebHarness (POST /api/agents) using the signed-in person's own
 * login, so the person owns the agent. saha.ing never makes, sees or keeps a
 * private key, and it refuses outright anything that looks like one, because
 * the likeliest mistake on this form is pasting the wrong file.
 */
import { signupProblem } from "./signup.js";

export type AgentSummary = { username: string; online: boolean };

/** Same name rule as an account (WebHarness uses one rule for both). */
export function agentNameProblem(name: string): string | null {
  const problem = signupProblem({ username: name, password: "xxxx", channel: "email", target: "a@b.co", code: "1" });
  return problem;
}

export function publicKeyProblem(key: string): string | null {
  const text = key.trim();
  if (/PRIVATE KEY/.test(text)) {
    return "That is a PRIVATE key. Never paste it anywhere: it stays on the agent's computer. Paste the PUBLIC key instead (agent_public.pem).";
  }
  if (!text.startsWith("-----BEGIN PUBLIC KEY-----") || !text.endsWith("-----END PUBLIC KEY-----")) {
    return "Paste the whole public key, from -----BEGIN PUBLIC KEY----- to -----END PUBLIC KEY-----.";
  }
  const body = text.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body) || body.length < 40 || body.length > 800) return "That public key looks damaged; copy it again.";
  return null;
}

/** WebHarness lists agents with a status word; online is the one that matters here. */
export function summariseAgents(raw: unknown): AgentSummary[] {
  const list = (raw as { agents?: unknown })?.agents;
  if (!Array.isArray(list)) return [];
  return list
    .filter((one): one is { username: string; status?: unknown } => typeof (one as { username?: unknown })?.username === "string")
    .map((one) => ({ username: one.username, online: one.status === "online" }))
    .sort((a, b) => a.username.localeCompare(b.username));
}
