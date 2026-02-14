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

const MAP_BASE_WIDTH = 1600;
const MAP_BASE_HEIGHT = 900;
const MAP_BASE_SCALE = 0.95;

const bubbleLayoutOverrides = {
  "鶴屋百貨店": {
    side: "left",
    vertical: "top",
    anchorYPx: 133,
    edgeFactor: 1,
    gapX: 6,
  },
  "サクラマチ": {
    side: "left",
    vertical: "top",
    anchorYPx: 246,
    edgeFactor: 1,
    gapX: 6,
  },
  "アミュプラザくまもと": {
    side: "left",
    vertical: "bottom",
    layoutMode: "anchor",
    anchorOffsetY: 14,
  },
  "サンリブシティくまなん": {
    side: "left",
    vertical: "bottom",
    layoutMode: "anchor",
    anchorOffsetY: 18,
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
    { id: "サンリブシティくまなん", name: "サンリブシティくまなん", x: 60.5, y: 62.0 },
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
    "サンリブシティくまなん": "unknown",
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

const chartPalette = [
  "#1db455",
  "#f1c842",
  "#e64a3b",
  "#0b4aa3",
  "#8f1f14",
  "#1664c8",
  "#2f87e0",
  "#6a7076",
];

const buildBubble = (place, statusKey, meta, detail, side) => {
  const bubble = document.createElement("div");
  bubble.className = `bubble has-line side-${side}`;
  bubble.dataset.status = statusKey;

  const icon = document.createElement("img");
  icon.src = meta.icon;
  icon.alt = meta.label;

  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = nameOverrides[place.name] || place.name;

  const status = document.createElement("div");
  status.className = "status";
  status.textContent = meta.label;

  const delay = document.createElement("div");
  delay.className = "delay";
  delay.textContent = formatDelay(detail?.delay_sec);

  body.append(title, status, delay);
  bubble.append(icon, body);

  return bubble;
};

const layoutBubbles = (overlay, items) => {
  const overlayHeight = overlay.offsetHeight || overlay.getBoundingClientRect().height || 1;
  const overlayWidth = overlay.offsetWidth || overlay.getBoundingClientRect().width || 1;
  const margin = 14;
  const gap = 12;
  const horizontalGap = 12;
  const edgeFactorDefault = 0.1;
  const groups = {
    "left-top": [],
    "left-bottom": [],
    "right-top": [],
    "right-bottom": [],
  };

  items.forEach((item) => {
    const bubbleHeight = item.bubble.offsetHeight || item.bubble.getBoundingClientRect().height || 0;
    const bubbleWidth = item.bubble.offsetWidth || item.bubble.getBoundingClientRect().width || 0;
    if (item.layoutMode === "anchor") {
      const anchorX = (item.place.x / 100) * overlayWidth;
      const anchorY = (item.place.y / 100) * overlayHeight;
      const offsetY = item.layoutAnchorOffsetY ?? 12;
      const left = Math.min(
        Math.max(margin, anchorX - bubbleWidth / 2),
        overlayWidth - margin - bubbleWidth
      );
      const top = Math.min(
        Math.max(margin, anchorY + offsetY),
        overlayHeight - margin - bubbleHeight
      );
      item.bubble.style.left = `${Math.round(left)}px`;
      item.bubble.style.top = `${Math.round(top)}px`;
      return;
    }

    const anchorY = item.layoutAnchorYPx ?? (item.place.y / 100) * overlayHeight;
    const key = `${item.side}-${item.vertical}`;
    if (!groups[key]) return;
    groups[key].push({ ...item, bubbleHeight, bubbleWidth, anchorY });
  });

  const setHorizontal = (item) => {
    const anchorX = (item.place.x / 100) * overlayWidth;
    const gapX = item.layoutGapX ?? horizontalGap;
    const maxLeft = Math.max(margin, overlayWidth - item.bubbleWidth - margin);
    const closeLeft =
      item.side === "left"
        ? Math.min(maxLeft, Math.max(margin, anchorX - item.bubbleWidth - gapX))
        : Math.min(maxLeft, Math.max(margin, anchorX + gapX));
    const edgeFactor = item.layoutEdgeFactor ?? edgeFactorDefault;
    const left =
      item.side === "left"
        ? margin + (closeLeft - margin) * edgeFactor
        : closeLeft + (maxLeft - closeLeft) * edgeFactor;
    item.bubble.style.left = `${Math.round(left)}px`;
  };

  const placeTopGroup = (group) => {
    group.sort((a, b) => a.anchorY - b.anchorY);
    let cursor = margin;
    group.forEach((item) => {
      const desired = item.anchorY - item.bubbleHeight / 2;
      const top = Math.max(desired, cursor);
      item.top = top;
      cursor = top + item.bubbleHeight + gap;
    });

    const overflow = cursor - gap - (overlayHeight - margin);
    if (overflow > 0) {
      group.forEach((item) => {
        item.top = Math.max(margin, item.top - overflow);
      });
    }

    group.forEach((item) => {
      item.bubble.style.top = `${Math.round(item.top)}px`;
      setHorizontal(item);
    });
  };

  const placeBottomGroup = (group) => {
    group.sort((a, b) => b.anchorY - a.anchorY);
    let cursor = overlayHeight - margin;
    group.forEach((item) => {
      const desired = item.anchorY - item.bubbleHeight / 2;
      const top = Math.min(desired, cursor - item.bubbleHeight);
      item.top = top;
      cursor = top - gap;
    });

    if (group.length) {
      const minTop = Math.min(...group.map((item) => item.top));
      const underflow = margin - minTop;
      if (underflow > 0) {
        group.forEach((item) => {
          item.top += underflow;
        });
      }
    }

    group.forEach((item) => {
      item.bubble.style.top = `${Math.round(item.top)}px`;
      setHorizontal(item);
    });
  };

  placeTopGroup(groups["left-top"]);
  placeTopGroup(groups["right-top"]);
  placeBottomGroup(groups["left-bottom"]);
  placeBottomGroup(groups["right-bottom"]);
};

const drawLines = (overlay, pointerLayer, items) => {
  const rect = overlay.getBoundingClientRect();
  const width = overlay.offsetWidth || rect.width || 1;
  const height = overlay.offsetHeight || rect.height || 1;
  if (!width || !height) return;

  const scaleX = rect.width / width;
  const scaleY = rect.height / height;
  pointerLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  pointerLayer.innerHTML = "";

  items.forEach(({ place, bubble }) => {
    const anchorX = (place.x / 100) * width;
    const anchorY = (place.y / 100) * height;
    const bubbleRect = bubble.getBoundingClientRect();
    const localLeft = (bubbleRect.left - rect.left) / scaleX;
    const localTop = (bubbleRect.top - rect.top) / scaleY;
    const localRight = localLeft + bubbleRect.width / scaleX;
    const localBottom = localTop + bubbleRect.height / scaleY;
    const targetX = Math.min(Math.max(anchorX, localLeft), localRight);
    const targetY = Math.min(Math.max(anchorY, localTop), localBottom);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", anchorX);
    line.setAttribute("y1", anchorY);
    line.setAttribute("x2", targetX);
    line.setAttribute("y2", targetY);
    pointerLayer.appendChild(line);

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", anchorX);
    dot.setAttribute("cy", anchorY);
    dot.setAttribute("r", "4");
    pointerLayer.appendChild(dot);
  });
};

const buildHourLabels = (startHour, endHour) => {
  const labels = [];
  for (let h = startHour; h <= endHour; h += 1) {
    labels.push(String(h).padStart(2, "0"));
  }
  return labels;
};

const buildSeriesForHours = (labels, hours, values) => {
  const map = new Map();
  if (Array.isArray(hours) && Array.isArray(values)) {
    hours.forEach((h, idx) => {
      map.set(String(h).padStart(2, "0"), values[idx]);
    });
  }
  return labels.map((label) => (label === "24" ? null : map.get(label) ?? null));
};

const renderTrend = async () => {
  const trend = document.getElementById("trend");
  const trendMeta = document.getElementById("trend-meta");
  const canvas = document.getElementById("daily-delay-chart");
  if (!trend || !canvas) return;

  const daily = await fetchJson("data/daily_delay.json", null);
  if (!daily || !daily.series || !daily.hours || typeof Chart === "undefined") {
    trend.classList.add("hidden");
    return;
  }

  if (trendMeta) {
    trendMeta.textContent = `${daily.date ?? "--"} (${daily.timezone ?? "JST"}) / 05-24時 / 遅延中央値(分)`;
  }

  const labels = buildHourLabels(5, 24);
  const datasets = Object.entries(daily.series).map(([mall, values], idx) => {
    const color = chartPalette[idx % chartPalette.length];
    const seriesValues = buildSeriesForHours(labels, daily.hours, values);
    return {
      label: mall,
      data: seriesValues,
      borderColor: color,
      backgroundColor: color,
      tension: 0.3,
      spanGaps: false,
      pointRadius: 2,
      pointHoverRadius: 4,
    };
  });

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              if (value === null || value === undefined) return `${context.dataset.label}: -`;
              return `${context.dataset.label}: ${value}分`;
            },
          },
        },
      },
      scales: {
        y: {
          title: { display: true, text: "遅延(分)" },
          beginAtZero: true,
        },
        x: {
          title: { display: true, text: "時間帯" },
          ticks: { maxTicksLimit: 12 },
        },
      },
    },
  });
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

