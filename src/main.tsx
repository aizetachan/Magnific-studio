import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProjectProvider } from "./state/ProjectStore";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </StrictMode>,
);
