import { useRef, useState } from "react";
import { IconDownload, IconFileZip, IconUpload } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { ShareControls } from "@/share/ShareControls";
import { downloadAllZip } from "@/state/download";
import { exportBundle, importBundle } from "@/state/bundle";

/**
 * Global project actions (download assets / export bundle / import). These live
 * on the right of every Studio page header (`page__head`) — there is no separate
 * top strip; the page header is the single header per page.
 */
export function HeaderActions() {
  const { project, importJson } = useStore();
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
    <div className="header-actions">
      <ShareControls />
      <button
        className="icon-btn"
        disabled={zipping}
        onClick={doZip}
        title={zipping ? "Comprimiendo…" : "Descargar assets (solo los medios generados)"}
        aria-label="Descargar assets"
      >
        <IconFileZip size={16} />
      </button>
      <button
        className="icon-btn"
        disabled={exporting}
        onClick={doExport}
        title={exporting ? "Exportando…" : "Exportar proyecto (proyecto + medios, .zip portable)"}
        aria-label="Exportar proyecto"
      >
        <IconDownload size={16} />
      </button>
      <button
        className="icon-btn"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
        title={importing ? "Importando…" : "Importar proyecto (.zip / .json)"}
        aria-label="Importar"
      >
        <IconUpload size={16} />
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
  );
}
