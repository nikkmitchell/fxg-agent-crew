import type { CrewTask, TaskStatus } from "./event-core";
import type { WorkAgent } from "./types";

const columns: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In progress" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

export function calculateProjectProgress(tasks: CrewTask[]) {
  const total = tasks.reduce((sum, task) => sum + task.points, 0);
  const complete = tasks.filter((task) => task.status === "done").reduce((sum, task) => sum + task.points, 0);
  return { total, complete, percent: total === 0 ? 0 : Math.round((complete / total) * 100) };
}

export function ProjectBoard({ tasks, agents }: { tasks: CrewTask[]; agents: WorkAgent[] }) {
  const progress = calculateProjectProgress(tasks);
  const agentName = (id?: string) => agents.find((agent) => agent.id === id)?.name ?? "Unassigned";

  return (
    <section className="project-board" aria-labelledby="project-board-title">
      <header className="board-header">
        <div>
          <p className="eyebrow">SIMULATED PROJECT BOARD <span>/</span> DEMO PROJECTION</p>
          <h2 id="project-board-title">From brief to verified release.</h2>
        </div>
        <a href="https://github.com/nikkmitchell/fxg-agent-crew" target="_blank" rel="noreferrer">
          <small>PROJECT LOCATION</small>
          <strong>nikkmitchell / fxg-agent-crew ↗</strong>
        </a>
      </header>

      <div className="board-progress" aria-label={`${progress.percent}% of project points complete`}>
        <span><b>{progress.complete}</b> / {progress.total} points verified</span>
        <div><i style={{ width: `${progress.percent}%` }} /></div>
        <strong>{progress.percent}%</strong>
      </div>

      <div className="board-columns">
        {columns.map((column) => {
          const cards = tasks.filter((task) => task.status === column.status || (column.status === "in_progress" && (task.status === "assigned" || task.status === "blocked")));
          return (
            <section className="board-column" key={column.status} aria-labelledby={`column-${column.status}`}>
              <header><h3 id={`column-${column.status}`}>{column.label}</h3><span>{cards.length}</span></header>
              <div>
                {cards.length === 0 && <p className="column-empty">No confirmed tasks</p>}
                {cards.map((task) => (
                  <article key={task.id} className={task.status === "blocked" ? "is-blocked" : ""}>
                    <div className="task-meta"><span>{task.id}</span><b>{task.points} pts</b></div>
                    <h4>{task.title}</h4>
                    <footer><span>{agentName(task.assigneeId)}</span><small>{task.status.replace("_", " ")}</small></footer>
                    {task.blocker && <p className="task-blocker"><b>Blocked:</b> {task.blocker}</p>}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

