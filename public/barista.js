(function () {
  const API_BASE =
    (window.ARTE_BARISTA_CONFIG && window.ARTE_BARISTA_CONFIG.apiBase) ||
    "https://clone-reach-quebec-arena.trycloudflare.com";

  const LOGO_MONOGRAM_SRC = `${API_BASE}/public/arte-coffee-monogram-white.png`;
  const STORAGE_KEY = "arte_barista_ui_state_v6";

  let panelOpen = false;
  let initialized = false;
  let session = null;

  const existingUserId = localStorage.getItem("arte_barista_external_user_id");
  const externalUserId =
    existingUserId || "arte-" + Math.random().toString(36).slice(2, 12);

  localStorage.setItem("arte_barista_external_user_id", externalUserId);

  const uiState = loadState() || {
    isKnownUser: false,
  };

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
    document
      .getElementById("arte-barista-close")
      .addEventListener("click", closePanel);

    const input = document.getElementById("arte-barista-input");
    input.addEventListener("keydown", async function (e) {
      if (e.key === "Enter") {
        const text = input.value.trim();
        if (!text) return;

        input.value = "";
        appendUserMessage(text);
        await sendMessage(text);
      }
    });
  }

  function updateButtonVisibility() {
    const button = document.getElementById("arte-barista-button");
    if (!button) return;

    if (panelOpen) {
      button.classList.add("is-hidden");
    } else {
      button.classList.remove("is-hidden");
    }
  }

  async function openPanel() {
    const panel = document.getElementById("arte-barista-panel");
    panelOpen = true;
    panel.style.display = "flex";
    updateButtonVisibility();
    clearVisibleChat();

    try {
      await ensureSession();
      renderEntryViewFromBackend();
    } catch (e) {
      renderFallbackWelcome();
    }
  }

  function closePanel() {
    const panel = document.getElementById("arte-barista-panel");
    panelOpen = false;
    panel.style.display = "none";
    updateButtonVisibility();
    clearVisibleChat();
  }

  function clearVisibleChat() {
    const el = document.getElementById("arte-barista-messages");
    if (el) el.innerHTML = "";
  }

  function renderFallbackWelcome() {
    if (uiState.isKnownUser) {
      appendAssistantMessage("Bienvenido de nuevo.\n\n¿En qué puedo ayudarte hoy?");
    } else {
      appendAssistantMessage("Bienvenido a Arte Coffee.\n\n¿En qué puedo ayudarte?");
    }
  }

  function renderEntryViewFromBackend() {
    if (!session) {
      renderFallbackWelcome();
      return;
    }

    uiState.isKnownUser = true;
    saveState();

    if (session.resumeAvailable) {
      appendAssistantMessage(
        `${session.greeting}\n\nLa última vez estuvimos hablando de ${session.resumeSummary}.\n\n¿Quieres continuar con eso o prefieres una nueva consulta?`
      );

      appendActionChoices([
        {
          label: "Continuar",
          action: () => {
            appendUserMessage("Continuar conversación");
            appendAssistantMessage(buildContinuationPromptFromSession());
          },
        },
        {
          label: "Nueva consulta",
          action: async () => {
            await resetConversationInBackend();
            appendUserMessage("Nueva consulta");
            appendAssistantMessage("De acuerdo.\n\n¿En qué puedo ayudarte ahora?");
          },
        },
      ]);

      return;
    }

    appendAssistantMessage(`${session.greeting}\n\n¿En qué puedo ayudarte?`);
  }

  function buildContinuationPromptFromSession() {
    const parts = [];

    if (session.lastCoffee) {
      parts.push(`Seguíamos con ${session.lastCoffee}`);
    }

    if (session.lastIntent) {
      parts.push(`en torno a ${friendlyIntent(session.lastIntent)}`);
    }

    if (!parts.length && session.lastUserMessage) {
      parts.push(`Tu última consulta fue: "${session.lastUserMessage}"`);
    }

    const base = parts.length
      ? parts.join(" ")
      : "Retomamos tu consulta anterior";

    return `${base}.\n\nPuedes seguir justo por ahí o plantearme una variante nueva.`;
  }

  function friendlyIntent(intent) {
    const map = {
      recommend_coffee: "la selección del café",
      brewing_guidance: "la preparación",
      pairing: "el maridaje",
      cocktails: "la coctelería con café",
      subscription: "las suscripciones",
      orders: "los pedidos",
      support: "una consulta de soporte",
    };

    return map[intent] || intent || "la conversación anterior";
  }

  function appendActionChoices(actions) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";

    const inner = document.createElement("div");
    inner.className = "arte-bubble";
    inner.style.background = "transparent";
    inner.style.border = "0";
    inner.style.boxShadow = "none";
    inner.style.padding = "0";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.flexWrap = "wrap";

    actions.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.label;
      btn.style.minHeight = "40px";
      btn.style.padding = "0 14px";
      btn.style.borderRadius = "999px";
      btn.style.border = "1px solid rgba(201, 169, 110, 0.28)";
      btn.style.background = "#fffdfa";
      btn.style.color = "#2a241d";
      btn.style.fontSize = "14px";
      btn.style.fontWeight = "600";
      btn.style.cursor = "pointer";

      btn.addEventListener("click", item.action);
      row.appendChild(btn);
    });

    inner.appendChild(row);
    wrapper.appendChild(inner);
    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function messagesEl() {
    return document.getElementById("arte-barista-messages");
  }

  function scrollToBottom() {
    const el = messagesEl();
    el.scrollTop = el.scrollHeight;
  }

  function appendAssistantMessage(text, product, showProductCard = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";

    let html = `<div class="arte-bubble">${formatText(text)}</div>`;

    if (product && showProductCard) {
      const safeImage = escapeHtml(product.image || "");
      const safeName = escapeHtml(product.name || "");
      const safeReason = escapeHtml(product.reason || "");
      const safeUrl = escapeHtml(product.url || "#");
      const safeHandle = escapeHtml(product.handle || "");

      html += `
        <div class="arte-card">
          <div class="arte-card-hero">
            ${
              safeImage
                ? `<div class="arte-card-image">
                     <img src="${safeImage}" alt="${safeName}" onerror="this.closest('.arte-card-image').style.display='none'" />
                   </div>`
                : ""
            }
            <div>
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
        </div>
      `;
    }

    wrapper.innerHTML = html;
    messagesEl().appendChild(wrapper);

    wrapper.querySelectorAll("[data-product-click='true']").forEach((link) => {
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
        } catch (e) {}
      });
    });

    scrollToBottom();
  }

  function appendUserMessage(text) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-user";
    wrapper.innerHTML = `<div class="arte-bubble">${escapeHtml(text)}</div>`;
    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function appendLoading() {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";
    wrapper.id = "arte-barista-loading";
    wrapper.innerHTML = `<div class="arte-bubble">Pensando…</div>`;
    messagesEl().appendChild(wrapper);
    scrollToBottom();
  }

  function removeLoading() {
    const loading = document.getElementById("arte-barista-loading");
    if (loading) loading.remove();
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

    const chips = map[product.handle] || [];

    return chips
      .map((chip) => `<span class="arte-chip">${escapeHtml(chip)}</span>`)
      .join("");
  }

  async function ensureSession() {
    if (session) return session;

    const res = await fetch(`${API_BASE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalUserId }),
    });

    session = await res.json();
    return session;
  }

  async function resetConversationInBackend() {
    const currentSession = await ensureSession();

    await fetch(`${API_BASE}/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentSession.userId,
      }),
    });

    session = {
      ...session,
      resumeAvailable: false,
      resumeSummary: "",
      lastCoffee: "",
      lastIntent: "",
      lastUserMessage: "",
      lastAssistantReply: "",
      lastInteractionAt: "",
    };
  }

  async function sendMessage(message) {
    try {
      appendLoading();

      const currentSession = await ensureSession();
      const previousCoffee = session?.lastCoffee || "";

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentSession.userId,
          message,
        }),
      });

      const data = await res.json();
      removeLoading();

      let showProductCard = false;

      if (data.product?.name) {
        const newCoffee = data.product.name;
        showProductCard = !previousCoffee || previousCoffee !== newCoffee;
      }

      session = {
        ...session,
        resumeAvailable: true,
        resumeSummary: data.product?.name || session.resumeSummary || "",
        lastCoffee: data.product?.name || session.lastCoffee || "",
        lastIntent: data.intent || "",
        lastUserMessage: message,
        lastAssistantReply: data.reply || "",
        lastInteractionAt: new Date().toISOString(),
      };

      uiState.isKnownUser = true;
      saveState();

      appendAssistantMessage(
        data.reply || "No he podido responder.",
        data.product,
        showProductCard
      );
    } catch (error) {
      removeLoading();
      appendAssistantMessage(
        "Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos."
      );
    }
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    createUI();
    updateButtonVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
