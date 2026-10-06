/**
 * Place Tool (place-tool) — map → drag · lock · regenerate
 * Standalone HTML placement editor. Consumers: any preview page + placement.json.
 * Source of truth for Place runtime lives here — not in restaurant-site-preview.
 *
 * Place edit chrome = outline only ; never restyle product fills/fonts via edit CSS.
 * Freeze = resolved computed look at lift time in px; never freeze transform;
 * prefer min-size over hard size when the box must stay fluid.
 * Placeholder = invisible layout twin (margins + box + grid/flex role);
 * never a second visible copy; never display:none.
 * One placement owner per subtree: no independent lift of a data-place inside
 * another data-place (use group or drop the child attribute).
 * Placement coords = CSS left/top of the layout box on the place layer;
 * never confuse with post-transform AABB from getBoundingClientRect.
 * Measure placement only in #rsp-place-layer space after lift;
 * never walk offsetParent/matrices on pointerdown.
 * Clear local = full session reset to file-backed placement (reload or true
 * DOM restore); never storage-only.
 * Motion owns enter on native tree until settled; Place lifts only after
 * settled (or edit fallback). Never query placeable nodes through parents
 * that Place may empty.
 * Free-page drag via #rsp-place-layer on body (escapes transform cages).
 * Never overwrites design transform (rotate / swing stay on stylesheet).
 * On lift: snapshot getComputedStyle → inline freeze + layout placeholder
 * so parent-dependent selectors / em sizes / grid slots don't collapse.
 * Edit UX: region-first — draw a session-only marquee, then drag scoped
 * [data-place]; Whole page is escape hatch; never export region in JSON.
 * Edit load: apply locked only; defer unlocked until region/1st drag
 * (on-demand lift). Region hit = el ∪ slot; centre-in-region or ≥20% overlap.
 * Kind = named role (data-place-kind), never HTML tag → role.
 */
