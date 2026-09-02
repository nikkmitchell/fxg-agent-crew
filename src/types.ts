export type AgentStatus = "working" | "reviewing" | "waiting" | "complete";

export interface Evidence {
  name: string;
  detail: string;
  kind: "file" | "decision" | "test";
  preview: string;
}

export interface WorkAgent {
  id: string;
  name: string;
  initials: string;
  role: string;
  status: AgentStatus;
  verb: string;
  task: string;
  summary: string;
  elapsed: string;
  accent: string;
  shape: "circle" | "arch" | "square" | "diamond";
  evidence: Evidence[];
}

export interface Activity {
  id: number;
  time: string;
  agentId: string;
  copy: string;
  type: "work" | "decision" | "artifact" | "verification";
}

export interface ScriptedEvent {
  agentId: string;
  status: AgentStatus;
  verb: string;
  task: string;
  activity: Omit<Activity, "id" | "time">;
}
