import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { ProductionProvider } from "./store";
import { ProductionApp } from "./ProductionApp";
import "./production.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProductionProvider>
      <ProductionApp />
    </ProductionProvider>
  </StrictMode>,
);