(function () {
  const EDIT = new URLSearchParams(location.search).has("edit");
  const STORAGE_KEY = "rsp-place:" + location.pathname;
  const PLACE_URL =
    new URLSearchParams(location.search).get("placement") || "./placement.json";

  /** Short named roles — not HTML tags. Soft-warn if unknown. */
  const PLACE_KINDS = new Set([
    "badge",
    "cta",
    "seal",
    "heading",
    "nav",
    "visit",
    "eyebrow",
    "hint",
  ]);
  /** Min fraction of placeable box inside region to count as hit. */
  const REGION_OVERLAP_MIN = 0.2;

  /** Resolved look props — no transform (animations / rotate stay on CSS classes). */
  const FREEZE_PROPS = [
    "display",
    "boxSizing",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "textShadow",
    "whiteSpace",
    "verticalAlign",
    "opacity",
    "filter",
    "webkitTextStrokeWidth",
    "webkitTextStrokeColor",
    "color",
    "backgroundColor",
    "backgroundImage",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "boxShadow",
    "gap",
    "rowGap",
    "columnGap",
    "alignItems",
    "justifyContent",
    "flexDirection",
    "flexWrap",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
  ];

  const style = document.createElement("style");
  style.textContent = `
    #rsp-place-layer {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      min-height: 100%;
      pointer-events: none;
      z-index: 40;
    }
    #rsp-place-layer > [data-place].is-placed {
      position: absolute !important;
      left: calc(var(--rsp-x, 50) * 1%) !important;
      top: calc(var(--rsp-y, 50) * 1%) !important;
      right: auto !important;
      bottom: auto !important;
      margin: 0 !important;
      pointer-events: auto;
      z-index: 1;
    }
    [data-place-slot] {
      visibility: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
    }
    [data-place].is-edit {
      cursor: grab;
      outline: 2px dashed color-mix(in srgb, #e6322a 80%, #12141a);
      outline-offset: 3px;
      pointer-events: auto !important;
      user-select: none;
      touch-action: none;
    }
    [data-place].is-edit:active { cursor: grabbing; }
    [data-place].is-edit:hover {
      outline-style: solid;
      outline-width: 3px;
    }
    [data-place].is-edit-active {
      outline: 3px solid #0b62d6;
      outline-offset: 4px;
    }
    [data-place].is-locked {
      outline-color: #1a7f37;
    }
    [data-place].is-locked::after {
      content: "lock";
      position: absolute;
      top: -0.55rem;
      right: -0.55rem;
      z-index: 2;
      font: 700 0.55rem/1 system-ui, sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.2rem 0.35rem;
      border-radius: 999px;
      background: #1a7f37;
      color: #fff;
      pointer-events: none;
    }
    #rsp-place-bar {
      position: fixed;
      left: 50%;
      bottom: 1rem;
      translate: -50% 0;
      z-index: 9999;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
      padding: 0.45rem 0.6rem;
      border: 2px solid #12141a;
      background: #fff;
      font: 700 0.72rem/1.2 system-ui, sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      box-shadow: 3px 3px 0 #12141a;
      max-width: min(92vw, 40rem);
    }
    #rsp-place-bar button {
      font: inherit;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 2px solid #12141a;
      background: #ffd60a;
      color: #12141a;
      padding: 0.35rem 0.55rem;
      cursor: pointer;
    }
    #rsp-place-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
    #rsp-place-bar [data-act="lock"] { background: #e6322a; color: #fff; }
    #rsp-place-bar [data-act="lock"].on { background: #1a7f37; }
    #rsp-place-status { opacity: 0.7; font-weight: 600; text-transform: none; letter-spacing: 0; }
    #rsp-place-bar [data-act="whole-page"].on { background: #0b62d6; color: #fff; }
    /* Region chrome = outline only; never restyle product fills */
    #rsp-place-marquee,
    #rsp-place-region {
      position: absolute;
      left: 0;
      top: 0;
      box-sizing: border-box;
      pointer-events: none;
      display: none;
    }
    #rsp-place-marquee {
      z-index: 9997;
      border: 1.5px dashed #0b62d6;
      background: color-mix(in srgb, #0b62d6 12%, transparent);
    }
    #rsp-place-region {
      z-index: 0;
      border: 1.5px solid color-mix(in srgb, #0b62d6 75%, #12141a);
      background: transparent;
    }
  `;
  document.head.appendChild(style);

  /** @type {Record<string, { x: number, y: number, locked?: boolean }>} */
  let data = {};
  /** @type {HTMLElement | null} */
  let active = null;
  let dragging = false;
  /** @type {{ el: HTMLElement, dx: number, dy: number } | null} */
  let grab = null;

  /** @type {HTMLElement | null} */
  let layerCached = null;
  let layerSized = false;

  /** Scope: region-first by default; "whole" = escape hatch */
  /** @type {"region" | "whole"} */
  let scopeMode = "region";
  /** Layer-space AABB (px). Session only — not exported. */
  /** @type {{ left: number, top: number, right: number, bottom: number } | null} */
  let region = null;
  let drawingRegion = false;
  /** @type {{ x: number, y: number } | null} */
  let drawStart = null;
  /** @type {WeakSet<HTMLElement>} */
  const editBound = new WeakSet();

  /**
   * Place layer — cache node; resize only when missing size or forced
   * (window resize / end-drag / region end), never every pointermove.
   * @param {{ resize?: boolean }} [opts]
   */
  function ensureLayer(opts) {
    const forceResize = !!(opts && opts.resize);
    let layer = layerCached || document.getElementById("rsp-place-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "rsp-place-layer";
      if (getComputedStyle(document.body).position === "static") {
        document.body.style.position = "relative";
      }
      document.body.appendChild(layer);
      layerSized = false;
    }
    layerCached = layer;
    if (!layerSized || forceResize) {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.clientHeight
      );
      const w = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
        document.documentElement.clientWidth
      );
      layer.style.width = w + "px";
      layer.style.height = h + "px";
      layerSized = true;
    }
    return layer;
  }

  function clientToLayer(clientX, clientY) {
    const layer = ensureLayer();
    const lr = layer.getBoundingClientRect();
    return { x: clientX - lr.left, y: clientY - lr.top };
  }

  /** Layer-space AABB from getBoundingClientRect (hit filter only — not placement coords). */
  function layerBoxFromEl(el) {
    const layer = ensureLayer();
    const lr = layer.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return {
      left: er.left - lr.left,
      top: er.top - lr.top,
      right: er.right - lr.left,
      bottom: er.bottom - lr.top,
    };
  }

  function boxCenterInRegion(box, r) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  /** Fraction of `box` area that overlaps region `r`. */
  function boxOverlapRatio(box, r) {
    const left = Math.max(box.left, r.left);
    const top = Math.max(box.top, r.top);
    const right = Math.min(box.right, r.right);
    const bottom = Math.min(box.bottom, r.bottom);
    if (right <= left || bottom <= top) return 0;
    const area = Math.max(0, (box.right - box.left) * (box.bottom - box.top));
    if (area <= 0) return 0;
    return ((right - left) * (bottom - top)) / area;
  }

  function boxHitsRegion(box, r) {
    return (
      boxCenterInRegion(box, r) || boxOverlapRatio(box, r) >= REGION_OVERLAP_MIN
    );
  }

  /**
   * Region scope hit: lifted el may sit elsewhere — also test native
   * [data-place-slot]. Centre-in-region or ≥20% overlap (not any AABB touch).
   */
  function placeableHitsRegion(el, r) {
    const id = el.getAttribute("data-place");
    const targets = [el];
    if (id) {
      const slot = document.querySelector(
        `[data-place-slot="${CSS.escape(id)}"]`
      );
      if (slot) targets.push(slot);
    }
    for (const t of targets) {
      if (boxHitsRegion(layerBoxFromEl(t), r)) return true;
    }
    return false;
  }

  /** Status line: id · kind · label */
  function placeStatusBase(el) {
    const id = el.getAttribute("data-place") || "?";
    const kind = el.getAttribute("data-place-kind") || "—";
    const raw = (
      el.getAttribute("aria-label") ||
      el.textContent ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ");
    const label = raw ? raw.slice(0, 40) : "—";
    return `${id} · ${kind} · ${label}`;
  }

  function ensureRegionChrome() {
    const layer = ensureLayer();
    let marquee = document.getElementById("rsp-place-marquee");
    if (!marquee) {
      marquee = document.createElement("div");
      marquee.id = "rsp-place-marquee";
      layer.appendChild(marquee);
    } else if (marquee.parentElement !== layer) {
      layer.appendChild(marquee);
    }
    let outline = document.getElementById("rsp-place-region");
    if (!outline) {
      outline = document.createElement("div");
      outline.id = "rsp-place-region";
      layer.appendChild(outline);
    } else if (outline.parentElement !== layer) {
      layer.appendChild(outline);
    }
    return { marquee, outline };
  }

  function paintBox(el, box) {
    if (!box) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = box.left + "px";
    el.style.top = box.top + "px";
    el.style.width = Math.max(0, box.right - box.left) + "px";
    el.style.height = Math.max(0, box.bottom - box.top) + "px";
  }

  function updateRegionChrome() {
    const { marquee, outline } = ensureRegionChrome();
    if (!drawingRegion) marquee.style.display = "none";
    paintBox(outline, scopeMode === "region" ? region : null);
  }

  function onPlaceEnter(e) {
    const el = e.currentTarget;
    if (!(el instanceof HTMLElement) || dragging || drawingRegion) return;
    setStatus(placeStatusBase(el));
  }

  function onPlaceClick(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function setPlaceEdit(el, on) {
    if (on) {
      el.classList.add("is-edit");
      if (!editBound.has(el)) {
        el.addEventListener("pointerdown", onDown);
        el.addEventListener("pointerenter", onPlaceEnter);
        el.addEventListener("click", onPlaceClick);
        editBound.add(el);
      }
    } else {
      el.classList.remove("is-edit", "is-edit-active");
      if (editBound.has(el)) {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerenter", onPlaceEnter);
        el.removeEventListener("click", onPlaceClick);
        editBound.delete(el);
      }
    }
  }

  /** Activate is-edit only for scoped placeables (region or whole page). */
  function refreshEditScope() {
    const nodes = [...document.querySelectorAll("[data-place]")];
    for (const el of nodes) {
      let on = false;
      if (scopeMode === "whole") on = true;
      else if (region) on = placeableHitsRegion(el, region);
      setPlaceEdit(el, on);
    }
    if (active && !active.classList.contains("is-edit")) select(null);
    updateRegionChrome();
    updateBar();
  }

  /** Freeze resolved look as inline (px etc.) before leaving parent CSS context. */
  function freezeLook(el) {
    if (el.dataset.placeFrozen === "1") return;
    const cs = getComputedStyle(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    for (const prop of FREEZE_PROPS) {
      const val = cs[prop];
      if (val == null || val === "" || val === "none") continue;
      el.style[prop] = val;
    }
    // Prefer min-size so the box stays fluid; hard size only for inline* (collapse risk)
    const disp = cs.display;
    const inlineLike =
      disp === "inline" || disp === "inline-block" || disp === "inline-flex";
    if (inlineLike) {
      if (w > 0) el.style.width = w + "px";
      if (h > 0) el.style.height = h + "px";
    } else {
      if (w > 0) el.style.minWidth = w + "px";
      if (h > 0) el.style.minHeight = h + "px";
    }
    el.dataset.placeFrozen = "1";
  }

  /** Keep layout slot so lifting a grid/flow child doesn't reflow the page. */
  function leavePlaceholder(el) {
    const id = el.getAttribute("data-place");
    if (!id || !el.parentNode) return;
    if (document.querySelector(`[data-place-slot="${CSS.escape(id)}"]`)) return;

    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const parentDisp = parent ? getComputedStyle(parent).display : "";
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    const slot = document.createElement("span");
    slot.setAttribute("data-place-slot", id);
    slot.setAttribute("aria-hidden", "true");

    // Exact display box (flex/grid/inline-flex…), not just block|inline-block
    slot.style.display = cs.display || "block";
    slot.style.boxSizing = "border-box";
    slot.style.flexShrink = "0";

    // Layout metrics — offset box (not AABB); margins keep neighbor gaps
    if (w > 0) slot.style.width = w + "px";
    if (h > 0) slot.style.height = h + "px";
    slot.style.marginTop = cs.marginTop;
    slot.style.marginRight = cs.marginRight;
    slot.style.marginBottom = cs.marginBottom;
    slot.style.marginLeft = cs.marginLeft;
    slot.style.verticalAlign = cs.verticalAlign;

    // Flex item role
    if (parentDisp === "flex" || parentDisp === "inline-flex") {
      slot.style.alignSelf = cs.alignSelf;
      slot.style.justifySelf = cs.justifySelf;
      slot.style.flexGrow = cs.flexGrow;
      slot.style.flexShrink = cs.flexShrink;
      slot.style.flexBasis = cs.flexBasis;
      slot.style.order = cs.order;
    }

    // Grid item role (hero-title / media cells)
    if (parentDisp === "grid" || parentDisp === "inline-grid") {
      slot.style.gridColumn = cs.gridColumn;
      slot.style.gridRow = cs.gridRow;
      slot.style.alignSelf = cs.alignSelf;
      slot.style.justifySelf = cs.justifySelf;
    }

    el.parentNode.insertBefore(slot, el);
  }

  /**
   * Lift out of transform cages into #rsp-place-layer.
   * Snapshot look + placeholder BEFORE appendChild.
   */
  function liftToLayer(el) {
    const layer = ensureLayer();
    if (el.parentElement === layer) return layer;
    freezeLook(el);
    leavePlaceholder(el);
    layer.appendChild(el);
    return layer;
  }

  /** Nearest ancestor that is itself a placeable (nested ownership). */
  function placeOwnerAncestor(el) {
    return el.parentElement ? el.parentElement.closest("[data-place]") : null;
  }

  /** Depth in document — shallower = parent, applied first. */
  function placeDepth(el) {
    let d = 0;
    let n = el;
    while (n.parentElement) {
      d += 1;
      n = n.parentElement;
    }
    return d;
  }

  /**
   * One owner per subtree. Returns a status reason if lift/apply must refuse.
   * Agents: never put data-place inside another data-place (drop child or group).
   */
  function ownershipBlock(el) {
    const anc = placeOwnerAncestor(el);
    if (anc) {
      return (
        "nested under " +
        anc.getAttribute("data-place") +
        " — one owner per subtree (drop child data-place)"
      );
    }
    const kid = [...el.querySelectorAll("[data-place]")].find(
      (c) =>
        c.classList.contains("is-placed") ||
        c.parentElement?.id === "rsp-place-layer"
    );
    if (kid) {
      return (
        "child " +
        kid.getAttribute("data-place") +
        " already placed — clear/unlock child first"
      );
    }
    return null;
  }

  /** Drop nested / missing ids so JSON never keeps parent+child conflicts. */
  function pruneOwnershipData() {
    for (const id of Object.keys(data)) {
      const el = document.querySelector(`[data-place="${CSS.escape(id)}"]`);
      if (!el || placeOwnerAncestor(el)) delete data[id];
    }
  }

  /** Layout % from offsetLeft/Top — el must already be on #rsp-place-layer. */
  function layerPercentOnLayer(el) {
    const layer = ensureLayer();
    const lw = layer.offsetWidth || 1;
    const lh = layer.offsetHeight || 1;
    return {
      x: (el.offsetLeft / lw) * 100,
      y: (el.offsetTop / lh) * 100,
    };
  }

  /**
   * First map: lift into layer, seed with ONE visual rect (no ancestor walk),
   * then canonicalize to offsetLeft/Top layout % on the layer.
   */
  function mapOntoLayer(el) {
    if (ownershipBlock(el)) return null;
    const layer = ensureLayer();
    if (el.parentElement === layer && el.classList.contains("is-placed")) {
      return layerPercentOnLayer(el);
    }

    const lr = layer.getBoundingClientRect();
    const rw = lr.width || 1;
    const rh = lr.height || 1;
    // Single visual sample before lift — continuity only, no matrix walk
    const vr = el.getBoundingClientRect();
    const xVis = ((vr.left - lr.left) / rw) * 100;
    const yVis = ((vr.top - lr.top) / rh) * 100;

    liftToLayer(el);
    writeCoords(el, xVis, yVis);
    const at = layerPercentOnLayer(el);
    writeCoords(el, at.x, at.y);
    return at;
  }

  /** Prefer layer-space measure; lift-first if still native. */
  function layerPercent(el) {
    if (el.parentElement?.id === "rsp-place-layer") return layerPercentOnLayer(el);
    return mapOntoLayer(el) || { x: 0, y: 0 };
  }

  /** Viewport position of layout TL when el is already on the place layer. */
  function placedLayoutViewport(el) {
    const layer = ensureLayer();
    const lr = layer.getBoundingClientRect();
    return {
      x: lr.left + el.offsetLeft,
      y: lr.top + el.offsetTop,
    };
  }

  /** Write coords only — skip freeze/lift when already on the layer. */
  function writeCoords(el, x, y, locked) {
    const id = el.getAttribute("data-place");
    if (!id) return false;
    data[id] = {
      x,
      y,
      locked: locked != null ? !!locked : !!(data[id] && data[id].locked),
    };
    el.style.setProperty("--rsp-x", String(x));
    el.style.setProperty("--rsp-y", String(y));
    el.classList.add("is-placed");
    el.classList.toggle("is-locked", !!data[id].locked);
    return true;
  }

  function applyOne(el, entry) {
    if (!entry || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return false;
    if (ownershipBlock(el)) return false;
    if (el.parentElement?.id === "rsp-place-layer" && el.classList.contains("is-placed")) {
      return writeCoords(el, entry.x, entry.y, entry.locked);
    }
    liftToLayer(el);
    return writeCoords(el, entry.x, entry.y, entry.locked);
  }

  function applyAll() {
    pruneOwnershipData();
    // Soft validate: JSON ids with no matching [data-place] in DOM
    for (const id of Object.keys(data)) {
      if (!document.querySelector(`[data-place="${CSS.escape(id)}"]`)) {
        console.warn("[rsp-place] placement id has no matching [data-place] in DOM — skipped:", id);
      }
    }
    const nodes = [...document.querySelectorAll("[data-place]")].filter((el) => {
      const id = el.getAttribute("data-place");
      return id && data[id];
    });
    // Parents before children
    nodes.sort((a, b) => placeDepth(a) - placeDepth(b));
    for (const el of nodes) {
      const id = el.getAttribute("data-place");
      if (!id || !data[id]) continue;
      if (placeOwnerAncestor(el)) {
        delete data[id];
        continue;
      }
      // Skip if an ancestor placeable is also in this payload / already placed
      let walk = el.parentElement;
      let ancestorPlaced = false;
      while (walk) {
        const aid = walk.getAttribute?.("data-place");
        if (aid && (data[aid] || walk.classList.contains("is-placed"))) {
          ancestorPlaced = true;
          break;
        }
        walk = walk.parentElement;
      }
      if (ancestorPlaced) {
        delete data[id];
        continue;
      }
      applyOne(el, data[id]);
    }
  }

  /** Edit load: lift only locked entries — unlocked stay native until drag. */
  function applyLockedOnly() {
    pruneOwnershipData();
    const nodes = [...document.querySelectorAll("[data-place]")].filter((el) => {
      const id = el.getAttribute("data-place");
      return id && data[id] && data[id].locked;
    });
    nodes.sort((a, b) => placeDepth(a) - placeDepth(b));
    for (const el of nodes) {
      const id = el.getAttribute("data-place");
      if (!id || !data[id]) continue;
      if (placeOwnerAncestor(el)) {
        delete data[id];
        continue;
      }
      let walk = el.parentElement;
      let ancestorPlaced = false;
      while (walk) {
        const aid = walk.getAttribute?.("data-place");
        if (aid && (data[aid] || walk.classList.contains("is-placed"))) {
          ancestorPlaced = true;
          break;
        }
        walk = walk.parentElement;
      }
      if (ancestorPlaced) {
        delete data[id];
        continue;
      }
      applyOne(el, data[id]);
    }
  }

  function warnUnknownKinds() {
    document.querySelectorAll("[data-place]").forEach((el) => {
      const kind = el.getAttribute("data-place-kind");
      if (!kind) {
        console.warn(
          "[rsp-place] missing data-place-kind on",
          el.getAttribute("data-place") || el
        );
        return;
      }
      if (!PLACE_KINDS.has(kind)) {
        console.warn(
          "[rsp-place] unknown data-place-kind:",
          kind,
          "(id:",
          el.getAttribute("data-place") + ")"
        );
      }
    });
  }

  function readFromDom(el) {
    const id = el.getAttribute("data-place");
    if (!id) return null;
    const x = Number.parseFloat(el.style.getPropertyValue("--rsp-x"));
    const y = Number.parseFloat(el.style.getPropertyValue("--rsp-y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, locked: !!(data[id] && data[id].locked) };
  }

  function syncEntry(el) {
    const id = el.getAttribute("data-place");
    if (!id) return;
    const cur = readFromDom(el);
    if (!cur) return;
    data[id] = { ...data[id], ...cur };
  }

  function serialize() {
    return JSON.stringify(data, null, 2);
  }

  function persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, serialize());
    } catch (_) {}
  }

  async function load() {
    let file = {};
    let local = {};
    try {
      const res = await fetch(PLACE_URL, { cache: "no-store" });
      if (res.ok) file = await res.json();
    } catch (_) {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (_) {}
    data = { ...file, ...local };
    // Enter on native tree first; lift only after settled (or timeout / no-motion)
    await waitForMotionSettled(EDIT ? 800 : 2200);
    if (EDIT) {
      warnUnknownKinds();
      applyLockedOnly();
    } else {
      applyAll();
    }
  }

  /**
   * Wait until motion host marks data-motion=settled (or rsp:motion-settled),
   * else timeout — pages without motion must not hang Place.
   */
  function waitForMotionSettled(timeoutMs) {
    return new Promise((resolve) => {
      if (document.querySelector('[data-motion="settled"]')) {
        resolve("already");
        return;
      }
      const host =
        document.querySelector(".rsp-hero-brand") ||
        document.querySelector("[data-motion]");
      if (!host) {
        resolve("none");
        return;
      }

      let done = false;
      const finish = (why) => {
        if (done) return;
        done = true;
        obs.disconnect();
        window.removeEventListener("rsp:motion-settled", onEvt);
        window.clearTimeout(tid);
        resolve(why);
      };
      const onEvt = () => finish("event");
      const obs = new MutationObserver(() => {
        if (document.querySelector('[data-motion="settled"]')) finish("attr");
      });
      obs.observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ["data-motion"],
      });
      window.addEventListener("rsp:motion-settled", onEvt);
      const tid = window.setTimeout(() => finish("timeout"), timeoutMs);
    });
  }

  function setStatus(msg) {
    const el = document.querySelector("#rsp-place-status");
    if (el) el.textContent = msg;
  }

  function select(el) {
    document.querySelectorAll("[data-place].is-edit-active").forEach((n) => {
      n.classList.remove("is-edit-active");
    });
    active = el;
    if (!el) {
      if (scopeMode === "whole") setStatus("whole page · click an element");
      else if (region) setStatus("region · click a scoped element");
      else setStatus("draw a region");
      updateBar();
      return;
    }
    el.classList.add("is-edit-active");
    const id = el.getAttribute("data-place");
    const entry = data[id] || readFromDom(el);
    const base = placeStatusBase(el);
    setStatus(
      entry
        ? `${base} · ${Number(entry.x).toFixed(1)}, ${Number(entry.y).toFixed(1)}` +
            (entry.locked ? " · LOCKED" : "")
        : `${base} · unmapped — drag to map`
    );
    updateBar();
  }

  function updateBar() {
    const lockBtn = document.querySelector('#rsp-place-bar [data-act="lock"]');
    const wholeBtn = document.querySelector('#rsp-place-bar [data-act="whole-page"]');
    if (wholeBtn) wholeBtn.classList.toggle("on", scopeMode === "whole");
    if (!lockBtn) return;
    const id = active && active.getAttribute("data-place");
    const locked = !!(id && data[id] && data[id].locked);
    lockBtn.disabled = !active;
    lockBtn.classList.toggle("on", locked);
    lockBtn.textContent = locked ? "Unlock" : "Lock";
  }

  function ensureMapped(el, x, y) {
    const id = el.getAttribute("data-place");
    if (!id) return false;
    const block = ownershipBlock(el);
    if (block) {
      setStatus(placeStatusBase(el) + " · " + block);
      return false;
    }
    const prev = data[id] || {};
    return applyOne(el, { x, y, locked: !!prev.locked });
  }

  function exportJson() {
    pruneOwnershipData();
    document.querySelectorAll("[data-place].is-placed").forEach(syncEntry);
    pruneOwnershipData();
    const text = serialize();
    persistLocal();
    navigator.clipboard?.writeText(text).catch(() => {});
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "placement.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("exported — replace preview/…/placement.json");
  }

  function toggleLock() {
    if (!active) return;
    const id = active.getAttribute("data-place");
    if (!id) return;
    if (!data[id]) {
      const at = layerPercent(active);
      ensureMapped(active, at.x, at.y);
    }
    data[id].locked = !data[id].locked;
    active.classList.toggle("is-locked", !!data[id].locked);
    persistLocal();
    select(active);
  }

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = "rsp-place-bar";
    bar.innerHTML = `
      <span>Place · Draw region</span>
      <button type="button" data-act="clear-region">Clear region</button>
      <button type="button" data-act="whole-page">Whole page</button>
      <button type="button" data-act="lock" disabled>Lock</button>
      <button type="button" data-act="export">Export JSON</button>
      <button type="button" data-act="clear-local">Clear local</button>
      <span id="rsp-place-status">draw a region</span>
    `;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "lock") toggleLock();
      if (act === "export") exportJson();
      if (act === "clear-local") clearLocalSession();
      if (act === "clear-region") {
        region = null;
        scopeMode = "region";
        refreshEditScope();
        setStatus("draw a region");
      }
      if (act === "whole-page") {
        if (scopeMode === "whole") {
          scopeMode = "region";
          region = null;
          refreshEditScope();
          setStatus("draw a region");
        } else {
          scopeMode = "whole";
          region = null;
          refreshEditScope();
          setStatus("whole page · click an element");
        }
      }
    });
    document.body.appendChild(bar);
  }

  const ARROWS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  /** Full session reset → file-backed placement (never storage-only). */
  function clearLocalSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    data = {};
    setStatus("clearing session → reload from file…");
    // Preserve ?edit=1 (and any other query); drop only ephemeral cache busters if any
    window.setTimeout(() => {
      location.reload();
    }, 400);
  }

  function onKey(e) {
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest("#rsp-place-bar")) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t.isContentEditable) return;
    }
    if (!active) return;
    if (e.key === "l" || e.key === "L") {
      toggleLock();
      return;
    }
    const dir = ARROWS[e.key];
    if (!dir) return;
    const id = active.getAttribute("data-place");
    if (!id) return;
    if (data[id] && data[id].locked) {
      setStatus(placeStatusBase(active) + " · LOCKED — press L to unlock");
      return;
    }
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.5;
    const cur = data[id] || readFromDom(active) || layerPercent(active);
    ensureMapped(active, cur.x + dir[0] * step, cur.y + dir[1] * step);
    persistLocal();
    select(active);
  }

  function normalizeBox(a, b) {
    return {
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      right: Math.max(a.x, b.x),
      bottom: Math.max(a.y, b.y),
    };
  }

  function onRegionDown(e) {
    if (scopeMode !== "region" || dragging || drawingRegion) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest("#rsp-place-bar")) return;
    // Marquee must not start on an active placeable (element drag wins)
    const place = e.target.closest("[data-place]");
    if (place && place.classList.contains("is-edit")) return;
    if (e.button != null && e.button !== 0) return;

    drawingRegion = true;
    drawStart = clientToLayer(e.clientX, e.clientY);
    const { marquee } = ensureRegionChrome();
    paintBox(marquee, normalizeBox(drawStart, drawStart));
    marquee.style.display = "block";
    window.addEventListener("pointermove", onRegionMove, true);
    window.addEventListener("pointerup", onRegionUp, true);
    window.addEventListener("pointercancel", onRegionUp, true);
    e.preventDefault();
  }

  function onRegionMove(e) {
    if (!drawingRegion || !drawStart) return;
    const cur = clientToLayer(e.clientX, e.clientY);
    const { marquee } = ensureRegionChrome();
    paintBox(marquee, normalizeBox(drawStart, cur));
    marquee.style.display = "block";
  }

  function onRegionUp(e) {
    if (!drawingRegion || !drawStart) return;
    const cur = clientToLayer(e.clientX, e.clientY);
    const box = normalizeBox(drawStart, cur);
    drawingRegion = false;
    drawStart = null;
    window.removeEventListener("pointermove", onRegionMove, true);
    window.removeEventListener("pointerup", onRegionUp, true);
    window.removeEventListener("pointercancel", onRegionUp, true);
    ensureLayer({ resize: true });

    const { marquee } = ensureRegionChrome();
    marquee.style.display = "none";

    const w = box.right - box.left;
    const h = box.bottom - box.top;
    // Ignore tiny clicks — keep previous region if any
    if (w < 6 && h < 6) {
      updateRegionChrome();
      return;
    }
    region = box;
    refreshEditScope();
    const n = document.querySelectorAll("[data-place].is-edit").length;
    setStatus(`region · ${n} placeable${n === 1 ? "" : "s"} — drag to map`);
  }

  function enableEdit() {
    ensureLayer({ resize: true });
    ensureRegionChrome();
    buildBar();
    // Region-first: no aggressive whole-page is-edit until region or Whole page
    refreshEditScope();
    setStatus("draw a region");
    window.addEventListener("pointerdown", onRegionDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onWinResize);
  }

  function onWinResize() {
    ensureLayer({ resize: true });
    if (region) refreshEditScope();
    else updateRegionChrome();
  }

  function onDown(e) {
    const el = e.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    e.stopPropagation();
    e.preventDefault();
    select(el);
    const id = el.getAttribute("data-place");
    if (id && data[id] && data[id].locked) {
      setStatus(placeStatusBase(el) + " · LOCKED — unlock to move");
      return;
    }

    const block = ownershipBlock(el);
    if (block) {
      setStatus(placeStatusBase(el) + " · " + block);
      return;
    }

    if (!el.classList.contains("is-placed") || el.parentElement?.id !== "rsp-place-layer") {
      if (!mapOntoLayer(el)) {
        setStatus(
          placeStatusBase(el) + " · " + (ownershipBlock(el) || "map failed")
        );
        return;
      }
    }

    // Grab vs layout box on layer (offsetLeft/Top) — never AABB, never matrix walk
    const layout = placedLayoutViewport(el);
    dragging = true;
    grab = {
      el,
      dx: layout.x - e.clientX,
      dy: layout.y - e.clientY,
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch (_) {}
  }

  function onMove(e) {
    if (!dragging || !grab) return;
    e.preventDefault();
    // Cached layer size — no resize thrash on pointermove
    const layer = ensureLayer();
    const lr = layer.getBoundingClientRect();
    const rw = lr.width || 1;
    const rh = lr.height || 1;
    const left = e.clientX + grab.dx;
    const top = e.clientY + grab.dy;
    const x = ((left - lr.left) / rw) * 100;
    const y = ((top - lr.top) / rh) * 100;
    // Already on layer — coords only (no re-lift / freeze)
    writeCoords(grab.el, x, y);
    const id = grab.el.getAttribute("data-place");
    if (id && data[id]) {
      setStatus(
        `${placeStatusBase(grab.el)} · ${data[id].x.toFixed(1)}, ${data[id].y.toFixed(1)}`
      );
    }
  }

  function onUp() {
    if (!grab) return;
    const el = grab.el;
    dragging = false;
    grab = null;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    ensureLayer({ resize: true });
    syncEntry(el);
    persistLocal();
    select(el);
  }

  load().then(() => {
    if (EDIT) enableEdit();
  });

  window.RSPPlace = {
    get: () => JSON.parse(serialize()),
    apply: applyAll,
    isEdit: EDIT,
  };
})();
