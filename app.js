(function () {
  "use strict";

  const TOPIC_PREFIX = "yichun777";
  const ALL_TOPIC = TOPIC_PREFIX + "/#";
  const SYSTEM_STATE_TOPIC = TOPIC_PREFIX + "/system_state";
  const LAYOUT_TOPIC = TOPIC_PREFIX + "/_dashboard_layout";

  const GRID_COLS = 4;

  const WIDGET_DEFAULTS = {
    button: { w: 2, h: 2, config: { label: "按鈕", topic: "", onText: "on", offText: "off", color: "#33ffff" } },
    switch: { w: 2, h: 2, config: { label: "開關", topic: "", onValue: "true", offValue: "false", color: "#2f8f4e" } },
    slider: { w: 4, h: 2, config: { label: "拉桿", topic: "", min: 0, max: 100, color: "#ff0000" } },
    led: { w: 2, h: 2, config: { label: "LED", topic: "", onValue: "on", color: "#33ffff" } },
    label: { w: 4, h: 1, config: { label: "標籤", topic: "", unit: "" } },
  };

  const WIDGET_TYPE_NAMES = { button: "按鈕", switch: "開關", slider: "拉桿", led: "LED 燈", label: "標籤" };

  const el = {
    broker: document.getElementById("broker"),
    port: document.getElementById("port"),
    path: document.getElementById("path"),
    secure: document.getElementById("secure"),
    btnConnect: document.getElementById("btnConnect"),
    btnDisconnect: document.getElementById("btnDisconnect"),
    imgConnected: document.getElementById("imgConnected"),
    lblState: document.getElementById("lblState"),
    msgLog: document.getElementById("msgLog"),
    btnClearLog: document.getElementById("btnClearLog"),
    grid: document.getElementById("grid"),
    btnEditMode: document.getElementById("btnEditMode"),
    btnAddWidget: document.getElementById("btnAddWidget"),
    addMenuOverlay: document.getElementById("addMenuOverlay"),
    btnCancelAdd: document.getElementById("btnCancelAdd"),
    configOverlay: document.getElementById("configOverlay"),
    configTitle: document.getElementById("configTitle"),
    configFields: document.getElementById("configFields"),
    btnDeleteWidget: document.getElementById("btnDeleteWidget"),
    btnCancelConfig: document.getElementById("btnCancelConfig"),
    btnSaveConfig: document.getElementById("btnSaveConfig"),
  };

  const MAX_LOG_ENTRIES = 300;
  const LOCAL_STORAGE_KEY = "esp32_mqtt_dashboard_layout";

  let client = null;
  let widgets = [];
  let editMode = false;
  let configTargetId = null;
  let publishLayoutTimer = null;
  let interacting = false;

  if (window.location.protocol === "https:") {
    el.secure.checked = true;
  }

  // ---------- logging ----------

  function nowTime() {
    return new Date().toLocaleTimeString("zh-TW", { hour12: false });
  }

  function logEntry(type, dirLabel, topic, text) {
    const wasAtBottom =
      el.msgLog.scrollHeight - el.msgLog.clientHeight <= el.msgLog.scrollTop + 4;

    const row = document.createElement("div");
    row.className = "log-entry log-" + type;

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = "[" + nowTime() + "] ";
    row.appendChild(time);

    const dir = document.createElement("span");
    dir.className = "log-dir";
    dir.textContent = dirLabel + " ";
    row.appendChild(dir);

    if (topic) {
      const topicEl = document.createElement("span");
      topicEl.className = "log-topic";
      topicEl.textContent = topic + " ";
      row.appendChild(topicEl);
    }

    row.appendChild(document.createTextNode(text));

    el.msgLog.appendChild(row);
    while (el.msgLog.childElementCount > MAX_LOG_ENTRIES) {
      el.msgLog.removeChild(el.msgLog.firstChild);
    }
    if (wasAtBottom) {
      el.msgLog.scrollTop = el.msgLog.scrollHeight;
    }
  }

  function logTx(topic, message) {
    logEntry("tx", "TX", topic, "→ " + message);
  }

  function logRx(topic, message) {
    logEntry("rx", "RX", topic, "← " + message);
  }

  function logSys(text) {
    logEntry("sys", "SYS", "", text);
  }

  // ---------- widget model ----------

  function uid() {
    return "w" + Math.random().toString(36).slice(2, 9);
  }

  function createWidget(type, x, y, configOverrides) {
    const def = WIDGET_DEFAULTS[type];
    return {
      id: uid(),
      type: type,
      x: x,
      y: y,
      w: def.w,
      h: def.h,
      config: Object.assign({}, def.config, configOverrides || {}),
      value: type === "slider" ? Number(def.config.min) : "",
    };
  }

  function defaultLayout() {
    return [
      createWidget("led", 0, 0, { label: "LED 1", topic: TOPIC_PREFIX + "/light/LED1", onValue: "on" }),
      createWidget("led", 2, 0, { label: "LED 2", topic: TOPIC_PREFIX + "/light/LED2", onValue: "on" }),
      createWidget("switch", 0, 2, { label: "開關1", topic: TOPIC_PREFIX + "/switch1", color: "#ff0000" }),
      createWidget("switch", 2, 2, { label: "開關2", topic: TOPIC_PREFIX + "/switch2" }),
      createWidget("label", 0, 4, { label: "參數1", topic: TOPIC_PREFIX + "/value1", unit: " 單位1" }),
      createWidget("label", 0, 5, { label: "參數2", topic: TOPIC_PREFIX + "/value2", unit: " 單位2" }),
      createWidget("slider", 0, 6, { label: "參數3", topic: TOPIC_PREFIX + "/slider_value1", color: "#ff0000" }),
      createWidget("slider", 0, 8, { label: "參數4", topic: TOPIC_PREFIX + "/slider_value2", color: "#00bcd4" }),
    ];
  }

  function nextFreeY() {
    let maxY = -1;
    widgets.forEach(function (w) {
      maxY = Math.max(maxY, w.y + w.h - 1);
    });
    return maxY + 1;
  }

  function findWidget(id) {
    return widgets.filter(function (w) { return w.id === id; })[0] || null;
  }

  function layoutTopicsInUse() {
    const set = {};
    widgets.forEach(function (w) {
      if (w.config.topic) set[w.config.topic] = true;
    });
    return Object.keys(set);
  }

  // ---------- rendering ----------

  function renderGrid() {
    el.grid.classList.toggle("edit-mode", editMode);
    el.grid.classList.toggle("empty", widgets.length === 0);
    el.grid.textContent = "";
    widgets.forEach(function (w) {
      el.grid.appendChild(renderWidget(w));
    });
  }

  function applyPosition(elm, w) {
    elm.style.gridColumn = (w.x + 1) + " / span " + w.w;
    elm.style.gridRow = (w.y + 1) + " / span " + w.h;
  }

  function renderWidget(w) {
    const wrap = document.createElement("div");
    wrap.className = "widget widget-" + w.type;
    wrap.dataset.id = w.id;
    applyPosition(wrap, w);

    const body = buildWidgetBody(w);
    wrap.appendChild(body);

    const label = document.createElement("div");
    label.className = "widget-label";
    label.textContent = w.config.label || "";
    wrap.appendChild(label);

    if (editMode) {
      const bar = document.createElement("div");
      bar.className = "widget-edit-bar";
      const gear = document.createElement("button");
      gear.type = "button";
      gear.className = "w-icon-btn";
      gear.textContent = "⚙";
      gear.addEventListener("click", function (e) {
        e.stopPropagation();
        openConfig(w.id);
      });
      bar.appendChild(gear);
      wrap.appendChild(bar);

      const resizeHandle = document.createElement("div");
      resizeHandle.className = "resize-handle";
      wrap.appendChild(resizeHandle);
      bindResize(wrap, w, resizeHandle);
      bindDrag(wrap, w);
    } else {
      bindRunInteraction(wrap, w, body);
    }

    return wrap;
  }

  function buildWidgetBody(w) {
    if (w.type === "button") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "w-button";
      const on = w.value === true;
      btn.style.background = on ? w.config.color : "var(--led-off)";
      btn.textContent = on ? w.config.onText : w.config.offText;
      return btn;
    }

    if (w.type === "led") {
      const dot = document.createElement("div");
      dot.className = "w-led";
      dot.style.background = w.value === true ? w.config.color : "var(--led-off)";
      return dot;
    }

    if (w.type === "switch") {
      const row = document.createElement("label");
      row.className = "w-switch-row";
      const span = document.createElement("span");
      span.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = w.value === true;
      const track = document.createElement("span");
      track.className = "switch-track";
      track.style.setProperty("background", w.value === true ? w.config.color : "#ccc");
      span.appendChild(input);
      span.appendChild(track);
      row.appendChild(span);
      return row;
    }

    if (w.type === "slider") {
      const row = document.createElement("div");
      row.className = "w-slider-row";
      const input = document.createElement("input");
      input.type = "range";
      input.min = w.config.min;
      input.max = w.config.max;
      input.value = w.value;
      input.style.accentColor = w.config.color;
      const val = document.createElement("span");
      val.className = "w-slider-value";
      val.textContent = w.value;
      row.appendChild(input);
      row.appendChild(val);
      return row;
    }

    // label
    const val = document.createElement("div");
    val.className = "w-value";
    val.textContent = (w.value === "" ? "--" : w.value) + (w.config.unit || "");
    return val;
  }

  function updateWidgetDom(w) {
    const wrap = el.grid.querySelector('[data-id="' + w.id + '"]');
    if (!wrap) return;
    const body = wrap.firstChild;
    const newBody = buildWidgetBody(w);
    wrap.replaceChild(newBody, body);
    if (!editMode) bindRunInteraction(wrap, w, newBody);
  }

  // ---------- run-mode interaction (publish on user action) ----------

  function bindRunInteraction(wrap, w, body) {
    if (w.type === "button") {
      body.addEventListener("click", function () {
        w.value = !(w.value === true);
        publishWidgetValue(w);
        updateWidgetDom(w);
      });
    } else if (w.type === "switch") {
      const input = body.querySelector("input");
      input.addEventListener("change", function () {
        w.value = input.checked;
        publishWidgetValue(w);
        updateWidgetDom(w);
      });
    } else if (w.type === "slider") {
      const input = body.querySelector("input");
      const valLabel = body.querySelector(".w-slider-value");
      input.addEventListener("input", function () {
        w.value = Number(input.value);
        valLabel.textContent = input.value;
        publishWidgetValue(w);
      });
    }
  }

  function publishWidgetValue(w) {
    if (!w.config.topic) return;
    let payload;
    if (w.type === "button") {
      payload = w.value ? w.config.onText : w.config.offText;
    } else if (w.type === "switch") {
      payload = w.value ? w.config.onValue : w.config.offValue;
    } else if (w.type === "slider") {
      payload = String(w.value);
    } else {
      return;
    }
    publish(w.config.topic, payload);
  }

  // ---------- incoming MQTT -> widget state ----------

  function applyIncomingMessage(topic, msg) {
    let changed = false;
    widgets.forEach(function (w) {
      if (w.config.topic !== topic) return;
      if (w.type === "button") {
        if (msg === w.config.onText) w.value = true;
        else if (msg === w.config.offText) w.value = false;
      } else if (w.type === "switch") {
        if (msg === w.config.onValue) w.value = true;
        else if (msg === w.config.offValue) w.value = false;
      } else if (w.type === "led") {
        w.value = msg === w.config.onValue;
      } else if (w.type === "slider") {
        w.value = Number(msg);
      } else if (w.type === "label") {
        w.value = msg;
      }
      changed = true;
      updateWidgetDom(w);
    });
    return changed;
  }

  // ---------- layout persistence + cross-device sync ----------

  function serializeLayout() {
    return widgets.map(function (w) {
      return { id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, config: w.config };
    });
  }

  function saveLocal() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializeLayout()));
    } catch (e) {
      /* storage unavailable, ignore */
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw).map(function (item) {
        return Object.assign(createWidget(item.type, item.x, item.y, item.config), {
          id: item.id,
          w: item.w,
          h: item.h,
        });
      });
    } catch (e) {
      return null;
    }
  }

  function schedulePublishLayout() {
    saveLocal();
    if (publishLayoutTimer) clearTimeout(publishLayoutTimer);
    publishLayoutTimer = setTimeout(function () {
      publishLayoutTimer = null;
      if (client && client.connected) {
        const json = JSON.stringify(serializeLayout());
        client.publish(LAYOUT_TOPIC, json, { qos: 1, retain: true });
        logTx(LAYOUT_TOPIC, "(layout, " + widgets.length + " 個元件)");
      }
    }, 500);
  }

  function applyIncomingLayout(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return;
    }
    if (!Array.isArray(parsed)) return;
    if (interacting) return;
    if (JSON.stringify(parsed) === JSON.stringify(serializeLayout())) return;

    widgets = parsed.map(function (item) {
      const w = Object.assign(createWidget(item.type, item.x, item.y, item.config), {
        id: item.id,
        w: item.w,
        h: item.h,
      });
      return w;
    });
    saveLocal();
    renderGrid();
    ensureSubscriptions();
  }

  function ensureSubscriptions() {
    if (!client || !client.connected) return;
    layoutTopicsInUse().forEach(function (topic) {
      if (topic.indexOf(TOPIC_PREFIX + "/") !== 0) {
        client.subscribe(topic, { qos: 1 });
        logSys("subscribed " + topic);
      }
    });
  }

  // ---------- edit mode: add / configure / delete ----------

  function setEditMode(on) {
    editMode = on;
    el.btnEditMode.textContent = on ? "完成" : "編輯";
    el.btnEditMode.classList.toggle("active", on);
    el.btnAddWidget.hidden = !on;
    renderGrid();
  }

  el.btnEditMode.addEventListener("click", function () {
    setEditMode(!editMode);
  });

  el.btnAddWidget.addEventListener("click", function () {
    el.addMenuOverlay.hidden = false;
  });

  el.btnCancelAdd.addEventListener("click", function () {
    el.addMenuOverlay.hidden = true;
  });

  el.addMenuOverlay.addEventListener("click", function (e) {
    if (e.target === el.addMenuOverlay) el.addMenuOverlay.hidden = true;
  });

  Array.prototype.forEach.call(document.querySelectorAll(".add-menu-item"), function (btn) {
    btn.addEventListener("click", function () {
      const type = btn.dataset.type;
      const w = createWidget(type, 0, nextFreeY());
      widgets.push(w);
      el.addMenuOverlay.hidden = true;
      renderGrid();
      schedulePublishLayout();
      ensureSubscriptions();
      openConfig(w.id);
    });
  });

  function openConfig(id) {
    const w = findWidget(id);
    if (!w) return;
    configTargetId = id;
    el.configTitle.textContent = "設定" + WIDGET_TYPE_NAMES[w.type];
    el.configFields.textContent = "";

    addTextField("label", "顯示名稱", w.config.label);
    addTextField("topic", "MQTT 主題", w.config.topic);

    if (w.type === "button") {
      addTextField("onText", "ON 發布值", w.config.onText);
      addTextField("offText", "OFF 發布值", w.config.offText);
      addColorField("color", "ON 顏色", w.config.color);
    } else if (w.type === "switch") {
      addTextField("onValue", "ON 發布值", w.config.onValue);
      addTextField("offValue", "OFF 發布值", w.config.offValue);
      addColorField("color", "ON 顏色", w.config.color);
    } else if (w.type === "led") {
      addTextField("onValue", "點亮判斷值", w.config.onValue);
      addColorField("color", "亮燈顏色", w.config.color);
    } else if (w.type === "slider") {
      addNumberField("min", "最小值", w.config.min);
      addNumberField("max", "最大值", w.config.max);
      addColorField("color", "顏色", w.config.color);
    } else if (w.type === "label") {
      addTextField("unit", "單位後綴", w.config.unit);
    }

    el.configOverlay.hidden = false;
  }

  function addTextField(key, labelText, value) {
    const label = document.createElement("label");
    label.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.key = key;
    input.value = value == null ? "" : value;
    label.appendChild(span);
    label.appendChild(input);
    el.configFields.appendChild(label);
  }

  function addNumberField(key, labelText, value) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number";
    input.dataset.key = key;
    input.value = value;
    label.appendChild(span);
    label.appendChild(input);
    el.configFields.appendChild(label);
  }

  function addColorField(key, labelText, value) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "color";
    input.dataset.key = key;
    input.value = value || "#33ffff";
    label.appendChild(span);
    label.appendChild(input);
    el.configFields.appendChild(label);
  }

  el.btnCancelConfig.addEventListener("click", function () {
    el.configOverlay.hidden = true;
    configTargetId = null;
  });

  el.configOverlay.addEventListener("click", function (e) {
    if (e.target === el.configOverlay) {
      el.configOverlay.hidden = true;
      configTargetId = null;
    }
  });

  el.btnSaveConfig.addEventListener("click", function () {
    const w = findWidget(configTargetId);
    if (!w) return;
    const inputs = el.configFields.querySelectorAll("[data-key]");
    Array.prototype.forEach.call(inputs, function (input) {
      const key = input.dataset.key;
      if (input.type === "number") {
        w.config[key] = Number(input.value);
      } else {
        w.config[key] = input.value;
      }
    });
    el.configOverlay.hidden = true;
    configTargetId = null;
    renderGrid();
    schedulePublishLayout();
    ensureSubscriptions();
  });

  el.btnDeleteWidget.addEventListener("click", function () {
    if (!configTargetId) return;
    widgets = widgets.filter(function (w) { return w.id !== configTargetId; });
    el.configOverlay.hidden = true;
    configTargetId = null;
    renderGrid();
    schedulePublishLayout();
  });

  // ---------- drag to move ----------

  function bindDrag(wrap, w) {
    wrap.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".w-icon-btn") || e.target.closest(".resize-handle")) return;
      e.preventDefault();
      interacting = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startGridX = w.x;
      const startGridY = w.y;
      const gridRect = el.grid.getBoundingClientRect();
      const cellW = (gridRect.width - 10 * (GRID_COLS - 1)) / GRID_COLS;
      const cellH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 64;

      wrap.classList.add("dragging");
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore: capture optional */ }

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        wrap.style.transform = "translate(" + dx + "px," + dy + "px)";
      }

      function onUp(ev) {
        wrap.removeEventListener("pointermove", onMove);
        wrap.removeEventListener("pointerup", onUp);
        wrap.removeEventListener("pointercancel", onUp);
        wrap.classList.remove("dragging");
        wrap.style.transform = "";

        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCols = Math.round(dx / (cellW + 10));
        const dRows = Math.round(dy / (cellH + 10));
        w.x = Math.max(0, Math.min(GRID_COLS - w.w, startGridX + dCols));
        w.y = Math.max(0, startGridY + dRows);
        applyPosition(wrap, w);
        interacting = false;
        schedulePublishLayout();
      }

      wrap.addEventListener("pointermove", onMove);
      wrap.addEventListener("pointerup", onUp);
      wrap.addEventListener("pointercancel", onUp);
    });
  }

  function bindResize(wrap, w, handle) {
    handle.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      interacting = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = w.w;
      const startH = w.h;
      const gridRect = el.grid.getBoundingClientRect();
      const cellW = (gridRect.width - 10 * (GRID_COLS - 1)) / GRID_COLS;
      const cellH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 64;

      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore: capture optional */ }

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCols = Math.round(dx / (cellW + 10));
        const dRows = Math.round(dy / (cellH + 10));
        const newW = Math.max(1, Math.min(GRID_COLS - w.x, startW + dCols));
        const newH = Math.max(1, startH + dRows);
        wrap.style.gridColumn = (w.x + 1) + " / span " + newW;
        wrap.style.gridRow = (w.y + 1) + " / span " + newH;
      }

      function onUp(ev) {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCols = Math.round(dx / (cellW + 10));
        const dRows = Math.round(dy / (cellH + 10));
        w.w = Math.max(1, Math.min(GRID_COLS - w.x, startW + dCols));
        w.h = Math.max(1, startH + dRows);
        applyPosition(wrap, w);
        interacting = false;
        schedulePublishLayout();
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  // ---------- MQTT connection ----------

  function setState(text) {
    el.lblState.textContent = text;
  }

  function setConnectedUI(connected) {
    el.btnConnect.hidden = connected;
    el.btnDisconnect.hidden = !connected;
    el.broker.disabled = connected;
    el.port.disabled = connected;
    el.path.disabled = connected;
    el.secure.disabled = connected;
    el.imgConnected.src = connected ? "assets/ok.png" : "assets/not_ok.png";
  }

  function publish(topic, message) {
    if (client && client.connected) {
      client.publish(topic, String(message), { qos: 1, retain: true });
      logTx(topic, String(message));
    }
  }

  function connect() {
    const host = el.broker.value.trim();
    const port = Number(el.port.value);
    const path = el.path.value.trim() || "/mqtt";
    const protocol = el.secure.checked ? "wss" : "ws";

    if (!host || !port) {
      setState("請輸入 Broker 與 Port");
      return;
    }

    const url = protocol + "://" + host + ":" + port + path;
    setState("Connecting...");
    logSys("connecting to " + url);

    client = mqtt.connect(url, {
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 4000,
      will: {
        topic: SYSTEM_STATE_TOPIC,
        payload: "offline",
        qos: 1,
        retain: true,
      },
    });

    client.on("connect", function () {
      setState("Connected");
      setConnectedUI(true);
      logSys("connected");
      client.publish(SYSTEM_STATE_TOPIC, "online", { qos: 1, retain: true });
      logTx(SYSTEM_STATE_TOPIC, "online");
      client.subscribe(ALL_TOPIC, { qos: 1 });
      logSys("subscribed " + ALL_TOPIC);
      ensureSubscriptions();
    });

    client.on("reconnect", function () {
      setState("Reconnecting...");
      logSys("reconnecting");
    });

    client.on("close", function () {
      setState("Disconnected");
      setConnectedUI(false);
    });

    client.on("error", function (err) {
      const msg = err && err.message ? err.message : String(err);
      setState("Error: " + msg);
      setConnectedUI(false);
      logSys("error: " + msg);
    });

    client.on("message", function (topic, payload) {
      const msg = payload.toString();
      logRx(topic, msg);
      if (topic === LAYOUT_TOPIC) {
        applyIncomingLayout(msg);
        return;
      }
      applyIncomingMessage(topic, msg);
    });
  }

  function disconnect() {
    if (!client) return;
    client.publish(SYSTEM_STATE_TOPIC, "offline", { qos: 1, retain: true }, function () {
      logTx(SYSTEM_STATE_TOPIC, "offline");
      client.end(true);
      client = null;
      setState("Disconnected");
      setConnectedUI(false);
      logSys("disconnected");
    });
  }

  el.btnConnect.addEventListener("click", connect);
  el.btnDisconnect.addEventListener("click", disconnect);
  el.btnClearLog.addEventListener("click", function () {
    el.msgLog.textContent = "";
  });

  // ---------- init ----------

  widgets = loadLocal() || defaultLayout();
  renderGrid();
})();
