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

function filmVideo() {
  return document.querySelector(".film video");
}

let filmToken = 0;
let filmOpen = false;
let filmDone = false;
let arriving = false;

function stopFilm(video) {
  arriving = false;
  filmOpen = false;
  filmDone = false;
  filmToken += 1;
  video.pause();
  try { video.currentTime = 0; } catch (error) { /* not ready */ }
}

function startFilm(video) {
  if (!video || reduced() || filmOpen || filmDone) return;
  const token = ++filmToken;
  const slide = video.closest(".film");
  if (slide) slide.classList.add("is-current");
  video.muted = false;
  video.volume = 1;
  const pending = video.play();
  if (!pending) return;
  filmOpen = true;
  pending.then(() => {
    if (token !== filmToken) video.pause();
  }).catch(() => {
    if (token !== filmToken) return;
    filmOpen = false;
    video.muted = true;
    const again = video.play();
    if (!again) return;
    again.then(() => {
      if (token !== filmToken) {
        video.pause();
        return;
      }
      filmOpen = true;
    }).catch(() => {
      if (token === filmToken) filmOpen = false;
    });
  });
}

function settleFilm(slide) {
  const video = filmVideo();
  if (!video) return;
  const here = Boolean(slide && slide.contains(video));
  if (here) {
    arriving = false;
    if (filmDone || video.ended) {
      filmDone = true;
      video.pause();
      return;
    }
    startFilm(video);
    return;
  }
  if (arriving) return;
  if (filmOpen || !video.paused) stopFilm(video);
}

function go(index) {
  const slide = slides[index];
  if (!slide) return;
  const video = filmVideo();
  if (video && slide.contains(video)) {
    arriving = true;
    startFilm(video);
  } else if (video) {
    stopFilm(video);
  }
  slide.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", inline: "start", block: "nearest" });
}

const filmNode = filmVideo();
if (filmNode) {
  filmNode.addEventListener("ended", () => {
    filmDone = true;
    filmToken += 1;
    filmOpen = true;
    filmNode.pause();
  });
  const openWhenReady = () => {
    const slide = slides[indexNow()];
    if (!slide || !slide.contains(filmNode) || filmDone || filmOpen || !filmNode.paused) return;
    startFilm(filmNode);
  };
  filmNode.addEventListener("canplay", openWhenReady);
  filmNode.addEventListener("loadeddata", openWhenReady);
}

function resetDeck() {
  if (!deck) return;
  if (shown !== 0) {
    deckOrder.forEach((card) => deck.appendChild(card));
    deck.querySelectorAll(".card").forEach((card) => {
      card.classList.remove("is-leaving", "is-entering", "is-rising");
    });
    shown = 0;
    deckBusy = false;
  }
  deck.querySelectorAll(".card").forEach((card) => setPhoto(card, 0));
}

function photoReel(card) {
  return card.querySelector(".photo-track");
}

function setPhoto(card, index) {
  const reel = photoReel(card);
  if (!reel) return;
  const count = reel.children.length;
  const next = Math.max(0, Math.min(count - 1, index));
  card.dataset.photo = String(next);
  reel.style.transform = `translateX(${next * -100}%)`;
  const countEl = card.querySelector(".photo-count");
  if (countEl) countEl.textContent = `${next + 1} / ${count}`;
}

function shiftPhotos(card, dir) {
  const reel = photoReel(card);
  if (!reel || reel.children.length < 2) return false;
  const index = Number(card.dataset.photo || 0);
  const last = reel.children.length - 1;
  if (dir > 0 && index < last) {
    setPhoto(card, index + 1);
    return true;
  }
  if (dir < 0 && index > 0) {
    setPhoto(card, index - 1);
    return true;
  }
  return false;
}

function playDeck(dir) {
  if (!deck || deckBusy) return true;
  const top = deck.firstElementChild;
  if (!top) return false;
  if (shiftPhotos(top, dir)) return true;
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
  settleFilm(slide);
  document.body.classList.toggle("on-dark", slide.dataset.theme === "dark");
  const name = document.documentElement.lang === "en"
    ? slide.dataset.collectionEn || slide.dataset.collection
    : slide.dataset.collection;
  current.textContent = `${name} ↑`;
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
  if (event.target.closest(".is-head, a, button, input, textarea, label, select, video")) return;
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
    if (event.target.closest(".is-head")) {
      touchStart = null;
      return;
    }
    const point = event.changedTouches[0];
    touchStart = { x: point.clientX, y: point.clientY, left: track.scrollLeft };
  }, { passive: true });
  deck.addEventListener("touchmove", (event) => {
    if (!touchStart) return;
    const point = event.touches[0];
    const dx = point.clientX - touchStart.x;
    const dy = point.clientY - touchStart.y;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    event.preventDefault();
    track.scrollLeft = touchStart.left;
  }, { passive: false });
  deck.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - touchStart.x;
    const dy = point.clientY - touchStart.y;
    const left = touchStart.left;
    touchStart = null;
    const horizontal = Math.abs(dx) > 24 && Math.abs(dx) >= Math.abs(dy);
    const vertical = Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx);
    if (!horizontal && !vertical) return;
    track.scrollLeft = left;
    const dir = horizontal ? (dx < 0 ? 1 : -1) : (dy > 0 ? 1 : -1);
    if (!playDeck(dir)) go(indexNow() + dir);
  }, { passive: true });
}

let pageTouch = null;
track.addEventListener("touchstart", (event) => {
  if (event.target.closest(".deck")) return;
  const point = event.changedTouches[0];
  pageTouch = { x: point.clientX, i: indexNow() };
}, { passive: true });
track.addEventListener("touchend", (event) => {
  if (!pageTouch) return;
  const dx = event.changedTouches[0].clientX - pageTouch.x;
  const from = pageTouch.i;
  pageTouch = null;
  const video = filmVideo();
  if (!video || Math.abs(dx) < 24) return;
  const dir = dx < 0 ? 1 : -1;
  const guess = slides[from + dir];
  if (guess && guess.contains(video)) startFilm(video);
}, { passive: true });

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

document.addEventListener("luxetik:lang", sync);
if (deck) deck.querySelectorAll(".card").forEach((card) => setPhoto(card, 0));
sync();
if (location.hash === "#ecrire") go(9);

const head = document.querySelector(".is-head");
if (head) {
  let crop = null;

  function cropPos() {
    const parts = getComputedStyle(head).objectPosition.split(/\s+/);
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    return {
      x: Number.isFinite(x) ? x : 50,
      y: Number.isFinite(y) ? y : 0,
    };
  }

  head.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const pos = cropPos();
    crop = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: pos.x, oy: pos.y };
    try { head.setPointerCapture(event.pointerId); } catch (error) { /* synthetic */ }
  });

  head.addEventListener("pointermove", (event) => {
    if (!crop || event.pointerId !== crop.id) return;
    const reel = head.closest(".photo-reel");
    const width = reel ? reel.clientWidth : 1;
    const height = reel ? reel.clientHeight : 1;
    const x = Math.min(100, Math.max(0, crop.ox - ((event.clientX - crop.x) / width) * 100));
    const y = Math.min(100, Math.max(0, crop.oy - ((event.clientY - crop.y) / height) * 100));
    head.style.objectPosition = `${Math.round(x)}% ${Math.round(y)}%`;
  });

  function endCrop(event) {
    if (!crop || (event && event.pointerId !== crop.id)) return;
    crop = null;
    const pos = cropPos();
    fetch("/api/crop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }),
    }).catch(() => {});
  }

  head.addEventListener("pointerup", endCrop);
  head.addEventListener("pointercancel", endCrop);
}
