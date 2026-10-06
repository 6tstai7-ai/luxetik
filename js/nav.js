const track = document.querySelector("#track");
const slides = [...document.querySelectorAll(".slide")];
const prev = document.querySelector("#prev");
const next = document.querySelector("#next-col");
const hint = document.querySelector("#hint");
const current = document.querySelector("#current");
const menu = document.querySelector("#menu");

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function indexNow() {
  const x = track.scrollLeft;
  let i = 0;
  slides.forEach((slide, n) => {
    if (slide.offsetLeft <= x + slide.offsetWidth * 0.45) i = n;
  });
  return i;
}

function go(index) {
  const slide = slides[index];
  if (!slide) return;
  slide.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", inline: "start", block: "nearest" });
}

function sync() {
  const i = indexNow();
  const slide = slides[i];
  document.body.classList.toggle("on-dark", slide.dataset.theme === "dark");
  current.textContent = `${slide.dataset.collection} ↑`;
  const atStart = i === 0;
  prev.hidden = atStart;
  hint.hidden = !atStart;
  next.hidden = i === slides.length - 1;
}

track.addEventListener("scroll", sync, { passive: true });
track.addEventListener(
  "wheel",
  (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const scroller = event.target.closest(".slide-scroll");
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 8) {
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const goingDown = event.deltaY > 0;
      if ((goingDown && !atBottom) || (!goingDown && !atTop)) return;
    }
    event.preventDefault();
    if (track.dataset.wheeling === "1") return;
    track.dataset.wheeling = "1";
    go(indexNow() + (event.deltaY > 0 ? 1 : -1));
    window.setTimeout(() => {
      track.dataset.wheeling = "0";
    }, 620);
  },
  { passive: false }
);

let drag = null;
track.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("a, button, input, textarea, label, select")) return;
  drag = { x: event.clientX, left: track.scrollLeft, id: event.pointerId };
  track.classList.add("is-dragging");
  track.setPointerCapture(event.pointerId);
});
track.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  track.scrollLeft = drag.left - (event.clientX - drag.x);
});
function endDrag(event) {
  if (!drag || (event && event.pointerId !== drag.id)) return;
  drag = null;
  track.classList.remove("is-dragging");
  go(indexNow());
}
track.addEventListener("pointerup", endDrag);
track.addEventListener("pointercancel", endDrag);

prev.addEventListener("click", () => go(indexNow() - 1));
next.addEventListener("click", () => go(indexNow() + 1));
current.addEventListener("click", () => go(0));
menu.addEventListener("click", () => go(0));

document.querySelectorAll("[data-go]").forEach((node) => {
  node.addEventListener("click", (event) => {
    event.preventDefault();
    go(Number(node.dataset.go));
  });
});

sync();
