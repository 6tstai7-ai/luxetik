const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;

function loadEnv() {
  let text = "";
  try {
    text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const name = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}

loadEnv();

const PORT = Number(process.env.PORT) || 4173;
const ARTICLES = path.join(ROOT, "data", "articles.json");
const SETTINGS = path.join(ROOT, "data", "settings.json");
const PITCHES = path.join(ROOT, "data", "pitches.json");
const ADMIN = path.join(ROOT, "data", "admin.json");
const CATS = new Set(["art", "mode", "business", "people"]);
const KINDS = new Set(["event", "subject", "invitation", "interview", "accreditation"]);
const KIND_LABEL = {
  event: "Événement",
  subject: "Sujet",
  invitation: "Invitation",
  interview: "Entrevue",
  accreditation: "Accréditation",
};
const RESERVED = new Set(["presse", "admin"]);
const sessions = new Set();

const L = {
  fr: {
    skip: "Aller au contenu",
    langLabel: "Langue",
    journal: "Journal",
    press: "Presse",
    contact: "Contact",
    agency: "Agency",
    journalTitle: "Luxétik Journal",
    journalDescription: "Luxétik Journal, la branche éditoriale de Luxétik. Art, culture, mode, design, business et récits.",
    kicker: "Branche éditoriale",
    lead: "Art, culture, mode, design, business et récits.",
    featured: "À la une",
    featuredEmpty: "Rien à la une pour le moment.",
    latest: "Derniers articles",
    latestEmpty: "Les premiers articles arrivent.",
    all: "Tout",
    filters: "Catégories",
    emptyCat: "Aucun article dans cette catégorie.",
    pressTitle: "Presse — Luxétik Journal",
    pressDescription: "Invitations, entrevues et accréditations pour Luxétik Journal, la branche éditoriale de Luxétik.",
    pressLead: "Luxétik Journal est la branche éditoriale de Luxétik. Luxétik Agency reste la branche commerciale.",
    pressMail: "Invitations, entrevues, accréditations",
    pressNoMail: "Écrivez par le formulaire.",
    pitchTitle: "Proposer un événement ou un sujet",
    name: "Nom",
    email: "Courriel",
    kind: "Type",
    message: "Message",
    send: "Envoyer",
    sent: "Proposition reçue.",
    sentLead: "Elle est enregistrée. Luxétik la lit.",
    err: "Complétez le nom, un courriel valide et le message.",
    kindEvent: "Événement",
    kindSubject: "Sujet",
    kindInvite: "Invitation",
    kindInterview: "Entrevue",
    kindPress: "Accréditation",
    video: "Voir la vidéo",
    notFoundTitle: "Introuvable",
    notFound: "Cet article n’est pas publié.",
    catArt: "Art & Culture",
    catMode: "Mode & Design",
    catBusiness: "Business & Influence",
    catPeople: "People & Stories",
  },
  en: {
    skip: "Skip to content",
    langLabel: "Language",
    journal: "Journal",
    press: "Press",
    contact: "Contact",
    agency: "Agency",
    journalTitle: "Luxétik Journal",
    journalDescription: "Luxétik Journal, the editorial side of Luxétik. Art, culture, fashion, design, business, and stories.",
    kicker: "Editorial",
    lead: "Art, culture, fashion, design, business, and stories.",
    featured: "Featured",
    featuredEmpty: "Nothing featured yet.",
    latest: "Latest",
    latestEmpty: "The first articles are on their way.",
    all: "All",
    filters: "Categories",
    emptyCat: "No articles in this category.",
    pressTitle: "Press — Luxétik Journal",
    pressDescription: "Invitations, interviews, and accreditation for Luxétik Journal, the editorial side of Luxétik.",
    pressLead: "Luxétik Journal is the editorial side of Luxétik. Luxétik Agency remains the commercial side.",
    pressMail: "Invitations, interviews, accreditation",
    pressNoMail: "Write through the form.",
    pitchTitle: "Propose an event or a subject",
    name: "Name",
    email: "Email",
    kind: "Type",
    message: "Message",
    send: "Send",
    sent: "Proposal received.",
    sentLead: "It is saved. Luxétik reads it.",
    err: "Add a name, a valid email, and a message.",
    kindEvent: "Event",
    kindSubject: "Subject",
    kindInvite: "Invitation",
    kindInterview: "Interview",
    kindPress: "Accreditation",
    video: "Watch the video",
    notFoundTitle: "Not found",
    notFound: "This article is not published.",
    catArt: "Art & Culture",
    catMode: "Mode & Design",
    catBusiness: "Business & Influence",
    catPeople: "People & Stories",
  },
};

const CAT_KEY = { art: "catArt", mode: "catMode", business: "catBusiness", people: "catPeople" };
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function originOf(req) {
  const host = String(req.headers.host || "localhost").replace(/[^a-zA-Z0-9.:\-[\]]/g, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${host || "localhost"}`;
}

function langOf(url) {
  return url.searchParams.get("lang") === "en" ? "en" : "fr";
}

function href(pathname, lang, query) {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
  }
  if (lang === "en") params.set("lang", "en");
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

function catName(lang, id) {
  return L[lang][CAT_KEY[id]] || L[lang].catArt;
}

function formatDate(iso, lang) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(lang === "en" ? "en-CA" : "fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function pick(article, lang) {
  const primary = article[lang] || {};
  const fr = article.fr || {};
  const choose = (key) => String(primary[key] || "").trim() || String(fr[key] || "").trim();
  return { title: choose("title"), excerpt: choose("excerpt"), body: choose("body") };
}

function excerptOf(article, lang) {
  const text = pick(article, lang);
  if (text.excerpt) return text.excerpt;
  const flat = text.body.replace(/\s+/g, " ").trim();
  if (flat.length <= 180) return flat;
  return `${flat.slice(0, 177).trimEnd()}…`;
}

function byDate(a, b) {
  if (a.date === b.date) return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  return a.date < b.date ? 1 : -1;
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function photoUrl(src) {
  return /^\/assets\/journal\/[A-Za-z0-9._-]+$/.test(src || "") ? src : "";
}

function safeYouTube(id) {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
}

function embedSrc(url) {
  let parsed;
  try { parsed = new URL(url); } catch (error) { return ""; }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return safeYouTube(parsed.pathname.split("/").filter(Boolean)[0]);
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname.startsWith("/embed/")) return safeYouTube(parsed.pathname.split("/")[2]);
    if (parsed.pathname.startsWith("/shorts/")) return safeYouTube(parsed.pathname.split("/")[2]);
    return safeYouTube(parsed.searchParams.get("v") || "");
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return /^[0-9]+$/.test(id) ? `https://player.vimeo.com/video/${id}` : "";
  }
  return "";
}

function embedHtml(url, title, label) {
  const src = embedSrc(url);
  if (src) {
    return `<figure class="video"><iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></figure>`;
  }
  if (!url) return "";
  return `<p><a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`;
}

function photosHtml(article, title) {
  const urls = (article.photos || []).map(photoUrl).filter(Boolean);
  if (!urls.length) return "";
  return `<div class="photos">${urls.map((url, index) => `<img src="${escapeHtml(url)}" alt="${index === 0 ? escapeHtml(title) : ""}">`).join("")}</div>`;
}

function header(lang) {
  const t = L[lang];
  const en = lang === "en";
  return `<a class="skip" href="#contenu">${escapeHtml(t.skip)}</a>
<header class="top">
  <a class="brand" href="${href("/", lang)}">Luxétik</a>
  <p class="top-links">
    <span class="lang" role="group" aria-label="${escapeHtml(t.langLabel)}">
      <button type="button" data-set-lang="fr" aria-pressed="${en ? "false" : "true"}">FR</button>
      <span aria-hidden="true">|</span>
      <button type="button" data-set-lang="en" aria-pressed="${en ? "true" : "false"}">EN</button>
    </span>
    <span aria-hidden="true">|</span>
    <a href="${href("/journal", lang)}">${escapeHtml(t.journal)}</a>
    <span aria-hidden="true">|</span>
    <a href="${href("/journal/presse", lang)}">${escapeHtml(t.press)}</a>
    <span aria-hidden="true">|</span>
    <a href="${href("/", lang)}#ecrire">${escapeHtml(t.contact)}</a>
  </p>
</header>`;
}

function page(req, opts) {
  const origin = originOf(req);
  const image = opts.image || `${origin}/assets/favicon.png`;
  const json = opts.jsonld ? `<script type="application/ld+json">${opts.jsonld.replace(/</g, "\\u003c")}</script>` : "";
  return `<!DOCTYPE html>
<html lang="${opts.lang === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<meta name="robots" content="${opts.robots || "index,follow"}">
<link rel="canonical" href="${escapeHtml(opts.canonical)}">
<link rel="alternate" hreflang="fr" href="${escapeHtml(opts.fr)}">
<link rel="alternate" hreflang="en" href="${escapeHtml(opts.en)}">
<link rel="alternate" hreflang="x-default" href="${escapeHtml(opts.canonical)}">
<meta property="og:site_name" content="Luxétik">
<meta property="og:type" content="${opts.type || "website"}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:url" content="${escapeHtml(opts.url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:locale" content="${opts.lang === "en" ? "en_CA" : "fr_CA"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(opts.title)}">
<meta name="twitter:description" content="${escapeHtml(opts.description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" href="/assets/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css?v=26">
<link rel="stylesheet" href="/css/journal.css?v=1">
</head>
<body class="journal">
${header(opts.lang)}
<main id="contenu" class="sheet">
${opts.body}
</main>
<script>
document.querySelectorAll("[data-set-lang]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = new URL(location.href);
    next.searchParams.set("lang", button.dataset.setLang);
    location.assign(next.pathname + next.search + next.hash);
  });
});
</script>
${json}
</body>
</html>`;
}

function filtersHtml(lang, cat) {
  const t = L[lang];
  const items = [["", t.all], ["art", t.catArt], ["mode", t.catMode], ["business", t.catBusiness], ["people", t.catPeople]];
  return `<nav class="filters" aria-label="${escapeHtml(t.filters)}">${items.map(([id, label]) => {
    const current = (cat || "") === id;
    return `<a href="${href("/journal", lang, id ? { cat: id } : null)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`;
  }).join("")}</nav>`;
}

function featureHtml(article, lang) {
  const text = pick(article, lang);
  const photo = photoUrl((article.photos || [])[0]);
  const img = photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(text.title)}">` : "";
  const meta = `${formatDate(article.date, lang)}${article.author ? ` — ${article.author}` : ""}`;
  return `<a class="feature" href="${href(`/journal/${article.slug}`, lang)}">${img}<div><p class="kicker">${escapeHtml(catName(lang, article.category))}</p><h2>${escapeHtml(text.title)}</h2><p class="meta">${escapeHtml(meta)}</p><p class="excerpt">${escapeHtml(excerptOf(article, lang))}</p></div></a>`;
}

