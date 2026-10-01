import "@fontsource/instrument-serif/400.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import { StrictMode } from "react";
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { installErrorReporting } from "./client-errors";
import "./styles.css";

// The room's three.js, for the modules teams load into it: the import map in
// index.html sends their `import "three"` to /kit/three-bridge.js, which hands
// out this very copy (server/spaces/three-bridge.ts).
(globalThis as { __SAHA_THREE__?: typeof THREE }).__SAHA_THREE__ = THREE;

installErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary where="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
