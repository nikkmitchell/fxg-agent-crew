import { useEffect, useState } from "react";

type BuildInfo = {
  commit: string | null;
  deployedAt: string | null;
  processStartedAt: string;
  unavailableReason?: string;
};

const when = (iso: string | null) => (iso ? iso.slice(0, 19).replace("T", " ") + " UTC" : "—");

/**
 * What is actually running, read from the deployment rather than described.
 *
 * The panel's only job is to let someone check whether what they think is
 * running is running. So it renders exactly what the server could read, and
 * says UNKNOWN out loud when that is the answer — a build panel that invents a
 * version defeats its own purpose.
 */
export function BuildPanel() {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed_out" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}bff/build`, { credentials: "include" });
        if (response.status === 401) {
          if (!cancelled) setState("signed_out");
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as BuildInfo;
        if (!cancelled) {
          setInfo(body);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return <p className="muted-note">Reading the deployment…</p>;
  if (state === "signed_out") return <p className="muted-note">Sign in to see what is deployed.</p>;
  if (state === "error" || !info) return <p className="project-error" role="alert">Could not read the deployment.</p>;

  const restartedSinceDeploy =
    info.deployedAt !== null && info.processStartedAt > info.deployedAt;

  return (
    <section className="build-panel">
      <dl>
        <dt>Deployed commit</dt>
        <dd>
          {info.commit ? (
            <code>{info.commit.slice(0, 12)}</code>
          ) : (
            <><b>Unknown.</b> {info.unavailableReason}</>
          )}
        </dd>

        <dt>Deployed at</dt>
        <dd>{when(info.deployedAt)}</dd>

        <dt>Process started</dt>
        <dd>{when(info.processStartedAt)}</dd>
      </dl>

      {restartedSinceDeploy ? (
        <p className="build-note">
          This process started after the last deploy, so it has been restarted since — the code is
          unchanged, but anything held only in memory was lost.
        </p>
      ) : null}

      <p className="build-note">
        Read from the record the release script writes. It reports the commit that was shipped,
        which is not necessarily on the mainline — a branch deployed directly shows its own commit,
        and that is the point.
      </p>
    </section>
  );
}
