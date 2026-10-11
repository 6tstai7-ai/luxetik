document.documentElement.classList.add("js");

const track = document.querySelector("#track");
const slides = [...document.querySelectorAll(".slide")];
const prev = document.querySelector("#prev");
const next = document.querySelector("#next-col");
const hint = document.querySelector("#hint");
const current = document.querySelector("#current");
const menu = document.querySelector("#menu");
const deck = document.querySelector(".deck-stack");
const deckOrder = deck ? [...deck.children] : [];
let shown = 0;
let deckBusy = false;

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

function resetDeck() {
  if (!deck || shown === 0) return;
  deckOrder.forEach((card) => deck.appendChild(card));
  deck.querySelectorAll(".card").forEach((card) => {
    card.classList.remove("is-leaving", "is-entering", "is-rising");
  });
  shown = 0;
  deckBusy = false;
}

function playDeck(dir) {
  if (!deck || deckBusy) return true;
  const top = deck.firstElementChild;
  if (!top) return false;
  if (dir > 0 && shown >= deckOrder.length - 1) return false;
  if (dir < 0 && shown <= 0) return false;
  deckBusy = true;

  if (dir > 0) {
    const finish = () => {
      deck.appendChild(top);
      top.classList.remove("is-leaving");
      shown += 1;
      deckBusy = false;
    };
    if (reduced()) {
      finish();
      return true;
    }
    top.classList.add("is-leaving");
    const onDone = (event) => {
      if (event.target !== top) return;
      top.removeEventListener("transitionend", onDone);
      finish();
    };
    top.addEventListener("transitionend", onDone);
    return true;
  }

  const incoming = deck.lastElementChild;
  incoming.classList.add("is-entering");
  deck.insertBefore(incoming, top);
  const finishBack = () => {
    incoming.classList.remove("is-entering", "is-rising");
    shown -= 1;
    deckBusy = false;
  };
  if (reduced()) {
    finishBack();
    return true;
  }
  incoming.getBoundingClientRect();
  incoming.classList.add("is-rising");
  const onDone = (event) => {
    if (event.target !== incoming) return;
    incoming.removeEventListener("transitionend", onDone);
    finishBack();
  };
  incoming.addEventListener("transitionend", onDone);
  return true;
}

function sync() {
  const i = indexNow();
  const slide = slides[i];
  slides.forEach((item, n) => item.classList.toggle("is-current", n === i));
  if (!slide.classList.contains("deck")) resetDeck();
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
    const slide = slides[indexNow()];
    const dir = event.deltaY > 0 ? 1 : -1;
    if (slide.classList.contains("deck") && playDeck(dir)) {
      track.dataset.wheeling = "1";
      window.setTimeout(() => {
        track.dataset.wheeling = "0";
      }, 700);
      return;
    }
    track.dataset.wheeling = "1";
    go(indexNow() + dir);
    window.setTimeout(() => {
      track.dataset.wheeling = "0";
    }, 620);
  },
  { passive: false }
);

let drag = null;
track.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.pointerType === "touch") return;
  if (event.target.closest("a, button, input, textarea, label, select")) return;
  drag = { x: event.clientX, y: event.clientY, left: track.scrollLeft, id: event.pointerId, deck: Boolean(event.target.closest(".deck")) };
  track.classList.add("is-dragging");
  track.setPointerCapture(event.pointerId);
});
track.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (drag.deck && Math.abs(dy) > Math.abs(dx)) return;
  track.scrollLeft = drag.left - dx;
});
function endDrag(event) {
  if (!drag || (event && event.pointerId !== drag.id)) return;
  const dx = event ? event.clientX - drag.x : 0;
  const dy = event ? event.clientY - drag.y : 0;
  const onDeck = drag.deck;
  drag = null;
  track.classList.remove("is-dragging");
  if (onDeck && Math.abs(dy) > 56 && Math.abs(dy) > Math.abs(dx)) {
    playDeck(dy > 0 ? 1 : -1);
    return;
  }
  go(indexNow());
}
track.addEventListener("pointerup", endDrag);
track.addEventListener("pointercancel", endDrag);

if (deck) {
  let touchStart = null;
  deck.addEventListener("touchstart", (event) => {
    const point = event.changedTouches[0];
    touchStart = { x: point.clientX, y: point.clientY };
  }, { passive: true });
  deck.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - touchStart.x;
    const dy = point.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx)) playDeck(dy > 0 ? 1 : -1);
  }, { passive: true });
}

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
