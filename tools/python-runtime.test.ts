import { describe, expect, it } from "vitest";
import { displayPythonInvocation, execPythonFileSync, pythonInvocation, pythonRuntimeEnvironment } from "./python-runtime.mts";

describe("WebHarness Python runtime selection", () => {
  it("prefers the explicit WebHarness interpreter path", () => {
    expect(pythonInvocation({ WEBHARNESS_PYTHON: "C:\\Tools\\Python\\python.exe", PYTHON: "python" }, "win32"))
      .toEqual({ command: "C:\\Tools\\Python\\python.exe", prefixArgs: [] });
  });

  it("keeps existing Python override names as compatibility fallbacks", () => {
    expect(pythonInvocation({ PYTHON_BIN: "python-custom" }, "win32"))
      .toEqual({ command: "python-custom", prefixArgs: [] });
    expect(pythonInvocation({ PYTHON: "/opt/python/bin/python3" }, "darwin"))
      .toEqual({ command: "/opt/python/bin/python3", prefixArgs: [] });
  });

  it("uses the Windows launcher instead of the python3 Store alias by default", () => {
    expect(pythonInvocation({}, "win32")).toEqual({ command: "py", prefixArgs: ["-3"] });
  });

  it("uses python3 on Unix-like hosts", () => {
    expect(pythonInvocation({}, "linux")).toEqual({ command: "python3", prefixArgs: [] });
  });

  it("points helpers at the repository's inbox module while preserving caller environment", () => {
    const env = pythonRuntimeEnvironment({ WEBHARNESS_HOME: "C:\\identity\\Inkstone", PATH: "C:\\bin" });
    expect(env.WEBHARNESS_HOME).toBe("C:\\identity\\Inkstone");
    expect(env.PATH).toBe("C:\\bin");
    expect(env.WEBHARNESS_INBOX_DIR).toMatch(/[\\/]tools[\\/]webharness[\\/]?$/);
  });

  it("renders an explicit Windows path safely for PowerShell", () => {
    expect(displayPythonInvocation({ command: "C:\\Program Files\\Python\\python.exe", prefixArgs: [] }, "win32"))
      .toBe("& 'C:\\Program Files\\Python\\python.exe'");
  });

  it("gives a useful fix when the selected interpreter cannot be started", () => {
    expect(() => execPythonFileSync(["-V"], {
      encoding: "utf8",
      env: { ...process.env, WEBHARNESS_PYTHON: "inkstone-no-such-python-executable" },
    })).toThrow("Set WEBHARNESS_PYTHON to the full path");
  });
});
