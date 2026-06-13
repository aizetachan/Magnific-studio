import { useRef } from "react";
import { useStore } from "@/state/ProjectStore";
import { totals } from "@/state/consumption";

/** Top bar: project name, live consumption meter, and JSON export/import. */
export function Topbar() {
  const { project, exportJson, importJson } = useStore();
  const t = totals(project);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}.studio.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importJson(String(reader.result));
      } catch (e) {
        alert("JSON inválido: " + (e instanceof Error ? e.message : e));
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="topbar">
      <div className="topbar__title">{project.name}</div>
      <div className="topbar__meters">
        <span className="meter" title="Créditos de Magnific consumidos">
          ⚡ {t.magnificCredits} cr
        </span>
        <span className="meter" title="Coste estimado de la API de Claude">
          ◐ ${t.claudeCostUsd.toFixed(4)}
        </span>
      </div>
      <div className="topbar__actions">
        <button className="mini" onClick={doExport}>
          Exportar JSON
        </button>
        <button className="mini" onClick={() => fileRef.current?.click()}>
          Importar
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
