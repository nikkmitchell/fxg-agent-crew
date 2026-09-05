import type { CrewTask, TaskKind } from "./event-core";

export type KindProgress = {
  kind: TaskKind | "unspecified";
  done: number;
  total: number;
};

const LABELS: Record<TaskKind | "unspecified", string> = {
  decision: "decisions",
  build: "built",
  unspecified: "unspecified",
};

/**
 * Progress reported PER KIND, never as one number.
 *
 * A single "8 of 9 done" is what let the board imply a working product when
 * every finished card was a decision. Splitting the count makes the true
 * sentence sayable: "4 decisions made, 0 built".
 *
 * Unspecified is its own bucket rather than being folded into either. Cards
 * created before this field existed were never labelled, and putting them in a
 * bucket on our behalf would be a guess presented as a record.
 */
export function progressByKind(tasks: CrewTask[]): KindProgress[] {
  const order: Array<TaskKind | "unspecified"> = ["decision", "build", "unspecified"];
  return order
    .map((kind) => {
      const matching = tasks.filter((task) => (task.kind ?? "unspecified") === kind);
      return {
        kind,
        done: matching.filter((task) => task.status === "done").length,
        total: matching.length,
      };
    })
    .filter((entry) => entry.total > 0);
}

/**
 * The honest one-line summary. Deliberately not a percentage: a percentage over
 * mixed kinds is the exact number that misled here.
 */
export function describeProgress(tasks: CrewTask[]): string {
  const parts = progressByKind(tasks);
  if (parts.length === 0) return "No tasks yet.";
  return parts.map((part) => `${part.done}/${part.total} ${LABELS[part.kind]}`).join(" · ");
}

export function kindLabel(kind: TaskKind | undefined): string {
  return kind === "decision" ? "decision" : kind === "build" ? "build" : "unspecified";
}
