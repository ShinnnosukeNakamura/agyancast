import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const STATUS_META = {
  low: {
    label: "スイスイ",
    icon: "/assets/status-low.svg",
    color: "#1db455",
  },
  medium: {
    label: "普通",
    icon: "/assets/status-medium.svg",
    color: "#f1c842",
  },
  high: {
    label: "混雑",
    icon: "/assets/status-high.svg",
    color: "#e64a3b",
  },
  very_high: {
    label: "大混雑",
    icon: "/assets/status-very-high.svg",
    color: "#8f1f14",
  },
  unknown: {
    label: "データ不足",
    icon: "/assets/status-unknown.svg",
    color: "#9aa0a6",
  },
};

const NAME_OVERRIDES = {
  "アミュプラザくまもと": "アミュプラザ熊本",
  "サクラマチ": "サクラマチ熊本",
  "鶴屋百貨店": "鶴屋",
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

const FALLBACK_PLACES = {
  places: [
    { id: "ゆめタウン浜線", name: "ゆめタウン浜線", x: 56.7, y: 49.69 },
    { id: "アミュプラザくまもと", name: "アミュプラザくまもと", x: 32.7, y: 35.53 },
    { id: "イオンモール熊本", name: "イオンモール熊本", x: 67.5, y: 73.84 },
    { id: "サクラマチ", name: "サクラマチ", x: 41.89, y: 28.17 },
    { id: "サンリブシティくまなん", name: "サンリブシティくまなん", x: 41.92, y: 45.11 },
    { id: "鶴屋百貨店", name: "鶴屋百貨店", x: 47.77, y: 26.56 },
  ],
};

const FALLBACK_LATEST = {
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

const FALLBACK_LATEST_DETAIL = {
  updated_at: "",
  malls: {},
};

const FAVORITES_STORAGE_KEY = "agyancast.favorite_malls";

const fetchJson = async (url, fallback) => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await res.json();
  } catch (error) {
    console.warn(`failed to load ${url}`, error);
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

const STATUS_PRIORITY = {
  very_high: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const FAVORABLE_PRIORITY = {
  low: 0,
  medium: 1,
  high: 2,
  very_high: 3,
  unknown: 4,
};

const toMinutes = (delaySec) => {
  const value = Number(delaySec);
  if (Number.isNaN(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(value / 60));
};

const formatHourLabel = (hourText) => {
  if (hourText === null || hourText === undefined) return "--";
  const hour = Number(hourText);
  if (Number.isNaN(hour)) return "--";
  return `${String(hour).padStart(2, "0")}時台`;
};

const pickBestHourOverall = (daily, itemIds) => {
  if (!daily?.hours || !daily?.series) return null;
  const idSet = new Set(itemIds);
  const hourValues = new Map();
  Object.entries(daily.series).forEach(([mallId, values]) => {
    if (!idSet.has(mallId) || !Array.isArray(values)) return;
    values.forEach((value, idx) => {
      const hourText = daily.hours[idx];
      const hour = Number(hourText);
      if (hour < 5 || hour > 23 || value === null || value === undefined) return;
      if (!hourValues.has(hourText)) hourValues.set(hourText, []);
      hourValues.get(hourText).push(Number(value));
    });
  });
  let bestHour = null;
  let bestScore = Number.POSITIVE_INFINITY;
  hourValues.forEach((values, hourText) => {
    if (!values.length) return;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (avg < bestScore) {
      bestScore = avg;
      bestHour = hourText;
    }
  });
  return bestHour;
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

const layoutBubbles = (overlay, items) => {
  const overlayHeight = overlay.offsetHeight || overlay.getBoundingClientRect().height || 1;
  const overlayWidth = overlay.offsetWidth || overlay.getBoundingClientRect().width || 1;
  const margin = 18;
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
    const bubble = item.element;
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const bubbleHeight = rect.height || 0;
    const bubbleWidth = rect.width || 0;

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
      bubble.style.left = `${Math.round(left)}px`;
      bubble.style.top = `${Math.round(top)}px`;
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
    item.element.style.left = `${Math.round(left)}px`;
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
      item.element.style.top = `${Math.round(item.top)}px`;
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
      item.element.style.top = `${Math.round(item.top)}px`;
      setHorizontal(item);
    });
  };

  placeTopGroup(groups["left-top"]);
  placeTopGroup(groups["right-top"]);
  placeBottomGroup(groups["left-bottom"]);
  placeBottomGroup(groups["right-bottom"]);
};

const drawPointers = (overlay, pointerLayer, items) => {
  const rect = overlay.getBoundingClientRect();
  const width = overlay.offsetWidth || rect.width || 1;
  const height = overlay.offsetHeight || rect.height || 1;
  if (!width || !height) return;

  const scaleX = rect.width / width;
  const scaleY = rect.height / height;
  pointerLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  pointerLayer.innerHTML = "";

  items.forEach((item) => {
    const bubble = item.element;
    if (!bubble) return;
    const anchorX = (item.place.x / 100) * width;
    const anchorY = (item.place.y / 100) * height;
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

const MapView = ({ items }) => {
  const mapRef = useRef(null);
  const viewportRef = useRef(null);
  const overlayRef = useRef(null);
  const pointerRef = useRef(null);

  useEffect(() => {
    const map = mapRef.current;
    const viewport = viewportRef.current;
    if (!map || !viewport) return;

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

    return () => {
      map.removeEventListener("pointerdown", onPointerDown);
      map.removeEventListener("pointermove", onPointerMove);
      map.removeEventListener("pointerup", onPointerUp);
      map.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const pointerLayer = pointerRef.current;
    if (!overlay || !pointerLayer) return;

    const update = () => {
      const layoutItems = items
        .map((item) => {
          const place = item.place;
          const element = overlay.querySelector(`[data-id="${place.id}"]`);
          if (!element) return null;
          const override = bubbleLayoutOverrides[place.id] || bubbleLayoutOverrides[place.name];
          const side = override?.side ?? (place.x < 50 ? "left" : "right");
          const vertical = override?.vertical ?? (place.y < 50 ? "top" : "bottom");
          return {
            place,
            element,
            side,
            vertical,
            layoutAnchorYPx: override?.anchorYPx ?? null,
            layoutEdgeFactor: override?.edgeFactor ?? null,
            layoutGapX: override?.gapX ?? null,
            layoutMode: override?.layoutMode ?? null,
            layoutAnchorOffsetY: override?.anchorOffsetY ?? null,
          };
        })
        .filter(Boolean);

      layoutBubbles(overlay, layoutItems);
      drawPointers(overlay, pointerLayer, layoutItems);
    };

    let raf = requestAnimationFrame(update);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("resize", onResize);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(onResize).catch(() => {});
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [items]);

  return (
    <section className="panel map-panel" id="map-section">
      <div className="panel-header">
        <div>
          <div className="panel-title">混雑マップ</div>
          <div className="panel-sub">地図をドラッグして確認できます</div>
        </div>
        <span className="panel-chip">阿蘇方面 →</span>
      </div>
      <div
        className="map"
        ref={mapRef}
        style={{
          "--map-base-width": `${MAP_BASE_WIDTH}px`,
          "--map-base-height": `${MAP_BASE_HEIGHT}px`,
        }}
      >
        <div className="map-viewport" ref={viewportRef}>
          <div className="map-bg" />
          <div className="map-overlay" ref={overlayRef}>
            <svg
              className="pointer-layer"
              ref={pointerRef}
              width="100%"
              height="100%"
              preserveAspectRatio="none"
            />
            {items.map((item) => {
              const place = item.place;
              return (
                <div
                  key={item.id}
                  className={`bubble status-${item.statusKey}`}
                  data-id={place.id}
                >
                  <div className="bubble-icon">
                    <img src={item.meta.icon} alt={item.meta.label} />
                  </div>
                  <div className="bubble-body">
                    <div className="bubble-title">{item.displayName}</div>
                    <div className="bubble-status">{item.meta.label}</div>
                    <div className="bubble-delay">{item.delayLabel}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const MallList = ({ items, favoritesSet, onToggleFavorite }) => (
  <section className="panel list-panel" id="list-section">
    <div className="panel-header">
      <div>
        <div className="panel-title">モール混雑一覧</div>
        <div className="panel-sub">天気予報のようにサッと確認</div>
      </div>
      <span className="panel-chip muted">予測は準備中</span>
    </div>
    <div className="list-table">
      <div className="list-row list-header">
        <div className="list-cell">施設</div>
        <div className="list-cell">混雑度</div>
        <div className="list-cell">遅延</div>
        <div className="list-cell">1時間後</div>
        <div className="list-cell">3時間後</div>
      </div>
      {items.map((item) => {
        const isFavorite = favoritesSet.has(item.id);
        return (
          <div className="list-row" data-status={item.statusKey} key={item.id}>
            <div className="list-cell list-name">
              <button
                type="button"
                className={`favorite-btn ${isFavorite ? "active" : ""}`}
                onClick={() => onToggleFavorite(item.id)}
                aria-label={`${item.displayName}をお気に入り`}
              >
                {isFavorite ? "★" : "☆"}
              </button>
              <span className="list-dot" style={{ background: item.meta.color }} />
              <span className="list-name-text">{item.displayName}</span>
            </div>
            <div className="list-cell list-status">
              <span className="list-pill">{item.meta.label}</span>
            </div>
            <div className="list-cell list-delay">{item.delayLabel}</div>
            <div className="list-cell list-forecast">準備中</div>
            <div className="list-cell list-forecast">準備中</div>
          </div>
        );
      })}
    </div>
  </section>
);

const TrendChart = ({ daily }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!daily || !canvasRef.current) return;
    const labels = buildHourLabels(5, 24);
    const palette = [
      "#1db455",
      "#f1c842",
      "#e64a3b",
      "#0b4aa3",
      "#8f1f14",
      "#1664c8",
      "#2f87e0",
      "#6a7076",
    ];
    const datasets = Object.entries(daily.series ?? {}).map(([mall, values], idx) => {
      const color = palette[idx % palette.length];
      const seriesValues = buildSeriesForHours(labels, daily.hours, values);
      return {
        label: mall,
        data: seriesValues,
        borderColor: color,
        backgroundColor: color,
        tension: 0.35,
        spanGaps: false,
        pointRadius: 2,
        pointHoverRadius: 4,
      };
    });

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvasRef.current, {
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

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [daily]);

  if (!daily) {
    return null;
  }

  return (
    <section className="panel trend-panel" id="trend-section">
      <div className="panel-header">
        <div>
          <div className="panel-title">今日の混雑推移</div>
          <div className="panel-sub">
            {daily.date ?? "--"} ({daily.timezone ?? "JST"}) / 05-24時
          </div>
        </div>
      </div>
      <div className="trend-chart">
        <div className="trend-scroll">
          <canvas ref={canvasRef} height="200" />
        </div>
      </div>
    </section>
  );
};

const App = () => {
  const [places, setPlaces] = useState(FALLBACK_PLACES.places);
  const [latest, setLatest] = useState(FALLBACK_LATEST);
  const [latestDetail, setLatestDetail] = useState(FALLBACK_LATEST_DETAIL);
  const [daily, setDaily] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [placesData, latestData, latestDetailData, dailyData] = await Promise.all([
        fetchJson("/data/places.json", FALLBACK_PLACES),
        fetchJson("/data/latest.json", FALLBACK_LATEST),
        fetchJson("/data/latest_detail.json", FALLBACK_LATEST_DETAIL),
        fetchJson("/data/daily_delay.json", null),
      ]);
      if (!active) return;
      setPlaces(placesData?.places ?? FALLBACK_PLACES.places);
      setLatest(latestData ?? FALLBACK_LATEST);
      setLatestDetail(latestDetailData ?? FALLBACK_LATEST_DETAIL);
      setDaily(dailyData);
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setFavorites(parsed);
    } catch (error) {
      console.warn("failed to load favorites", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch (error) {
      console.warn("failed to save favorites", error);
    }
  }, [favorites]);

  const updatedAt = latest.updated_at || latestDetail.updated_at || "";
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);
  const mallItems = useMemo(() => {
    return places.map((place) => {
      const detail = latestDetail.malls?.[place.id] ?? null;
      const statusKey = latest.statuses[place.id] || detail?.status || "unknown";
      const meta = STATUS_META[statusKey] || STATUS_META.unknown;
      const delaySec = detail?.delay_sec;
      return {
        id: place.id,
        place,
        statusKey,
        meta,
        displayName: NAME_OVERRIDES[place.name] || place.name,
        delayLabel: formatDelay(delaySec),
        delayMinutes: toMinutes(delaySec),
      };
    });
  }, [places, latest, latestDetail]);

  const filteredItems = useMemo(() => {
    if (!favoriteOnly) return mallItems;
    return mallItems.filter((item) => favoritesSet.has(item.id));
  }, [mallItems, favoriteOnly, favoritesSet]);

  const listItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const left = STATUS_PRIORITY[a.statusKey] ?? 99;
      const right = STATUS_PRIORITY[b.statusKey] ?? 99;
      if (left !== right) return left - right;
      return a.displayName.localeCompare(b.displayName, "ja");
    });
  }, [filteredItems]);

  const statusSummary = useMemo(() => {
    const counts = {
      low: 0,
      medium: 0,
      high: 0,
      very_high: 0,
      unknown: 0,
    };
    mallItems.forEach((item) => {
      const key = item.statusKey;
      if (counts[key] === undefined) counts.unknown += 1;
      else counts[key] += 1;
    });
    return counts;
  }, [mallItems]);
  const crowdedCount = statusSummary.high + statusSummary.very_high;

  const recommendedNow = useMemo(() => {
    return [...filteredItems]
      .sort((a, b) => {
        const left = FAVORABLE_PRIORITY[a.statusKey] ?? 99;
        const right = FAVORABLE_PRIORITY[b.statusKey] ?? 99;
        if (left !== right) return left - right;
        if (a.delayMinutes !== b.delayMinutes) return a.delayMinutes - b.delayMinutes;
        return a.displayName.localeCompare(b.displayName, "ja");
      })
      .slice(0, 2);
  }, [filteredItems]);

  const bestHourOverall = useMemo(() => {
    const ids = filteredItems.map((item) => item.id);
    return pickBestHourOverall(daily, ids);
  }, [daily, filteredItems]);

  const toggleFavorite = (id) => {
    setFavorites((prev) => {
      if (prev.includes(id)) return prev.filter((value) => value !== id);
      return [...prev, id];
    });
  };

  const shareCurrentStatus = async () => {
    const url = window.location.href;
    const head = recommendedNow[0]?.displayName ?? "各モール";
    const text = `熊本市混雑ナビ: 今行くなら${head} / 狙い目 ${formatHourLabel(bestHourOverall)} (${formatDateTime(updatedAt)})`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "熊本市 混雑ナビ",
          text,
          url,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app-shell">
      <div className="sky-layer sky-layer-one" />
      <div className="sky-layer sky-layer-two" />
      <div className="app">
        <header className="weather-hero">
          <div className="hero-top">
            <div className="header-title">
              <span className="header-city">熊本市</span>
              <span className="header-sub">混雑ナビ</span>
            </div>
            <div className="hero-time-card">
              <span className="meta-label">最終更新</span>
              <span className="meta-value">{formatDateTime(updatedAt)}</span>
            </div>
          </div>
          <div className="hero-caption">
            主要モールの遅延状況を30分ごとに更新
          </div>
        </header>
        <section className="decision-strip" aria-label="recommendation">
          <div className="decision-card now">
            <span className="decision-label">今行くなら</span>
            <strong className="decision-value">
              {recommendedNow.length
                ? recommendedNow.map((item) => item.displayName).join(" / ")
                : "データ準備中"}
            </strong>
            <span className="decision-note">
              {crowdedCount > 0 ? `混雑スポット ${crowdedCount}件` : "比較的おだやかです"}
            </span>
            <span className="decision-trial">※試験表示（参考値）</span>
          </div>
          <div className="decision-card time">
            <span className="decision-label">狙い目時間</span>
            <strong className="decision-value">{formatHourLabel(bestHourOverall)}</strong>
            <span className="decision-note">過去データの遅延中央値ベース</span>
            <span className="decision-trial">※試験表示（参考値）</span>
          </div>
        </section>
        <section className="hero-actions" aria-label="common actions">
          <button
            type="button"
            className={`action-btn ${favoriteOnly ? "active" : ""}`}
            onClick={() => setFavoriteOnly((prev) => !prev)}
          >
            {favoriteOnly ? "お気に入りのみ表示中" : "お気に入りのみ表示"}
          </button>
          <button type="button" className="action-btn secondary" onClick={shareCurrentStatus}>
            共有
          </button>
        </section>

        <main className="content">
          <MapView items={filteredItems} />
          <MallList
            items={listItems}
            favoritesSet={favoritesSet}
            onToggleFavorite={toggleFavorite}
          />
          <TrendChart daily={daily} />
        </main>

        <nav className="bottom-nav">
          <a href="#map-section" className="nav-item">
            <span className="nav-dot" />
            <span>マップ</span>
          </a>
          <a href="#list-section" className="nav-item">
            <span className="nav-dot" />
            <span>一覧</span>
          </a>
          <a href="#trend-section" className="nav-item">
            <span className="nav-dot" />
            <span>推移</span>
          </a>
        </nav>
      </div>
    </div>
  );
};

export default App;
