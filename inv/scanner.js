/** Leitor QR — folha impressa (código SAP por item) */
(function () {
  "use strict";

  let scanner = null;
  let running = false;
  let onCodeCb = null;

  const overlay = document.getElementById("scanner-overlay");
  const readerEl = document.getElementById("scanner-reader");
  const errEl = document.getElementById("scanner-error");

  function showErr(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
  }

  function hideErr() {
    if (errEl) errEl.classList.add("hidden");
  }

  async function stop() {
    running = false;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        /* já parado */
      }
      try {
        scanner.clear();
      } catch {
        /* ignore */
      }
      scanner = null;
    }
    if (overlay) overlay.classList.add("hidden");
  }

  async function start(onCode) {
    if (typeof Html5Qrcode === "undefined") {
      showErr("Biblioteca de leitura não carregou. Verifique a internet na 1ª abertura.");
      return;
    }
    onCodeCb = onCode;
    hideErr();
    overlay.classList.remove("hidden");

    scanner = new Html5Qrcode("scanner-reader");
    const config = { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 };

    try {
      running = true;
      await scanner.start(
        { facingMode: "environment" },
        config,
        (decoded) => {
          if (!running) return;
          const code = String(decoded || "")
            .trim()
            .replace(/^SAP\s*/i, "");
          if (!code) return;
          running = false;
          stop().then(() => {
            if (onCodeCb) onCodeCb(code);
          });
        },
        () => {
          /* frame sem leitura — normal */
        }
      );
    } catch (e) {
      showErr(
        "Não foi possível abrir a câmera. Permita o acesso ou digite o código SAP na busca."
      );
      console.warn(e);
    }
  }

  document.getElementById("btn-scan")?.addEventListener("click", () => {
    if (window.__inventarioAbrirScan) window.__inventarioAbrirScan();
  });

  document.querySelectorAll("[data-scanner-close]").forEach((el) => {
    el.addEventListener("click", () => stop());
  });

  window.InventarioScanner = { start, stop };
})();
