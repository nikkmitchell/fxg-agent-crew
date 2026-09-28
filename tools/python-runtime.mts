import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_WEBHARNESS_TOOLS = fileURLToPath(new URL("./webharness/", import.meta.url));

/**
 * Pick one Python runtime for all local WebHarness helpers.
 *
 * On Windows the bundled interpreter is often not on PATH, and `python3` may
 * resolve to the Microsoft Store alias. Set WEBHARNESS_PYTHON to the exact
 * executable in that case. PYTHON_BIN and PYTHON remain supported for callers
 * that already use them.
 */
export type PythonInvocation = { command: string; prefixArgs: string[] };

export function pythonInvocation(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): PythonInvocation {
  for (const name of ["WEBHARNESS_PYTHON", "PYTHON_BIN", "PYTHON"]) {
    const configured = env[name]?.trim();
    if (configured) return { command: configured, prefixArgs: [] };
  }
  return platform === "win32"
    ? { command: "py", prefixArgs: ["-3"] }
    : { command: "python3", prefixArgs: [] };
}

export function displayPythonInvocation(invocation: PythonInvocation, platform: NodeJS.Platform): string {
  const command = platform === "win32"
    ? `& '${invocation.command.replaceAll("'", "''")}'`
    : `'${invocation.command.replaceAll("'", "'\\''")}'`;
  return [command, ...invocation.prefixArgs].join(" ");
}

export function pythonRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, WEBHARNESS_INBOX_DIR: LOCAL_WEBHARNESS_TOOLS };
}

export function execPythonFileSync(args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding): string {
  const invocation = pythonInvocation(options.env ?? process.env);
  const preparedOptions = { ...options, env: pythonRuntimeEnvironment(options.env ?? process.env) };
  try {
    return execFileSync(invocation.command, [...invocation.prefixArgs, ...args], preparedOptions);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Python interpreter '${invocation.command}' was not found. Set WEBHARNESS_PYTHON to the full path of the Python executable to use.`,
        { cause: error },
      );
    }
    throw error;
  }
}
