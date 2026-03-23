(function () {
  const API_BASE =
    (window.ARTE_BARISTA_CONFIG && window.ARTE_BARISTA_CONFIG.apiBase) ||
    "https://barista.arte-coffee.com";

  const LOGO_MONOGRAM_SRC = "https://barista.arte-coffee.com/public/arte-coffee-monogram-white.png?v=300";
  const STORAGE_KEY = "arte_barista_ui_state_v5";
  const USER_KEY = "arte_barista_external_user_id";
  const SESSION_KEY = "arte_barista_session_cache_v1";

  let initialized = false;
  let session = null;
  let sessionPromise = null;

  const externalUserId = getOrCreateExternalUserId();

  const conversationState = loadState() || {
    hasStarted: false,
    isKnownUser: false,
    lastCoffee: "",
    lastIntent: "",
    lastSummary: "",
  };

  function getOrCreateExternalUserId() {
    const existing = localStorage.getItem(USER_KEY);
    if (existing && typeof existing === "string" && existing.trim()) {
      return existing;
    }

    const created = "arte-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(USER_KEY, created);
    return created;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationState));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSessionCache(value) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch {}
  }

  function loadSessionCache() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function createUI() {
    if (document.getElementById("arte-barista-button")) return;

    const button = document.createElement("button");
    button.id = "arte-barista-button";
    button.setAttribute("aria-label", "Abrir Tu Barista");
    button.innerHTML = `
      <img src="${LOGO_MONOGRAM_SRC}" alt="Arte Coffee" onerror="this.style.display='none'" />
      <span id="arte-barista-button-label">Tu Barista</span>
    `;

    const panel = document.createElement("div");
    panel.id = "arte-barista-panel";

    panel.innerHTML = `
      <div id="arte-barista-header">
        <div id="arte-barista-header-top">
          <div id="arte-barista-brand">
            <div id="arte-barista-brand-mark">
              <img src="${LOGO_MONOGRAM_SRC}" alt="Arte Coffee" onerror="this.style.display='none'" />
            </div>
            <div id="arte-barista-brand-copy">
              <div id="arte-barista-header-title">Tu Barista</div>
              <div id="arte-barista-header-subtitle">Arte Coffee · Selección, preparación y experiencia</div>
            </div>
          </div>
          <button id="arte-barista-close" aria-label="Cerrar">×</button>
        </div>
      </div>
      <div id="arte-barista-messages"></div>
      <div id="arte-barista-input-wrap">
        <input id="arte-barista-input" type="text" placeholder="Escribe tu consulta…" />
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);

    button.addEventListener("click", openPanel);
    document.getElementById("arte-barista-close").addEventListener("click", closePanel);

    const input = document.getElementById("arte-barista-input");
    input.addEventListener("keydown", async function (e) {
      if (e.key !== "Enter") return;

      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      appendUserMessage(text);
      await sendMessage(text);
    });
  }

  async function openPanel() {
    const panel = document.getElementById("arte-barista-panel");
    panel.style.display = "flex";
    clearVisibleChat();

    appendLoading("Recuperando conversación…");

    try {
      const currentSession = await ensureSession(true);
      removeLoading();
      renderWelcomeView(currentSession);
    } catch (e) {
      removeLoading();
      renderWelcomeView(null);
    }
  }

  function closePanel() {
    const panel = document.getElementById("arte-barista-panel");
    panel.style.display = "none";
    clearVisibleChat();
  }

  function clearVisibleChat() {
    const el = document.getElementById("arte-barista-messages");
    if (el) el.innerHTML = "";
  }

  function renderWelcomeView(currentSession) {
    const backendSummary =
      currentSession &&
      currentSession.profile &&
      currentSession.profile.state &&
      typeof currentSession.profile.state.lastAssistantSummary === "string"
        ? currentSession.profile.state.lastAssistantSummary
        : "";

    const localSummary = conversationState.lastSummary || "";

    const summary = backendSummary || localSummary;

    if (summary) {
      appendAssistantMessage(
        `Bienvenido de nuevo.\n\n${summary}\n\n¿Quieres continuar con eso o prefieres una nueva consulta?`
      );
      appendChoiceButtons();
      conversationState.isKnownUser = true;
      saveState();
      return;
    }

    if (conversationState.isKnownUser || conversationState.hasStarted) {
      appendAssistantMessage("Bienvenido de nuevo.\n\n¿En qué puedo ayudarte hoy?");
    } else {
      appendAssistantMessage("Bienvenido a Arte Coffee.\n\n¿En qué puedo ayudarte?");
    }
  }

  function appendChoiceButtons() {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";

    wrapper.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="arte-choice-btn" data-choice="continue">Continuar</button>
        <button class="arte-choice-btn" data-choice="new">Nueva consulta</button>
      </div>
    `;

    messagesEl().appendChild(wrapper);

    wrapper.querySelectorAll(".arte-choice-btn").forEach((btn) => {
      btn.addEventListener("click", async function () {
        const choice = this.getAttribute("data-choice");

        if (choice === "continue") {
          appendUserMessage("Continuar conversación");
          await sendMessage("Quiero continuar con la conversación anterior");
        } else {
          conversationState.lastSummary = "";
          conversationState.lastIntent = "";
          conversationState.lastCoffee = "";
          saveState();
          appendUserMessage("Nueva consulta");
          appendAssistantMessage("Perfecto. Empezamos de nuevo.\n\n¿Qué te apetece resolver hoy?");
        }

        wrapper.remove();
      });
    });

    scrollToBottom();
  }

  function messagesEl() {
    return document.getElementById("arte-barista-messages");
  }

  function scrollToBottom() {
    const el = messagesEl();
    if (el) el.scrollTop = el.scrollHeight;
  }

  function appendAssistantMessage(text, product, showProductCard = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";

    const bubble = document.createElement("div");
    bubble.className = "arte-bubble";
    bubble.innerHTML = formatText(cleanAssistantText(text));
    wrapper.appendChild(bubble);

    if (product && showProductCard) {
      const safeImage = escapeHtml(product.image || "");
      const safeName = escapeHtml(product.name || "");
      const safeReason = escapeHtml(product.reason || "");
      const safeUrl = escapeHtml(product.url || "#");
      const safeHandle = escapeHtml(product.handle || "");

      const card = document.createElement("div");
      card.className = "arte-card";

      card.innerHTML = `
        <div class="arte-card-hero">
          ${
            safeImage
              ? `<div class="arte-card-image">
                   <img src="${safeImage}" alt="${safeName}" onerror="this.closest('.arte-card-image').style.display='none'" />
                 </div>`
              : ""
          }
          <div class="arte-card-main">
            <div class="arte-card-kicker">Selección recomendada</div>
            <div class="arte-card-title">${safeName}</div>
            <div class="arte-card-chips">${buildProductChips(product)}</div>
          </div>
        </div>
        <div class="arte-card-body">
          <div class="arte-card-text">${safeReason}</div>
          <div class="arte-card-actions">
            <a
              href="${safeUrl}"
              target="_blank"
              rel="noopener noreferrer"
              data-product-click="true"
              data-product-handle="${safeHandle}"
            >Descubrir este café</a>
          </div>
        </div>
      `;

      wrapper.appendChild(card);

      card.querySelectorAll("[data-product-click='true']").forEach((link) => {
        link.addEventListener("click", async function () {
          try {
            const currentSession = await ensureSession();

            await fetch(`${API_BASE}/track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: currentSession.userId,
                type: "product_clicked",
                meta: {
                  handle: this.getAttribute("data-product-handle") || "",
                },
              }),
            });
          } catch {}
        });
      });
    }

    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function appendUserMessage(text) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-user";
    wrapper.innerHTML = `<div class="arte-bubble">${escapeHtml(text)}</div>`;
    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function appendLoading(text = "Pensando…") {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";
    wrapper.id = "arte-barista-loading";
    wrapper.innerHTML = `<div class="arte-bubble">${escapeHtml(text)}</div>`;
    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function removeLoading() {
    const loading = document.getElementById("arte-barista-loading");
    if (loading) loading.remove();
  }

  function cleanAssistantText(str) {
    return String(str)
      .replaceAll("continue_cocktail_discussion", "la conversación anterior")
      .replaceAll("continue_pairing_discussion", "la conversación anterior")
      .replaceAll("continue_preparation_discussion", "la conversación anterior")
      .replaceAll("continue_selection_discussion", "la conversación anterior")
      .replaceAll("preparar_postre_con_cafe", "preparar un postre con café");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatText(str) {
    return escapeHtml(String(str)).replace(/\n/g, "<br>");
  }

  function buildProductChips(product) {
    if (!product?.handle) return "";

    const map = {
      catuai: ["Suave", "Equilibrado", "Versátil"],
      geisha: ["Floral", "Elegante", "Aromático"],
      pacamara: ["Intenso", "Con cuerpo", "Complejo"],
    };

    return (map[product.handle] || [])
      .map((chip) => `<span class="arte-chip">${escapeHtml(chip)}</span>`)
      .join("");
  }

  async function ensureSession(forceRefresh = false) {
    if (!forceRefresh && session) return session;
    if (!forceRefresh && sessionPromise) return sessionPromise;

    const cached = loadSessionCache();
    if (!forceRefresh && cached && cached.externalUserId === externalUserId && cached.userId) {
      session = cached;
      return session;
    }

    sessionPromise = fetch(`${API_BASE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalUserId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("session_error");
        const data = await res.json();
        session = data;
        saveSessionCache({
          externalUserId,
          userId: data.userId,
          profile: data.profile || null,
        });
        return session;
      })
      .finally(() => {
        sessionPromise = null;
      });

    return sessionPromise;
  }

  async function sendMessage(message) {
    try {
      appendLoading();

      const currentSession = await ensureSession();
      const previousCoffee = conversationState.lastCoffee || "";

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentSession.userId,
          message,
          context: {
            lastCoffee: conversationState.lastCoffee || null,
            lastIntent: conversationState.lastIntent || null,
          },
        }),
      });

      if (!res.ok) {
        removeLoading();
        appendAssistantMessage("Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos.");
        return;
      }

      const data = await res.json();
      removeLoading();

      conversationState.hasStarted = true;
      conversationState.isKnownUser = true;
      conversationState.lastIntent = data.intent || "";
      conversationState.lastSummary =
        data.state && data.state.lastAssistantSummary
          ? data.state.lastAssistantSummary
          : conversationState.lastSummary || "";

      let showProductCard = false;

      if (data.product?.name) {
        const newCoffee = data.product.name;
        showProductCard = !previousCoffee || previousCoffee !== newCoffee;
        conversationState.lastCoffee = newCoffee;
      } else if (data.state?.activeCoffee) {
        conversationState.lastCoffee = data.state.activeCoffee;
      }

      saveState();

      if (session) {
        session.profile = session.profile || {};
        session.profile.state = data.state || session.profile.state || null;
        saveSessionCache({
          externalUserId,
          userId: session.userId,
          profile: session.profile,
        });
      }

      appendAssistantMessage(
        data.reply || "No he podido responder.",
        data.product,
        showProductCard
      );
    } catch {
      removeLoading();
      appendAssistantMessage("Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos.");
    }
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    createUI();

    try {
      await ensureSession();
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
