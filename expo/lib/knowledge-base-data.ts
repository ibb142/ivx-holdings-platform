/**
 * IVX Knowledge Base — Data Model
 *
 * 10 categories covering the full IVX institutional knowledge base:
 * arquitectura, reglas de miembros, reglas de inversión, documentación interna,
 * proyectos, propiedades, errores anteriores, soluciones aprobadas,
 * procedimientos de QA, políticas de seguridad.
 */

export type KBArticle = {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  tags: string[];
  updatedAt: string;
  author: string;
  readTimeMin: number;
  /** Ordered content blocks rendered by the article reader. */
  blocks: KBBlock[];
};

export type KBBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'callout'; variant: 'info' | 'warning' | 'danger' | 'success'; text: string }
  | { type: 'divider' };

export type KBCategory = {
  id: string;
  title: string;
  subtitle: string;
  icon: string; // lucide icon name
  color: string;
  articleCount: number;
};

// ─── Categories ─────────────────────────────────────────────────────────

export const KB_CATEGORIES: KBCategory[] = [
  {
    id: 'arquitectura',
    title: 'Arquitectura',
    subtitle: 'Estructura del sistema y stack tecnológico',
    icon: 'Network',
    color: '#4A90D9',
    articleCount: 4,
  },
  {
    id: 'reglas-miembros',
    title: 'Reglas de Miembros',
    subtitle: 'Clasificación, roles y permisos',
    icon: 'Users',
    color: '#FFD700',
    articleCount: 3,
  },
  {
    id: 'reglas-inversion',
    title: 'Reglas de Inversión',
    subtitle: 'Políticas de oferta, comisiones y retornos',
    icon: 'TrendingUp',
    color: '#00C48C',
    articleCount: 4,
  },
  {
    id: 'documentacion-interna',
    title: 'Documentación Interna',
    subtitle: 'Procesos, flujos y manuales operativos',
    icon: 'FileText',
    color: '#A78BFA',
    articleCount: 3,
  },
  {
    id: 'proyectos',
    title: 'Proyectos',
    subtitle: 'Catálogo de proyectos y estado de desarrollo',
    icon: 'Briefcase',
    color: '#FF6B35',
    articleCount: 3,
  },
  {
    id: 'propiedades',
    title: 'Propiedades',
    subtitle: 'Bienes raíces, tokenización y due diligence',
    icon: 'Building2',
    color: '#4ECDC4',
    articleCount: 3,
  },
  {
    id: 'errores-anteriores',
    title: 'Errores Anteriores',
    subtitle: 'Incidentes registrados y lecciones aprendidas',
    icon: 'AlertTriangle',
    color: '#FF4D4D',
    articleCount: 4,
  },
  {
    id: 'soluciones-aprobadas',
    title: 'Soluciones Aprobadas',
    subtitle: 'Fixes validados y patrones verificados',
    icon: 'CheckCircle2',
    color: '#00C48C',
    articleCount: 3,
  },
  {
    id: 'procedimientos-qa',
    title: 'Procedimientos de QA',
    subtitle: 'Protocolos de testing y verificación',
    icon: 'ClipboardCheck',
    color: '#F59E0B',
    articleCount: 4,
  },
  {
    id: 'politicas-seguridad',
    title: 'Políticas de Seguridad',
    subtitle: 'Claves, RLS, acceso y compliance',
    icon: 'Shield',
    color: '#FFD700',
    articleCount: 4,
  },
];

// ─── Articles ───────────────────────────────────────────────────────────