const initPan = () => {
  const map = document.getElementById("map");
  const viewport = document.getElementById("map-viewport");
  if (!map || !viewport) return;

  map.style.setProperty("--map-base-width", `${MAP_BASE_WIDTH}px`);
  map.style.setProperty("--map-base-height", `${MAP_BASE_HEIGHT}px`);

  let panX = 0;
  let panY = 0;
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let scale = MAP_BASE_SCALE;

  const applyTransform = () => {
    const rect = map.getBoundingClientRect();
    const viewWidth = MAP_BASE_WIDTH * scale;
    const viewHeight = MAP_BASE_HEIGHT * scale;
    const maxX = Math.max(0, (viewWidth - rect.width) / 2);
    const maxY = Math.max(0, (viewHeight - rect.height) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
    viewport.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${scale})`;
  };

  const updateScale = () => {
    scale = MAP_BASE_SCALE;
    applyTransform();
  };

  const onPointerDown = (event) => {
    isDragging = true;
    map.classList.add("dragging");
    map.setPointerCapture(event.pointerId);
    startX = event.clientX - panX;
    startY = event.clientY - panY;
  };

  const onPointerMove = (event) => {
    if (!isDragging) return;
    panX = event.clientX - startX;
    panY = event.clientY - startY;
    applyTransform();
  };

  const onPointerUp = () => {
    isDragging = false;
    map.classList.remove("dragging");
  };

  map.addEventListener("pointerdown", onPointerDown);
  map.addEventListener("pointermove", onPointerMove);
  map.addEventListener("pointerup", onPointerUp);
  map.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", updateScale);

  updateScale();
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
  const pointerLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  pointerLayer.classList.add("pointer-layer");
  pointerLayer.setAttribute("width", "100%");
  pointerLayer.setAttribute("height", "100%");
  pointerLayer.setAttribute("preserveAspectRatio", "none");
  overlay.appendChild(pointerLayer);

  const items = [];
  placesData.places.forEach((place) => {
    const detail = latestDetail.malls?.[place.id] ?? null;
    const statusKey = latest.statuses[place.id] || detail?.status || "unknown";
    const meta = statusMeta[statusKey] || statusMeta.unknown;
    const override = bubbleLayoutOverrides[place.id] || bubbleLayoutOverrides[place.name];
    const side = override?.side ?? (place.x < 50 ? "left" : "right");
    const vertical = override?.vertical ?? (place.y < 50 ? "top" : "bottom");
    const bubble = buildBubble(place, statusKey, meta, detail, side);
    overlay.appendChild(bubble);
    items.push({
      place,
      bubble,
      side,
      vertical,
      layoutAnchorYPx: override?.anchorYPx ?? null,
      layoutEdgeFactor: override?.edgeFactor ?? null,
      layoutGapX: override?.gapX ?? null,
      layoutMode: override?.layoutMode ?? null,
      layoutAnchorOffsetY: override?.anchorOffsetY ?? null,
    });
  });

  await renderTrend();
  initPan();

  const updateLayout = () => {
    layoutBubbles(overlay, items);
    drawLines(overlay, pointerLayer, items);
  };

  requestAnimationFrame(updateLayout);
  window.addEventListener("resize", updateLayout, { passive: true });
};

render().catch((err) => {
  console.error(err);
});
