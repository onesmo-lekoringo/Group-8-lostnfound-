(function () {
  "use strict";

  const app = document.getElementById("app");
  let catalog;
  let status;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[char]);
  }

  function formatDay(value) {
    if (!value) return "";
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  async function api(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: options?.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options?.headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw body;
    return body;
  }

  function navigate(path) {
    history.pushState({}, "", path);
    render();
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-link]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(link.getAttribute("href"));
  });
  window.addEventListener("popstate", render);

  async function loadBase() {
    if (!catalog) catalog = await api("/api/catalog");
    status = await api("/api/status");
    const footer = document.getElementById("footer-updated");
    if (footer && status.savedAt) {
      footer.textContent = `Register updated ${new Date(status.savedAt).toLocaleString("en-KE")}`;
    }
  }

  function statusLabel(item) {
    if (item.status === "returned") return "Returned";
    if (item.status === "resolved") return "Resolved";
    if (item.status === "review") return "Claim in review";
    if (item.kind === "found" && item.custody === "desk") return "At the security desk";
    if (item.kind === "found") return "With the finder";
    return "Still missing";
  }

  function itemCard(item) {
    return `<article class="item-card">
      <div class="item-card-meta"><span class="${item.kind}">${item.kind === "lost" ? "Lost" : "Found"}</span><span>${escapeHtml(statusLabel(item))}</span></div>
      <h3><a href="/items/${encodeURIComponent(item.ref)}" data-link>${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(item.category)} · ${escapeHtml(item.place)}</p>
      <p class="quiet">${escapeHtml(formatDay(item.occurredOn))} · ${escapeHtml(item.ref)}</p>
    </article>`;
  }

  async function renderHome() {
    await loadBase();
    const data = await api("/api/items?status=all&sort=newest");
    const items = data.items;
    app.innerHTML = `
      <section class="hero">
        <div><p class="eyebrow">Community register</p><h1>Lost it? Found it?</h1>
        <p>Search the campus register, report an item, or leave a note for the security desk.</p>
        <div class="actions"><a class="button gold" href="/items" data-link>Search the register</a><a class="button" href="/report" data-link>Report an item</a></div></div>
      </section>
      <section class="grid-two">
        <div><div class="section-heading"><h2>Recent reports</h2></div><div class="card-grid">${items.slice(0, 4).map(itemCard).join("") || "<p class=\"empty\">No reports yet.</p>"}</div></div>
        <aside class="desk-panel"><h2>At a glance</h2>
          <dl><div><dt>Open items</dt><dd>${items.filter((item) => item.status === "open").length}</dd></div>
          <div><dt>Pending claims</dt><dd>${status.pendingCount}</dd></div></dl>
        </aside>
      </section>`;
  }

  async function renderItems() {
    await loadBase();
    const params = new URLSearchParams(location.search);
    const query = {
      q: params.get("q") || "", kind: params.get("kind") || "all",
      category: params.get("category") || "all", place: params.get("place") || "all",
      status: params.get("status") || "all", sort: params.get("sort") || "newest",
      page: params.get("page") || "1",
    };
    const data = await api(`/api/items?${new URLSearchParams(query)}`);
    app.innerHTML = `
      <div class="page-heading"><p class="eyebrow">Campus register</p><h1>Search items</h1></div>
      <form id="search-form" class="filter-bar">
        <label>Search<input name="q" value="${escapeHtml(query.q)}" placeholder="Reference or description"></label>
        <label>Type<select name="kind"><option value="all">All</option><option value="lost" ${query.kind === "lost" ? "selected" : ""}>Lost</option><option value="found" ${query.kind === "found" ? "selected" : ""}>Found</option></select></label>
        <label>Category<select name="category"><option value="all">All categories</option>${catalog.categories.map((value) => `<option ${query.category === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>Status<select name="status"><option value="all">All statuses</option><option value="open" ${query.status === "open" ? "selected" : ""}>Open</option><option value="desk" ${query.status === "desk" ? "selected" : ""}>At desk</option><option value="closed" ${query.status === "closed" ? "selected" : ""}>Closed</option></select></label>
        <button class="button gold" type="submit">Search</button>
      </form>
      <p class="result-count">${data.total} ${data.total === 1 ? "item" : "items"} found</p>
      <div class="card-grid">${data.slice.map(itemCard).join("") || "<p class=\"empty\">No items match this search.</p>"}</div>
      ${data.pages > 1 ? `<div class="pager">${Array.from({length: data.pages}, (_, i) => `<button class="button ${query.page === String(i + 1) ? "current" : ""}" data-page="${i + 1}">${i + 1}</button>`).join("")}</div>` : ""}`;
    document.getElementById("search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      navigate(`/items?${new URLSearchParams(Object.fromEntries(form))}`);
    });
    document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
      params.set("page", button.dataset.page);
      navigate(`/items?${params}`);
    }));
  }

  async function renderReport() {
    await loadBase();
    app.innerHTML = `
      <div class="page-heading"><p class="eyebrow">Create a report</p><h1>Report an item</h1></div>
      <form id="report-form" class="form-grid">
        <fieldset><legend>Item type</legend><label><input type="radio" name="kind" value="lost" checked> I lost it</label><label><input type="radio" name="kind" value="found"> I found it</label></fieldset>
        <label>Item name<input name="title" required minlength="3"></label>
        <label>Category<select name="category" required>${catalog.categories.map((value) => `<option>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>Colour<input name="color"></label>
        <label class="wide">Description<textarea name="description" required minlength="12"></textarea></label>
        <label>Place<select name="place" required>${catalog.places.map((value) => `<option>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>Location detail<input name="detail"></label>
        <label>Date<input type="date" name="occurredOn" max="${catalog.today}" value="${catalog.today}" required></label>
        <label>Your name<input name="reporterName" required></label>
        <label>Your role<select name="reporterRole" required>${catalog.roles.map((value) => `<option>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>Phone or email<input name="reporterContact" required></label>
        <label>Student/ID number<input name="studentId"></label>
        <fieldset class="wide found-options" hidden><legend>Found-item custody</legend>
          <label><input type="radio" name="handIn" value="desk" checked> Held at a security desk</label>
          <label><input type="radio" name="handIn" value="finder"> I still have the item</label>
          <label>Security desk<select name="desk">${catalog.desks.map((value) => `<option>${escapeHtml(value)}</option>`).join("")}</select></label>
        </fieldset>
        <div class="wide actions"><button class="button gold" type="submit">Submit report</button></div>
        <p id="form-message" class="wide form-message"></p>
      </form>`;
    const form = document.getElementById("report-form");
    const foundOptions = form.querySelector(".found-options");
    form.querySelectorAll('[name="kind"]').forEach((radio) => radio.addEventListener("change", () => {
      foundOptions.hidden = radio.value !== "found" || !radio.checked;
    }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("form-message");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const result = await api("/api/report", {
          method: "POST",
          body: JSON.stringify(values),
        });
        message.textContent = `Report submitted. Reference: ${result.ref}`;
        event.currentTarget.reset();
      } catch (error) {
        message.textContent = error.errors
          ? Object.values(error.errors).join(" ")
          : (error.error || "Could not submit the report.");
      }
    });
  }

  async function renderItem(id) {
    await loadBase();
    try {
      const data = await api(`/api/items/${encodeURIComponent(id)}`);
      app.innerHTML = `
        <a href="/items" data-link class="quiet">← Back to register</a>
        <article class="item-detail"><p class="eyebrow">${escapeHtml(data.item.ref)}</p><h1>${escapeHtml(data.item.title)}</h1>
        <p><strong>${escapeHtml(statusLabel(data.item))}</strong></p><dl>
        <div><dt>Category</dt><dd>${escapeHtml(data.item.category)}</dd></div>
        <div><dt>Place</dt><dd>${escapeHtml(data.item.place)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(formatDay(data.item.occurredOn))}</dd></div></dl>
        <p>${escapeHtml(data.item.description)}</p>
        ${data.matches.length ? `<h2>Possible matches</h2><div class="card-grid">${data.matches.map((match) => itemCard(match.item)).join("")}</div>` : ""}
        ${data.item.kind === "found" && data.item.status === "open" ? `<button class="button gold" id="claim-button">Claim this item</button>` : ""}
        ${data.item.kind === "lost" && data.item.status === "open" ? `<button class="button gold" id="lead-button">Send a sighting</button>` : ""}
        </article><div id="action-panel"></div>`;
      document.getElementById("claim-button")?.addEventListener("click", () => showClaimForm(id));
      document.getElementById("lead-button")?.addEventListener("click", () => showLeadForm(id));
    } catch {
      app.innerHTML = '<section class="empty"><h1>Item not found</h1><p>The reference is not in the register.</p></section>';
    }
  }

  function showClaimForm(id) {
    document.getElementById("action-panel").innerHTML = `<form id="action-form" class="form-grid"><h2>Claim this item</h2>
      <label>Name<input name="name" required></label><label>Phone or email<input name="contact" required></label>
      <label>Student/ID number<input name="studentId" required></label><label class="wide">Private detail<textarea name="proof" required minlength="12"></textarea></label>
      <button class="button gold wide" type="submit">Submit claim</button><p class="form-message wide" id="form-message"></p></form>`;
    bindActionForm("action-form", `/api/items/${id}/claim`, "Claim submitted.");
  }

  function showLeadForm(id) {
    document.getElementById("action-panel").innerHTML = `<form id="action-form" class="form-grid"><h2>Send a sighting</h2>
      <label>Name<input name="name" required></label><label>Phone or email<input name="contact" required></label>
      <label class="wide">Where and when<textarea name="message" required minlength="12"></textarea></label>
      <button class="button gold wide" type="submit">Send note</button><p class="form-message wide" id="form-message"></p></form>`;
    bindActionForm("action-form", `/api/items/${id}/lead`, "Sighting sent.");
  }

  function bindActionForm(formId, url, successMessage) {
    document.getElementById(formId).addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("form-message");
      try {
        await api(url, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
        message.textContent = successMessage;
        event.currentTarget.reset();
      } catch (error) {
        message.textContent = error.errors ? Object.values(error.errors).join(" ") : (error.error || "Could not submit.");
      }
    });
  }

  async function renderDesk() {
    await loadBase();
    if (!status.deskOn) {
      app.innerHTML = `<div class="page-heading"><p class="eyebrow">Restricted area</p><h1>Security desk</h1></div>
        <form id="desk-login" class="narrow-form"><label>Desk code<input name="code" inputmode="numeric" autocomplete="off" required></label>
        <button class="button gold" type="submit">Unlock desk</button><p id="form-message"></p></form>`;
      document.getElementById("desk-login").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api("/api/desk/unlock", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
          status.deskOn = true;
          renderDesk();
        } catch (error) {
          document.getElementById("form-message").textContent = error.error || "Could not unlock.";
        }
      });
      return;
    }
    const data = await api("/api/desk");
    const pending = data.claims.filter((claim) => claim.status === "pending").map((claim) => {
      const item = data.items.find((entry) => entry.id === claim.itemId);
      return item ? `<article class="desk-row"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(claim.name)} · ${escapeHtml(claim.studentId)}</p>
        <button class="button gold" data-claim="${claim.id}" data-action="approve">Approve</button>
        <button class="button" data-claim="${claim.id}" data-action="reject">Reject</button></article>` : "";
    }).join("");
    app.innerHTML = `<div class="page-heading"><p class="eyebrow">Security desk</p><h1>Desk operations</h1></div>
      <div class="actions"><button id="desk-lock" class="button">Lock desk</button></div>
      <h2>Pending claims</h2><div>${pending || "<p class=\"empty\">No pending claims.</p>"}</div>
      <h2>Active found items</h2><div class="card-grid">${data.items.filter((item) => item.kind === "found" && item.status === "open").map((item) =>
        `<article class="item-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.ref)}</p>
        <button class="button" data-release="${item.id}">Mark returned</button></article>`).join("")}</div>`;
    document.getElementById("desk-lock").addEventListener("click", async () => {
      await api("/api/desk/lock", { method: "POST" });
      status.deskOn = false;
      renderDesk();
    });
    document.querySelectorAll("[data-claim]").forEach((button) => button.addEventListener("click", async () => {
      await api(`/api/desk/claims/${button.dataset.claim}/${button.dataset.action}`, { method: "POST", body: "{}" });
      renderDesk();
    }));
    document.querySelectorAll("[data-release]").forEach((button) => button.addEventListener("click", () => {
      const name = window.prompt("Collector name:");
      const studentId = window.prompt("Collector ID:");
      if (!name || !studentId) return;
      api(`/api/desk/items/${button.dataset.release}/release`, { method: "POST", body: JSON.stringify({ name, studentId, note: "" }) }).then(renderDesk);
    }));
  }

  async function render() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/") await renderHome();
      else if (path === "/items") await renderItems();
      else if (path === "/report") await renderReport();
      else if (path === "/desk") await renderDesk();
      else if (path.startsWith("/items/")) await renderItem(decodeURIComponent(path.slice(7)));
      else app.innerHTML = '<section class="empty"><h1>Page not found</h1></section>';
    } catch (error) {
      app.innerHTML = `<section class="empty"><h1>Could not load the register</h1><p>${escapeHtml(error.error || "Please try again.")}</p></section>`;
    }
  }

  render();
})();
