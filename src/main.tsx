import "@fontsource/instrument-serif/400.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { installErrorReporting } from "./client-errors";
import "./styles.css";

installErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary where="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
