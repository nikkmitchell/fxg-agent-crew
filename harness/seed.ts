/**
 * Put a project, a card and a long discussion into the fake upstream.
 *
 * Seeded as crew-event fences through the fake's /__control/say rather than by
 * writing state directly, so the events travel the same adapter, validator and
 * authority checks as anything else. Seeding state directly would create a
 * board that no sequence of real messages could produce, and then the browser
 * test would be exercising a fiction.
 */
const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:8899";
const AUTHOR = process.env.FAKE_USER ?? "tester";

async function say(payload: unknown, username = AUTHOR) {
  const content = "```crew-event\n" + JSON.stringify({ version: 1, payload }) + "\n```";
  const response = await fetch(`${FAKE}/__control/say`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, content }),
  });
  if (!response.ok) throw new Error(`seed failed: ${response.status}`);
}

await say({
  type: "project.upserted",
  project: {
    id: "demo",
    name: "Demo",
    summary: "A project that exists so the failure paths can be driven in a browser.",
    goals: ["Prove history, retry and recovery against a server that can be broken on command"],
    steps: [{ id: "s1", title: "Drive the three failure paths in a browser", status: "in_progress" }],
  },
});

await say({
  type: "task.upserted",
  task: {
    id: "chatty",
    projectId: "demo",
    title: "A card with a long discussion that used to become uneditable",
    status: "backlog",
    points: 2,
  },
});

// Five comments is past the point where re-sending them all in a task.upserted
// exceeds the 2000-character message limit. On the real board eleven cards had
// crossed this line and could not be edited at all.
for (let i = 1; i <= 5; i += 1) {
  await say({
    type: "task.commented",
    taskId: "chatty",
    comment: {
      id: `c${i}`,
      author: AUTHOR,
      body:
        `Comment number ${i}. ` +
        "This is a substantial review comment that takes up real space in the durable log. ".repeat(4),
      createdAt: "2026-09-09T00:00:00Z",
    },
  });
}

console.log("seeded a project, a card and five comments");

/**
 * A board reconciliation, as it actually arrives.
 *
 * Three cards closed back to back. backlog → done is not a legal transition, so
 * each one costs four transitions plus a comment: fifteen messages of
 * bookkeeping for three decisions. This is the shape that made one wake contain
 * 49 messages.
 */
for (const id of ["chatty", "chatty", "chatty"]) {
  void id;
}

const RECONCILED = ["reconcile-a", "reconcile-b", "reconcile-c"];
for (const taskId of RECONCILED) {
  await say({
    type: "task.upserted",
    task: { id: taskId, projectId: "demo", title: `Card ${taskId}`, status: "backlog", points: 1 },
  });
}
for (const taskId of RECONCILED) {
  await say({ type: "task.transitioned", taskId, to: "assigned" });
  await say({ type: "task.transitioned", taskId, to: "in_progress" });
  await say({
    type: "task.commented",
    taskId,
    comment: { id: `${taskId}-c1`, author: AUTHOR, body: "Closing: verified against the deployed build.", createdAt: "2026-09-09T10:00:00Z" },
  });
  await say({ type: "task.transitioned", taskId, to: "review" });
  await say({ type: "task.transitioned", taskId, to: "done" });
}

console.log(`seeded a reconciliation: ${RECONCILED.length} cards, ${RECONCILED.length * 6} messages`);
