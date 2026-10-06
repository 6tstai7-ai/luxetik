const form = document.querySelector("#qualification");
const shell = document.querySelector("#form-shell");
const steps = [...form.querySelectorAll(".step")];
const error = document.querySelector("#form-error");
const back = document.querySelector("#back");
const next = document.querySelector("#next");
const progress = document.querySelector("#progress");
const meterBar = document.querySelector("#meter-bar");
const result = document.querySelector("#result");
const revise = document.querySelector("#revise");
const ease = "cubic-bezier(0.23, 1, 0.32, 1)";

let index = 0;

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function show(nextIndex, focusField = true) {
  index = nextIndex;
  steps.forEach((step, i) => {
    const active = i === index;
    step.classList.toggle("is-active", active);
    step.hidden = !active;
  });
  back.hidden = index === 0;
  next.textContent = index === steps.length - 1 ? "Envoyer la demande" : "Continuer";
  progress.textContent = `${index + 1} / ${steps.length}`;
  if (meterBar) meterBar.style.width = `${((index + 1) / steps.length) * 100}%`;
  error.textContent = "";
  const field = steps[index].querySelector("input, textarea");
  if (focusField && field) field.focus({ preventScroll: true });
}

function messageFor(step) {
  const names = new Set();
  for (const field of step.querySelectorAll("input, textarea")) {
    if (field.type === "radio") {
      if (names.has(field.name)) continue;
      names.add(field.name);
      const picked = step.querySelector(`input[name="${CSS.escape(field.name)}"]:checked`);
      if (!picked) return "Choisissez une réponse.";
      if (picked.value === "autre") {
        const extra = step.querySelector(`[name="${CSS.escape(field.name)}-preciser"]`);
        if (extra && !extra.value.trim()) return "Précisez votre réponse.";
      }
      continue;
    }
    if (field.dataset.optional === "true") continue;
    if (field.closest("[hidden]")) continue;
    if (!field.value.trim()) return "Complétez ce champ pour continuer.";
  }
  return "";
}

function run(update) {
  if (reduced()) {
    update();
    return;
  }
  shell.style.transition = `opacity 180ms ${ease}, transform 180ms ${ease}`;
  shell.style.opacity = "0";
  shell.style.transform = "translateY(8px)";
  window.setTimeout(() => {
    update();
    shell.style.transform = "translateY(0)";
    shell.style.opacity = "1";
  }, 160);
}

form.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;
  const extra = input.closest(".step")?.querySelector(".preciser");
  if (!extra) return;
  const open = input.value === "autre" && input.checked;
  extra.hidden = !open;
  if (open) extra.querySelector("input")?.focus({ preventScroll: true });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const problem = messageFor(steps[index]);
  if (problem) {
    error.textContent = problem;
    return;
  }
  if (index < steps.length - 1) {
    run(() => show(index + 1));
    return;
  }
  run(() => {
    form.hidden = true;
    result.hidden = false;
    result.querySelector("h3")?.focus({ preventScroll: true });
  });
});

back.addEventListener("click", () => {
  if (index === 0) return;
  run(() => show(index - 1));
});

revise.addEventListener("click", () => {
  result.hidden = true;
  form.hidden = false;
  show(0);
  document.querySelector("#demande")?.scrollIntoView({ block: "start" });
});

show(0, false);
