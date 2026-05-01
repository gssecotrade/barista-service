(function () {
  const API_BASE =
    (window.ARTE_BARISTA_CONFIG && window.ARTE_BARISTA_CONFIG.apiBase) ||
    "https://barista.arte-coffee.com";

  const LOGO_MONOGRAM_SRC =
    "https://barista.arte-coffee.com/public/arte-coffee-monogram-white.png?v=300";
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
        <div id="arte-barista-input-shell">
          <textarea
            id="arte-barista-input"
            rows="1"
            placeholder="Escribe tu consulta…"
          ></textarea>
          <button id="arte-barista-send" type="button" aria-label="Enviar consulta">→</button>
        </div>
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);

    button.addEventListener("click", openPanel);

    const closeButton = document.getElementById("arte-barista-close");
    const input = document.getElementById("arte-barista-input");
    const sendButton = document.getElementById("arte-barista-send");

    if (!closeButton || !input || !sendButton) {
      console.error("Arte Barista: faltan elementos del widget en createUI()");
      return;
    }

    closeButton.addEventListener("click", closePanel);

    function autoResizeTextarea() {
      input.style.height = "auto";
      const nextHeight = Math.min(input.scrollHeight, 112);
      input.style.height = `${nextHeight}px`;
      input.style.overflowY = input.scrollHeight > 112 ? "auto" : "hidden";
    }

    async function submitCurrentMessage() {
      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      autoResizeTextarea();
      appendUserMessage(text);
      await sendMessage(text);
    }

    input.addEventListener("input", autoResizeTextarea);

    input.addEventListener("keydown", async function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        await submitCurrentMessage();
      }
    });

    sendButton.addEventListener("click", async function () {
      await submitCurrentMessage();
    });

    autoResizeTextarea();
  }

  async function openPanel() {
    const panel = document.getElementById("arte-barista-panel");
    panel.style.display = "flex";
    panel.style.zIndex = "2147483647";

    if (window.arteStartHideClubArte) {
      window.arteStartHideClubArte();
    }

    clearVisibleChat();

    appendLoading("Recuperando conversación...");

    try {
      const currentSession = await ensureSession(true);
      removeLoading();
      renderWelcomeView(currentSession);
    } catch {
      removeLoading();
      renderWelcomeView(null);
    }
  }

  function closePanel() {
    const panel = document.getElementById("arte-barista-panel");
    panel.style.display = "none";

    if (window.arteStopHideClubArte) {
      window.arteStopHideClubArte();
    }

    clearVisibleChat();
  }

  function clearVisibleChat() {
    const el = document.getElementById("arte-barista-messages");
    if (el) el.innerHTML = "";
  }

  function renderWelcomeView(currentSession) {
    const backendSummary =
      currentSession &&
      currentSession.state &&
      typeof currentSession.state.lastAssistantSummary === "string"
        ? currentSession.state.lastAssistantSummary
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
          appendAssistantMessage(
            "Perfecto. Empezamos de nuevo.\n\n¿Qué te apetece resolver hoy?"
          );
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

  function appendAssistantMessage(text, productData, showProductCard = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "arte-msg arte-msg-assistant";

    const bubble = document.createElement("div");
    bubble.className = "arte-bubble";
    bubble.innerHTML = formatText(cleanAssistantText(text));
    wrapper.appendChild(bubble);

    if (showProductCard) {
      const productList =
        Array.isArray(productData?.products) && productData.products.length
          ? productData.products
          : Array.isArray(productData)
          ? productData
          : productData
          ? [productData]
          : [];
    
      const cards = renderProductCards(productList);
    
      if (cards) {
        wrapper.appendChild(cards);
      }
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

  function buildProductCard(product) {
    if (!product) return null;

    const safeName = escapeHtml(product.name || "");
    const safeUrl = escapeHtml(product.url || "#");
    const safeHandle = escapeHtml(product.handle || "");
    const safeCtaTitle = escapeHtml(getContextualCtaTitle(product));

    const card = document.createElement("div");
    card.className = "arte-card arte-card--sales";

    card.innerHTML = `
      <div class="arte-card-minimal">
        <div class="arte-card-minimal-main">
          <div class="arte-card-kicker">${escapeHtml(getContextualCardLabel(product))}</div>
          <div class="arte-card-title">${safeName}</div>
          <div class="arte-card-chips">${buildProductChips(product)}</div>
        </div>

        <div class="arte-card-actions arte-card-actions--sales">
          <button
            type="button"
            class="arte-card-buy-button"
            onclick="return window.arteBaristaAddToCart('${safeHandle}', this)"
            aria-label="Añadir ${safeName} al carrito"
          >
            Añadir al carrito
          </button>

          <a
            href="${safeUrl}?ref=barista"
            rel="noopener noreferrer"
            title="${safeCtaTitle}"
            onclick="return window.arteBaristaNavigate('${safeHandle}')"
            data-product-click="true"
            data-product-handle="${safeHandle}"
          >
            Ver producto
          </a>

          <div class="arte-card-feedback" aria-live="polite"></div>
        </div>
      </div>
    `;

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

    return card;
  }
  
  function renderProductCards(products) {
    if (!Array.isArray(products) || !products.length) return null;

    const unique = [];
    const seen = new Set();

    products.forEach((product) => {
      const handle = String(product?.handle || "").trim();
      if (!handle || seen.has(handle)) return;
      seen.add(handle);
      unique.push(product);
    });

    if (!unique.length) return null;

    const container = document.createElement("div");
    container.className = "arte-card-list";

    // 🔥 PACK REAL (prioridad sobre combinación manual)
    if (unique.length > 1) {
      const handles = unique.map(p => p.handle);

      let pack = null;

      // 👉 lógica basada en tus packs reales
      if (handles.includes("catuai") && handles.includes("pacamara")) {
        pack = {
          name: "Pack Coffee Lover - Selección especial - 1 kg",
          handle: "pack-coffee-lover-seleccion-especial",
          url: "https://arte-coffee.com/products/pack-coffee-lover-seleccion-especial"
        };
      }

      if (handles.includes("catuai") && unique.length === 1) {
        pack = {
          name: "Pack Daily Coffee - Consumo diario - 1 kg",
          handle: "pack-daily-coffee-consumo-diario",
          url: "https://arte-coffee.com/products/pack-daily-coffee-consumo-diario"
        };
      }

      if (pack) {
        const packWrapper = document.createElement("div");
        packWrapper.className = "arte-pack-wrapper";

        packWrapper.innerHTML = `
          <div class="arte-pack-card">
            <div class="arte-card-kicker">RECOMENDACIÓN ARTE COFFEE</div>
            <div class="arte-card-title">${pack.name}</div>

            <div class="arte-card-actions arte-card-actions--sales">
              <button
                class="arte-card-buy-button"
                onclick="return window.arteBaristaAddToCart('${pack.handle}', this)"
              >
                Añadir pack al carrito
              </button>

              <a href="${pack.url}?ref=barista">
                Ver pack
              </a>
            </div>
          </div>
        `;

        container.appendChild(packWrapper);
        return container; // 🔥 importante: no mostrar productos sueltos
      }
    }

    // productos individuales
    unique.slice(0, 3).forEach((product) => {
      const card = buildProductCard(product);
      if (card) container.appendChild(card);
    });

    return container;
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
          state: data.state || null,
          welcomeBack: Boolean(data.welcomeBack),
          welcomeBackSummary: data.welcomeBackSummary || "",
        });
        return session;
      })
      .finally(() => {
        sessionPromise = null;
      });

    return sessionPromise;
  }

  function getIntentLabel(intent) {
    if (!intent) return null;

    const normalized = String(intent).toLowerCase();

    if (normalized.includes("pair")) return "maridaje";
    if (normalized.includes("recipe")) return "receta";
    if (normalized.includes("cocktail")) return "cóctel";
    if (normalized.includes("mocktail")) return "propuesta sin alcohol";
    if (normalized.includes("order")) return "compra";
    if (normalized.includes("subscription")) return "suscripción";
    if (normalized.includes("professional")) return "propuesta para tu local";
    if (normalized.includes("select")) return "recomendación de café";
    if (normalized.includes("prepar")) return "forma de preparación";

    return "recomendación";
  }

  function prettyCoffeeName(coffee) {
    if (!coffee) return null;

    const normalized = String(coffee).toLowerCase();

    if (normalized.includes("catuai")) return "Catuai";
    if (normalized.includes("geisha")) return "Geisha";
    if (normalized.includes("pacamara")) return "Pacamara";

    return coffee;
  }

  function getSmartFallbackMessage() {
    return "Ahora mismo no he podido procesar tu consulta. Escríbemela de nuevo en una frase y te respondo sin arrastrar contexto anterior.";
  }

  function getContextualCtaLabel(product) {
    const lastIntent = String(conversationState?.lastIntent || "").toLowerCase();
    const lastCoffee = String(conversationState?.lastCoffee || "").toLowerCase();
    const handle = String(product?.handle || "").toLowerCase();

    if (
      lastIntent.includes("professional") ||
      lastIntent.includes("local") ||
      lastIntent.includes("negocio") ||
      lastIntent.includes("carta")
    ) {
      return "Café recomendado";
    }

    if (
      lastIntent.includes("pair") ||
      lastIntent.includes("marid") ||
      lastIntent.includes("postre") ||
      lastIntent.includes("recipe") ||
      lastIntent.includes("receta")
    ) {
      return "Café recomendado";
    }

    if (
      lastIntent.includes("cocktail") ||
      lastIntent.includes("mocktail") ||
      lastIntent.includes("sin alcohol")
    ) {
      return "Café recomendado";
    }

    if (
      lastIntent.includes("order") ||
      lastIntent.includes("compra") ||
      lastIntent.includes("subscription")
    ) {
      return "Café recomendado";
    }

    if (handle && lastCoffee && handle.includes(lastCoffee)) {
      return "Café recomendado";
    }

    return "Café recomendado";
  }

  function getContextualCtaTitle(product) {
    const lastIntent = String(conversationState?.lastIntent || "").toLowerCase();

    if (
      lastIntent.includes("professional") ||
      lastIntent.includes("local") ||
      lastIntent.includes("negocio") ||
      lastIntent.includes("carta")
    ) {
      return "Café recomendado recomendado para esta propuesta de carta";
    }

    if (
      lastIntent.includes("pair") ||
      lastIntent.includes("marid") ||
      lastIntent.includes("postre") ||
      lastIntent.includes("recipe") ||
      lastIntent.includes("receta")
    ) {
      return "Café recomendado para este maridaje o receta";
    }

    if (
      lastIntent.includes("cocktail") ||
      lastIntent.includes("mocktail") ||
      lastIntent.includes("sin alcohol")
    ) {
      return "Café recomendado recomendado para esta elaboración";
    }

    return "Café recomendado";
  }

  function getContextualCardLabel(product) {
    const lastIntent = String(conversationState?.lastIntent || "").toLowerCase();

    if (
      lastIntent.includes("professional") ||
      lastIntent.includes("local") ||
      lastIntent.includes("negocio") ||
      lastIntent.includes("carta")
    ) {
      return "Café recomendado para carta";
    }

    if (
      lastIntent.includes("pair") ||
      lastIntent.includes("marid") ||
      lastIntent.includes("postre") ||
      lastIntent.includes("recipe") ||
      lastIntent.includes("receta")
    ) {
      return "Café recomendado para esta propuesta";
    }

    if (
      lastIntent.includes("cocktail") ||
      lastIntent.includes("mocktail") ||
      lastIntent.includes("sin alcohol")
    ) {
      return "Base recomendada";
    }

    return "Café sugerido";
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
      let errorText = "";
      try {
        errorText = await res.text();
      } catch {}

      console.error("BARISTA /chat HTTP ERROR", res.status, errorText);

      removeLoading();
      appendAssistantMessage(
        "Ahora mismo no he podido procesar tu consulta. Escríbemela de nuevo en una frase y te respondo sin arrastrar contexto anterior."
      );
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

    const responseProducts =
      Array.isArray(data.products) && data.products.length
        ? data.products
        : data.product
        ? [data.product]
        : [];

    if (responseProducts.length) {
      const firstProduct = responseProducts[0];
      const newCoffee = firstProduct?.name || "";

      showProductCard =
        responseProducts.length > 1 ||
        !previousCoffee ||
        previousCoffee !== newCoffee;

      if (newCoffee) {
        conversationState.lastCoffee = newCoffee;
      }
    } else if (data.state?.activeCoffee) {
      conversationState.lastCoffee = data.state.activeCoffee;
    }

    saveState();

    if (session) {
      session.profile = session.profile || {};
      session.state = data.state || session.state || null;

      saveSessionCache({
        externalUserId,
        userId: session.userId,
        profile: session.profile,
        state: session.state,
        welcomeBack: true,
        welcomeBackSummary: conversationState.lastSummary || "",
      });
    }

    const forcedShowProductCard = responseProducts.length > 0;

    appendAssistantMessage(
      data.reply || "No he podido responder.",
      responseProducts.length > 1
        ? responseProducts
        : responseProducts[0] || null,
      forcedShowProductCard
    );

  } catch (error) {
    console.error("BARISTA sendMessage ERROR", error);
    removeLoading();
    appendAssistantMessage(
      "Ahora mismo no he podido procesar tu consulta. Escríbemela de nuevo en una frase y te respondo sin arrastrar contexto anterior."
    );
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

(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const highlight = params.get('highlight');

    if (!highlight) return;

    setTimeout(() => {
      const el = document.querySelector(`[data-product-handle="${highlight}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #c9a96e';
        el.style.outlineOffset = '4px';
      }
    }, 900);
  } catch (e) {}
})();

window.arteBaristaNavigate = function (handle) {
  try {
    const isCollection = window.location.pathname.includes('/collections');

    if (!isCollection) {
      window.location.href = `/collections/all?highlight=${handle}`;
      return false;
    }

    const el = document.querySelector(`[data-product-handle="${handle}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.location.href = `/products/${handle}`;
    }

    return false;
  } catch (e) {
    window.location.href = `/products/${handle}`;
    return false;
  }
};

window.arteBaristaAddToCart = async function (handle, trigger) {
  try {
    const button = trigger || null;

    if (button) {
      button.disabled = true;
      button.classList.remove('is-added', 'is-error');
      button.classList.add('is-loading');
    }

    const productUrl = `/products/${handle}.js`;
    const productRes = await fetch(productUrl);

    if (!productRes.ok) {
      window.location.href = `/products/${handle}`;
      return false;
    }

    const product = await productRes.json();
    const firstAvailableVariant = (product.variants || []).find((v) => v.available);

    if (!firstAvailableVariant) {
      window.location.href = `/products/${handle}`;
      return false;
    }

    const addRes = await fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        id: firstAvailableVariant.id,
        quantity: 1,
      }),
    });

    if (!addRes.ok) {
      window.location.href = `/products/${handle}`;
      return false;
    }

    if (button) {
      button.classList.remove('is-loading');
      button.classList.add('is-added');
      button.disabled = false;

      const feedback = button.closest('.arte-card')?.querySelector('.arte-card-feedback');
      if (feedback) {
        feedback.textContent = 'Añadido al carrito';
        feedback.classList.add('is-visible');
      }

      setTimeout(() => {
        button.classList.remove('is-added');
        const feedbackLater = button.closest('.arte-card')?.querySelector('.arte-card-feedback');
        if (feedbackLater) {
          feedbackLater.classList.remove('is-visible');
        }
      }, 1800);
    }

    return false;
  } catch (e) {
    if (trigger) {
      trigger.classList.remove('is-loading');
      trigger.classList.add('is-error');
      trigger.disabled = false;

      const feedback = trigger.closest('.arte-card')?.querySelector('.arte-card-feedback');
      if (feedback) {
        feedback.textContent = 'No se pudo añadir';
        feedback.classList.add('is-visible');
      }

      setTimeout(() => {
        trigger.classList.remove('is-error');
        const feedbackLater = trigger.closest('.arte-card')?.querySelector('.arte-card-feedback');
        if (feedbackLater) {
          feedbackLater.classList.remove('is-visible');
        }
      }, 1800);
    }

    return false;
  }
(function forceHideClubArteWhenBaristaIsOpen() {
  let timer = null;

  function hideClubArte() {
    document.querySelectorAll("body *").forEach((el) => {
      if (el.closest("#arte-barista-panel") || el.closest("#arte-barista-button")) return;

      const text = (el.innerText || el.textContent || "").toLowerCase();
      const rect = el.getBoundingClientRect();

      const isClubArteText = text.includes("club arte");

      const isBlockingInput =
        rect.right > window.innerWidth - 260 &&
        rect.bottom > window.innerHeight - 170 &&
        rect.width > 60 &&
        rect.height > 35;

      if (isClubArteText || isBlockingInput) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("opacity", "0", "important");
        el.style.setProperty("pointer-events", "none", "important");
      }
    });
  }

  function startHideClubArte() {
    hideClubArte();
    if (timer) clearInterval(timer);
    timer = setInterval(hideClubArte, 200);
  }

  function stopHideClubArte() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  window.arteStartHideClubArte = startHideClubArte;
  window.arteStopHideClubArte = stopHideClubArte;
})();
};