export const KB_ARTICLES: KBArticle[] = [
  // ── Arquitectura ──
  {
    id: 'arq-001',
    categoryId: 'arquitectura',
    title: 'Stack Tecnológico IVX',
    summary: 'Visión general del stack: Expo React Native, Hono backend, Supabase, Render.',
    tags: ['stack', 'overview', 'infra'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Stack Tecnológico IVX' },
      { type: 'paragraph', text: 'IVX Holdings opera sobre un stack dividido en tres capas principales: frontend móvil (Expo/React Native), backend API (Hono en Render), y capa de datos (Supabase + PostgreSQL + S3).' },
      { type: 'heading', text: 'Frontend — Expo Go' },
      { type: 'list', items: [
        'Framework: Expo SDK con React Native',
        'Navegación: expo-router (file-based)',
        'Estado servidor: @tanstack/react-query',
        'Estado global: @nkzw/create-context-hook',
        'Iconos: lucide-react-native',
        'Testing: bun test',
      ]},
      { type: 'heading', text: 'Backend — Hono en Render' },
      { type: 'list', items: [
        'Runtime: Hono sobre Node.js en Render free/performance tier',
        'API REST + WebSocket para chat en tiempo real',
        'Integración con Vercel AI Gateway para IA',
        'Almacenamiento: S3 (best-effort mirror) + Supabase (primary)',
      ]},
      { type: 'heading', text: 'Datos — Supabase' },
      { type: 'list', items: [
        'PostgreSQL con RLS por rol',
        'Auth integrado (JWT + email/passwordless)',
        'Edge Functions para operaciones serverless',
        'Storage para archivos multimedia',
      ]},
      { type: 'callout', variant: 'info', text: 'Supabase es la fuente de verdad primaria para lectura/escritura. S3 funciona como mirror secundario best-effort.' },
    ],
  },
  {
    id: 'arq-002',
    categoryId: 'arquitectura',
    title: 'Estructura de Carpetas',
    summary: 'Organización del monorepo: expo/, backend/, deploy/, docs/.',
    tags: ['structure', 'monorepo'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Estructura del Monorepo' },
      { type: 'paragraph', text: 'El proyecto vive en un monorepo con las siguientes carpetas principales:' },
      { type: 'list', items: [
        'expo/ — App móvil Expo Go (React Native)',
        'backend/ — API Hono + servicios + workers',
        'deploy/ — Scripts de despliegue y configuración',
        'docs/ — Documentación del proyecto',
        'dist/ — Build artifacts',
      ]},
      { type: 'heading', text: 'Estructura interna de expo/' },
      { type: 'list', items: [
        'app/ — Pantallas (expo-router file-based)',
        'app/(tabs)/ — Pantallas del tab bar',
        'app/admin/ — Consola de owner',
        'components/ — Componentes reutilizables',
        'lib/ — Lógica, servicios, contextos',
        'constants/ — Tokens de diseño, brand, colores',
        'hooks/ — Hooks custom',
        'types/ — Definiciones TypeScript',
      ]},
      { type: 'callout', variant: 'info', text: 'Las rutas de expo-router se generan automáticamente desde la estructura de carpetas en app/. No se necesita configuración manual de rutas.' },
    ],
  },
  {
    id: 'arq-003',
    categoryId: 'arquitectura',
    title: 'Pipeline de Despliegue',
    summary: 'Flujo: commit → GitHub → Render deploy → health check → producción.',
    tags: ['deploy', 'ci', 'render'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 5,
    blocks: [
      { type: 'heading', text: 'Pipeline de Despliegue' },
      { type: 'paragraph', text: 'El despliegue sigue un flujo de commit → push a GitHub → Render auto-deploy → verificación de health.' },
      { type: 'heading', text: 'Pasos del Pipeline' },
      { type: 'list', items: [
        '1. Commit en local con mensaje descriptivo',
        '2. Push a GitHub (rama main)',
        '3. Render detecta el cambio y inicia build',
        '4. Build exitoso → deploy automático',
        '5. /health verifica SHA y bootTime',
        '6. Verificación de endpoints críticos',
      ]},
      { type: 'callout', variant: 'warning', text: 'Render free tier hiberna tras inactividad. Primer request puede tardar 30-50s en despertar el servicio.' },
      { type: 'heading', text: 'Verificación Post-Deploy' },
      { type: 'paragraph', text: 'Después de cada deploy se debe verificar:' },
      { type: 'list', items: [
        'GET /health — status, commit SHA, bootTime',
        'GET /api/ivx/executive-layer — executive summary',
        'GET /api/ivx/autonomous/qa — QA scheduler status',
        'POST /api/ivx/owner-passwordless-login — owner auth',
      ]},
    ],
  },
  {
    id: 'arq-004',
    categoryId: 'arquitectura',
    title: 'Sistema de Contextos y Providers',
    summary: 'React Query, Auth, I18n, Analytics, IPX, Wallet, Earn — orden y jerarquía.',
    tags: ['providers', 'context', 'state'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Jerarquía de Providers' },
      { type: 'paragraph', text: 'El árbol de providers sigue un orden estricto: React Query debe ser el provider más externo, con todos los demás contextos anidados dentro.' },
      { type: 'code', language: 'text', code: 'QueryClientProvider\n  └─ I18nProvider\n      └─ AuthProvider\n          └─ AnalyticsProvider\n              └─ IPXProvider\n                  └─ WalletProvider\n                      └─ EarnProvider\n                          └─ EmailProvider\n                              └─ NetworkProvider' },
      { type: 'callout', variant: 'info', text: 'React Query es siempre el provider top-level. Todos los demás contextos se anidan dentro. Nunca envolver RootLayoutNav en un provider.' },
      { type: 'paragraph', text: 'Para estado persistente (settings, progreso), usar AsyncStorage solo dentro del context hook provider, nunca directamente en hooks.' },
    ],
  },

  // ── Reglas de Miembros ──
  {
    id: 'miem-001',
    categoryId: 'reglas-miembros',
    title: 'Sistema de Clasificación de Miembros',
    summary: 'Tiers: Owner, Admin, Investor, Buyer, Member. Permisos por rol.',
    tags: ['roles', 'classification', 'permissions'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 5,
    blocks: [
      { type: 'heading', text: 'Clasificación de Miembros' },
      { type: 'paragraph', text: 'IVX clasifica a sus miembros en 5 tiers con permisos escalados. La clasificación se obtiene via getMyClassification() en el backend.' },
      { type: 'heading', text: 'Tiers y Permisos' },
      { type: 'list', items: [
        'Owner — Acceso total, consola admin, deploy control, AI gateway',
        'Admin — Gestión de miembros, propiedades, contenido, CRM',
        'Investor — Ver ofertas, invertir, portafolio, retiros',
        'Buyer — Ver propiedades, hacer ofertas, JV deals, tokenización',
        'Member — Registro básico, acceso a reels, chat público',
      ]},
      { type: 'callout', variant: 'info', text: 'El Owner Console y la pestaña CRM solo son visibles para roles owner/admin. Se controlan via href: isOwner ? undefined : null en el tab layout.' },
      { type: 'heading', text: 'Determinación de Rol' },
      { type: 'paragraph', text: 'El rol se determina en el auth context al iniciar sesión. Se compara el email con el owner email aprobado y se lee el campo role del profileData.' },
      { type: 'code', language: 'typescript', code: 'const isOwnerOrAdmin = role === \'owner\' || role === \'admin\';\nconst isOwnerSession = currentUser.isOwnerOrAdmin\n  || (!!currentUser.email && currentUser.email === ownerEmail);' },
    ],
  },
  {
    id: 'miem-002',
    categoryId: 'reglas-miembros',
    title: 'Flujo de Registro de Miembros',
    summary: 'POST /api/members/register → AuthUserId → stage COMPLETED.',
    tags: ['registration', 'onboarding', 'auth'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Flujo de Registro' },
      { type: 'paragraph', text: 'El registro de miembros sigue un flujo de 3 etapas: datos básicos → verificación de email → completion.' },
      { type: 'heading', text: 'Endpoint Principal' },
      { type: 'code', language: 'text', code: 'POST /api/members/register\nBody: { email, password, firstName, lastName, country, phone }\nResponse: { ok: true, stage: "COMPLETED", authUserId, registrationRequestId }' },
      { type: 'heading', text: 'Validaciones' },
      { type: 'list', items: [
        'Email único (no duplicados)',
        'Password mínimo 8 caracteres',
        'Country obligatorio (código ISO)',
        'Phone opcional pero recomendado',
      ]},
      { type: 'callout', variant: 'warning', text: 'El registro crea un authUserId en Supabase Auth inmediatamente. El registrationRequestId se persiste para auditoría.' },
    ],
  },
  {
    id: 'miem-003',
    categoryId: 'reglas-miembros',
    title: 'Política de Acceso Abierto',
    summary: 'Open Access Mode para demos y QA sin autenticación.',
    tags: ['access', 'open-mode', 'demo'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 2,
    blocks: [
      { type: 'heading', text: 'Open Access Mode' },
      { type: 'paragraph', text: 'IVX soporta un modo de acceso abierto (isOpenAccessModeEnabled) que permite usar la app sin autenticación para demos y QA.' },
      { type: 'paragraph', text: 'Cuando está activo, el auth guard en el tab layout no redirige a /login y todas las pantallas son accesibles.' },
      { type: 'callout', variant: 'danger', text: 'Open Access Mode NUNCA debe estar activo en producción. Es solo para demos, testing y QA interna.' },
    ],
  },

  // ── Reglas de Inversión ──
  {
    id: 'inv-001',
    categoryId: 'reglas-inversion',
    title: 'Estructura de Ofertas',
    summary: 'Tipos: equity, debt, JV, tokenizada. Mínimos y máximos.',
    tags: ['offers', 'equity', 'debt', 'jv'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 5,
    blocks: [
      { type: 'heading', text: 'Tipos de Oferta' },
      { type: 'paragraph', text: 'IVX ofrece 4 tipos de estructura de inversión:' },
      { type: 'list', items: [
        'Equity — Compra de acciones en proyectos inmobiliarios',
        'Debt Acquisition — Compra de deuda a descuento',
        'JV (Joint Venture) — Sociedad con land partners',
        'Tokenizada — Fraccionamiento digital del activo',
      ]},
      { type: 'heading', text: 'Mínimos de Inversión' },
      { type: 'list', items: [
        'Equity: $5,000 mínimo',
        'Debt Acquisition: $10,000 mínimo',
        'JV: $25,000 mínimo',
        'Tokenizada: $100 mínimo por token',
      ]},
      { type: 'callout', variant: 'info', text: 'Las ofertas tokenizadas permiten fraccionar un activo en tokens de $100, democratizando el acceso a inversiones inmobiliarias.' },
    ],
  },
  {
    id: 'inv-002',
    categoryId: 'reglas-inversion',
    title: 'Comisiones y Estructura de Retorno',
    summary: 'Carry, management fee, preferred return, waterfall.',
    tags: ['fees', 'returns', 'waterfall'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 6,
    blocks: [
      { type: 'heading', text: 'Estructura de Comisiones' },
      { type: 'list', items: [
        'Management fee: 2% anual sobre capital comprometido',
        'Carry (carried interest): 20% sobre utilidades después de preferred return',
        'Preferred return: 8% anual para investors antes de carry',
      ]},
      { type: 'heading', text: 'Waterfall Distribution' },
      { type: 'paragraph', text: 'Las utilidades se distribuyen en el siguiente orden:' },
      { type: 'list', items: [
        '1. Retorno de capital original al investor',
        '2. Preferred return 8% anual acumulado',
        '3. Split 80/20 (investor/IVX) sobre utilidades restantes',
      ]},
      { type: 'callout', variant: 'success', text: 'El preferred return del 8% garantiza que los investors reciben su retorno antes de que IVX participe en las utilidades.' },
    ],
  },
  {
    id: 'inv-003',
    categoryId: 'reglas-inversion',
    title: 'Auto-Reinvest y Copy Trading',
    summary: 'Reinversión automática de dividendos y copy trading de top investors.',
    tags: ['reinvest', 'copy-trading'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Auto-Reinvest' },
      { type: 'paragraph', text: 'Los investors pueden activar la reinversión automática de dividendos en nuevas oportunidades del mismo tipo.' },
      { type: 'heading', text: 'Copy Trading' },
      { type: 'paragraph', text: 'Permite replicar automáticamente las inversiones de investors con mejor desempeño histórico.' },
      { type: 'callout', variant: 'warning', text: 'El copy trading replica proporcionalmente, no copia montos exactos. Se respeta el mínimo de inversión por oferta.' },
    ],
  },
  {
    id: 'inv-004',
    categoryId: 'reglas-inversion',
    title: 'Reglas de Retiro',
    summary: 'Períodos de lock-up, ventanas de retiro, penalidades.',
    tags: ['withdrawal', 'lockup', 'penalty'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Períodos de Lock-up' },
      { type: 'list', items: [
        'Equity: 12 meses lock-up mínimo',
        'Debt Acquisition: 6 meses lock-up',
        'JV: 24 meses lock-up',
        'Tokenizada: Liquidez secundaria en marketplace',
      ]},
      { type: 'heading', text: 'Ventanas de Retiro' },
      { type: 'paragraph', text: 'Después del lock-up, los retiros se procesan en ventanas trimestrales con 30 días de notificación previa.' },
      { type: 'callout', variant: 'danger', text: 'Retiros antes del lock-up incurren en penalidad del 5% del capital invertido.' },
    ],
  },

  // ── Documentación Interna ──
  {
    id: 'doc-001',
    categoryId: 'documentacion-interna',
    title: 'Flujo de Aprobación de Propiedades',
    summary: 'Submit → Due Diligence → Aprobación → Publicación.',
    tags: ['properties', 'approval', 'workflow'],
    updatedAt: '2026-07-28',
    author: 'IVX Operations',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Flujo de Aprobación' },
      { type: 'paragraph', text: 'Las propiedades pasan por un flujo de 4 etapas antes de ser publicadas para inversión:' },
      { type: 'list', items: [
        '1. Submit — Land partner o admin envía datos de la propiedad',
        '2. Due Diligence — Verificación legal, física y financiera',
        '3. Aprobación — Owner/admin revisa y aprueba',
        '4. Publicación — La propiedad se hace visible para investors',
      ]},
      { type: 'callout', variant: 'info', text: 'Cada etapa genera un registro de auditoría con timestamp, usuario y comentarios.' },
    ],
  },
  {
    id: 'doc-002',
    categoryId: 'documentacion-interna',
    title: 'Manual de Operaciones CRM',
    summary: 'Gestión de leads, investors, buyers y communication flows.',
    tags: ['crm', 'leads', 'operations'],
    updatedAt: '2026-07-28',
    author: 'IVX Operations',
    readTimeMin: 5,
    blocks: [
      { type: 'heading', text: 'CRM IVX' },
      { type: 'paragraph', text: 'El CRM integrado gestiona leads, investors descubiertos via SEC EDGAR, buyers, y comunicaciones automatizadas.' },
      { type: 'heading', text: 'Fuentes de Leads' },
      { type: 'list', items: [
        'SEC EDGAR Form D — Investors y buyers descubiertos automáticamente',
        'Landing page — Visitantes que se registran',
        'Referrals — Members existentes refieren nuevos investors',
        'Outreach AI — Contactos generados por IA autónoma',
      ]},
      { type: 'heading', text: 'Estados de Lead' },
      { type: 'list', items: [
        'discovered → contacted → interested → qualified → converted',
      ]},
    ],
  },
  {
    id: 'doc-003',
    categoryId: 'documentacion-interna',
    title: 'Gestión de Contenido y Reels',
    summary: 'Pipeline de video: upload → transcode → HLS → publicar.',
    tags: ['content', 'reels', 'video'],
    updatedAt: '2026-07-28',
    author: 'IVX Operations',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Pipeline de Video' },
      { type: 'paragraph', text: 'Los reels siguen un pipeline de procesamiento que genera adaptive HLS, posters y thumbnails.' },
      { type: 'list', items: [
        'Upload → S3 (original privado)',
        'Transcode → HLS ladder (1080p/720p/480p/360p)',
        'Poster → Frame al 10% del video',
        'Thumbnail → Frame a 480w',
        'Publish → Disponible en feed de reels',
      ]},
      { type: 'callout', variant: 'warning', text: 'Supabase es el store primario para metadatos de video. S3 es mirror best-effort.' },
    ],
  },

  // ── Proyectos ──
  {
    id: 'proy-001',
    categoryId: 'proyectos',
    title: 'IVX Holdings App',
    summary: 'App móvil principal: inversiones, reels, chat, CRM, portfolio.',
    tags: ['app', 'mobile', 'expo'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'IVX Holdings App' },
      { type: 'paragraph', text: 'La app móvil principal de IVX Holdings, construida con Expo Go y React Native. Incluye 8 pestañas: Home, Invest, Market, Portfolio, Chat, Profile, CRM (owner), Aura (owner).' },
      { type: 'heading', text: 'Módulos Principales' },
      { type: 'list', items: [
        'Home — Feed de reels y oportunidades destacadas',
        'Invest — Catálogo de ofertas de inversión',
        'Market — Mercado secundario de tokens',
        'Portfolio — Portafolio del investor con métricas',
        'Chat — Chat con IA IVX IA y soporte',
        'Profile — Configuración, KYC, wallet, documentos',
        'CRM — Gestión de leads y investors (owner only)',
        'Aura — Dashboard ejecutivo de IA (owner only)',
      ]},
    ],
  },
  {
    id: 'proy-002',
    categoryId: 'proyectos',
    title: 'Backend API Hono',
    summary: 'API REST + WebSocket en Render, con autonomous engines.',
    tags: ['backend', 'api', 'hono'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Backend API' },
      { type: 'paragraph', text: 'El backend corre en Hono sobre Node.js en Render. Expone API REST para todas las operaciones y WebSocket para chat en tiempo real.' },
      { type: 'heading', text: 'Endpoints Clave' },
      { type: 'list', items: [
        '/health — Estado del servicio y SHA',
        '/api/members/register — Registro de miembros',
        '/api/ivx/owner-passwordless-login — Auth de owner',
        '/api/ivx/investors — Lista de investors',
        '/api/ivx/video-platform — Gestión de reels',
        '/api/ivx/autonomous/* — Engines autónomos',
        '/api/ivx/developer-deploy/* — Deploy control',
      ]},
    ],
  },
  {
    id: 'proy-003',
    categoryId: 'proyectos',
    title: 'Landing Page ivxholding.com',
    summary: 'Sitio web público con SEO, reels integrados y captura de leads.',
    tags: ['landing', 'web', 'seo'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 2,
    blocks: [
      { type: 'heading', text: 'Landing Page' },
      { type: 'paragraph', text: 'El sitio público en ivxholding.com sirve como puerta de entrada para investors y buyers. Incluye reels integrados, SEO optimizado y captura de leads.' },
      { type: 'callout', variant: 'success', text: 'Verificado: HTTP 200, 479KB, tiempo de respuesta <0.25s en todos los user agents.' },
    ],
  },

  // ── Propiedades ──
  {
    id: 'prop-001',
    categoryId: 'propiedades',
    title: 'Due Diligence de Propiedades',
    summary: 'Checklist: legal, física, financiera, ambiental.',
    tags: ['duediligence', 'checklist', 'legal'],
    updatedAt: '2026-07-28',
    author: 'IVX Operations',
    readTimeMin: 5,
    blocks: [
      { type: 'heading', text: 'Checklist de Due Diligence' },
      { type: 'heading', text: 'Legal' },
      { type: 'list', items: [
        'Título de propiedad verificado',
        'Gravámenes y embargos',
        'Zonificación y uso de suelo',
        'Permisos municipales al día',
      ]},
      { type: 'heading', text: 'Física' },
      { type: 'list', items: [
        'Inspección estructural',
        'Estado de instalaciones (agua, luz, gas)',
        'Fotos profesionales (mínimo 20)',
        'Video walkthrough',
      ]},
      { type: 'heading', text: 'Financiera' },
      { type: 'list', items: [
        'Avalúo independiente reciente',
        'Historial de ingresos (si aplica)',
        'Proyección de ROI',
        'Análisis comparativo de mercado',
      ]},
      { type: 'callout', variant: 'danger', text: 'Ninguna propiedad se publica sin completar el 100% del checklist de due diligence.' },
    ],
  },
  {
    id: 'prop-002',
    categoryId: 'propiedades',
    title: 'Tokenización de Bienes Raíces',
    summary: 'Fraccionamiento digital, smart contracts, marketplace secundario.',
    tags: ['tokenization', 'blockchain', 'marketplace'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Tokenización' },
      { type: 'paragraph', text: 'La tokenización permite dividir una propiedad en tokens digitales de $100, permitiendo inversión fraccional con liquidez secundaria.' },
      { type: 'heading', text: 'Proceso' },
      { type: 'list', items: [
        '1. Propiedad aprobada y valorada',
        '2. Creación de token offering (POST /api/ivx/tokenization)',
        '3. Emisión de tokens (mínimo $100 c/u)',
        '4. Marketplace secundario para trading',
      ]},
      { type: 'callout', variant: 'info', text: 'Los tokens representan participación económica, no propiedad legal directa. Se rigen por un smart contract.' },
    ],
  },
  {
    id: 'prop-003',
    categoryId: 'propiedades',
    title: 'Gestión de Fotos y Videos',
    summary: 'Estándares de media: resolución, formato, metadata.',
    tags: ['media', 'photos', 'video'],
    updatedAt: '2026-07-28',
    author: 'IVX Operations',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Estándares de Media' },
      { type: 'heading', text: 'Fotos' },
      { type: 'list', items: [
        'Mínimo 1280x960 píxeles',
        'Formato JPG o WebP',
        'Mínimo 20 fotos por propiedad',
        'Incluir exterior, interior, amenities',
      ]},
      { type: 'heading', text: 'Video' },
      { type: 'list', items: [
        'Resolución mínima 720p',
        'Formato MP4 (H.264)',
        'Duración 1-3 minutos',
        'Walkthrough fluido con estabilización',
      ]},
    ],
  },

  // ── Errores Anteriores ──
  {
    id: 'err-001',
    categoryId: 'errores-anteriores',
    title: 'DEF-17-01: Like Engagement Silently Failing',
    summary: 'toggleProjectLike pasaba null userId → like no funcionaba.',
    tags: ['bug', 'engagement', 'likes'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'DEF-17-01: Like Engagement Field' },
      { type: 'paragraph', text: 'Síntoma: Los likes en reels no se registraban. El botón cambiaba visualmente pero el conteo no incrementaba.' },
      { type: 'heading', text: 'Causa Raíz' },
      { type: 'paragraph', text: 'toggleProjectLike(id, null) pasaba null como userId. El backend verificaba if(userId) que evaluaba false para null, por lo que la operación se ignoraba silenciosamente.' },
      { type: 'callout', variant: 'danger', text: 'El problema pasó desapercibido porque el frontend actualizaba el estado optimistamente, pero el backend nunca persistaba el like.' },
      { type: 'heading', text: 'Fix Aplicado' },
      { type: 'paragraph', text: 'Se creó toggleVideoLike(videoId, viewerId) que usa POST /api/projects/:id/like con guest_id en el body. Se actualizaron 4 callers: InvestorFirstFeed (2), CanonicalInvestmentReelCard, DealVideoCard.' },
    ],
  },
  {
    id: 'err-002',
    categoryId: 'errores-anteriores',
    title: 'DEF-16-02: S3 Stale Data Shadowing Supabase',
    summary: 'S3 servía datos stale → Supabase fallback nunca se alcanzaba.',
    tags: ['bug', 's3', 'supabase', 'data'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'DEF-16-02: Supabase como Store Primario' },
      { type: 'paragraph', text: 'Síntoma: Los cambios admin en reels (feature toggle, display order, etc.) se perdían tras reinicio del servicio.' },
      { type: 'heading', text: 'Causa Raíz' },
      { type: 'paragraph', text: 'S3 reads succeed with stale data, so the Supabase fallback was never reached. El código intentaba S3 primero, y como S3 respondía 200 con datos antiguos, Supabase nunca se consultaba.' },
      { type: 'callout', variant: 'danger', text: 'El problema era silencioso: S3 siempre respondía 200, pero con datos desactualizados. No había error que detectar.' },
      { type: 'heading', text: 'Fix Aplicado' },
      { type: 'paragraph', text: 'Se invirtió el orden: Supabase es ahora PRIMARY read/write. S3 es secondary mirror best-effort. Cambios admin sobreviven reinicios.' },
      { type: 'code', language: 'text', code: 'readDoc:  Supabase FIRST → S3 (secondary) → cache\nwriteDoc: Supabase FIRST → S3 (best-effort mirror)' },
    ],
  },
  {
    id: 'err-003',
    categoryId: 'errores-anteriores',
    title: 'DEF-07: Route Shadowing en /api/ivx/payments',
    summary: 'GET /:paymentId registrada antes que /buyer-offers → 404.',
    tags: ['bug', 'routing', 'hono'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'DEF-07: Route Shadowing' },
      { type: 'paragraph', text: 'Síntoma: GET /api/ivx/payments/buyer-offers retornaba 404 en lugar de listar buyer offers.' },
      { type: 'heading', text: 'Causa Raíz' },
      { type: 'paragraph', text: 'La ruta paramétrica GET /api/ivx/payments/:paymentId fue registrada ANTES que las rutas literales GET /buyer-offers y /jv-applications. Hono matcheaba "buyer-offers" como paymentId, que no existía → 404.' },
      { type: 'callout', variant: 'warning', text: 'En Hono/Express, las rutas paramétricas (:param) deben registrarse DESPUÉS de las rutas literales del mismo nivel.' },
      { type: 'heading', text: 'Fix Aplicado' },
      { type: 'paragraph', text: 'Se reordenaron las rutas: primero literales (buyer-offers, jv-applications), después paramétricas (:paymentId).' },
    ],
  },
  {
    id: 'err-004',
    categoryId: 'errores-anteriores',
    title: 'Base64 Files Committed as Text',
    summary: '6 archivos commitados como base64 → TypeScript parse error.',
    tags: ['bug', 'github', 'encoding'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Base64 Text Commit Error' },
      { type: 'paragraph', text: 'Síntoma: Deploy fallaba con "Unexpected end of file" en backend/hono-extended.ts.' },
      { type: 'heading', text: 'Causa Raíz' },
      { type: 'paragraph', text: '6 archivos fueron commitados a GitHub como strings base64 literales (ej: "Lyoq" en lugar de "/**"). GitHub almacenó el texto base64 en lugar del contenido decodificado.' },
      { type: 'callout', variant: 'danger', text: 'El commit API debe recibir content como string UTF-8 raw, NUNCA base64-encoded. El campo contentEncoding NO debe usarse.' },
      { type: 'heading', text: 'Fix Aplicado' },
      { type: 'paragraph', text: 'Los 6 archivos se re-commitaron como UTF-8 raw. Deploy exitoso inmediatamente después.' },
    ],
  },

  // ── Soluciones Aprobadas ──
  {
    id: 'sol-001',
    categoryId: 'soluciones-aprobadas',
    title: 'Patrón: Supabase Primary, S3 Secondary',
    summary: 'Supabase como fuente de verdad, S3 como mirror best-effort.',
    tags: ['pattern', 'supabase', 's3', 'approved'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Patrón Aprobado' },
      { type: 'paragraph', text: 'Para cualquier dato que deba sobrevivir reinicios del servicio, Supabase es el store primario. S3 funciona como mirror secundario best-effort.' },
      { type: 'code', language: 'text', code: 'READ:\n  1. Supabase (PRIMARY) → return if found\n  2. S3 (SECONDARY) → return if found\n  3. Cache → return if found\n  4. Not found\n\nWRITE:\n  1. Supabase (PRIMARY) → await\n  2. S3 (SECONDARY) → try/catch (best-effort)\n  3. Cache → update' },
      { type: 'callout', variant: 'success', text: 'Este patrón garantiza que los cambios admin persistan a través de reinicios y deploys. S3 puede fallar sin afectar la integridad de los datos.' },
    ],
  },
  {
    id: 'sol-002',
    categoryId: 'soluciones-aprobadas',
    title: 'Patrón: Guest ID para Engagement',
    summary: 'Usar guest_id en body para likes, comments, saves sin auth.',
    tags: ['pattern', 'engagement', 'guest', 'approved'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 2,
    blocks: [
      { type: 'heading', text: 'Guest Engagement Pattern' },
      { type: 'paragraph', text: 'Para operaciones de engagement (likes, comments, saves, shares) de usuarios no autenticados, se usa guest_id en el body del request.' },
      { type: 'code', language: 'text', code: 'POST /api/projects/:id/like     { guest_id: "xxx" }\nPOST /api/projects/:id/comments { guest_id: "xxx", body: "text" }\nPOST /api/projects/:id/save     { guest_id: "xxx" }\nPOST /api/projects/:id/share    { guest_id: "xxx" }' },
      { type: 'callout', variant: 'info', text: 'El campo es guest_id (snake_case), no guestId. Los comments usan body, no content ni text.' },
    ],
  },
  {
    id: 'sol-003',
    categoryId: 'soluciones-aprobadas',
    title: 'Patrón: Commit Atómico Auth+Deploy',
    summary: 'Re-autenticar y commitar en un solo script para evitar token expiry.',
    tags: ['pattern', 'auth', 'deploy', 'approved'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 2,
    blocks: [
      { type: 'heading', text: 'Commit Atómico' },
      { type: 'paragraph', text: 'El token de owner expira muy rápido (minutos). Para evitar errores "invalid or expired Supabase session", se debe re-autenticar y commitar en un solo script bun atómico.' },
      { type: 'callout', variant: 'warning', text: 'Nunca separar la autenticación del commit en scripts diferentes. El token expira entre llamadas.' },
    ],
  },

  // ── Procedimientos de QA ──
  {
    id: 'qa-001',
    categoryId: 'procedimientos-qa',
    title: 'Protocolo de Testing: Expo',
    summary: 'bun test, 1011 tests, 0 fail. Cobertura de componentes y lib.',
    tags: ['testing', 'expo', 'bun'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Testing Expo' },
      { type: 'paragraph', text: 'Los tests de Expo corren con bun test desde el directorio expo/.' },
      { type: 'code', language: 'bash', code: 'cd expo && bun test' },
      { type: 'heading', text: 'Cobertura Actual' },
      { type: 'list', items: [
        '1011 tests pass',
        '0 fail',
        '3220 expect() calls',
        '65 archivos de test',
      ]},
      { type: 'callout', variant: 'success', text: 'Todos los tests deben pasar antes de cualquier deploy. 0 fail es obligatorio.' },
    ],
  },
  {
    id: 'qa-002',
    categoryId: 'procedimientos-qa',
    title: 'Protocolo de Testing: Backend',
    summary: '328 tests pass, 0 fail. Incluye chat, intent, services.',
    tags: ['testing', 'backend', 'bun'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 2,
    blocks: [
      { type: 'heading', text: 'Testing Backend' },
      { type: 'paragraph', text: 'Los tests del backend corren con bun test desde el directorio raíz.' },
      { type: 'code', language: 'bash', code: 'bun test backend/' },
      { type: 'heading', text: 'Cobertura Actual' },
      { type: 'list', items: [
        '328 tests pass',
        '29 skip (dependencies faltantes en sandbox)',
        '0 fail',
      ]},
    ],
  },
  {
    id: 'qa-003',
    categoryId: 'procedimientos-qa',
    title: 'Verificación Post-Deploy',
    summary: 'Checklist de endpoints a verificar después de cada deploy.',
    tags: ['deploy', 'verification', 'checklist'],
    updatedAt: '2026-07-28',
    author: 'IVX Senior Developer',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Checklist Post-Deploy' },
      { type: 'paragraph', text: 'Después de cada deploy, verificar los siguientes endpoints:' },
      { type: 'list', items: [
        'GET /health → status, commit SHA, bootTime',
        'GET /api/ivx/executive-layer → executive summary',
        'GET /api/ivx/autonomous/qa → QA scheduler',
        'POST /api/ivx/owner-passwordless-login → owner auth',
        'GET /api/ivx/investors → lista de investors',
        'GET /api/ivx/video-pipeline/videos → reels',
      ]},
      { type: 'callout', variant: 'warning', text: 'Verificar que el commit SHA en /health coincida con el GitHub HEAD. Si no coincide, el deploy no se completó.' },
    ],
  },
  {
    id: 'qa-004',
    categoryId: 'procedimientos-qa',
    title: 'QA de Reels: Lifecycle Completo',
    summary: 'Verificar upload → transcode → publish → engagement.',
    tags: ['qa', 'reels', 'video', 'lifecycle'],
    updatedAt: '2026-07-29',
    author: 'IVX Senior Developer',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'QA de Reels' },
      { type: 'paragraph', text: 'Verificación completa del lifecycle de reels:' },
      { type: 'list', items: [
        '1. Upload: POST /api/ivx/video-pipeline/upload (field: "file")',
        '2. Transcode: HLS ladder 1080p/720p/480p/360p',
        '3. Metadata: feature toggle, display order, property link',
        '4. Engagement: like, comment (body field), save, share',
        '5. Admin: POST /api/ivx/video-platform/admin/videos/:id',
        '6. Persistence: cambios sobreviven reinicio (Supabase)',
      ]},
      { type: 'callout', variant: 'info', text: 'Admin update response está en data.meta.*, no en data directamente. Comment endpoint usa body, no content.' },
    ],
  },

  // ── Políticas de Seguridad ──
  {
    id: 'sec-001',
    categoryId: 'politicas-seguridad',
    title: 'Row Level Security (RLS) en Supabase',
    summary: 'Tablas sensibles solo accesibles via service role, no anon key.',
    tags: ['rls', 'supabase', 'security', 'policy'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 4,
    blocks: [
      { type: 'heading', text: 'Row Level Security' },
      { type: 'paragraph', text: 'Todas las tablas sensibles en Supabase tienen RLS habilitado. La anon key recibe 401 en tablas críticas — esto es comportamiento CORRECTO, no un bug.' },
      { type: 'callout', variant: 'success', text: 'anon key 401 en tablas sensibles = RLS funcionando correctamente. El service role tiene acceso total.' },
      { type: 'heading', text: 'Tablas con RLS' },
      { type: 'list', items: [
        'wallets — solo owner o via auth token',
        'profiles — solo el propio usuario',
        'projects — lectura pública, escritura owner',
        'project_likes — escritura con guest_id',
        'durable_store — solo service role',
      ]},
    ],
  },
  {
    id: 'sec-002',
    categoryId: 'politicas-seguridad',
    title: 'Gestión de Secrets y API Keys',
    summary: 'Keys en Render env vars, nunca en código. Backend usa su propio GITHUB_TOKEN.',
    tags: ['secrets', 'keys', 'env', 'policy'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Gestión de Secrets' },
      { type: 'list', items: [
        'API keys y secrets en Render environment variables',
        'Nunca hardcodear secrets en código fuente',
        'Backend tiene su propio GITHUB_TOKEN (no expuesto al frontend)',
        'AWS credentials en encrypted owner-variables store',
        'Supabase service role key solo en backend (nunca en frontend)',
      ]},
      { type: 'callout', variant: 'danger', text: 'La Supabase service role key NUNCA debe estar en el frontend (EXPO_PUBLIC_*). Solo se usa en el backend.' },
      { type: 'heading', text: 'Variables Públicas vs Privadas' },
      { type: 'list', items: [
        'EXPO_PUBLIC_* — Accesibles en el frontend (anon key, URL)',
        'Sin prefijo — Solo backend (service role, API keys, tokens)',
      ]},
    ],
  },
  {
    id: 'sec-003',
    categoryId: 'politicas-seguridad',
    title: 'Owner Auth y Emergency Login',
    summary: 'Passwordless login con email + emergency recovery code.',
    tags: ['auth', 'owner', 'emergency', 'policy'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Owner Authentication' },
      { type: 'paragraph', text: 'El owner se autentica via POST /api/ivx/owner-passwordless-login con email y emergency recovery code.' },
      { type: 'code', language: 'text', code: 'POST /api/ivx/owner-passwordless-login\nBody: { email, emergency: "ivx_emergency_recovery" }\nResponse: { success: true, accessToken: "..." }' },
      { type: 'callout', variant: 'warning', text: 'El token expira en minutos. Para operaciones largas, re-autenticar frecuentemente o usar commit atómico.' },
      { type: 'callout', variant: 'danger', text: 'El código de emergency recovery NO debe compartirse ni commitarse. Solo el owner lo conoce.' },
    ],
  },
  {
    id: 'sec-004',
    categoryId: 'politicas-seguridad',
    title: 'Rate Limiting y Access Control',
    summary: 'Rate limits por IP, owner guards en endpoints sensibles.',
    tags: ['ratelimit', 'access', 'security', 'policy'],
    updatedAt: '2026-07-28',
    author: 'IVX Owner',
    readTimeMin: 3,
    blocks: [
      { type: 'heading', text: 'Rate Limiting' },
      { type: 'paragraph', text: 'El backend implementa rate limiting por IP en endpoints sensibles para prevenir abuso.' },
      { type: 'heading', text: 'Owner Guards' },
      { type: 'paragraph', text: 'Endpoints sensibles usan assertIVXOwnerOnly() que verifica el bearer token y el rol del usuario.' },
      { type: 'list', items: [
        '/api/ivx/developer-deploy/* — owner only',
        '/api/ivx/admin/* — owner/admin only',
        '/api/ivx/owner-ai/* — owner only',
        '/api/ivx/autonomous/* — owner only',
      ]},
      { type: 'callout', variant: 'info', text: 'Los owner guards verifican el JWT token y comparan el email con el owner email aprobado. Sin token válido, se retorna 401/403.' },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────

export function getCategoryById(id: string): KBCategory | undefined {
  return KB_CATEGORIES.find((c) => c.id === id);
}

export function getArticlesByCategory(categoryId: string): KBArticle[] {
  return KB_ARTICLES.filter((a) => a.categoryId === categoryId);
}

export function getArticleById(id: string): KBArticle | undefined {
  return KB_ARTICLES.find((a) => a.id === id);
}

export function searchArticles(query: string): KBArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return KB_ARTICLES.filter(
    (a) => {
      const cat = getCategoryById(a.categoryId);
      return (
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (cat?.title.toLowerCase().includes(q) ?? false) ||
        (cat?.subtitle.toLowerCase().includes(q) ?? false) ||
        a.blocks.some(
          (b) =>
            (b.type === 'paragraph' && b.text.toLowerCase().includes(q)) ||
            (b.type === 'heading' && b.text.toLowerCase().includes(q)) ||
            (b.type === 'list' && b.items.some((i) => i.toLowerCase().includes(q))) ||
            (b.type === 'code' && b.code.toLowerCase().includes(q)) ||
            (b.type === 'callout' && b.text.toLowerCase().includes(q))
        )
      );
    }
  );
}

export const KB_TOTAL_ARTICLES = KB_ARTICLES.length;
export const KB_TOTAL_CATEGORIES = KB_CATEGORIES.length;