function entryHtml(article, lang) {
  const text = pick(article, lang);
  const meta = `${formatDate(article.date, lang)}${article.author ? ` — ${article.author}` : ""}`;
  const excerpt = excerptOf(article, lang);
  return `<article class="entry"><p class="kicker">${escapeHtml(catName(lang, article.category))}</p><h2><a href="${href(`/journal/${article.slug}`, lang)}">${escapeHtml(text.title)}</a></h2><p class="meta">${escapeHtml(meta)}</p>${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ""}</article>`;
}

function journalDocument(req, lang, articles, cat) {
  const t = L[lang];
  const origin = originOf(req);
  const published = articles.filter((item) => item.status === "published").sort(byDate);
  const pool = cat ? published.filter((item) => item.category === cat) : published;
  const featured = pool.filter((item) => item.featured);
  const rest = pool.filter((item) => !item.featured);
  const featuredBlock = featured.length
    ? `<h2 class="block-title">${escapeHtml(t.featured)}</h2>${featured.map((item) => featureHtml(item, lang)).join("")}`
    : (cat ? "" : `<h2 class="block-title">${escapeHtml(t.featured)}</h2><p class="quiet">${escapeHtml(t.featuredEmpty)}</p>`);
  const listBlock = rest.length
    ? `<h2 class="block-title">${escapeHtml(t.latest)}</h2>${rest.map((item) => entryHtml(item, lang)).join("")}`
    : (pool.length ? "" : `<h2 class="block-title">${escapeHtml(t.latest)}</h2><p class="quiet">${escapeHtml(cat ? t.emptyCat : t.latestEmpty)}</p>`);
  const body = `<p class="crumbs"><a href="${href("/", lang)}">${escapeHtml(t.agency)}</a> / <span aria-current="page">${escapeHtml(t.journal)}</span></p>
<p class="kicker">${escapeHtml(t.kicker)}</p>
<h1>${escapeHtml(t.journal)}</h1>
<p class="lead">${escapeHtml(t.lead)}</p>
${filtersHtml(lang, cat)}
${featuredBlock}
${listBlock}`;
  const photo = photoUrl((featured[0] && featured[0].photos && featured[0].photos[0]) || "");
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: pool.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${origin}/journal/${item.slug}`,
      name: pick(item, lang).title,
    })),
  };
  return page(req, {
    lang,
    title: t.journalTitle,
    description: t.journalDescription,
    canonical: `${origin}/journal`,
    url: `${origin}${href("/journal", lang, cat ? { cat } : null)}`,
    fr: `${origin}${href("/journal", "fr", cat ? { cat } : null)}`,
    en: `${origin}${href("/journal", "en", cat ? { cat } : null)}`,
    image: photo ? origin + photo : "",
    jsonld: JSON.stringify(list),
    body,
  });
}

function articleDocument(req, lang, article) {
  const t = L[lang];
  const origin = originOf(req);
  const text = pick(article, lang);
  const canonical = `${origin}/journal/${article.slug}`;
  const photo = photoUrl((article.photos || [])[0]);
  const description = excerptOf(article, lang) || t.journalDescription;
  const body = `<p class="crumbs"><a href="${href("/", lang)}">${escapeHtml(t.agency)}</a> / <a href="${href("/journal", lang)}">${escapeHtml(t.journal)}</a> / <span aria-current="page">${escapeHtml(text.title)}</span></p>
<article class="article">
  <p class="kicker">${escapeHtml(catName(lang, article.category))}</p>
  <h1>${escapeHtml(text.title)}</h1>
  <p class="meta"><time datetime="${escapeHtml(article.date)}">${escapeHtml(formatDate(article.date, lang))}</time>${article.author ? ` — ${escapeHtml(article.author)}` : ""}</p>
  ${photosHtml(article, text.title)}
  ${embedHtml(article.video, text.title, t.video)}
  <div class="body">${paragraphs(text.body)}</div>
</article>`;
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: text.title,
    datePublished: article.date,
    inLanguage: lang === "en" ? "en-CA" : "fr-CA",
    author: { "@type": "Person", name: article.author || "Luxétik" },
    publisher: { "@type": "Organization", name: "Luxétik" },
    mainEntityOfPage: canonical,
    description,
  };
  if (photo) data.image = origin + photo;
  return page(req, {
    lang,
    type: "article",
    title: `${text.title} — Luxétik Journal`,
    description,
    canonical,
    url: lang === "en" ? `${canonical}?lang=en` : canonical,
    fr: `${canonical}?lang=fr`,
    en: `${canonical}?lang=en`,
    image: photo ? origin + photo : "",
    jsonld: JSON.stringify(data),
    body,
  });
}

function missingDocument(req, lang) {
  const t = L[lang];
  const origin = originOf(req);
  const body = `<p class="crumbs"><a href="${href("/journal", lang)}">${escapeHtml(t.journal)}</a></p>
<h1>${escapeHtml(t.notFoundTitle)}</h1>
<p>${escapeHtml(t.notFound)}</p>`;
  return page(req, {
    lang,
    title: `${t.notFoundTitle} — Luxétik Journal`,
    description: t.notFound,
    canonical: `${origin}/journal`,
    url: `${origin}/journal`,
    fr: `${origin}/journal`,
    en: `${origin}/journal?lang=en`,
    robots: "noindex",
    body,
  });
}

function presseDocument(req, lang, state) {
  const t = L[lang];
  const origin = originOf(req);
  const mail = state.email
    ? `<p class="press-mail">${escapeHtml(t.pressMail)}<br><a href="mailto:${escapeHtml(state.email)}">${escapeHtml(state.email)}</a></p>`
    : `<p class="press-mail">${escapeHtml(t.pressMail)}<br>${escapeHtml(t.pressNoMail)}</p>`;
  const form = state.sent
    ? `<h2>${escapeHtml(t.sent)}</h2><p>${escapeHtml(t.sentLead)}</p>`
    : `<form method="post" action="/api/presse">
        <h2>${escapeHtml(t.pitchTitle)}</h2>
        ${state.error ? `<p class="form-error" role="alert">${escapeHtml(t.err)}</p>` : ""}
        <input class="sr" tabindex="-1" autocomplete="off" name="website" value="">
        <input type="hidden" name="lang" value="${lang}">
        <label>${escapeHtml(t.name)} <input name="name" required maxlength="120" autocomplete="name"></label>
        <label>${escapeHtml(t.email)} <input name="email" type="email" required maxlength="160" autocomplete="email"></label>
        <label>${escapeHtml(t.kind)}
          <select name="kind">
            <option value="event">${escapeHtml(t.kindEvent)}</option>
            <option value="subject">${escapeHtml(t.kindSubject)}</option>
            <option value="invitation">${escapeHtml(t.kindInvite)}</option>
            <option value="interview">${escapeHtml(t.kindInterview)}</option>
            <option value="accreditation">${escapeHtml(t.kindPress)}</option>
          </select>
        </label>
        <label>${escapeHtml(t.message)} <textarea name="message" rows="5" required maxlength="4000"></textarea></label>
        <button class="btn btn-ink" type="submit">${escapeHtml(t.send)}</button>
      </form>`;
  const body = `<p class="crumbs"><a href="${href("/", lang)}">${escapeHtml(t.agency)}</a> / <a href="${href("/journal", lang)}">${escapeHtml(t.journal)}</a> / <span aria-current="page">${escapeHtml(t.press)}</span></p>
<p class="kicker">${escapeHtml(t.journal)}</p>
<h1>${escapeHtml(t.press)}</h1>
<p class="lead">${escapeHtml(t.pressLead)}</p>
${mail}
${form}`;
  return page(req, {
    lang,
    title: t.pressTitle,
    description: t.pressDescription,
    canonical: `${origin}/journal/presse`,
    url: `${origin}${href("/journal/presse", lang)}`,
    fr: `${origin}/journal/presse`,
    en: `${origin}/journal/presse?lang=en`,
    robots: state.sent ? "noindex" : "index,follow",
    body,
  });
}

async function sendMail({ to, subject, text, replyTo, label }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.PRESS_FROM || "Luxétik Journal <onboarding@resend.dev>";
  const payload = { from, to: [to], subject, text };
  if (replyTo) payload.reply_to = replyTo;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(label, res.status, detail.slice(0, 240));
      return false;
    }
    return true;
  } catch (error) {
    console.error(label, error.message);
    return false;
  }
}

async function mailPitch({ to, name, email, kind, message }) {
  return sendMail({
    to,
    replyTo: email,
    subject: `Luxétik Journal — ${KIND_LABEL[kind] || kind} — ${name}`,
    text: `${name} <${email}>\n\n${message}`,
    label: "Envoi presse:",
  });
}

async function mailReceipt({ to, name, lang, replyTo }) {
  const en = lang === "en";
  return sendMail({
    to,
    replyTo,
    subject: en ? "Luxétik Journal — proposal received" : "Luxétik Journal — proposition reçue",
    text: en
      ? `Hello ${name},\n\nLuxétik has received your message. It is saved.\n\nLuxétik Journal`
      : `Bonjour ${name},\n\nLuxétik a bien reçu votre message. Il est enregistré.\n\nLuxétik Journal`,
    label: "Accusé presse:",
  });
}

function sendHtml(res, code, html) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function isAdmin(req) {
  const token = cookies(req).luxetik_admin;
  return Boolean(token && sessions.has(token));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too-big"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readInput(req, limit) {
  const buf = await readBody(req, limit);
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    try { return JSON.parse(buf.toString("utf8") || "{}"); }
    catch (error) { throw new Error("json"); }
  }
  return Object.fromEntries(new URLSearchParams(buf.toString("utf8")));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.promises.rename(tmp, file);
}

function sameSecret(input, saved) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(String(saved));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "article";
}

function uniqueSlug(base, articles) {
  let slug = RESERVED.has(base) ? `${base}-article` : base;
  const taken = new Set(articles.map((item) => item.slug));
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanEmail(value) {
  const email = cleanText(value, 160);
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Courriel invalide.");
    error.status = 400;
    throw error;
  }
  return email;
}

function cleanVideo(value) {
  const video = cleanText(value, 500);
  if (!video) return "";
  let parsed;
  try { parsed = new URL(video); } catch (error) { return ""; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  return parsed.toString();
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function buildArticle(input, articles, prev) {
  const fr = {
    title: cleanText(input.fr && input.fr.title, 180),
    excerpt: cleanText(input.fr && input.fr.excerpt, 400),
    body: cleanText(input.fr && input.fr.body, 20000),
  };
  const en = {
    title: cleanText(input.en && input.en.title, 180),
    excerpt: cleanText(input.en && input.en.excerpt, 400),
    body: cleanText(input.en && input.en.body, 20000),
  };
  if (!fr.title) {
    const error = new Error("Le titre français est requis.");
    error.status = 400;
    throw error;
  }
  const status = input.status === "published" ? "published" : "draft";
  const author = cleanText(input.author, 120);
  if (status === "published" && !author) {
    const error = new Error("L'auteur est requis pour publier.");
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  return {
    id: prev ? prev.id : crypto.randomUUID(),
    slug: prev ? prev.slug : uniqueSlug(slugify(fr.title), articles),
    status,
    featured: input.featured === true || input.featured === "true",
    category: CATS.has(input.category) ? input.category : "art",
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") ? input.date : today(),
    author,
    video: cleanVideo(input.video),
    photos: Array.isArray(input.photos) ? input.photos.map(photoUrl).filter(Boolean).slice(0, 12) : [],
    fr,
    en,
    createdAt: prev ? prev.createdAt || now : now,
    updatedAt: now,
  };
}

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 6) {
    const gif = buf.subarray(0, 6).toString("ascii");
    if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

function resolveStatic(pathname) {
  let rel = pathname;
  if (rel.includes("\0")) return null;
  if (rel === "/") rel = "/index.html";
  const full = path.resolve(ROOT, `.${rel}`);
  const root = path.resolve(ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  const relPosix = path.relative(root, full).split(path.sep).join("/");
  if (!relPosix || relPosix.startsWith("..") || relPosix === "server.js" || relPosix.startsWith("data/") || relPosix.startsWith(".git")) return null;
  return full;
}

function serveFile(req, res, full) {
  fs.promises.stat(full).then((stat) => {
    if (!stat.isFile()) {
      sendHtml(res, 404, "Introuvable");
      return;
    }
    const type = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": type.startsWith("text/html") ? "no-store" : "public, max-age=3600",
    });
    fs.createReadStream(full).pipe(res);
  }).catch(() => sendHtml(res, 404, "Introuvable"));
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    redirect(res, pathname.slice(0, -1) + url.search);
    return;
  }

  if (pathname === "/api/crop" && req.method === "POST") {
    const remote = req.socket.remoteAddress || "";
    const local = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!local) {
      sendJson(res, 403, { error: "Cadrage local seulement." });
      return;
    }
    const body = await readInput(req, 2000);
    const x = Math.round(Number(body.x));
    const y = Math.round(Number(body.y));
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
      sendJson(res, 400, { error: "Cadrage invalide." });
      return;
    }
    const file = path.join(ROOT, "css", "site.css");
    const css = await fs.promises.readFile(file, "utf8");
    const next = css.replace(
      /\.photo-track img\.is-head \{ object-position: [^;]+; cursor: grab; touch-action: none; \}/,
      `.photo-track img.is-head { object-position: ${x}% ${y}%; cursor: grab; touch-action: none; }`
    );
    if (next === css) {
      sendJson(res, 500, { error: "Règle de cadrage introuvable." });
      return;
    }
    await fs.promises.writeFile(file, next);
    sendJson(res, 200, { x, y });
    return;
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await readInput(req, 20_000);
    const admin = await readJson(ADMIN, { password: "" });
    if (!sameSecret(body.password, admin.password)) {
      sendJson(res, 401, { error: "Mot de passe incorrect." });
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    res.setHeader("Set-Cookie", `luxetik_admin=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const token = cookies(req).luxetik_admin;
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "luxetik_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/me" && req.method === "GET") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/settings" && req.method === "GET") {
    const settings = await readJson(SETTINGS, { pressEmail: "" });
    sendJson(res, 200, { pressEmail: settings.pressEmail || "" });
    return;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    const body = await readInput(req, 20_000);
    const pressEmail = cleanEmail(body.pressEmail);
    await locked(() => writeJson(SETTINGS, { pressEmail }));
    sendJson(res, 200, { pressEmail });
    return;
  }

  if (pathname === "/api/pitches" && req.method === "GET") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    const pitches = await readJson(PITCHES, []);
    sendJson(res, 200, { pitches: Array.isArray(pitches) ? pitches : [] });
    return;
  }

  if (pathname === "/api/presse" && req.method === "POST") {
    const body = await readInput(req, 80_000);
    const lang = body.lang === "en" ? "en" : "fr";
    const back = (flag) => href("/journal/presse", lang, { [flag]: "1" });
    if (String(body.website || "").trim()) {
      redirect(res, back("sent"));
      return;
    }
    let email = "";
    try { email = cleanEmail(body.email); } catch (error) { email = ""; }
    const name = cleanText(body.name, 120);
    const message = cleanText(body.message, 4000);
    const kind = KINDS.has(body.kind) ? body.kind : "";
    if (!name || !email || !message || !kind) {
      redirect(res, back("error"));
      return;
    }
    await locked(async () => {
      const current = await readJson(PITCHES, []);
      const list = Array.isArray(current) ? current : [];
      list.unshift({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        name,
        email,
        kind,
        message,
      });
      await writeJson(PITCHES, list.slice(0, 200));
    });
    const settings = await readJson(SETTINGS, { pressEmail: "" });
    await mailPitch({
      to: settings.pressEmail || "",
      name,
      email,
      kind,
      message,
    });
    await mailReceipt({ to: email, name, lang, replyTo: settings.pressEmail || "" });
    redirect(res, back("sent"));
    return;
  }

  if (pathname === "/api/upload" && req.method === "POST") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    const body = await readInput(req, 12_000_000);
    const buf = Buffer.from(String(body.data || ""), "base64");
    if (!buf.length || buf.length > 8_000_000) {
      sendJson(res, 413, { error: "Photo trop lourde (8 Mo max)." });
      return;
    }
    const ext = sniff(buf);
    if (!ext) {
      sendJson(res, 400, { error: "Format accepté : JPG, PNG, WEBP ou GIF." });
      return;
    }
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
    await fs.promises.mkdir(path.join(ROOT, "assets", "journal"), { recursive: true });
    await fs.promises.writeFile(path.join(ROOT, "assets", "journal", name), buf);
    sendJson(res, 200, { url: `/assets/journal/${name}` });
    return;
  }

  if (pathname === "/api/articles" && req.method === "GET") {
    const data = await readJson(ARTICLES, { articles: [] });
    const articles = Array.isArray(data.articles) ? [...data.articles].sort(byDate) : [];
    if (url.searchParams.get("all") === "1") {
      if (!isAdmin(req)) {
        sendJson(res, 401, { error: "Connexion requise." });
        return;
      }
      sendJson(res, 200, { articles });
      return;
    }
    sendJson(res, 200, { articles: articles.filter((item) => item.status === "published") });
    return;
  }

  if (pathname === "/api/articles" && req.method === "POST") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    const body = await readInput(req, 200_000);
    const article = await locked(async () => {
      const data = await readJson(ARTICLES, { articles: [] });
      if (!Array.isArray(data.articles)) data.articles = [];
      const created = buildArticle(body, data.articles, null);
      data.articles.push(created);
      await writeJson(ARTICLES, data);
      return created;
    });
    sendJson(res, 201, { article });
    return;
  }

  const articleRoute = pathname.match(/^\/api\/articles\/([0-9a-f-]{36})$/i);
  if (articleRoute && (req.method === "PUT" || req.method === "DELETE")) {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "Connexion requise." });
      return;
    }
    const id = articleRoute[1];
    if (req.method === "DELETE") {
      const removed = await locked(async () => {
        const data = await readJson(ARTICLES, { articles: [] });
        const index = data.articles.findIndex((item) => item.id === id);
        if (index === -1) return false;
        data.articles.splice(index, 1);
        await writeJson(ARTICLES, data);
        return true;
      });
      if (!removed) {
        sendJson(res, 404, { error: "Article introuvable." });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    const body = await readInput(req, 200_000);
    const article = await locked(async () => {
      const data = await readJson(ARTICLES, { articles: [] });
      const index = data.articles.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const next = buildArticle(body, data.articles.filter((item) => item.id !== id), data.articles[index]);
      data.articles[index] = next;
      await writeJson(ARTICLES, data);
      return next;
    });
    if (!article) {
      sendJson(res, 404, { error: "Article introuvable." });
      return;
    }
    sendJson(res, 200, { article });
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Introuvable." });
    return;
  }

  if (pathname === "/robots.txt" && req.method === "GET") {
    const body = `User-agent: *\nAllow: /\nSitemap: ${originOf(req)}/sitemap.xml\n`;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
    return;
  }

  if (pathname === "/sitemap.xml" && req.method === "GET") {
    const origin = originOf(req);
    const data = await readJson(ARTICLES, { articles: [] });
    const urls = ["/", "/journal", "/journal/presse"];
    for (const article of data.articles || []) {
      if (article.status === "published") urls.push(`/journal/${article.slug}`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${origin}${item}</loc></url>`).join("\n")}\n</urlset>\n`;
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" });
    res.end(xml);
    return;
  }

  if ((pathname === "/journal" || pathname === "/journal/presse") && req.method === "GET") {
    const lang = langOf(url);
    const cat = CATS.has(url.searchParams.get("cat")) ? url.searchParams.get("cat") : "";
    if (pathname === "/journal/presse") {
      const settings = await readJson(SETTINGS, { pressEmail: "" });
      sendHtml(res, 200, presseDocument(req, lang, {
        email: settings.pressEmail || "",
        sent: url.searchParams.get("sent") === "1",
        error: url.searchParams.get("error") === "1",
      }));
      return;
    }
    const data = await readJson(ARTICLES, { articles: [] });
    sendHtml(res, 200, journalDocument(req, lang, data.articles || [], cat));
    return;
  }

  const story = pathname.match(/^\/journal\/([a-z0-9-]+)$/);
  if (story && req.method === "GET") {
    const lang = langOf(url);
    const data = await readJson(ARTICLES, { articles: [] });
    const article = (data.articles || []).find((item) => item.slug === story[1] && item.status === "published");
    if (!article) {
      sendHtml(res, 404, missingDocument(req, lang));
      return;
    }
    sendHtml(res, 200, articleDocument(req, lang, article));
    return;
  }

  if (pathname === "/admin" && req.method === "GET") {
    serveFile(req, res, path.join(ROOT, "admin.html"));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Méthode refusée." });
    return;
  }

  const file = resolveStatic(pathname);
  if (!file) {
    sendHtml(res, 404, "Introuvable");
    return;
  }
  serveFile(req, res, file);
}

async function main() {
  await fs.promises.mkdir(path.join(ROOT, "data"), { recursive: true });
  await fs.promises.mkdir(path.join(ROOT, "assets", "journal"), { recursive: true });
  let created = false;
  try {
    await fs.promises.access(ADMIN);
  } catch (error) {
    await writeJson(ADMIN, { password: "luxetik" });
    created = true;
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return;
      if (error.message === "json") {
        sendJson(res, 400, { error: "Format invalide." });
        return;
      }
      if (error.message === "too-big") {
        sendJson(res, 413, { error: "Fichier trop lourd." });
        return;
      }
      if (error.status === 400) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: "Erreur interne." });
    });
  });
  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE" ? `Le port ${PORT} est déjà pris.` : error);
    process.exit(1);
  });
  const host = process.env.HOST || "0.0.0.0";
  server.listen(PORT, host, () => {
    console.log(`Luxétik local : http://127.0.0.1:${PORT}`);
    console.log(`Journal : http://127.0.0.1:${PORT}/journal`);
    console.log(`Admin : http://127.0.0.1:${PORT}/admin`);
    if (created) console.log("Mot de passe admin : luxetik");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
