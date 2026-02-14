const statusMeta = {
  low: {
    label: "スイスイ",
    icon: "assets/status-low.svg",
  },
  medium: {
    label: "普通",
    icon: "assets/status-medium.svg",
  },
  high: {
    label: "混雑",
    icon: "assets/status-high.svg",
  },
  very_high: {
    label: "大混雑",
    icon: "assets/status-very-high.svg",
  },
  unknown: {
    label: "データ不足",
    icon: "assets/status-unknown.svg",
  },
};

const nameOverrides = {
  "アミュプラザくまもと": "アミュプラザ熊本",
  "サクラマチ": "サクラマチ熊本",
  "鶴屋百貨店": "鶴屋",
};

const fallbackPlaces = {
  places: [
    { id: "ゆめタウン浜線", name: "ゆめタウン浜線", x: 56.7, y: 49.69 },
    { id: "アミュプラザくまもと", name: "アミュプラザくまもと", x: 32.7, y: 35.53 },
    { id: "イオンモール熊本", name: "イオンモール熊本", x: 67.5, y: 73.84 },
    { id: "サクラマチ", name: "サクラマチ", x: 41.89, y: 28.17 },
    { id: "鶴屋百貨店", name: "鶴屋百貨店", x: 47.77, y: 26.56 },
  ],
};

const fallbackLatest = {
  updated_at: "",
  statuses: {
    "ゆめタウン浜線": "unknown",
    "アミュプラザくまもと": "unknown",
    "イオンモール熊本": "unknown",
    "サクラマチ": "unknown",
    "鶴屋百貨店": "unknown",
  },
};

const fallbackLatestDetail = {
  updated_at: "",
  malls: {},
};

const fetchJson = async (url, fallback) => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  } catch (err) {
    console.warn(`failed to load ${url}`, err);
    return fallback;
  }
};


