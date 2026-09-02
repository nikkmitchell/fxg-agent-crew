import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { initialActivity, initialAgents, scriptedEvents } from "./demo";
import type { Activity, AgentStatus, Evidence, WorkAgent } from "./types";
import { LiveRoomPanel } from "./LiveRoomPanel";

const statusLabel: Record<AgentStatus, string> = {
  working: "Working",
  reviewing: "In review",
  waiting: "Needs direction",
  complete: "Verified",
};

const filterLabels = ["all", "decision", "artifact", "verification"] as const;
type FeedFilter = (typeof filterLabels)[number];
type CommandReceipt = {
  state: "pending" | "acknowledged";
  copy: string;
  agentId: string;
  agentName: string;
};

type StoredWorkroomState = {
  selectedId?: string;
  progress?: number;
  running?: boolean;
};

function loadStoredState(): StoredWorkroomState {
  try {
    return JSON.parse(localStorage.getItem("fxg-workroom-state") ?? "{}") as StoredWorkroomState;
  } catch {
    localStorage.removeItem("fxg-workroom-state");
    return {};
  }
}

function prependActivity(current: Activity[], next: Activity): Activity[] {
  return [next, ...current.filter((item) => !(item.agentId === next.agentId && item.copy === next.copy && item.type === next.type))].slice(0, 12);
}

function Glyph({ name }: { name: "grid" | "stack" | "clock" | "chat" | "pause" | "play" | "arrow" | "spark" }) {
  const paths = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    stack: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chat: <><path d="M5 5h14v10H9l-4 4V5Z"/><path d="M9 9h6M9 12h4"/></>,
    pause: <><path d="M9 6v12M15 6v12"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z"/><path d="m19 17 .6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z"/></>,
  };
  return <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function AgentMark({ agent, large = false }: { agent: WorkAgent; large?: boolean }) {
  return (
    <span
      className={`agent-mark shape-${agent.shape}${large ? " agent-mark--large" : ""}`}
      style={{ "--agent-accent": agent.accent } as React.CSSProperties}
      aria-hidden="true"
    >
      {agent.initials}
    </span>
  );
}

function Status({ status }: { status: AgentStatus }) {
  return <span className={`status status--${status}`} aria-label={`Status: ${statusLabel[status]}`}><i aria-hidden="true" />{statusLabel[status]}</span>;
}

function EvidenceIcon({ kind }: { kind: Evidence["kind"] }) {
  return <span className={`evidence-icon evidence-icon--${kind}`}>{kind === "file" ? "↗" : kind === "decision" ? "?" : "✓"}</span>;
}

