import { useSyncExternalStore } from "react";

/**
 * Minimal i18n. Default language is ENGLISH; Spanish is offered as an option.
 * Detection: the system language (navigator.language) picks Spanish when it
 * starts with "es", anything else falls back to English. A manual choice in
 * Settings → Preferences is persisted and wins over detection.
 *
 * Usage:  const { t } = useI18n();  →  t("login.title")
 * (Non-React code can import t directly; components should use the hook so
 * they re-render on language change.)
 */

export type Lang = "en" | "es";

const LANG_KEY = "magnific-studio:lang";

function detect(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "es") return stored;
    return (navigator.language ?? "").toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

let lang: Lang = detect();
const subs = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* ignore */
  }
  subs.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const STRINGS = {
  en: {
    // Auth
    "login.lead":
      "Sign in to use the studio. Your content is stored only on your machine (for this alpha); you'll connect your own Magnific account and your Claude API key in Settings.",
    "login.google": "Sign in with Google",
    "login.loading": "Loading…",
    // Workdir gate
    "workdir.title": "Where should we save your work?",
    "workdir.body1":
      "Your content (projects, generated images and videos) is stored only on your machine — never on our servers.",
    "workdir.body2":
      "Recommended: pick a working folder and everything will be saved there automatically.",
    "workdir.browserHint":
      "When you pick it, your browser will ask you to confirm editing files in that folder — click “Allow”. That prompt comes from the browser and is your guarantee of control.",
    "workdir.pick": "Choose folder",
    "workdir.browserOnly": "Only in this browser",
    "workdir.reconnect": "Reconnect your working folder",
    "workdir.reconnectCta": "Reconnect folder",
    "workdir.pickCta": "Choose your working folder to save on your machine.",
    "workdir.fallbackToast":
      "Your work is saved only in this browser. Before closing, use Export (ZIP) to take a copy — we'll warn you if you close with unexported changes.",
    // Onboarding tour
    "tour.s1.title": "Connect your accounts",
    "tour.s1.body":
      "Go to Settings and connect your Magnific account (OAuth) — image and video generation uses your credits — and paste your Claude API key, which directs the story. Neither leaves your session.",
    "tour.s2.title": "From idea to short film",
    "tour.s2.body":
      "Work in phases: Story → Script → Storyboard → Production → Delivery. Validate each phase to unlock the next; everything you generate is saved to your working folder.",
    "tour.prev": "Back",
    "tour.next": "Next",
    "tour.start": "Start creating",
    "tour.skip": "Skip tutorial",
    // App alert
    "alert.needApiTitle": "Claude isn't connected yet",
    "alert.title": "Notice",
    "alert.needApiBody":
      "The Director uses your own Anthropic API key. It stays in your session and never leaves your browser.",
    "alert.close": "Close",
    "alert.connectApi": "Connect Claude API",
    // Banners
    "banner.connectMagnific": "Connect your Magnific account to generate.",
    "banner.connectCta": "Connect my account",
    "banner.magnificConnected": "Magnific account connected. You can generate now.",
    "banner.magnificUnconfigured": "The backend has no MAGNIFIC_MCP_URL configured.",
    "banner.magnificError": "Could not connect to Magnific:",
    // Share
    "share.button": "Share project",
    "share.buttonShared": "Shared project — invite more people",
    "share.title": "Share",
    "share.lead":
      "You'll work together in real time while you're online at the same time. Everything generated is saved on each person's machine; a field being edited shows as locked for everyone else.",
    "share.invite": "Invite",
    "share.invited": "Invitation sent to {email}. They'll see it when they sign in.",
    "share.close": "Close",
    "share.inboxFrom": "has shared",
    "share.inboxNote": "with you. If you accept, everything generated will also be saved on your machine.",
    "share.accept": "Accept and open",
    "share.decline": "Decline",
    "share.linkSection": "Share link",
    "share.mode.approval": "Requires my approval",
    "share.mode.open": "Anyone with the link",
    "share.expiry": "Link expiry",
    "share.exp.never": "No expiry",
    "share.exp.d1": "1 day",
    "share.exp.d7": "7 days",
    "share.exp.d30": "30 days",
    "share.copyLink": "Copy link",
    "share.copied": "Link copied!",
    "share.regenerate": "Regenerate",
    "share.pending": "Join requests",
    "share.approve": "Approve",
    "share.reject": "Reject",
    "join.waitingTitle": "Waiting for approval",
    "join.waitingBody": "waiting for approval from",
    "join.waitingHint": "Keep this tab open — you'll enter automatically once approved.",
    "join.rejectedTitle": "Request declined",
    "join.rejectedBody": "The owner declined your request for this link.",
    "join.expiredTitle": "Link expired",
    "join.expiredBody": "This link has expired — ask for a new one.",
    "join.invalidTitle": "Invalid link",
    "join.invalidBody": "This link doesn't exist or was regenerated.",
    "user.collaborators": "Collaborators",
    "collab.empty": "No pending requests.",
    "collab.wants": "wants to join",
    // Phases
    "phase.story.desc":
      "Develop the narrative, visual style and references. Claude proposes characters and environments and generates their first image in the defined style.",
    "phase.story.gate": "Story ready → write script",
    "phase.script.desc": "Professional screenplay, scene by scene.",
    "phase.script.gate": "Script validated → generate storyboard",
    "phase.storyboard.desc":
      "Keyframe grid for the whole short. Approve each shot to enable the gate.",
    "phase.storyboard.gate": "Validate storyboard → go to Production",
    "phase.production.desc":
      "Scene by scene, shot by shot. Each shot is a video job with its cost and status.",
    "phase.delivery.desc": "Assemble the short with all the assets and deliver it.",
    // Home
    "home.dashboard": "Home",
    "home.recents": "Recents",
    "home.starred": "Starred",
    "home.all": "All projects",
    "home.trash": "Trash",
    "home.settings": "Settings",
    "home.library": "Library",
    "home.community": "Community",
    "home.stock": "Stock",
    "home.drafts": "Drafts",
    "home.resources": "Resources",
    "common.soon": "soon",
    "user.logout": "Log out",
    "trash.empty": "Trash is empty.",
    "trash.inTrash": "in trash",
    "trash.restore": "Restore",
    "trash.deleteOne": "Delete forever",
    "trash.emptyAll": "Empty trash",
    "trash.confirmTitle": "Delete forever",
    "trash.confirmBody": "This is permanent: the file will also be deleted from your local working folder. It cannot be undone.",
    "trash.typeName": "Type the file name to confirm:",
    "trash.typeWord": "Type {word} to confirm:",
    "trash.word": "DELETE",
    "trash.confirmAllTitle": "Empty trash",
    "trash.confirmAllBody": "This permanently deletes {n} file(s), including their content in your local working folder. It cannot be undone.",
    "trash.delete": "Delete",
    "home.create": "Create",
    "home.emptyTitle": "No projects yet.",
    "home.emptyCta": "to get started.",
    "home.emptyPress": "Press",
    "home.emptyRecents": "No recent projects.",
    "home.emptyAll": "No projects yet.",
    "home.newProject": "New project",
    "home.searchPlaceholder": "Search projects…",
    // Dashboard library
    "dlib.title": "Library",
    "dlib.lead": "Pick a file to browse its characters, environments and style — without opening it.",
    "dlib.empty": "No projects with library content yet.",
    "dlib.back": "All files",
    "dlib.assets": "assets",
    "dlib.none": "This file has no library assets yet.",
    "dlib.type.character": "Character",
    "dlib.type.location": "Environment",
    "dlib.type.style": "Style",
    // Settings
    "settings.apiHelp":
      "Stored only in this browser (never on our servers). Not exported with projects.",
    "settings.apiWhere": "Where do I find it?",
    "settings.model": "Director model",
    "settings.testConn": "Test connection",
    "settings.testing": "Testing…",
    "settings.connected": "Claude connected",
    "settings.noConn": "Not connected",
    "settings.untested": "Untested",
    "settings.prefs.title": "Preferences",
    "settings.prefs.lang": "Language",
    "settings.prefs.langHelp": "Detected from your system; your choice is remembered on this device.",
    "settings.lang.en": "English",
    "settings.lang.es": "Español",
    "settings.nav.profile": "Profile",
    "settings.nav.prefs": "Preferences",
    "settings.nav.security": "Security",
    "settings.nav.usage": "Usage",
    "settings.nav.claude": "Claude (API)",
    "settings.nav.magnific": "Magnific (MCP)",
    "settings.group.account": "Account",
    "settings.group.connections": "Connections",
    "settings.group.usage": "Usage",
    "settings.group.org": "Organization",
    "settings.apiKeyLabel": "Anthropic API (Claude)",
  },
  es: {
    "login.lead":
      "Inicia sesión para usar el estudio. Tu contenido se guarda solo en tu máquina (para esta versión alpha); conectarás tu propia cuenta de Magnific y tu API key de Claude en Ajustes.",
    "login.google": "Entrar con Google",
    "login.loading": "Cargando…",
    "workdir.title": "¿Dónde guardamos tu trabajo?",
    "workdir.body1":
      "Tu contenido (proyectos, imágenes y vídeos generados) se guarda solo en tu máquina, nunca en nuestros servidores.",
    "workdir.body2":
      "Recomendado: elige una carpeta de trabajo y todo se guardará ahí automáticamente.",
    "workdir.browserHint":
      "Al elegirla, tu navegador te pedirá confirmación para editar archivos en esa carpeta — pulsa «Permitir». Ese aviso es del navegador y es tu garantía de control.",
    "workdir.pick": "Elegir carpeta",
    "workdir.browserOnly": "Solo en este navegador",
    "workdir.reconnect": "Reconecta tu carpeta de trabajo",
    "workdir.reconnectCta": "Reconectar carpeta",
    "workdir.pickCta": "Elige tu carpeta de trabajo para guardar en tu máquina.",
    "workdir.fallbackToast":
      "Tu trabajo se guarda solo en este navegador. Antes de cerrar, usa Exportar (ZIP) para llevarte una copia — te avisaremos si cierras con cambios sin exportar.",
    "tour.s1.title": "Conecta tus cuentas",
    "tour.s1.body":
      "Ve a Ajustes y conecta tu cuenta de Magnific (OAuth) — la generación de imagen y vídeo usa tus créditos — y pega tu API key de Claude, que dirige la historia. Ninguna de las dos sale de tu sesión.",
    "tour.s2.title": "De la idea al corto",
    "tour.s2.body":
      "Trabaja por fases: Historia → Guion → Storyboard → Producción → Entrega. Valida cada fase para desbloquear la siguiente; todo lo que generes se guarda en tu carpeta de trabajo.",
    "tour.prev": "Anterior",
    "tour.next": "Siguiente",
    "tour.start": "Empezar a crear",
    "tour.skip": "Saltar tutorial",
    "alert.needApiTitle": "Falta conectar Claude",
    "alert.title": "Aviso",
    "alert.needApiBody":
      "El Director usa tu propia API key de Anthropic. Se guarda solo en tu sesión y nunca sale de tu navegador.",
    "alert.close": "Cerrar",
    "alert.connectApi": "Conectar API de Claude",
    "banner.connectMagnific": "Conecta tu cuenta de Magnific para poder generar.",
    "banner.connectCta": "Conectar mi cuenta",
    "banner.magnificConnected": "Cuenta de Magnific conectada. Ya puedes generar.",
    "banner.magnificUnconfigured": "El backend no tiene MAGNIFIC_MCP_URL configurado.",
    "banner.magnificError": "No se pudo conectar a Magnific:",
    "share.button": "Compartir proyecto",
    "share.buttonShared": "Proyecto compartido — invitar a más gente",
    "share.title": "Compartir",
    "share.lead":
      "Trabajaréis en tiempo real mientras estéis conectados a la vez. Todo lo que se genere se guarda en la máquina de cada uno; si un campo está siendo editado, los demás lo verán bloqueado.",
    "share.invite": "Invitar",
    "share.invited": "Invitación enviada a {email}. La verá al entrar.",
    "share.close": "Cerrar",
    "share.inboxFrom": "ha compartido",
    "share.inboxNote": "contigo. Al aceptar, lo que se genere se guardará también en tu máquina.",
    "share.accept": "Aceptar y abrir",
    "share.decline": "Rechazar",
    "share.linkSection": "Enlace para compartir",
    "share.mode.approval": "Con mi aprobación",
    "share.mode.open": "Cualquiera con el enlace",
    "share.expiry": "Caducidad del enlace",
    "share.exp.never": "Sin caducidad",
    "share.exp.d1": "1 día",
    "share.exp.d7": "7 días",
    "share.exp.d30": "30 días",
    "share.copyLink": "Copiar enlace",
    "share.copied": "¡Enlace copiado!",
    "share.regenerate": "Regenerar",
    "share.pending": "Solicitudes de acceso",
    "share.approve": "Aprobar",
    "share.reject": "Rechazar",
    "join.waitingTitle": "Esperando aprobación",
    "join.waitingBody": "pendiente de la aprobación de",
    "join.waitingHint": "Mantén esta pestaña abierta — entrarás automáticamente cuando te aprueben.",
    "join.rejectedTitle": "Solicitud rechazada",
    "join.rejectedBody": "El propietario ha rechazado tu solicitud para este enlace.",
    "join.expiredTitle": "Enlace caducado",
    "join.expiredBody": "Este enlace ha caducado — pide uno nuevo.",
    "join.invalidTitle": "Enlace no válido",
    "join.invalidBody": "Este enlace no existe o fue regenerado.",
    "user.collaborators": "Colaboradores",
    "collab.empty": "No hay solicitudes pendientes.",
    "collab.wants": "quiere entrar en",
    "phase.story.desc":
      "Desarrolla la narrativa, el estilo visual y las referencias. Claude propone personajes y entornos y genera su primera imagen con el estilo definido.",
    "phase.story.gate": "Historia lista → escribir guion",
    "phase.script.desc": "Guion profesional, escena a escena.",
    "phase.script.gate": "Guion validado → generar storyboard",
    "phase.storyboard.desc":
      "Grid de keyframes del corto completo. Aprueba cada plano para habilitar el gate.",
    "phase.storyboard.gate": "Validar storyboard → ir a Producción",
    "phase.production.desc":
      "Escena por escena, plano por plano. Cada plano es un job de vídeo con su coste y estado.",
    "phase.delivery.desc": "Monta el corto con todos los assets y entrégalo.",
    "home.dashboard": "Home",
    "home.recents": "Recientes",
    "home.starred": "Favoritos",
    "home.all": "Todos los proyectos",
    "home.trash": "Papelera",
    "home.settings": "Ajustes",
    "home.library": "Biblioteca",
    "home.community": "Comunidad",
    "home.stock": "Stock",
    "home.drafts": "Borradores",
    "home.resources": "Recursos",
    "common.soon": "pronto",
    "user.logout": "Cerrar sesión",
    "trash.empty": "La papelera está vacía.",
    "trash.inTrash": "en la papelera",
    "trash.restore": "Restaurar",
    "trash.deleteOne": "Eliminar definitivamente",
    "trash.emptyAll": "Vaciar papelera",
    "trash.confirmTitle": "Eliminar definitivamente",
    "trash.confirmBody": "Es permanente: el archivo se eliminará también de tu carpeta de trabajo local. No se puede deshacer.",
    "trash.typeName": "Escribe el nombre del archivo para confirmar:",
    "trash.typeWord": "Escribe {word} para confirmar:",
    "trash.word": "ELIMINAR",
    "trash.confirmAllTitle": "Vaciar papelera",
    "trash.confirmAllBody": "Se eliminarán permanentemente {n} archivo(s), incluido su contenido en tu carpeta de trabajo local. No se puede deshacer.",
    "trash.delete": "Eliminar",
    "home.create": "Crear",
    "home.emptyTitle": "Aún no hay proyectos.",
    "home.emptyCta": "para empezar.",
    "home.emptyPress": "Pulsa",
    "home.emptyRecents": "No hay proyectos recientes.",
    "home.emptyAll": "Aún no hay proyectos.",
    "home.newProject": "Nuevo proyecto",
    "home.searchPlaceholder": "Buscar proyectos…",
    "dlib.title": "Biblioteca",
    "dlib.lead": "Elige un archivo para ver sus personajes, entornos y estilo — sin tener que abrirlo.",
    "dlib.empty": "Aún no hay proyectos con contenido de biblioteca.",
    "dlib.back": "Todos los archivos",
    "dlib.assets": "assets",
    "dlib.none": "Este archivo aún no tiene assets en su biblioteca.",
    "dlib.type.character": "Personaje",
    "dlib.type.location": "Entorno",
    "dlib.type.style": "Estilo",
    "settings.apiHelp":
      "Se guarda solo en este navegador (nunca en nuestros servidores). No se exporta con los proyectos.",
    "settings.apiWhere": "¿Dónde encontrarla?",
    "settings.model": "Modelo del director",
    "settings.testConn": "Comprobar conexión",
    "settings.testing": "Probando…",
    "settings.connected": "Claude conectado",
    "settings.noConn": "Sin conexión",
    "settings.untested": "Sin probar",
    "settings.prefs.title": "Preferencias",
    "settings.prefs.lang": "Idioma",
    "settings.prefs.langHelp": "Detectado de tu sistema; tu elección se recuerda en este dispositivo.",
    "settings.lang.en": "English",
    "settings.lang.es": "Español",
    "settings.nav.profile": "Perfil",
    "settings.nav.prefs": "Preferencias",
    "settings.nav.security": "Seguridad",
    "settings.nav.usage": "Consumo",
    "settings.nav.claude": "Claude (API)",
    "settings.nav.magnific": "Magnific (MCP)",
    "settings.group.account": "Cuenta",
    "settings.group.connections": "Conexiones",
    "settings.group.usage": "Uso",
    "settings.group.org": "Organización",
    "settings.apiKeyLabel": "API de Anthropic (Claude)",
  },
} as const;

export type TKey = keyof (typeof STRINGS)["en"];

export function t(key: TKey, vars?: Record<string, string>): string {
  const table = STRINGS[lang] as Record<TKey, string>;
  let out: string = table[key] ?? (STRINGS.en as Record<TKey, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, v);
  return out;
}

/** Hook: re-renders on language change; returns { lang, t }. */
export function useI18n(): { lang: Lang; t: typeof t } {
  const current = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang: current, t };
}
