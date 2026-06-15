import { useRef, useState } from "react";
import {
  IconBolt,
  IconCoin,
  IconDownload,
  IconFileZip,
  IconUpload,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { totals } from "@/state/consumption";
import { downloadAllZip } from "@/state/download";
import { exportBundle, importBundle } from "@/state/bundle";

/** Top bar: project name, live consumption meter, downloads and portable bundle. */
export function Topbar() {
  const { project, importJson } = useStore();
  const t = totals(project);
  const claude = project.settings.connectionTested; // "ok" | "failed" | "untested"
  const claudeLabel =
    claude === "ok" ? "Claude conectado" : claude === "failed" ? "Claude sin conexión" : "Claude sin probar";
  const fileRef = useRef<HTMLInputElement>(null);
  const [zipping, setZipping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const doZip = async () => {
    setZipping(true);
    try {
      const n = await downloadAllZip(project);
      if (n === 0) alert("Aún no hay assets generados para descargar.");
    } catch (e) {
      alert("No se pudo crear el ZIP: " + (e instanceof Error ? e.message : e));
    } finally {
      setZipping(false);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await exportBundle(project);
    } catch (e) {
      alert("No se pudo exportar: " + (e instanceof Error ? e.message : e));
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      if (file.name.endsWith(".zip")) {
        // Portable bundle: restores media to this machine, then loads the project.
        const restored = await importBundle(file);
        importJson(JSON.stringify(restored));
      } else {
        // Plain JSON (structure only; media references stay as-is).
        importJson(await file.text());
      }
    } catch (e) {
      alert("No se pudo importar: " + (e instanceof Error ? e.message : e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar__title">{project.name}</div>
      <div className="topbar__meters">
        <span className="meter" title={`${claudeLabel} (configúralo en Ajustes)`}>
          <span className={`status-dot status-dot--${claude}`} /> {claudeLabel}
        </span>
        <span className="meter" title="Créditos de Magnific consumidos">
          <IconBolt size={14} /> {t.magnificCredits} cr
        </span>
        <span className="meter" title="Coste estimado de la API de Claude">
          <IconCoin size={14} /> ${t.claudeCostUsd.toFixed(4)}
        </span>
      </div>
      <div className="topbar__actions">
        <button className="mini" disabled={zipping} onClick={doZip} title="Solo los medios generados">
          <IconFileZip size={15} /> {zipping ? "Comprimiendo…" : "Descargar assets"}
        </button>
        <button className="mini" disabled={exporting} onClick={doExport} title="Proyecto + medios (.zip portable)">
          <IconDownload size={15} /> {exporting ? "Exportando…" : "Exportar proyecto"}
        </button>
        <button className="mini" disabled={importing} onClick={() => fileRef.current?.click()}>
          <IconUpload size={15} /> {importing ? "Importando…" : "Importar"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.json,application/json,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
