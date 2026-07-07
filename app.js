(function () {
  "use strict";

  const TOPIC_PREFIX = "yichun777";
  const TOPICS = {
    all: TOPIC_PREFIX + "/#",
    systemState: TOPIC_PREFIX + "/system_state",
    value1: TOPIC_PREFIX + "/value1",
    value2: TOPIC_PREFIX + "/value2",
    led1: TOPIC_PREFIX + "/light/LED1",
    led2: TOPIC_PREFIX + "/light/LED2",
    switch1: TOPIC_PREFIX + "/switch1",
    switch2: TOPIC_PREFIX + "/switch2",
    slider1: TOPIC_PREFIX + "/slider_value1",
    slider2: TOPIC_PREFIX + "/slider_value2",
  };

  const el = {
    broker: document.getElementById("broker"),
    port: document.getElementById("port"),
    path: document.getElementById("path"),
    secure: document.getElementById("secure"),
    btnConnect: document.getElementById("btnConnect"),
    btnDisconnect: document.getElementById("btnDisconnect"),
    imgConnected: document.getElementById("imgConnected"),
    lblState: document.getElementById("lblState"),
    led1: document.getElementById("led1"),
    led2: document.getElementById("led2"),
    switch1: document.getElementById("switch1"),
    switch2: document.getElementById("switch2"),
    labelV1: document.getElementById("labelV1"),
    labelV2: document.getElementById("labelV2"),
    slider1: document.getElementById("slider1"),
    slider2: document.getElementById("slider2"),
    sliderValue1: document.getElementById("sliderValue1"),
    sliderValue2: document.getElementById("sliderValue2"),
    msgLog: document.getElementById("msgLog"),
    btnClearLog: document.getElementById("btnClearLog"),
  };

  const MAX_LOG_ENTRIES = 300;

  let client = null;
  let ledState = { led1: "off", led2: "off" };

  if (window.location.protocol === "https:") {
    el.secure.checked = true;
  }

  function setState(text) {
    el.lblState.textContent = text;
  }

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
        topic: TOPICS.systemState,
        payload: "offline",
        qos: 1,
        retain: true,
      },
    });

    client.on("connect", function () {
      setState("Connected");
      setConnectedUI(true);
      logSys("connected");
      client.publish(TOPICS.systemState, "online", { qos: 1, retain: true });
      logTx(TOPICS.systemState, "online");
      client.subscribe(TOPICS.all, { qos: 1 });
      logSys("subscribed " + TOPICS.all);
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
      switch (topic) {
        case TOPICS.value1:
          el.labelV1.textContent = msg + "  單位1";
          break;
        case TOPICS.value2:
          el.labelV2.textContent = msg + "  單位2";
          break;
        case TOPICS.led1:
          ledState.led1 = msg;
          el.led1.classList.toggle("on", msg === "on");
          break;
        case TOPICS.led2:
          ledState.led2 = msg;
          el.led2.classList.toggle("on", msg === "on");
          break;
        case TOPICS.switch1:
          el.switch1.checked = msg === "true";
          break;
        case TOPICS.switch2:
          el.switch2.checked = msg === "true";
          break;
        case TOPICS.slider1:
          el.slider1.value = msg;
          el.sliderValue1.textContent = msg;
          break;
        case TOPICS.slider2:
          el.slider2.value = msg;
          el.sliderValue2.textContent = msg;
          break;
      }
    });
  }

  function disconnect() {
    if (!client) return;
    client.publish(TOPICS.systemState, "offline", { qos: 1, retain: true }, function () {
      logTx(TOPICS.systemState, "offline");
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

  el.led1.addEventListener("click", function () {
    ledState.led1 = ledState.led1 === "on" ? "off" : "on";
    el.led1.classList.toggle("on", ledState.led1 === "on");
    publish(TOPICS.led1, ledState.led1);
  });

  el.led2.addEventListener("click", function () {
    ledState.led2 = ledState.led2 === "on" ? "off" : "on";
    el.led2.classList.toggle("on", ledState.led2 === "on");
    publish(TOPICS.led2, ledState.led2);
  });

  el.switch1.addEventListener("change", function () {
    publish(TOPICS.switch1, el.switch1.checked ? "true" : "false");
  });

  el.switch2.addEventListener("change", function () {
    publish(TOPICS.switch2, el.switch2.checked ? "true" : "false");
  });

  el.slider1.addEventListener("input", function () {
    el.sliderValue1.textContent = el.slider1.value;
    publish(TOPICS.slider1, el.slider1.value);
  });

  el.slider2.addEventListener("input", function () {
    el.sliderValue2.textContent = el.slider2.value;
    publish(TOPICS.slider2, el.slider2.value);
  });
})();
