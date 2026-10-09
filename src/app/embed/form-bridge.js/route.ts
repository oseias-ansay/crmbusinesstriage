/**
 * Script de captura para sites de clientes (sem mexer no código do site).
 *
 *   <script src="https://crm.SEU-DOMINIO/embed/form-bridge.js" data-tenant="slug-do-tenant" defer></script>
 *
 * Escuta o envio de QUALQUER formulário da página (inclusive React/Formspree) e manda uma
 * cópia para POST /api/forms/<tenant>. Não bloqueia nem altera o envio original.
 * Opcional no <script>: data-form="site-contato" (formId) e data-selector="form.contato"
 * (só esses formulários). Para ignorar um formulário: <form data-crm-ignore>.
 */
const JS = String.raw`(function () {
  var me = document.currentScript; if (!me) return;
  var tenant = me.getAttribute("data-tenant"); if (!tenant) return;
  var endpoint = new URL("/api/forms/" + encodeURIComponent(tenant), me.src).href;
  var formId = me.getAttribute("data-form") || "site";
  var selector = me.getAttribute("data-selector");

  // Guarda UTMs da primeira página visitada na sessão.
  try {
    var q = new URLSearchParams(location.search), utm = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k); });
    if (Object.keys(utm).length) sessionStorage.setItem("crm_utm", JSON.stringify(utm));
  } catch (e) {}

  var ALIASES = {
    name: ["name", "nome", "full_name", "fullname", "nome_completo", "your-name"],
    email: ["email", "e-mail", "mail", "your-email"],
    phone: ["phone", "telefone", "tel", "celular", "whatsapp", "fone", "your-phone"],
    company: ["company", "empresa", "organization", "negocio", "razao_social"],
    message: ["message", "mensagem", "msg", "comentario", "observacoes", "your-message"],
  };
  function key(el) { return (el.name || el.id || el.getAttribute("aria-label") || el.placeholder || "").trim(); }
  function norm(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_"); }

  function collect(form) {
    var out = {}, extras = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.tagName || el.disabled) return;
      var t = (el.type || "").toLowerCase();
      if (["submit", "button", "file", "password", "hidden"].indexOf(t) >= 0 && norm(key(el)) !== "website") return;
      if ((t === "checkbox" || t === "radio") && !el.checked) return;
      var k = key(el), v = (el.value || "").trim();
      if (!k || !v) return;
      var n = norm(k), hit = null;
      if (n === "website" || n === "_gotcha") { out.website = v; return; }
      Object.keys(ALIASES).forEach(function (f) { if (!hit && ALIASES[f].indexOf(n) >= 0) hit = f; });
      if (!hit && t === "email") hit = "email";
      if (!hit && t === "tel") hit = "phone";
      if (hit && !out[hit]) out[hit] = v; else extras[n] = extras[n] ? extras[n] + ", " + v : v;
    });
    return Object.assign(extras, out);
  }

  document.addEventListener("submit", function (ev) {
    var form = ev.target;
    if (!form || form.tagName !== "FORM" || form.hasAttribute("data-crm-ignore")) return;
    if (selector && !form.matches(selector)) return;
    var data = collect(form);
    if (!data.name) data.name = data.email || data.phone || "";
    if (!data.name || (!data.email && !data.phone)) return; // não é formulário de lead
    data.formId = form.getAttribute("data-crm-form") || form.id || formId;
    data.pagina = location.href;
    try { var u = JSON.parse(sessionStorage.getItem("crm_utm") || "{}"); for (var k in u) data[k] = u[k]; } catch (e) {}
    var body = JSON.stringify(data);
    // text/plain evita preflight de CORS; o endpoint lê o JSON do corpo.
    if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" })))) {
      fetch(endpoint, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(function () {});
    }
  }, true);
})();`;

export function GET() {
  return new Response(JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
