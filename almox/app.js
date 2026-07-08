(function () {
  "use strict";

  const CFG = window.SIGALMOX_CONFIG || {};
  const SCHEMA = CFG.SCHEMA || "almoxarifado";
  const BASE = (CFG.SUPABASE_URL || "").replace(/\/$/, "");

  const headers = () => ({
    apikey: CFG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    Prefer: "return=representation",
  });

  const headersRead = () => ({
    apikey: CFG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
    "Accept-Profile": SCHEMA,
  });

  let produtoAtual = null;
  let scanner = null;
  let scanning = false;

  const el = {
    btnScan: document.getElementById("btn-scan"),
    qrReader: document.getElementById("qr-reader"),
    codigoManual: document.getElementById("codigo-manual"),
    btnBuscar: document.getElementById("btn-buscar"),
    prodCard: document.getElementById("produto-card"),
    prodCodigo: document.getElementById("prod-codigo"),
    prodSaldo: document.getElementById("prod-saldo"),
    prodDesc: document.getElementById("prod-descricao"),
    prodCat: document.getElementById("prod-categoria"),
    form: document.getElementById("form-retirada"),
    quantidade: document.getElementById("quantidade"),
    destino: document.getElementById("destino"),
    responsavel: document.getElementById("responsavel"),
    observacao: document.getElementById("observacao"),
    recentList: document.getElementById("recent-list"),
    network: document.getElementById("network-status"),
    toast: document.getElementById("toast"),
  };

  function showToast(msg, isError) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden", "error");
    if (isError) el.toast.classList.add("error");
    setTimeout(() => el.toast.classList.add("hidden"), 3000);
  }

  function parseQr(valor) {
    const raw = String(valor || "").trim();
    if (!raw) return "";
    if (raw.toUpperCase().startsWith("SIGALMOX-")) return raw.slice(9);
    if (raw.toUpperCase().startsWith("SAP ")) return raw.slice(4).trim();
    return raw;
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(CFG.STORAGE_KEY) || "[]"); }
    catch { return []; }
  }
  function saveRecent(list) {
    localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
  }
  function getPending() {
    try { return JSON.parse(localStorage.getItem(CFG.PENDING_KEY) || "[]"); }
    catch { return []; }
  }
  function savePending(q) {
    localStorage.setItem(CFG.PENDING_KEY, JSON.stringify(q));
    updateNetwork();
  }

  function updateNetwork() {
    const pend = getPending().length;
    el.network.classList.remove("online", "offline", "sync-pending");
    if (!navigator.onLine) {
      el.network.classList.add("offline");
      el.network.textContent = pend ? `Offline · ${pend} na fila` : "Offline";
      return;
    }
    if (pend > 0) {
      el.network.classList.add("sync-pending");
      el.network.textContent = `${pend} aguardando envio`;
      return;
    }
    el.network.classList.add("online");
    el.network.textContent = "Online · sincronizado";
  }

  async function apiGet(table, query) {
    const url = `${BASE}/rest/v1/${table}?${query}`;
    const res = await fetch(url, { headers: headersRead() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function apiPost(table, body) {
    const url = `${BASE}/rest/v1/${table}`;
    const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  }

  async function buscarProduto(codigo) {
    const cod = parseQr(codigo);
    if (!cod) { showToast("Código inválido", true); return; }

    try {
      let rows = await apiGet("produtos", `codigo_sap=eq.${encodeURIComponent(cod)}&ativo=eq.true&limit=1`);
      if (!rows.length) {
        rows = await apiGet("produtos", `qr_code=eq.${encodeURIComponent("SIGALMOX-" + cod)}&ativo=eq.true&limit=1`);
      }
      if (!rows.length) {
        showToast(`Produto ${cod} não encontrado. Importe a lista SAP.`, true);
        return;
      }
      produtoAtual = rows[0];
      exibirProduto(produtoAtual);
      pararScanner();
    } catch (e) {
      showToast("Erro ao buscar produto: " + e.message, true);
    }
  }

  function exibirProduto(p) {
    el.prodCard.classList.remove("hidden");
    el.prodCodigo.textContent = "SAP " + p.codigo_sap;
    el.prodSaldo.textContent = "Saldo: " + Number(p.estoque_atual).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    el.prodDesc.textContent = p.descricao;
    el.prodCat.textContent = p.categoria + " · " + (p.local_tipo === "externo" ? "Externo" : "Almoxarifado");
    el.quantidade.value = "1";
    el.quantidade.max = p.estoque_atual;
    el.quantidade.focus();
  }

  async function carregarSelects() {
    try {
      const [destinos, responsaveis] = await Promise.all([
        apiGet("destinos", "ativo=eq.true&order=nome&select=id,nome"),
        apiGet("responsaveis", "ativo=eq.true&order=nome&select=id,nome"),
      ]);
      el.destino.innerHTML = '<option value="">Selecione...</option>';
      destinos.forEach(d => {
        const o = document.createElement("option");
        o.value = d.id;
        o.textContent = d.nome;
        o.dataset.nome = d.nome;
        el.destino.appendChild(o);
      });
      el.responsavel.innerHTML = '<option value="">Selecione...</option>';
      responsaveis.forEach(r => {
        const o = document.createElement("option");
        o.value = r.id;
        o.textContent = r.nome;
        o.dataset.nome = r.nome;
        el.responsavel.appendChild(o);
      });
    } catch (e) {
      el.destino.innerHTML = '<option value="">Erro ao carregar</option>';
      el.responsavel.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  async function registrarRetirada(payload) {
    if (navigator.onLine && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      try {
        await apiPost("movimentacoes", payload);
        return { synced: true };
      } catch (e) {
        console.warn("Falha online, enfileirando:", e);
      }
    }
    const pending = getPending();
    pending.push({ payload, ts: new Date().toISOString() });
    savePending(pending);
    return { synced: false };
  }

  async function processQueue() {
    if (!navigator.onLine) { updateNetwork(); return; }
    let q = getPending();
    while (q.length) {
      try {
        await apiPost("movimentacoes", q[0].payload);
        q = q.slice(1);
        savePending(q);
      } catch { break; }
    }
    updateNetwork();
  }

  function renderRecent() {
    const list = getRecent();
    el.recentList.innerHTML = list.length
      ? list.map(r => `<li>
          <strong>${r.codigo}</strong> · ${r.qtd} → ${r.destino}
          <div class="meta">${r.responsavel} · ${r.hora}${r.pending ? ' · <span class="pending">⏳ fila</span>' : ""}</div>
        </li>`).join("")
      : '<li style="color:#9ab892;font-size:0.85rem;">Nenhuma retirada ainda</li>';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!produtoAtual) return;

    const qtd = parseFloat(el.quantidade.value);
    if (!qtd || qtd <= 0) { showToast("Quantidade inválida", true); return; }
    if (qtd > produtoAtual.estoque_atual) {
      showToast(`Saldo insuficiente (${produtoAtual.estoque_atual})`, true);
      return;
    }

    const destOpt = el.destino.selectedOptions[0];
    const respOpt = el.responsavel.selectedOptions[0];
    if (!destOpt?.value || !respOpt?.value) {
      showToast("Selecione destino e responsável", true);
      return;
    }

    const payload = {
      produto_id: produtoAtual.id,
      quantidade: qtd,
      destino_id: destOpt.value,
      destino_nome: destOpt.dataset.nome || destOpt.textContent,
      responsavel_id: respOpt.value,
      responsavel_nome: respOpt.dataset.nome || respOpt.textContent,
      observacao: el.observacao.value.trim() || null,
      origem: "pwa",
      data_retirada: new Date().toISOString(),
    };

    const result = await registrarRetirada(payload);
    const recent = getRecent();
    recent.unshift({
      codigo: produtoAtual.codigo_sap,
      desc: produtoAtual.descricao,
      qtd,
      destino: payload.destino_nome,
      responsavel: payload.responsavel_nome,
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      pending: !result.synced,
    });
    saveRecent(recent);
    renderRecent();

    produtoAtual.estoque_atual -= qtd;
    el.prodSaldo.textContent = "Saldo: " + Number(produtoAtual.estoque_atual).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

    showToast(result.synced ? "✓ Retirada registrada!" : "✓ Salvo offline — sincroniza com rede");
    el.form.reset();
    el.quantidade.value = "1";
    processQueue();
  }

  function iniciarScanner() {
    if (scanning) { pararScanner(); return; }
    if (typeof Html5Qrcode === "undefined") {
      showToast("Scanner não disponível", true);
      return;
    }
    el.qrReader.classList.remove("hidden");
    scanner = new Html5Qrcode("qr-reader");
    scanning = true;
    el.btnScan.textContent = "⏹ Parar scanner";

    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => {
        buscarProduto(decoded);
        el.codigoManual.value = parseQr(decoded);
      },
      () => {}
    ).catch(err => {
      showToast("Câmera indisponível: " + err, true);
      pararScanner();
    });
  }

  function pararScanner() {
    if (scanner && scanning) {
      scanner.stop().catch(() => {});
      scanner.clear();
      scanning = false;
      el.btnScan.textContent = "📷 Escanear QR Code";
      el.qrReader.classList.add("hidden");
    }
  }

  el.btnScan.addEventListener("click", iniciarScanner);
  el.btnBuscar.addEventListener("click", () => buscarProduto(el.codigoManual.value));
  el.codigoManual.addEventListener("keydown", e => { if (e.key === "Enter") buscarProduto(el.codigoManual.value); });
  el.form.addEventListener("submit", onSubmit);
  window.addEventListener("online", processQueue);
  window.addEventListener("offline", updateNetwork);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(CFG.SW_URL + "?v=" + CFG.ASSET_VER).catch(() => {});
  }

  carregarSelects();
  renderRecent();
  updateNetwork();
  processQueue();
})();