const formatDateTime = (iso) => {
  if (!iso) return "----";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "----";
  const text = date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${text} JST`;
};

const formatDelay = (delaySec) => {
  if (delaySec === null || delaySec === undefined) return "遅延情報なし";
  const value = Number(delaySec);
  if (Number.isNaN(value)) return "遅延情報なし";
  const minutes = Math.max(0, Math.floor(value / 60));
  return `遅延 ${minutes}分`;
};

const render = async () => {
  const [placesData, latest, latestDetail] = await Promise.all([
    fetchJson("data/places.json", fallbackPlaces),
    fetchJson("data/latest.json", fallbackLatest),
    fetchJson("data/latest_detail.json", fallbackLatestDetail),
  ]);

  const updatedEl = document.getElementById("updated-time");
  if (updatedEl) {
    const updatedAt = latest.updated_at || latestDetail.updated_at || "";
    updatedEl.textContent = formatDateTime(updatedAt);
  }

  const overlay = document.getElementById("map-overlay");
  overlay.innerHTML = "";
  const mobileList = document.getElementById("mobile-list");
  if (mobileList) mobileList.innerHTML = "";

  const pointerLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  pointerLayer.classList.add("pointer-layer");
  pointerLayer.setAttribute("width", "100%");
  pointerLayer.setAttribute("height", "100%");
  pointerLayer.setAttribute("preserveAspectRatio", "none");

  const bubbleLayer = document.createElement("div");
  bubbleLayer.className = "bubble-layer";

  overlay.appendChild(pointerLayer);
  overlay.appendChild(bubbleLayer);

  const entries = placesData.places.map((place) => {
    const detail = latestDetail.malls?.[place.id] ?? null;
    const statusKey = latest.statuses[place.id] || detail?.status || "unknown";
    const meta = statusMeta[statusKey] || statusMeta.unknown;

    const bubble = document.createElement("div");
    bubble.className = "bubble has-line";
    bubble.dataset.status = statusKey;
    bubble.dataset.anchorX = place.x;
    bubble.dataset.anchorY = place.y;
    bubble.dataset.side = place.x < 50 ? "left" : "right";

    const icon = document.createElement("img");
    icon.src = meta.icon;
    icon.alt = meta.label;

    const content = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = nameOverrides[place.name] || place.name;

    const status = document.createElement("div");
    status.className = "status";
    status.textContent = meta.label;

    const delay = document.createElement("div");
    delay.className = "delay";
    delay.textContent = formatDelay(detail?.delay_sec);

    content.appendChild(title);
    content.appendChild(status);
    content.appendChild(delay);

    bubble.appendChild(icon);
    bubble.appendChild(content);

    bubbleLayer.appendChild(bubble);

    if (mobileList) {
      const card = document.createElement("div");
      card.className = "mobile-card";
      card.dataset.status = statusKey;
      const cardIcon = document.createElement("img");
      cardIcon.src = meta.icon;
      cardIcon.alt = meta.label;

      const cardContent = document.createElement("div");
      const cardTitle = document.createElement("div");
      cardTitle.className = "title";
      cardTitle.textContent = nameOverrides[place.name] || place.name;
      const cardStatus = document.createElement("div");
      cardStatus.className = "status";
      cardStatus.textContent = meta.label;

      const cardDelay = document.createElement("div");
      cardDelay.className = "delay";
      cardDelay.textContent = formatDelay(detail?.delay_sec);

      cardContent.appendChild(cardTitle);
      cardContent.appendChild(cardStatus);
      cardContent.appendChild(cardDelay);

      card.appendChild(cardIcon);
      card.appendChild(cardContent);
      mobileList.appendChild(card);
    }
    return { place, bubble };
  });

  const layoutSide = (list, side, rect) => {
    if (!list.length) return;
    const pad = 36;
    const available = Math.max(0, rect.height - pad * 2);
    const minGap = 130;
    let gap = 0;
    if (list.length > 1) {
      gap = minGap;
      const maxGap = available / (list.length - 1);
      if (gap > maxGap) gap = maxGap;
    }
    const start = pad + (available - gap * (list.length - 1)) / 2;
    list.forEach((entry, index) => {
      const top = start + index * gap;
      entry.bubble.style.top = `${Math.max(pad, top)}px`;
      entry.bubble.classList.toggle("side-right", side === "right");
      entry.bubble.classList.toggle("side-left", side === "left");
      entry.bubble.dataset.side = side;
    });
  };

  const layoutAndDraw = () => {
    const rect = overlay.getBoundingClientRect();
    const left = entries.filter((entry) => entry.place.x < 50).sort((a, b) => a.place.y - b.place.y);
    const right = entries.filter((entry) => entry.place.x >= 50).sort((a, b) => a.place.y - b.place.y);
    layoutSide(left, "left", rect);
    layoutSide(right, "right", rect);

    pointerLayer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    pointerLayer.innerHTML = "";
    const bubbles = overlay.querySelectorAll(".bubble");
    bubbles.forEach((bubble) => {
      const anchorX = (parseFloat(bubble.dataset.anchorX) / 100) * rect.width;
      const anchorY = (parseFloat(bubble.dataset.anchorY) / 100) * rect.height;
      const bubbleRect = bubble.getBoundingClientRect();
      const side = bubble.dataset.side === "left" ? "left" : "right";
      const targetX =
        side === "left"
          ? bubbleRect.right - rect.left - 8
          : bubbleRect.left - rect.left + 8;
      const targetY = bubbleRect.top - rect.top + bubbleRect.height * 0.55;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", anchorX);
      line.setAttribute("y1", anchorY);
      line.setAttribute("x2", targetX);
      line.setAttribute("y2", targetY);
      pointerLayer.appendChild(line);

      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", anchorX);
      dot.setAttribute("cy", anchorY);
      dot.setAttribute("r", "5");
      pointerLayer.appendChild(dot);
    });
  };

  requestAnimationFrame(layoutAndDraw);
  window.addEventListener("resize", layoutAndDraw, { passive: true });
};

render().catch((err) => {
  console.error(err);
});