export default function App() {
  const [storedState] = useState(loadStoredState);
  const [agents, setAgents] = useState(initialAgents);
  const [selectedId, setSelectedId] = useState(storedState.selectedId ?? "mira");
  const [running, setRunning] = useState(storedState.running ?? true);
  const [progress, setProgress] = useState(storedState.progress ?? 46);
  const [activities, setActivities] = useState(initialActivity);
  const cycleRef = useRef(0);
  const previousProgressRef = useRef(progress);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedEvidence, setSelectedEvidence] = useState(0);
  const [commandReceipt, setCommandReceipt] = useState<CommandReceipt | null>(null);
  const [liveRoomOpen, setLiveRoomOpen] = useState(false);

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const selectedArtifact = selected.evidence[selectedEvidence] ?? selected.evidence[0];

  useEffect(() => {
    localStorage.setItem("fxg-workroom-state", JSON.stringify({ selectedId, progress, running }));
  }, [selectedId, progress, running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const event = scriptedEvents[cycleRef.current % scriptedEvents.length];
      cycleRef.current += 1;
      setAgents((current) => current.map((agent) => agent.id === event.agentId ? { ...agent, status: event.status, verb: event.verb, task: event.task } : agent));
      setActivities((current) => prependActivity(current, { ...event.activity, id: Date.now(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }));
      setProgress((current) => Math.min(current + 4, 100));
    }, 5200);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const crossedCompletion = previousProgressRef.current < 100 && progress >= 100;
    previousProgressRef.current = progress;
    if (progress >= 100) setRunning(false);
    if (!crossedCompletion) return;
    setActivities((current) => prependActivity(current, { id: Date.now(), time: "now", agentId: "nikk", copy: "verified and completed the mission", type: "verification" }));
  }, [progress]);

  const filteredActivity = useMemo(() => activities.filter((item) => filter === "all" || item.type === filter), [activities, filter]);

  const selectAgent = (id: string) => {
    setSelectedId(id);
    setSelectedEvidence(0);
  };

  const submitDirection = (event: FormEvent) => {
    event.preventDefault();
    const copy = direction.trim();
    if (!copy) return;
    const target = { id: selected.id, name: selected.name };
    setCommandReceipt({ state: "pending", copy, agentId: target.id, agentName: target.name });
    setDirection("");
    setDirectionOpen(false);
    window.setTimeout(() => {
      setActivities((current) => prependActivity(current, { id: Date.now(), time: "now", agentId: target.id, copy: `acknowledged direction: “${copy}”`, type: "decision" }));
      setAgents((current) => current.map((agent) => agent.id === target.id ? { ...agent, status: "working", verb: "Applying your direction" } : agent));
      setCommandReceipt({ state: "acknowledged", copy, agentId: target.id, agentName: target.name });
    }, 900);
  };

  return (
    <div className="app-shell">
      <aside className="utility-rail" aria-label="Workspace navigation">
        <button className="brand-mark" aria-label="FXG Crew home">F<span>/</span>X</button>
        <nav className="rail-nav">
          <button className="rail-button is-active" aria-label="Workroom" title="Workroom"><Glyph name="grid" /></button>
          <button className="rail-button" aria-label="Artifacts" title="Artifacts" onClick={() => selectAgent("nikk")}><Glyph name="stack" /></button>
          <button className="rail-button" aria-label="Run history" title="Run history" onClick={() => document.querySelector(".work-log")?.scrollIntoView({ behavior: "smooth" })}><Glyph name="clock" /></button>
          <button className={`rail-button${liveRoomOpen ? " is-active" : ""}`} aria-label="Live rooms" title="Live rooms" aria-expanded={liveRoomOpen} onClick={() => setLiveRoomOpen((open) => !open)}><Glyph name="chat" /></button>
        </nav>
        <button className="rail-avatar" aria-label="Operator profile">NM</button>
      </aside>

      <main className="workroom">
        <header className="project-header">
          <div>
            <p className="eyebrow">FXG AGENT CREW <span>/</span> RELEASE 0.1</p>
            <h1>Build software with<br />the work visible.</h1>
            <p className="run-line"><span className="live-pulse" /> 2 agents working <b>·</b> 1 decision needed <b>·</b> live now</p>
          </div>
          <div className="header-actions">
            <button className="text-button" onClick={() => selectAgent("nikk")}>Review changes</button>
            <button className="primary-button" onClick={() => setDirectionOpen((open) => !open)} aria-expanded={directionOpen}>
              <Glyph name="spark" /> Direct the team
            </button>
          </div>
        </header>

        <section className={`direction-composer${directionOpen ? " is-open" : ""}`} aria-hidden={!directionOpen}>
          <form onSubmit={submitDirection}>
            <label htmlFor="direction">What should change?</label>
            <div className="composer-row">
              <input id="direction" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder={`Send direction to ${selected.name}…`} tabIndex={directionOpen ? 0 : -1} />
              <button type="submit" tabIndex={directionOpen ? 0 : -1} disabled={commandReceipt?.state === "pending"}>Send <Glyph name="arrow" /></button>
            </div>
          </form>
        </section>

        <section className="run-progress" aria-label="Mission progress">
          <div className="progress-copy"><span>MISSION PROGRESS</span><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          {progress >= 100 ? (
            <span className="run-complete">✓ Complete</span>
          ) : (
            <button className="run-control" onClick={() => setRunning((value) => !value)}><Glyph name={running ? "pause" : "play"} />{running ? "Pause run" : "Resume run"}</button>
          )}
        </section>

        {commandReceipt && (
          <button className={`command-receipt command-receipt--${commandReceipt.state}`} onClick={() => selectAgent(commandReceipt.agentId)} aria-live="polite">
            <span>{commandReceipt.state === "pending" ? "Sending direction" : "Direction acknowledged"}</span>
            <strong>{commandReceipt.agentName}</strong>
            <p>{commandReceipt.copy}</p>
            <b>{commandReceipt.state === "pending" ? "…" : "✓"}</b>
          </button>
        )}

        <section className="assignment-strip" aria-label="Current assignment flow">
          {agents.map((agent, index) => (
            <button key={agent.id} className={selected.id === agent.id ? "is-selected" : ""} onClick={() => selectAgent(agent.id)}>
              <span className="stage-index">0{index + 1}</span>
              <span><small>{agent.role}</small><strong>{agent.name}</strong></span>
              <Status status={agent.status} />
            </button>
          ))}
        </section>

        <section className="attention-strip" aria-labelledby="attention-title">
          <div className="attention-label"><i /><span>NEEDS ATTENTION</span></div>
          <div>
            <h2 id="attention-title">Hosted agent connection</h2>
            <p>Baiwei mapped the blocker. Choose a local runtime now or approve a valid port-443 gateway.</p>
          </div>
          <button onClick={() => selectAgent("baiwei")}>Review decision <Glyph name="arrow" /></button>
        </section>

        <section className="stage-heading">
          <div><p className="eyebrow">THE WORKROOM</p><h2>A gifted team, visibly at work.</h2></div>
          <p>Every handoff leaves evidence. Every decision stays inspectable.</p>
        </section>

        <section className="worktable" aria-label="Agent workspaces">
          <svg className="handoff-map" viewBox="0 0 1000 530" preserveAspectRatio="none" aria-hidden="true">
            <path d="M222 178 C360 70 410 88 505 160" />
            <path d="M525 175 C655 110 735 145 795 220" />
            <path d="M215 305 C345 435 520 420 650 335" />
            <circle cx="505" cy="160" r="5" /><circle cx="650" cy="335" r="5" />
          </svg>
          <div className="table-note table-note--one">brief accepted</div>
          <div className="table-note table-note--two">handoff ready</div>
          {agents.map((agent, index) => (
            <button
              key={agent.id}
              className={`agent-workspace agent-workspace--${index + 1}${selected.id === agent.id ? " is-selected" : ""}`}
              onClick={() => selectAgent(agent.id)}
              style={{ "--agent-accent": agent.accent } as React.CSSProperties}
              aria-label={`Open ${agent.name}'s workspace`}
            >
              <div className="agent-topline"><AgentMark agent={agent} /><span>{agent.role}</span><Status status={agent.status} /></div>
              <div className="agent-body">
                <p>{agent.verb}</p>
                <h3>{agent.task}</h3>
              </div>
              <div className="artifact-chip"><span>{agent.evidence[0].kind === "test" ? "✓" : "↗"}</span>{agent.evidence[0].name}<time>{agent.elapsed}</time></div>
              <span className="open-workspace">Open workspace <Glyph name="arrow" /></span>
            </button>
          ))}
          <div className="table-key"><span><i className="key-live" /> active work</span><span><i className="key-line" /> handoff</span><span><i className="key-decision" /> decision</span></div>
        </section>

        <section className="work-log">
          <div className="log-header">
            <div><p className="eyebrow">WORK LOG</p><h2>What changed because of the work.</h2></div>
            <div className="feed-filters" aria-label="Filter activity">
              {filterLabels.map((label) => <button key={label} className={filter === label ? "is-active" : ""} onClick={() => setFilter(label)}>{label}</button>)}
            </div>
          </div>
          <div className="activity-list" aria-live="polite">
            {filteredActivity.map((activity) => {
              const agent = agents.find((item) => item.id === activity.agentId) ?? agents[0];
              return <button key={activity.id} onClick={() => selectAgent(agent.id)}><time>{activity.time}</time><AgentMark agent={agent} /><p><strong>{agent.name}</strong> {activity.copy}</p><span className={`activity-type type-${activity.type}`}>{activity.type}</span></button>;
            })}
          </div>
        </section>
      </main>

      <aside className="evidence-rail" aria-label={`${selected.name} evidence`}>
        <div className="evidence-heading"><p className="eyebrow">SELECTED WORKSPACE</p><Status status={selected.status} /></div>
        <div className="agent-profile">
          <AgentMark agent={selected} large />
          <p>{selected.name.toUpperCase()} IS {selected.status === "waiting" ? "WAITING" : selected.status === "complete" ? "READY" : "WORKING"}</p>
          <h2>{selected.task}</h2>
          <span>{selected.summary}</span>
        </div>

        <div className="evidence-section">
          <div className="section-rule"><span>CURRENT EVIDENCE</span><small>{selected.evidence.length} items</small></div>
          <div className="evidence-list">
            {selected.evidence.map((item, index) => (
              <button key={item.name} className={selectedEvidence === index ? "is-active" : ""} onClick={() => setSelectedEvidence(index)}>
                <EvidenceIcon kind={item.kind} /><span><strong>{item.name}</strong><small>{item.detail}</small></span><b>↗</b>
              </button>
            ))}
          </div>
        </div>

        <div className="artifact-preview">
          <div className="preview-bar"><span>{selectedArtifact.name}</span><i>LIVE</i></div>
          <p>{selectedArtifact.preview}</p>
          <div className="preview-lines"><span /><span /><span /><span /></div>
        </div>

        <div className="handoff-callout">
          <span>ACTIVE HANDOFF</span>
          <p><strong>{selected.name}</strong> → {selected.id === "nikk" ? "Mira" : "Nikk"}</p>
          <small>Context accepted · evidence attached</small>
        </div>

        <div className="inspector-actions">
          <button onClick={() => setDirectionOpen(true)}>Send direction</button>
          <button onClick={() => setActivities((current) => [{ id: Date.now(), time: "now", agentId: selected.id, copy: "workspace focus opened by operator", type: "work" }, ...current])}>Watch work</button>
        </div>
      </aside>
      {liveRoomOpen && <LiveRoomPanel onClose={() => setLiveRoomOpen(false)} />}
    </div>
  );
}
