const login = document.querySelector("#login");
const app = document.querySelector("#app");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const settingsForm = document.querySelector("#settings-form");
const settingsError = document.querySelector("#settings-error");
const pitchesEl = document.querySelector("#pitches");
const articlesEl = document.querySelector("#articles");
const editor = document.querySelector("#editor");
const editorTitle = document.querySelector("#editor-title");
const thumbs = document.querySelector("#thumbs");
const statusEl = document.querySelector("#save-status");
const removeBtn = document.querySelector("#remove");
const logoutBtn = document.querySelector("#logout");
const photoInput = document.querySelector("#photos");

let articles = [];
let photos = [];
let editing = "";

function today() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "La requête a échoué.");
  return data;
}

function showApp(on) {
  login.hidden = on;
  app.hidden = !on;
  logoutBtn.hidden = !on;
}

function fill(article) {
  editing = article ? article.id : "";
  editorTitle.textContent = article ? "Modifier" : "Nouvel article";
  removeBtn.hidden = !article;
  const form = editor;
  form.status.value = article ? article.status : "draft";
  form.featured.checked = Boolean(article && article.featured);
  form.category.value = article ? article.category : "art";
  form.date.value = article ? article.date : today();
  form.author.value = article ? article.author : "";
  form.video.value = article ? article.video : "";
  form["fr-title"].value = article ? article.fr.title : "";
  form["fr-excerpt"].value = article ? article.fr.excerpt : "";
  form["fr-body"].value = article ? article.fr.body : "";
  form["en-title"].value = article ? article.en.title : "";
  form["en-excerpt"].value = article ? article.en.excerpt : "";
  form["en-body"].value = article ? article.en.body : "";
  photos = article ? [...article.photos] : [];
  drawPhotos();
  statusEl.textContent = "";
}

function drawPhotos() {
  thumbs.replaceChildren();
  photos.forEach((url, index) => {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Retirer";
    btn.addEventListener("click", () => {
      photos.splice(index, 1);
      drawPhotos();
    });
    fig.append(img, btn);
    thumbs.appendChild(fig);
  });
}

function drawArticles() {
  articlesEl.replaceChildren();
  if (!articles.length) {
    const li = document.createElement("li");
    li.textContent = "Aucun article.";
    articlesEl.appendChild(li);
    return;
  }
  articles.forEach((article) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const state = article.status === "published" ? "Publié" : "Brouillon";
    text.textContent = `${article.fr.title || "Sans titre"} — ${state}`;
    const actions = document.createElement("span");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Modifier";
    edit.addEventListener("click", () => {
      fill(article);
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    actions.appendChild(edit);
    if (article.status === "published") {
      const view = document.createElement("a");
      view.href = `/journal/${article.slug}`;
      view.textContent = "Voir";
      actions.appendChild(view);
    }
    li.append(text, actions);
    articlesEl.appendChild(li);
  });
}

function drawPitches(list) {
  pitchesEl.replaceChildren();
  if (!list.length) {
    const li = document.createElement("li");
    li.textContent = "Aucune proposition.";
    pitchesEl.appendChild(li);
    return;
  }
  list.forEach((pitch) => {
    const li = document.createElement("li");
    const when = pitch.createdAt ? pitch.createdAt.slice(0, 10) : "";
    const kinds = {
      event: "Événement",
      subject: "Sujet",
      invitation: "Invitation",
      interview: "Entrevue",
      accreditation: "Accréditation",
    };
    li.textContent = `${when} — ${pitch.name} — ${kinds[pitch.kind] || pitch.kind} — ${pitch.message}`;
    pitchesEl.appendChild(li);
  });
}

async function load() {
  const [list, settings, pitchList] = await Promise.all([
    api("/api/articles?all=1"),
    api("/api/settings"),
    api("/api/pitches"),
  ]);
  articles = list.articles || [];
  settingsForm.pressEmail.value = settings.pressEmail || "";
  drawArticles();
  drawPitches(pitchList.pitches || []);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: new FormData(loginForm).get("password") }),
    });
    showApp(true);
    fill(null);
    await load();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  showApp(false);
});

document.querySelector("#fresh").addEventListener("click", () => fill(null));

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsError.textContent = "";
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ pressEmail: settingsForm.pressEmail.value.trim() }),
    });
    settingsError.textContent = "Adresse enregistrée.";
  } catch (error) {
    settingsError.textContent = error.message;
  }
});

photoInput.addEventListener("change", async () => {
  const files = [...photoInput.files];
  photoInput.value = "";
  for (const file of files) {
    statusEl.textContent = "Téléversement…";
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 4096) {
      binary += String.fromCharCode(...buf.subarray(i, i + 4096));
    }
    try {
      const saved = await api("/api/upload", {
        method: "POST",
        body: JSON.stringify({ data: btoa(binary) }),
      });
      photos.push(saved.url);
      drawPhotos();
      statusEl.textContent = "";
    } catch (error) {
      statusEl.textContent = error.message;
      return;
    }
  }
});

editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  const form = editor;
  const payload = {
    status: form.status.value,
    featured: form.featured.checked,
    category: form.category.value,
    date: form.date.value,
    author: form.author.value,
    video: form.video.value,
    photos,
    fr: {
      title: form["fr-title"].value,
      excerpt: form["fr-excerpt"].value,
      body: form["fr-body"].value,
    },
    en: {
      title: form["en-title"].value,
      excerpt: form["en-excerpt"].value,
      body: form["en-body"].value,
    },
  };
  try {
    const saved = editing
      ? await api(`/api/articles/${editing}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api("/api/articles", { method: "POST", body: JSON.stringify(payload) });
    statusEl.textContent = saved.article.status === "published" ? "Publié." : "Brouillon enregistré.";
    await load();
    const next = articles.find((item) => item.id === saved.article.id);
    if (next) fill(next);
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

removeBtn.addEventListener("click", async () => {
  if (!editing || !confirm("Supprimer cet article ?")) return;
  try {
    await api(`/api/articles/${editing}`, { method: "DELETE" });
    fill(null);
    statusEl.textContent = "Article supprimé.";
    await load();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

api("/api/me")
  .then(async () => {
    showApp(true);
    fill(null);
    await load();
  })
  .catch(() => showApp(false));
