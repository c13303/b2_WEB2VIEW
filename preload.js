const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_ORIGINS = new Set([
  "https://blektre.com",
  "https://bdev.blektre.com",
  "null",
]);

contextBridge.exposeInMainWorld("web2view", {
  send(payload) {
    ipcRenderer.send("web2view-message", payload);
  },
});

contextBridge.exposeInMainWorld("electronAPI", {
  fullscreen(state) {
    ipcRenderer.send("web2view-fullscreen", !!state);
  },
});

function installFullscreenGuards() {
  const enterFullscreen = () => {
    ipcRenderer.send("web2view-fullscreen", true);
    return Promise.resolve();
  };
  const exitFullscreen = () => {
    ipcRenderer.send("web2view-fullscreen", false);
    return Promise.resolve();
  };
  const overrideElement = (name, fn) => {
    try {
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        value: fn,
      });
    } catch (_) {}
  };
  const overrideDocument = (name, fn) => {
    try {
      Object.defineProperty(Document.prototype, name, {
        configurable: true,
        value: fn,
      });
    } catch (_) {}
  };
  overrideElement("requestFullscreen", enterFullscreen);
  overrideElement("webkitRequestFullscreen", enterFullscreen);
  overrideElement("mozRequestFullScreen", enterFullscreen);
  overrideElement("msRequestFullscreen", enterFullscreen);
  overrideDocument("exitFullscreen", exitFullscreen);
  overrideDocument("webkitExitFullscreen", exitFullscreen);
  overrideDocument("mozCancelFullScreen", exitFullscreen);
  overrideDocument("msExitFullscreen", exitFullscreen);
}

installFullscreenGuards();

ipcRenderer.on("web2view-send", (_event, message) => {
  if (!message || typeof message !== "object") return;
  const targetOrigin =
    typeof message.targetOrigin === "string" ? message.targetOrigin : "*";
  let payload = message.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_) {
      // Keep as string if it's not JSON.
    }
  }

  const frame = document.getElementById("mainframe");
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(payload, targetOrigin);
  } else {
    window.postMessage(payload, targetOrigin);
  }
});

window.addEventListener("message", (event) => {
  if (event.origin && !ALLOWED_ORIGINS.has(event.origin)) {
    return;
  }
  ipcRenderer.send("web2view-message", event.data);
});
