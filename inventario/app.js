(function () {
  "use strict";

  const CFG = window.INVENTARIO_CONFIG || {};
  const TOL = CFG.TOLERANCIA_LEVE ?? 1;

  let catalogo = { setor: "", campanha: "", itens: [] };
  let campanhaId = CFG.CAMPANHA_ID || "";
  let campanhasAbertas = [];
  let modoAguardando = false;
  let modoPiloto = false;
  let contagens = loadContagens();
  let filtro = "todos";
  let busca = "";
  let itemAtual = null;

  const el = {
    titulo: document.getElementById("campanha-titulo"),
    sub: document.getElementById("campanha-sub"),
    progressText: document.getElementById("progress-text"),
    accuracyText: document.getElementById("accuracy-text"),
    progressFill: document.getElementById("progress-fill"),
    search: document.getElementById("search-input"),
    clearSearch: document.getElementById("clear-search"),
    lista: document.getElementById("lista-produtos"),
    statPend: document.getElementById("stat-pend"),
    statOk: document.getElementById("stat-ok"),
    statLeve: document.getElementById("stat-leve"),
    statCrit: document.getElementById("stat-crit"),
    modal: document.getElementById("modal"),
    modalCodigo: document.getElementById("modal-codigo"),
    modalTitle: document.getElementById("modal-title"),
    modalSap: document.getElementById("modal-sap"),
    modalFisico: document.getElementById("modal-fisico"),
    modalObs: document.getElementById("modal-obs"),
    modalPreview: document.getElementById("modal-preview"),
    modalSave: document.getElementById("modal-save"),
    toast: document.getElementById("toast"),
    network: document.getElementById("network-status"),
    campanhaPicker: document.getElementById("campanha-picker-wrap"),
    campanhaSelect: document.getElementById("campanha-select"),
  };

  function storageKey() {
    return campanhaId
      ? `${CFG.STORAGE_KEY}_campanha_${campanhaId}`
      : CFG.STORAGE_KEY;
  }

  function loadContagens() {
    try {
      const raw = localStorage.getItem(storageKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveContagens() {
    localStorage.setItem(storageKey(), JSON.stringify(contagens));
    updateNetworkStatus();
    trySyncSupabase();
  }

  function pendentesSync() {
    return Object.values(contagens).filter((c) => c && c.synced !== true).length;
  }

  function updateNetworkStatus() {
    if (!el.network) return;
    const online = navigator.onLine;
    const pend = pendentesSync();
    el.network.classList.remove("online", "offline", "sync-pending");
    if (!online) {
      el.network.classList.add("offline");
      el.network.textContent =
        pend > 0
          ? `Offline · ${pend} contagem(ns) guardada(s) — sincroniza quando tiver rede`
          : "Offline · contagem funciona normalmente (dados no celular)";
      return;
    }
    if (pend > 0) {
      el.network.classList.add("sync-pending");
      el.network.textContent = modoPiloto
        ? "Online · modo teste (não envia ao servidor)"
        : `Online · ${pend} contagem(ns) aguardando envio ao servidor`;
      return;
    }
    el.network.classList.add("online");
    el.network.textContent = modoPiloto
      ? "Online · modo teste (não envia ao servidor)"
      : CFG.SUPABASE_URL
      ? "Online · sincronizado com o servidor"
      : "Online · modo piloto (dados só neste celular)";
  }

  async function trySyncSupabase() {
    if (modoPiloto || !campanhaId) return;
    if (!navigator.onLine || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return;
    const pendKeys = Object.entries(contagens)
      .filter(([, v]) => v && v.synced === false)
      .map(([k]) => k);
    if (!pendKeys.length) return;

    const base = CFG.SUPABASE_URL.replace(/\/$/, "");
    const headers = {
      apikey: CFG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    for (const key of pendKeys) {
      const row = contagens[key];
      const item = catalogo.itens.find((i) => codigoKey(i.codigo) === key);
      if (!item) continue;
      try {
        const payload = {
          campanha_id: campanhaId || CFG.CAMPANHA_ID || null,
          codigo: key,
          descricao: item.descricao,
          qtd_sap: Number(item.em_estoque) || 0,
          qtd_fisica: row.qtd_fisica,
          observacao: row.observacao || null,
          contado_em: row.contado_em,
        };
        const res = await fetch(`${base}/rest/v1/inventario_contagem?on_conflict=campanha_id,codigo`, {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) row.synced = true;
      } catch {
        break;
      }
    }
    saveContagensSilent();
    updateNetworkStatus();
  }

  function saveContagensSilent() {
    localStorage.setItem(storageKey(), JSON.stringify(contagens));
  }

  function codigoKey(c) {
    return String(c).trim();
  }

  function getContagem(codigo) {
    return contagens[codigoKey(codigo)] || null;
  }

  /** @returns {'pendente'|'conforme'|'leve'|'critica'} */
  function classificar(item) {
    const c = getContagem(item.codigo);
    if (!c || c.qtd_fisica === "" || c.qtd_fisica == null) return "pendente";
    const sap = Number(item.em_estoque) || 0;
    const fis = Number(c.qtd_fisica);
    const variacao = fis - sap;
    if (variacao === 0) return "conforme";
    if (Math.abs(variacao) <= TOL) return "leve";
    return "critica";
  }

  function tipoVariacao(item, fisico) {
    const sap = Number(item.em_estoque) || 0;
    const v = Number(fisico) - sap;
    if (v === 0) return { tipo: "CONFORME", label: "Conforme", variacao: 0 };
    if (v < 0) {
      return {
        tipo: "FALTANTE",
        label: "Faltante (variância negativa)",
        variacao: v,
      };
    }
    return {
      tipo: "EXCEDENTE",
      label: "Excedente (variância positiva)",
      variacao: v,
    };
  }

  function gravidade(variacao) {
    if (variacao === 0) return "conforme";
    if (Math.abs(variacao) <= TOL) return "leve";
    return "critica";
  }

  function badgeHtml(status) {
    const map = {
      pendente: ["Pendente", "badge-pend"],
      conforme: ["Conforme", "badge-ok"],
      leve: ["Divergência leve", "badge-leve"],
      critica: ["Divergência crítica", "badge-crit"],
    };
    const [txt, cls] = map[status] || map.pendente;
    return `<span class="badge ${cls}">${txt}</span>`;
  }

  function fmtNum(n) {
    return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }

  function itensFiltrados() {
    const q = busca.trim().toLowerCase();
    return catalogo.itens.filter((item) => {
      const status = classificar(item);
      if (filtro === "pendente" && status !== "pendente") return false;
      if (filtro === "conforme" && status !== "conforme") return false;
      if (filtro === "divergente" && status !== "leve" && status !== "critica") return false;
      if (!q) return true;
      const cod = codigoKey(item.codigo).toLowerCase();
      const desc = (item.descricao || "").toLowerCase();
      return cod.includes(q) || desc.includes(q);
    });
  }

  function calcStats() {
    const total = catalogo.itens.length;
    let contados = 0;
    let ok = 0;
    let leve = 0;
    let crit = 0;
    catalogo.itens.forEach((item) => {
      const s = classificar(item);
      if (s !== "pendente") contados++;
      if (s === "conforme") ok++;
      if (s === "leve") leve++;
      if (s === "critica") crit++;
    });
    const pend = total - contados;
    const acuracia = contados > 0 ? (ok / contados) * 100 : null;
    return { total, contados, pend, ok, leve, crit, acuracia };
  }

  function render() {
    const stats = calcStats();
    el.progressText.textContent = `${stats.contados} / ${stats.total} contados`;
    el.accuracyText.textContent =
      stats.acuracia != null ? `Acurácia ${stats.acuracia.toFixed(0)}%` : "Acurácia —";
    el.progressFill.style.width =
      stats.total > 0 ? `${(stats.contados / stats.total) * 100}%` : "0%";

    el.statPend.textContent = stats.pend;
    el.statOk.textContent = stats.ok;
    el.statLeve.textContent = stats.leve;
    el.statCrit.textContent = stats.crit;

    const lista = itensFiltrados();
    if (!lista.length) {
      el.lista.innerHTML = '<p class="empty">Nenhum produto encontrado.</p>';
      return;
    }

    el.lista.innerHTML = lista
      .map((item) => {
        const status = classificar(item);
        const c = getContagem(item.codigo);
        const sap = Number(item.em_estoque) || 0;
        let meta = `SAP: <strong>${fmtNum(sap)}</strong>`;
        if (c && c.qtd_fisica != null && c.qtd_fisica !== "") {
          const tv = tipoVariacao(item, c.qtd_fisica);
          meta += ` · Físico: <strong>${fmtNum(c.qtd_fisica)}</strong>`;
          if (tv.variacao !== 0) {
            const sinal = tv.variacao > 0 ? "+" : "";
            meta += ` · Var: <strong>${sinal}${fmtNum(tv.variacao)}</strong>`;
          }
        }
        return `
          <article class="card" data-codigo="${codigoKey(item.codigo)}" tabindex="0">
            <div class="card-head">
              <span class="card-codigo">SAP ${item.codigo}</span>
              ${badgeHtml(status)}
            </div>
            <p class="card-title">${escapeHtml(item.descricao)}</p>
            <div class="card-meta">${meta}</div>
          </article>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function abrirModal(codigo) {
    const item = catalogo.itens.find((i) => codigoKey(i.codigo) === codigoKey(codigo));
    if (!item) return;
    itemAtual = item;
    const c = getContagem(item.codigo);
    el.modalCodigo.textContent = `SAP ${item.codigo}`;
    el.modalTitle.textContent = item.descricao;
    el.modalSap.textContent = fmtNum(item.em_estoque);
    el.modalFisico.value = c ? c.qtd_fisica : "";
    el.modalObs.value = c ? c.observacao || "" : "";
    atualizarPreview();
    el.modal.classList.remove("hidden");
    setTimeout(() => el.modalFisico.focus(), 200);
  }

  function fecharModal() {
    el.modal.classList.add("hidden");
    itemAtual = null;
  }

  function atualizarPreview() {
    if (!itemAtual) return;
    const val = el.modalFisico.value;
    if (val === "" || val == null) {
      el.modalPreview.classList.add("hidden");
      return;
    }
    const tv = tipoVariacao(itemAtual, val);
    const g = gravidade(tv.variacao);
    el.modalPreview.classList.remove("hidden", "ok", "leve", "crit");
    if (g === "conforme") {
      el.modalPreview.classList.add("ok");
      el.modalPreview.textContent = "✓ Conforme — físico igual ao SAP";
    } else if (g === "leve") {
      el.modalPreview.classList.add("leve");
      const sinal = tv.variacao > 0 ? "+" : "";
      el.modalPreview.textContent = `⚠ ${tv.label} · variância ${sinal}${fmtNum(tv.variacao)} (leve)`;
    } else {
      el.modalPreview.classList.add("crit");
      const sinal = tv.variacao > 0 ? "+" : "";
      el.modalPreview.textContent = `✕ ${tv.label} · variância ${sinal}${fmtNum(tv.variacao)} (crítica)`;
    }
  }

  function salvarContagem() {
    if (!itemAtual) return;
    const val = el.modalFisico.value;
    if (val === "" || val == null) {
      showToast("Informe a quantidade física.");
      return;
    }
    if (Number(val) < 0) {
      showToast("Quantidade não pode ser negativa.");
      return;
    }
    contagens[codigoKey(itemAtual.codigo)] = {
      qtd_fisica: Number(val),
      observacao: el.modalObs.value.trim(),
      contado_em: new Date().toISOString(),
      synced: modoPiloto ? true : false,
    };
    saveContagens();
    fecharModal();
    render();
    showToast("Contagem salva.");
  }

  let toastTimer;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2200);
  }

  function parseCodigoScan(valor) {
    const raw = String(valor || "").trim();
    if (!raw) return { codigo: "", campanha: "" };
    const partes = raw.split("|").map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 3 && partes[0].toUpperCase() === "INV") {
      return { campanha: partes[1], codigo: partes.slice(2).join("|") };
    }
    return { campanha: "", codigo: raw.replace(/^SAP\s*/i, "") };
  }

  function abrirPorCodigo(codigo) {
    const scan = parseCodigoScan(codigo);
    if (scan.campanha && scan.campanha !== campanhaId) {
      const camp = campanhasAbertas.find((c) => c.id === scan.campanha);
      if (camp) {
        selecionarCampanha(camp.id, scan.codigo);
        return;
      }
    }
    const key = codigoKey(scan.codigo);
    const item = catalogo?.itens?.find((i) => codigoKey(i.codigo) === key);
    if (!item) {
      showToast(`Código SAP ${key || codigo} não está na campanha selecionada.`);
      return;
    }
    el.search.value = String(item.codigo);
    busca = el.search.value;
    el.clearSearch.classList.remove("hidden");
    render();
    abrirModal(item.codigo);
  }

  function bindEvents() {
    window.addEventListener("online", () => {
      updateNetworkStatus();
      trySyncSupabase();
    });
    window.addEventListener("offline", updateNetworkStatus);

    document.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filtro = btn.dataset.filter;
        render();
      });
    });

    el.search.addEventListener("input", () => {
      busca = el.search.value;
      el.clearSearch.classList.toggle("hidden", !busca);
      render();
    });

    el.clearSearch.addEventListener("click", () => {
      el.search.value = "";
      busca = "";
      el.clearSearch.classList.add("hidden");
      render();
      el.search.focus();
    });

    el.lista.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (card) abrirModal(card.dataset.codigo);
    });

    el.lista.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const card = e.target.closest(".card");
        if (card) abrirModal(card.dataset.codigo);
      }
    });

    el.modal.querySelectorAll("[data-close]").forEach((n) => {
      n.addEventListener("click", fecharModal);
    });

    el.modalFisico.addEventListener("input", atualizarPreview);
    el.modalSave.addEventListener("click", salvarContagem);

    el.campanhaSelect?.addEventListener("change", () => {
      selecionarCampanha(el.campanhaSelect.value);
    });

    window.__inventarioAbrirScan = () => {
      if (!catalogo?.itens?.length) {
        showToast("Aguardando campanha aberta para escanear.");
        return;
      }
      if (!window.InventarioScanner) {
        showToast("Leitor QR indisponível.");
        return;
      }
      window.InventarioScanner.start(abrirPorCodigo);
    };
  }

  async function sbHeaders() {
    const base = CFG.SUPABASE_URL.replace(/\/$/, "");
    return {
      base,
      headers: {
        apikey: CFG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
      },
    };
  }

  function campanhaLabel(camp) {
    return `${camp.setor || "Setor"} · ${camp.nome || "Campanha"}`;
  }

  function renderCampanhaPicker() {
    if (!el.campanhaPicker || !el.campanhaSelect) return;
    el.campanhaSelect.innerHTML = campanhasAbertas
      .map((camp) => `<option value="${camp.id}">${escapeHtml(campanhaLabel(camp))}</option>`)
      .join("");
    el.campanhaSelect.value = campanhaId;
    el.campanhaPicker.classList.toggle("hidden", campanhasAbertas.length <= 1);
  }

  function campanhaInicial() {
    const params = new URLSearchParams(window.location.search);
    const daUrl = params.get("campanha");
    const salvo = localStorage.getItem(`${CFG.STORAGE_KEY}_campanha_atual`);
    const existe = (id) => campanhasAbertas.some((c) => c.id === id);
    if (daUrl && existe(daUrl)) return daUrl;
    if (salvo && existe(salvo)) return salvo;
    return campanhasAbertas[0]?.id || "";
  }

  async function carregarItensCampanha(camp, codigoAposCarregar = "") {
    const { base, headers } = await sbHeaders();
    campanhaId = camp.id;
    localStorage.setItem(`${CFG.STORAGE_KEY}_campanha_atual`, campanhaId);
    const itRes = await fetch(
      `${base}/rest/v1/inventario_item?campanha_id=eq.${camp.id}&select=codigo,descricao,qtd_sap,qtd_disponivel&order=codigo.asc`,
      { headers }
    );
    if (!itRes.ok) throw new Error("Falha ao carregar itens");
    const itens = await itRes.json();
    catalogo = {
      setor: camp.setor,
      campanha: camp.nome,
      itens: itens.map((i) => ({
        codigo: String(i.codigo).trim(),
        descricao: i.descricao,
        em_estoque: Number(i.qtd_sap) || 0,
        disponivel: Number(i.qtd_disponivel ?? i.qtd_sap) || 0,
      })),
    };
    contagens = loadContagens();
    modoAguardando = false;
    modoPiloto = false;
    renderCampanhaPicker();
    el.titulo.textContent = catalogo.setor || "Inventário";
    el.sub.textContent = catalogo.campanha || "";
    render();
    updateNetworkStatus();
    trySyncSupabase();
    if (codigoAposCarregar) abrirPorCodigo(codigoAposCarregar);
  }

  async function selecionarCampanha(id, codigoAposCarregar = "") {
    const camp = campanhasAbertas.find((c) => c.id === id);
    if (!camp) return;
    await carregarItensCampanha(camp, codigoAposCarregar);
  }

  async function carregarCatalogoSupabase() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return false;
    const { base, headers } = await sbHeaders();
    const campRes = await fetch(
      `${base}/rest/v1/inventario_campanha?status=eq.aberta&select=id,setor,nome,aberta_em&order=aberta_em.desc`,
      { headers }
    );
    if (!campRes.ok) throw new Error("Falha ao consultar campanha");
    campanhasAbertas = await campRes.json();
    if (!campanhasAbertas.length) {
      modoAguardando = true;
      return false;
    }
    const id = campanhaInicial();
    const camp = campanhasAbertas.find((c) => c.id === id) || campanhasAbertas[0];
    await carregarItensCampanha(camp);
    return true;
  }

  async function carregarCatalogoLocal() {
    const res = await fetch(CFG.DATA_URL);
    if (!res.ok) throw new Error("Falha ao carregar lista local");
    catalogo = await res.json();
    modoAguardando = false;
  }

  function renderAguardando() {
    el.titulo.textContent = "Aguardando campanha";
    el.sub.textContent = "Lista SAP será liberada na segunda de manhã";
    el.lista.innerHTML = `
      <div class="empty" style="padding:24px;line-height:1.6">
        <p><strong>Campanha ainda não aberta.</strong></p>
        <p>Na segunda cedo, a controladoria carrega o Excel SAP atualizado
        (baixas e quantidades do dia) e abre a campanha.</p>
        <p>Depois disso, atualize esta página (puxar para baixo ou F5).</p>
        <p style="color:var(--text3);font-size:12px;margin-top:12px">
          Modo piloto: troque DATA_URL em config.js para testar offline com JSON local.
        </p>
      </div>`;
    el.progressText.textContent = "—";
    el.accuracyText.textContent = "—";
    el.progressFill.style.width = "0%";
  }

  async function init() {
    bindEvents();
    try {
      let ok = false;
      if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
        try {
          ok = await carregarCatalogoSupabase();
        } catch (e) {
          console.warn("Supabase:", e);
        }
      }
      if (!ok) {
        if (modoAguardando && CFG.PILOTO_ENQUANTO_AGUARDA !== false) {
          try {
            await carregarCatalogoLocal();
            modoPiloto = true;
          } catch {
            renderAguardando();
            updateNetworkStatus();
            return;
          }
        } else if (modoAguardando) {
          renderAguardando();
          updateNetworkStatus();
          return;
        } else {
          await carregarCatalogoLocal();
        }
      }
      el.titulo.textContent = catalogo.setor || "Inventário";
      el.sub.textContent = modoPiloto
        ? "Modo teste · lista completa na segunda (F5)"
        : catalogo.campanha || "";
      render();
      updateNetworkStatus();
      trySyncSupabase();
    } catch (err) {
      el.lista.innerHTML = `<p class="empty">Erro ao carregar dados: ${escapeHtml(err.message)}</p>`;
    }
  }

  init();
})();
