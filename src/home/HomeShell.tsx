import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  IconApps,
  IconBook2,
  IconChevronDown,
  IconClock,
  IconFile,
  IconHome,
  IconLayoutBoardSplit,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconVideo,
  IconPlus,
  IconSearch,
  IconSettings,
  IconStack2,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { PageHead } from "@/components/PageHead";
import { SettingsPage } from "@/settings/SettingsPage";
import { DashboardLibrary } from "@/home/DashboardLibrary";
import { useI18n, type TKey } from "@/i18n";
import { peekSettingsTarget } from "@/components/AppAlert";
import {
  deleteProjectForever,
  duplicateProject,
  getStarred,
  listProjects,
  listTrashedProjects,
  projectColor,
  renameProject,
  restoreProject,
  toggleStar,
  trashProject,
} from "@/state/persistence";

/**
 * Home shell — Magnific-style dashboard (mostly a MOCK). Live: open/create
 * projects (→ Studio), star/trash projects, and the Recents / All / Starred /
 * Trash sections. Other nav items are placeholders.
 */

type Section = "dashboard" | "recents" | "all" | "starred" | "trash" | "admin" | "library" | "mock";

/** Page title shown in the header bar for each Home section (dashboard has none;
 *  mock sections use their clicked label instead). */
const HOME_TITLE: Record<Section, TKey | ""> = {
  dashboard: "",
  recents: "home.recents",
  all: "home.all",
  starred: "home.starred",
  trash: "home.trash",
  admin: "home.settings",
  library: "dlib.title",
  mock: "",
};

const TOOLS: Array<{ icon: typeof IconMovie; label: string; studio?: boolean; url?: string }> = [
  { icon: IconMovie, label: "Studio", studio: true },
  { icon: IconPhoto, label: "Image", url: "https://www.magnific.com/app/ai-image-generator" },
  { icon: IconVideo, label: "Video", url: "https://www.magnific.com/app/ai-video-generator" },
  { icon: IconMusic, label: "Audio", url: "https://www.magnific.com/app/voiceover-generator" },
];

// Teams (mock) shown in the account/team switcher; tag = the team's plan.
const TEAMS = [
  { name: "Xialongbao", plan: "Business" },
  { name: "Santi's profile", plan: "Pro" },
  { name: "Nakama Studio", plan: "Team" },
  { name: "ESDECO", plan: "Professional" },
];
const planKey = (plan: string) => plan.toLowerCase();

const PHRASES = [
  "Pregunta a Magnific o navega a las herramientas",
  "Crea un corto: historia, storyboard y producción…",
  "Genera personajes, entornos y un estilo coherente…",
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function relTime(ts: number): string {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 3600000) return "hace minutos";
  if (d < 86400000) return `hace ${Math.floor(d / 3600000)} h`;
  const days = Math.floor(d / 86400000);
  if (days < 30) return `hace ${days} día${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months > 1 ? "es" : ""}`;
  return `hace ${Math.floor(months / 12)} año${months >= 24 ? "s" : ""}`;
}

