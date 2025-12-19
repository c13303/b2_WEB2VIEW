const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_ORIGINS = new Set(["https://blektre.com", "null"]);

contextBridge.exposeInMainWorld("web2view", {
  send(payload) {
    ipcRenderer.send("web2view-message", payload);
  },
});

window.addEventListener("message", (event) => {
  if (event.origin && !ALLOWED_ORIGINS.has(event.origin)) {
    return;
  }
  ipcRenderer.send("web2view-message", event.data);
});
