import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { App } from "./App";
import { ProjectProvider } from "./state/ProjectStore";
import { AuthGate } from "./auth/AuthGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </AuthGate>
  </StrictMode>,
);