function useTypewriter(): string {
  const [text, setText] = useState("");
  useEffect(() => {
    let phrase = 0, char = 0, deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = PHRASES[phrase];
      char += deleting ? -1 : 1;
      setText(full.slice(0, char));
      if (!deleting && char === full.length) { deleting = true; timer = setTimeout(tick, 1800); return; }
      if (deleting && char === 0) { deleting = false; phrase = (phrase + 1) % PHRASES.length; }
      timer = setTimeout(tick, deleting ? 28 : 52);
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, []);
  return text;
}

/** Self-contained so its ~20Hz typewriter ticks don't re-render the whole Home. */
function TypingSearch() {
  const placeholder = useTypewriter();
  return (
    <div className="home__search">
      <IconSearch size={18} />
      <input placeholder={placeholder} />
      <span className="home__kbd">⌘K</span>
    </div>
  );
}

interface CardProps {
  p: { id: string; name: string; createdAt: number };
  isStar: boolean;
  onOpen: (id: string) => void;
  onStar: (id: string) => void;
  onContext: (e: ReactMouseEvent, p: { id: string; name: string }) => void;
}
/** Module-level (stable identity) so a Home re-render reconciles, never remounts. */
const ProjectCard = memo(function ProjectCard({ p, isStar, onOpen, onStar, onContext }: CardProps) {
  return (
    <div className="pcard" onContextMenu={(e) => onContext(e, p)}>
      <div className="pcard__thumb" role="button" style={{ background: projectColor(p.id) }} onClick={() => onOpen(p.id)}>
        <button
          className={`pcard__star ${isStar ? "pcard__star--on" : ""}`}
          title={isStar ? "Quitar de favoritos" : "Marcar como favorito"}
          onClick={(e) => { e.stopPropagation(); onStar(p.id); }}
        >
          {isStar ? <IconStarFilled size={16} /> : <IconStar size={16} />}
        </button>
      </div>
      <div className="pcard__foot">
        <span className="pcard__type" title="Studio"><IconMovie size={14} /></span>
        <div className="pcard__meta">
          <span className="pcard__name">{p.name}</span>
          <span className="pcard__time">Editado {relTime(p.createdAt)}</span>
        </div>
      </div>
    </div>
  );
});

export function HomeShell({ onEnterStudio }: { onEnterStudio: () => void }) {
  const { switchProject, createProject } = useStore();
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("dashboard");
  // Jump straight to Settings when something requested it (connect-API modal).
  useEffect(() => {
    if (peekSettingsTarget()) setSection("admin");
    const go = () => setSection("admin");
    window.addEventListener("ms:open-settings", go);
    return () => window.removeEventListener("ms:open-settings", go);
  }, []);
  const [mockTitle, setMockTitle] = useState("Community");
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [team, setTeam] = useState(0);
  const [teamOpen, setTeamOpen] = useState(false);
  const teamRef = useRef<HTMLDivElement | null>(null);
  const [ctx, setCtx] = useState<{ id: string; name: string; x: number; y: number } | null>(null);

  // Close the right-click context menu on any click / escape / scroll.
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctx]);

  useEffect(() => {
    if (!teamOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (teamRef.current && !teamRef.current.contains(e.target as Node)) setTeamOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [teamOpen]);

  const projects = useMemo(() => listProjects(), [refresh]);
  const trashed = useMemo(() => listTrashedProjects(), [refresh]);
  const starredSet = useMemo(() => getStarred(), [refresh]);
  const bump = () => setRefresh((x) => x + 1);

  const openProject = (id: string) => {
    switchProject(id);
    onEnterStudio();
  };
  const newProject = () => {
    createProject();
    onEnterStudio();
  };
  // Mock nav items all share the "mock" section; remember which label was clicked
  // so the shared header can show the right page title.
  const openMock = (title: string) => {
    setMockTitle(title);
    setSection("mock");
  };

  const match = (name: string) => !query || name.toLowerCase().includes(query.toLowerCase());
  const filtered = projects.filter((p) => match(p.name));
  const starred = projects.filter((p) => starredSet.has(p.id) && match(p.name));

  const onStar = (id: string) => { toggleStar(id); bump(); };
  const onContext = (e: ReactMouseEvent, pp: { id: string; name: string }) => {
    e.preventDefault();
    setCtx({ id: pp.id, name: pp.name, x: e.clientX, y: e.clientY });
  };
  const renderCard = (p: { id: string; name: string; createdAt: number }) => (
    <ProjectCard key={p.id} p={p} isStar={starredSet.has(p.id)} onOpen={openProject} onStar={onStar} onContext={onContext} />
  );

  const grid = (items: typeof projects, empty: string) =>
    items.length === 0 ? (
      <p className="muted home__empty">{empty}</p>
    ) : (
      <div className="home__files">{items.map(renderCard)}</div>
    );

  return (
    <div className="home">
      <aside className="home__nav">
        <div className="home__brand">
          <span className="home__logo">
            <svg viewBox="4 8 24 17" fill="none" aria-label="Magnific">
              <path d="M18.4806 8L16.0805 13.862L13.6815 8H8.88124L4.08095 25C4.01661 25 10.0807 25 10.0807 25L16.0805 17.3789L22.0802 25C22.0802 25 28.1443 25 28.0799 25L23.2809 8H18.4806Z" fill="currentColor" />
            </svg>
          </span>
          <svg className="home__wordmark" viewBox="0 0 100 32" xmlns="http://www.w3.org/2000/svg" aria-label="Magnific" role="img">
            <path d="M28.4702 12.4399L28.1011 13.7203C27.7265 13.3058 27.2808 12.9643 26.7621 12.6968C26.0283 12.3193 25.1703 12.1301 24.1915 12.1301C23.0819 12.1301 22.0965 12.3796 21.2319 12.8787C20.3684 13.3777 19.6977 14.0608 19.2233 14.9278C18.7478 15.7959 18.5105 16.7624 18.5105 17.8271C18.5105 18.8919 18.7511 19.8361 19.2344 20.6968C19.7166 21.5575 20.3905 22.2342 21.254 22.7259C22.1187 23.2176 23.0974 23.4639 24.1915 23.4639C25.0694 23.4639 25.8332 23.3201 26.4816 23.0315C26.6435 22.9596 26.7987 22.8803 26.9483 22.7957C27.6899 22.3748 28.2885 21.8303 28.6842 21.3756L29.1974 23.1562L31.7547 23.1552L30.5863 19.097V12.4399H28.4702ZM27.7375 19.6183C27.7276 19.6363 27.7165 19.6532 27.7065 19.6701C27.4061 20.1798 26.9949 20.5763 26.4705 20.8607C25.9307 21.1536 25.3222 21.2995 24.6449 21.2995C23.9676 21.2995 23.3191 21.1536 22.7871 20.8607C22.2539 20.5678 21.836 20.1565 21.5345 19.6246C21.2319 19.0938 21.0811 18.4943 21.0811 17.8271C21.0811 17.1599 21.2319 16.5371 21.5345 15.9989C21.8371 15.4618 22.255 15.0389 22.7871 14.7322C23.3191 14.4256 23.9388 14.2723 24.6449 14.2723C25.351 14.2723 25.9307 14.4224 26.4705 14.7217C27.0104 15.0209 27.4316 15.4428 27.7342 15.9884C28.0368 16.534 28.1876 17.1462 28.1876 17.8271C28.1876 18.5081 28.0379 19.0886 27.7375 19.6172V19.6183ZM59.1951 10.5578H61.8744V8H59.1951V10.5578ZM59.3027 23.1541H61.7868V12.4399H59.3027V23.1552V23.1541ZM85.5914 20.7127C85.0294 21.0901 84.3954 21.2794 83.6904 21.2794C82.6384 21.2794 81.8004 20.9696 81.1741 20.35C80.5478 19.7304 80.2341 18.8824 80.2341 17.807C80.2341 17.0859 80.3782 16.4621 80.6664 15.9387C80.9546 15.4142 81.3581 15.0093 81.8758 14.7227C82.3946 14.4372 82.9987 14.2934 83.6904 14.2934C85.0006 14.2934 86.1346 14.7661 86.8196 16.2707L89 15.4385C88.6264 14.322 87.8372 13.5205 86.8872 12.9643C85.9361 12.4081 84.8709 12.1301 83.6904 12.1301C82.5098 12.1301 81.5044 12.3732 80.59 12.8575C79.6755 13.3428 78.9594 14.0153 78.4406 14.876C77.9218 15.7367 77.6624 16.7137 77.6624 17.807C77.6624 18.9003 77.9141 19.8974 78.4184 20.7581C78.9228 21.6188 79.6311 22.285 80.5467 22.7565C81.4612 23.2281 82.5087 23.4639 83.6904 23.4639C84.872 23.4639 85.9206 23.1763 86.8551 22.6297C87.8039 22.0735 88.5743 21.2572 88.9634 20.1671L86.8008 19.3413C86.5137 19.8985 86.1534 20.3341 85.5914 20.7127ZM42.1456 13.6474C39.8898 11.133 35.0491 11.8869 33.5482 14.801C30.8956 19.7209 36.0157 25.0362 41.2167 22.1856C41.2167 22.1856 41.6279 21.9371 42.1456 21.5046V22.7491C42.4271 26.4806 36.0622 27.0019 35.0391 23.5052L32.8576 24.3373C33.2899 25.3397 34.5026 28 38.604 28C44.009 28 44.6308 24.4452 44.6308 22.8665V12.4399H42.4936L42.1456 13.6474ZM41.7997 19.2334C39.3311 22.7967 33.7555 19.8425 35.8594 15.8721C36.6863 14.2818 39.0585 13.8493 40.6115 14.6825C42.2199 15.5083 42.6699 17.7531 41.7997 19.2324V19.2334ZM55.2501 12.663C54.6238 12.3077 53.8567 12.1301 52.95 12.1301C52.2439 12.1301 51.6575 12.2231 51.1897 12.4081C50.7973 12.5636 50.4537 12.775 50.1577 13.0415C50.1577 13.0415 49.7697 13.3735 49.3862 13.8081L48.9916 12.4399H46.901V23.1552H49.3851V17.4666C49.3851 16.8121 49.4959 16.2495 49.7198 15.779C49.9426 15.3085 50.2708 14.9469 50.7031 14.6942C51.1354 14.4414 51.6464 14.3156 52.2372 14.3156C53.0575 14.3156 53.666 14.544 54.0629 15.0008C54.4586 15.4576 54.657 16.1639 54.657 17.1187V23.1552H57.1411V16.6386C57.1411 15.6965 56.9826 14.8866 56.6656 14.2109C56.3486 13.5353 55.8775 13.0193 55.2501 12.664V12.663ZM73.0257 10.5578H75.7038V8H73.0257V10.5578ZM68.0674 10.7608C68.0674 10.1665 68.5374 10.0206 68.8434 10.0206H70.9406L71.5215 8.00106H68.3545C66.8237 8.00106 65.5833 9.18425 65.5833 10.6445V12.4399H63.5526V14.4594H65.5833V23.1552H68.0674V14.4594H73.1343V23.1552H75.6184V12.4399H68.0674V10.7608ZM12.5912 8L8.40451 17.2065L4.17344 8H0V23.1541H2.52734V10.4922L8.4034 23.2324L14.2362 10.4922V23.1552H16.7636V8H12.5901H12.5912Z" fill="currentColor" />
          </svg>
        </div>

        <button className="home__create" onClick={newProject}>
          <span className="home__create-ic"><IconPlus size={18} /></span> Create
        </button>

        <div className="home__navsearch">
          <IconSearch size={15} />
          <input placeholder={t("home.searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <nav className="home__navlist">
          <button className={`home__navitem ${section === "dashboard" ? "home__navitem--active" : ""}`} onClick={() => setSection("dashboard")}>
            <IconHome size={18} /> {t("home.dashboard")}
          </button>
          <button className={`home__navitem ${section === "recents" ? "home__navitem--active" : ""}`} onClick={() => setSection("recents")}>
            <IconClock size={18} /> {t("home.recents")}
          </button>
          <button className="home__navitem" onClick={() => window.open("https://www.magnific.com/app/explore#from_element=mainmenu", "_blank", "noopener")}><IconUsers size={18} /> {t("home.community")}</button>
          <button className="home__navitem" onClick={() => window.open("https://www.magnific.com/stock#from_element=mainmenu", "_blank", "noopener")}><IconStack2 size={18} /> {t("home.stock")}</button>
          <button className={`home__navitem ${section === "library" ? "home__navitem--active" : ""}`} onClick={() => setSection("library")}><IconBook2 size={18} /> {t("home.library")}</button>

          <div className="home__sep" />

          <div className="home__account-wrap" ref={teamRef}>
            <button className="home__account" onClick={() => setTeamOpen((v) => !v)}>
              <span className="home__account-chip" style={{ background: projectColor(TEAMS[team].name) }} />
              <span className="home__account-name">{TEAMS[team].name}</span>
              <IconChevronDown size={14} />
              <span className={`home__badge home__badge--${planKey(TEAMS[team].plan)}`}>{TEAMS[team].plan}</span>
            </button>
            {teamOpen ? (
              <div className="psw__menu home__teammenu">
                <div className="psw__menu-title">Equipos</div>
                <div className="psw__list">
                  {TEAMS.map((t, i) => (
                    <button
                      key={t.name}
                      className={`psw__item ${i === team ? "psw__item--active" : ""}`}
                      onClick={() => { setTeam(i); setTeamOpen(false); }}
                    >
                      <span className="psw__chip" style={{ background: projectColor(t.name) }} />
                      <span className="psw__item-name">{t.name}</span>
                      <span className={`home__badge home__badge--${planKey(t.plan)}`}>{t.plan}</span>
                    </button>
                  ))}
                </div>
                <button className="psw__new"><IconPlus size={15} /> Crear equipo</button>
              </div>
            ) : null}
          </div>
          <button className={`home__navitem ${section === "mock" && mockTitle === "Drafts" ? "home__navitem--active" : ""}`} onClick={() => openMock("Drafts")}><IconFile size={18} /> {t("home.drafts")}</button>
          <button className={`home__navitem ${section === "all" ? "home__navitem--active" : ""}`} onClick={() => setSection("all")}>
            <IconApps size={18} /> {t("home.all")}
          </button>
          <button className={`home__navitem ${section === "mock" && mockTitle === "Resources" ? "home__navitem--active" : ""}`} onClick={() => openMock("Resources")}><IconLayoutBoardSplit size={18} /> {t("home.resources")}</button>
          <button className={`home__navitem ${section === "trash" ? "home__navitem--active" : ""}`} onClick={() => setSection("trash")}>
            <IconTrash size={18} /> {t("home.trash")}
          </button>
          <button className={`home__navitem ${section === "admin" ? "home__navitem--active" : ""}`} onClick={() => setSection("admin")}><IconSettings size={18} /> {t("home.settings")}</button>

          <div className="home__sep" />

          <div className="home__starhead">{t("home.starred")}</div>
          {starred.length === 0 ? (
            <p className="muted small home__starred-empty">Marca un proyecto con ★ para verlo aquí.</p>
          ) : (
            starred.map((p) => (
              <button key={p.id} className="home__navitem" onClick={() => openProject(p.id)}>
                <span className="psw__chip" style={{ background: projectColor(p.id), width: 18, height: 18 }} /> {p.name}
              </button>
            ))
          )}
        </nav>
      </aside>

      <main className="home__main">
        {section !== "dashboard" ? (
          <div className="home__headbar">
            <PageHead
              title={section === "mock" ? mockTitle : HOME_TITLE[section] ? t(HOME_TITLE[section] as TKey) : ""}
              action={
                section === "all" ? (
                  <button className="action action--gen" onClick={newProject}>
                    <IconPlus size={16} /> {t("home.newProject")}
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : null}
        <div className="home__scroll">
          {section === "dashboard" ? (
            <div className="home__dash">
              <h1 className="home__greeting" onClick={() => setSection("dashboard")}>{greeting()}, empieza a crear</h1>
              <TypingSearch />
              <div className="home__tools">
                {TOOLS.map((t) => (
                  <button
                    key={t.label}
                    className="home__tool"
                    onClick={t.studio ? newProject : t.url ? () => window.open(t.url, "_blank", "noopener") : undefined}
                    title={t.label}
                  >
                    <span className={`home__tool-ic ${t.studio ? "home__tool-ic--studio" : ""}`}><t.icon size={22} /></span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              {filtered.length > 0 ? (
                <section className="home__block">
                  <div className="home__block-head"><strong>{t("home.recents")}</strong></div>
                  <div className="home__recents">{filtered.slice(0, 6).map(renderCard)}</div>
                </section>
              ) : null}
              <section className="home__block">
                <div className="home__block-head">
                  <strong>Proyectos</strong>
                  <button className="icon-btn" title={t("home.newProject")} onClick={newProject}><IconPlus size={16} /></button>
                </div>
                {grid(filtered, "Aún no hay proyectos. Pulsa Create para empezar.")}
              </section>
            </div>
          ) : (
          <div className="home__content">
          {section === "recents" ? (
            <section className="home__block">
              {grid(filtered, "No hay proyectos recientes.")}
            </section>
          ) : null}

          {section === "all" ? (
            <section className="home__block">
              {grid(filtered, "Aún no hay proyectos.")}
            </section>
          ) : null}

          {section === "starred" ? (
            <section className="home__block">
              {grid(starred, "Sin favoritos. Marca proyectos con ★.")}
            </section>
          ) : null}

          {section === "trash" ? (
            <section className="home__block">
              {trashed.length === 0 ? (
                <p className="muted home__empty">La papelera está vacía.</p>
              ) : (
                <div className="home__files">
                  {trashed.map((p) => (
                    <div className="pcard" key={p.id}>
                      <div className="pcard__thumb pcard__thumb--trash" style={{ background: projectColor(p.id) }} />
                      <div className="pcard__foot">
                        <div className="pcard__meta">
                          <span className="pcard__name">{p.name}</span>
                          <span className="pcard__time">en la papelera</span>
                        </div>
                        <button className="mini" onClick={() => { restoreProject(p.id); bump(); }}>Restaurar</button>
                        <button className="icon-btn" title="Eliminar definitivamente" onClick={() => { if (confirm(`¿Eliminar "${p.name}" para siempre?`)) { deleteProjectForever(p.id); bump(); } }}>
                          <IconTrash size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {section === "admin" ? <SettingsPage /> : null}
          {section === "library" ? <DashboardLibrary /> : null}

          {section === "mock" ? (
            <section className="home__block">
              <div className="home__mock">
                <p className="muted">Sección en construcción.</p>
              </div>
            </section>
          ) : null}
          </div>
          )}
        </div>
      </main>

      {ctx ? (
        <div className="ctxmenu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <button className="ctxmenu__item" onClick={() => {
            const name = window.prompt("Nuevo nombre del proyecto", ctx.name);
            if (name != null) { renameProject(ctx.id, name); bump(); }
            setCtx(null);
          }}>Renombrar</button>
          <button className="ctxmenu__item" onClick={() => { duplicateProject(ctx.id); bump(); setCtx(null); }}>Duplicar proyecto</button>
          <button className="ctxmenu__item" disabled>Share</button>
          <div className="ctxmenu__sep" />
          <button className="ctxmenu__item ctxmenu__item--danger" onClick={() => { trashProject(ctx.id); bump(); setCtx(null); }}>Mover a la papelera</button>
        </div>
      ) : null}
    </div>
  );
}
