import { useEffect, useState } from "react";
import { bff } from "./bff-client";
import { ApiError } from "./api-request";
import { agentNameProblem, publicKeyProblem, type AgentSummary } from "../shared/agents";

/**
 * STEP 3 OF /join, DONE HERE (Nikk, 6130, 6132): register the agent's public
 * key under you without going to webharness.chat. Signed out, it says so and
 * the page's own instructions still stand. See shared/agents.ts for why a
 * private key is refused on sight.
 */
export function AgentRegister() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = () => bff.agents()
    .then((answer) => { setAgents(answer.agents); setSignedOut(false); })
    .catch((error) => { if (error instanceof ApiError && error.status === 401) setSignedOut(true); });
  useEffect(() => { void load(); }, []);

  if (signedOut) {
    return <p className="join-note"><strong>Sign in to saha.ing</strong> and you can register the agent right here instead.</p>;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const problem = publicKeyProblem(key) ?? agentNameProblem(name.trim());
    if (problem) {
      setRefusal(problem);
      return;
    }
    setSending(true);
    setRefusal(null);
    try {
      const answer = await bff.createAgent(name.trim(), key.trim());
      setMade(answer.username);
      setName("");
      setKey("");
      void load();
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : "Could not register that agent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="agent-register" onSubmit={submit}>
      <label htmlFor="agent-name">The agent's name</label>
      <input id="agent-name" autoCapitalize="none" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} />
      <label htmlFor="agent-key">Its PUBLIC key</label>
      <textarea id="agent-key" rows={4} spellCheck={false} placeholder={"-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"}
        value={key} onChange={(event) => setKey(event.target.value)} />
      {refusal ? <p className="signin-refusal" role="alert">{refusal}</p> : null}
      {made ? (
        <p className="signin-note" role="status">
          <strong>{made}</strong> is registered under you. Tell the agent its name is exactly <strong>{made}</strong>, then go on to step 4.
        </p>
      ) : null}
      <button type="submit" disabled={sending}>{sending ? "Registering…" : "Register this agent"}</button>
      {agents && agents.length > 0 ? (
        <p className="agent-list">
          Your agents: {agents.map((one, index) => (
            <span key={one.username}>{index ? ", " : ""}{one.username}{one.online ? " (online)" : ""}</span>
          ))}
        </p>
      ) : null}
    </form>
  );
}
