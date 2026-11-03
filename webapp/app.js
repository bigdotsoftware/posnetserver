
const SETTINGS = {
    apiBase: localStorage.getItem("pos.apiBase") || (location.protocol.startsWith("http") ? location.origin : "http://localhost:3050"),
    cashier: localStorage.getItem("pos.cashier") || "Kasjer",
    paymentTypes: { cash: 0, card: 2 },
    printer: loadPrinterSettings(),
    vat: { 
        A: { vt: 0, vtp: "23,00" }, 
        B: { vt: 1, vtp: "8,00" }, 
        C: { vt: 2, vtp: "5,00" }, 
        ZW: { vt: 3, vtp: "0,00" } 
    }
};
let uploadedLicenseContent = null;
let uploadedLicenseFileName = null;

const DEFAULT_PRODUCTS = [
    { id: "coffee", code: "1001", name: "Kawa Americano", price: 9.90, vat: "A", cat: "Napoje", icon: "☕" },
    { id: "cappuccino", code: "1002", name: "Cappuccino", price: 13.50, vat: "A", cat: "Napoje", icon: "☕" },
    { id: "tea", code: "1003", name: "Herbata", price: 8.50, vat: "A", cat: "Napoje", icon: "🍵" },
    { id: "water", code: "1004", name: "Woda 0,5 l", price: 5.00, vat: "A", cat: "Napoje", icon: "💧" },
    { id: "cola", code: "1005", name: "Cola 0,5 l", price: 8.00, vat: "A", cat: "Napoje", icon: "🥤" },
    { id: "cake", code: "2001", name: "Sernik", price: 15.90, vat: "A", cat: "Desery", icon: "🍰" },
    { id: "cookie", code: "2002", name: "Ciastko czekoladowe", price: 8.90, vat: "A", cat: "Desery", icon: "🍪" },
    { id: "croissant", code: "2003", name: "Croissant", price: 10.90, vat: "A", cat: "Desery", icon: "🥐" },
    { id: "sandwich", code: "3001", name: "Kanapka z kurczakiem", price: 18.90, vat: "A", cat: "Jedzenie", icon: "🥪" },
    { id: "salad", code: "3002", name: "Sałatka", price: 21.90, vat: "A", cat: "Jedzenie", icon: "🥗" },
    { id: "toast", code: "3003", name: "Tost", price: 14.90, vat: "A", cat: "Jedzenie", icon: "🥪" },
    { id: "juice", code: "1006", name: "Sok pomarańczowy", price: 11.90, vat: "A", cat: "Napoje", icon: "🧃" }];

let PRODUCTS = loadProducts();
let CATEGORIES = loadCategories();
let cart = [], 
    category = "Wszystko", 
    paymentMethod = "cash", 
    globalAdjustment = null;
let mainSort = localStorage.getItem("pos.mainSort") || "name-asc";
let settingsSearch = "", 
    settingsSort = "name-asc";
let settingsConnType = null;
let g_DrukarkaOffline = true;

function loadPrinterSettings() {
    try {
        const raw = localStorage.getItem("pos.printer");
        if (raw) {
            const d = JSON.parse(raw);
            if (d && typeof d === "object")  {
                return {
                    type: d.type === "eth" ? "eth" : "rs232",
                    usbDevice: d.usbDevice || "",
                    usbBaud: Number(d.usbBaud) || 9600,
                    usbFlowControl: d.usbFlowControl || "none",
                    printerManufacturer: d.printerManufacturer || "Posnet",
                    netIp: d.netIp || "",
                    netPort: Number(d.netPort) || 6666,
                    licenseFileName: d.licenseFileName || "",
                    licenseContent: d.licenseContent || ""
                };
            }
        }
    } catch (e) { }
    return { 
        type: "rs232", 
        usbDevice: "", 
        usbBaud: 9600, 
        printerManufacturer: "Posnet", 
        netIp: "", 
        netPort: 6666,
        licenseFileName: "",
        licenseContent: ""
    };
}
function loadProducts() { 
    try { 
        const raw = localStorage.getItem("pos.products"); 
        if (raw) { const data = JSON.parse(raw); if (Array.isArray(data) && data.length) return data } 
    } catch (e) { } 
    return DEFAULT_PRODUCTS.map(p => ({ ...p })) 
}
function saveProducts() { 
    localStorage.setItem("pos.products", JSON.stringify(PRODUCTS)) 
}
function loadCategories() { 
    try { 
        const raw = localStorage.getItem("pos.categories"); 
        if (raw) { const data = JSON.parse(raw); if (Array.isArray(data)) return data.filter(Boolean) } 
    } catch (e) { } 
    return [...new Set(DEFAULT_PRODUCTS.map(p => p.cat))] 
}
function saveCategories() { localStorage.setItem("pos.categories", JSON.stringify(CATEGORIES)) }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) }
function productCategories() { return [...CATEGORIES] }

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n);
const cents = n => Math.round(n * 100);
function toast(msg, error = false) { 
    const t = $("#toast"); 
    t.textContent = msg; 
    t.className = "toast show" + (error ? " error" : ""); 
    clearTimeout(window.__toast); 
    window.__toast = setTimeout(() => t.className = "toast", 3500) 
}
async function api(path, opts = {}) { 
    const r = await fetch(SETTINGS.apiBase.replace(/\/$/, "") + path, 
        { 
            cache: "no-store",
            headers: { 
                "Content-Type": "application/json", ...(opts.headers || {}) 
            }, 
            ...opts 
        });
    const text = await r.text(); 
    let d; 
    try { 
        d = text ? JSON.parse(text) : {} 
    } catch { 
        d = { message: text } 
    } 
    if (!r.ok || d.ok === false) 
        throw new Error(d.message || `HTTP ${r.status}`); 
    return d 
}
function adjustmentValue(base, a) { 
    if (!a || !Number.isFinite(a.value) || a.value <= 0) return 0; 
    const raw = a.mode === "percent" ? base * a.value / 100 : a.value; 
    return Math.min(base, raw) 
}
function lineGross(x) { 
    const base = x.price * x.qty, v = adjustmentValue(base, x.adjustment); 
    return x.adjustment?.kind === "surcharge" ? base + v : Math.max(0, base - v) 
}
function totals() { 
    const grossLines = cart.reduce((s, x) => s + lineGross(x), 0), 
          gv = adjustmentValue(grossLines, globalAdjustment), 
          gross = globalAdjustment?.kind === "surcharge" ? grossLines + gv : Math.max(0, grossLines - gv); 
    let net = 0; 
    cart.forEach(x => net += lineGross(x) / (1 + (SETTINGS.vat[x.vat]?.vt || 23) / 100)); 
    if (globalAdjustment && grossLines > 0) 
        net *= gross / grossLines; 
    return { grossLines, gross, net, vat: Math.max(0, gross - net) }
}
function categoryCount(c) { 
    return c === "Wszystko" ? PRODUCTS.length : PRODUCTS.filter(p => p.cat === c).length 
}
function renderCategories() { 
    let cats = ["Wszystko", ...CATEGORIES]; 
    cats = [...new Set(cats)]; 
    $("#categories").innerHTML = cats.map(c => `<button class="cat ${c === category ? "active" : ""}" data-cat="${esc(c)}">${esc(c)} <span class="cat-count">${categoryCount(c)}</span></button>`).join(""); 
    $$('.cat').forEach(b => b.onclick = () => { 
        category = b.dataset.cat; 
        renderCategories(); 
        renderProducts() 
    }) 
}
function sortProducts(list, sort = mainSort) { 
    const a = [...list]; 
    return a.sort((x, y) => { 
        let r = 0; 
        if (sort.startsWith("name")) 
            r = x.name.localeCompare(y.name, "pl"); 
        else if (sort.startsWith("price")) 
            r = x.price - y.price; 
        else if (sort.startsWith("code")) 
            r = String(x.code).localeCompare(String(y.code), "pl", { numeric: true }); 
        return sort.endsWith("desc") ? -r : r 
    })
}
function productVisual(p) { 
    return p.image ? `<img src="${p.image}" alt="">` : esc(p.icon || "🛒") 
}
function visibleProductButtons() {
    return $$("#products .product").filter(b => b.offsetParent !== null);
}
function focusProductButton(btn) {
    if (!btn) return;
    $$("#products .product.focused").forEach(b => b.classList.remove("focused"));
    btn.classList.add("focused");
    btn.focus({ preventScroll: true });
    btn.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function clearProductFocus() {
    $$("#products .product.focused").forEach(b => b.classList.remove("focused"));
}
function moveProductFocus(currentIdx, dx, dy) {
    const btns = visibleProductButtons();
    if (!btns.length) return;
    let idx = currentIdx;
    if (idx < 0) idx = 0;
    let cols = 1;
    if (dy !== 0) {
        const rows = [];
        btns.forEach(b => {
            const t = b.offsetTop;
            let row = rows.find(r => Math.abs(r.top - t) < 5);
            if (!row) { row = { top: t, items: [] }; rows.push(row); }
            row.items.push(b);
        });
        cols = Math.max(1, ...rows.map(r => r.items.length));
    }
    const next = Math.max(0, Math.min(btns.length - 1, idx + dx + dy * cols));
    focusProductButton(btns[next]);
}
function activeProductIndex() {
    const btns = visibleProductButtons();
    let idx = btns.findIndex(b => b.classList.contains("focused"));
    if (idx < 0 && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("product"))
        idx = btns.indexOf(document.activeElement);
    return { btns, idx };
}
function handleProductKeys(e) {
    const { btns, idx } = activeProductIndex();
    if (!btns.length) return false;
    const key = e.key;
    if (key === "ArrowRight" || key === "ArrowLeft" || key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        const dx = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
        const dy = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
        moveProductFocus(idx, dx, dy);
        return true;
    }
    if (key === "Enter" && idx >= 0 && !isTypingTarget(e.target)) {
        e.preventDefault();
        add(btns[idx].dataset.id);
        clearProductFocus();
        const s = $("#search");
        if (s) { s.focus(); s.select(); }
        return true;
    }
    return false;
}

function renderProducts() { 
    let q = $("#search").value.trim().toLowerCase(); 
    let ps = PRODUCTS.filter(p => (category === "Wszystko" || p.cat === category) && (!q || `${p.name} ${p.fiscalName || ""} ${p.code}`.toLowerCase().includes(q))); 
    ps = sortProducts(ps); 
    $("#products").innerHTML = ps.map(p => `<button class="product" data-id="${p.id}">
        <div class="product-img">${productVisual(p)}</div>
        <div class="product-body">
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-meta">kod ${esc(p.code)} · VAT ${SETTINGS.vat[p.vat]?.vtp}%</div>
            <div class="product-price">${money(p.price)}</div>
        </div>
        </button>`).join("") || '<div class="empty"><div><strong>Brak produktów</strong><span>Zmień wyszukiwanie.</span></div></div>';
        
    $$('.product').forEach(b => {
        b.onclick = () => { add(b.dataset.id); clearProductFocus(); };
        b.onfocus = () => {
            $$("#products .product.focused").forEach(x => { if (x !== b) x.classList.remove("focused") });
            b.classList.add("focused");
        };
    })
}
function add(id) { 
    let p = PRODUCTS.find(x => x.id === id), x = cart.find(x => x.id === id); 
    if (x) x.qty++; else cart.push({ ...p, qty: 1 }); 
    renderCart() 
}
function change(id, d) { 
    let x = cart.find(x => x.id === id); 
    if (!x) return; 
    x.qty += d; 
    if (x.qty <= 0) cart = cart.filter(y => y.id !== id); 
    renderCart() 
}
function adjustmentLabel(a) { 
    return a ? `${a.kind === "discount" ? "Rabat" : "Narzut"} ${a.mode === "percent" ? a.value + "%" : money(a.value)}` : "" 
}
function renderCart() {
    let c = $("#cartItems"); 
    const itemCount = cart.reduce((s, x) => s + x.qty, 0);
    $("#cartCount").textContent = `${itemCount} pozycji`;
    const cartBadge = $("#cartToggleCount");
    if (cartBadge) cartBadge.textContent = itemCount;
    if (!cart.length) 
        c.innerHTML = '<div class="empty"><div><div style="font-size:40px">🛒</div><strong>Koszyk jest pusty</strong><span>Dodaj produkt, aby rozpocząć sprzedaż.</span></div></div>';
    else 
        c.innerHTML = cart.map(x => { 
            const base = x.price * x.qty, 
                  final = lineGross(x); 
            return `<div class="cart-row">
                        <div class="cart-img">${productVisual(x)}</div>
                        <div>
                            <div class="cart-name">${x.name}</div>
                            <div class="cart-sub">${money(x.price)} × ${x.qty} · VAT ${SETTINGS.vat[x.vat]?.vtp}%</div>
                            ${x.adjustment ? `<div class="adjustment-tag">${adjustmentLabel(x.adjustment)} <button data-adjust-clear="${x.id}">×</button></div>` : ""}
                            <div class="qty">
                                <button data-minus="${x.id}">−</button>
                                <b>${x.qty}</b>
                                <button data-plus="${x.id}">+</button>
                                <button class="remove" data-remove="${x.id}">×</button>
                            </div>
                            <button class="discount-link" data-adjust="${x.id}">${x.adjustment ? "Edytuj rabat/narzut" : "+ Rabat / narzut"}</button>
                        </div>
                        <div class="row-total">${x.adjustment && final !== base ? `<del>${money(base)}</del><br>` : ""}${money(final)}</div>
                    </div>`
            }).join("");
    $$("[data-minus]").forEach(b => b.onclick = () => change(b.dataset.minus, -1)); 
    $$("[data-plus]").forEach(b => b.onclick = () => change(b.dataset.plus, 1)); 
    $$("[data-remove]").forEach(b => b.onclick = () => change(b.dataset.remove, -999)); 
    $$("[data-adjust]").forEach(b => b.onclick = () => openAdjustmentModal(b.dataset.adjust, false)); 
    $$("[data-adjust-clear]").forEach(b => b.onclick = () => { 
        const x = cart.find(x => x.id === b.dataset.adjustClear); 
        if (x) { 
            x.adjustment = null; 
            renderCart() 
        } 
    });
    const t = totals(); 
    $("#netTotal").textContent = money(t.net); 
    $("#vatTotal").textContent = money(t.vat); 
    $("#grandTotal").textContent = money(t.gross); 
    $("#checkoutBtn").disabled = !cart.length;
    const oldGlobal = $("#globalAdjustmentLine"); 
    if (oldGlobal) oldGlobal.remove();
    if (cart.length) { 
        const line = document.createElement("div"); 
        line.id = "globalAdjustmentLine"; 
        line.className = "global-adjustment"; 
        line.innerHTML = `<div>
            <span>Rabat / narzut całego koszyka</span>${globalAdjustment ? `<small>${adjustmentLabel(globalAdjustment)}</small>` : ""}</div>
            <button class="discount-link" id="globalAdjustmentBtn">${globalAdjustment ? "Edytuj" : "Dodaj"}</button>${globalAdjustment ? '<button class="clear-global" id="clearGlobal">×</button>' : ""}`; 
        c.appendChild(line); 
        $("#globalAdjustmentBtn").onclick = () => openAdjustmentModal(null, true); 
        if ($("#clearGlobal")) $("#clearGlobal").onclick = () => { globalAdjustment = null; renderCart() } 
    }
}
function productLines() {
    return cart.map(x => { 
        const line = { 
            na: (x.fiscalName || x.name), 
            il: x.qty, 
            // vt: SETTINGS.vat[x.vat].vt, 
            vtp: SETTINGS.vat[x.vat].vtp, 
            pr: cents(x.price) 
        }; 
        if (x.adjustment) 
            line.discounts = [{ 
                type: "basic", 
                discount: { 
                    rd: x.adjustment.kind === "discount", 
                    ...(x.adjustment.mode === "percent" ? { rp: Math.round(x.adjustment.value * 100) } : { rw: cents(x.adjustment.value) }), 
                    na: x.adjustment.kind === "discount" ? "Rabat" : "Narzut" 
                } 
            }]; 
            return line 
        });
}
function globalDiscountPayload() { 
    if (!globalAdjustment) return []; 
    return [{ 
        type: "bill", 
        discount: { 
            rd: globalAdjustment.kind === "discount", 
            ...(globalAdjustment.mode === "percent" ? { rp: Math.round(globalAdjustment.value * 100) } : { rw: cents(globalAdjustment.value) }), 
            na: globalAdjustment.kind === "discount" ? "Rabat całego koszyka" : "Narzut całego koszyka" 
        } 
    }] 
}
function paymentObject(amount, method) { 
    return { 
        ty: SETTINGS.paymentTypes[method], 
        wa: cents(amount), 
        na: method === "cash" ? "Gotówka" : "Karta", 
        re: false 
    } 
}
function closeModal() { 
    $("#modalRoot").innerHTML = "" 
}
function isModalOpen() {
    return !!document.querySelector("#modalRoot .modal-backdrop");
}
function isTypingTarget(el) {
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
function showShortcutsModal() {
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal shortcuts-modal">
            <div class="modal-head">
                <h3>Skróty klawiszowe</h3>
                <button class="close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="shortcuts-grid">
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Szukaj produktu / skaner</strong><small>Przenosi kursor do pola wyszukiwania; Enter dodaje produkt przy dokładnym kodzie lub gdy wynik jest jedyny, inaczej przenosi focus na pierwszy wynik</small></div><span class="kbd">F2</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Wybór produktu z listy</strong><small>Strzałki przesuwają zaznaczenie po liście produktów, Enter dodaje zaznaczony produkt</small></div><span class="kbd">← ↑ ↓ →</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Przejdź do płatności</strong><small>Otwiera okno płatności dla bieżącego koszyka</small></div><span class="kbd">F9</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Wyczyść koszyk</strong><small>Usuwa wszystkie pozycje (po potwierdzeniu)</small></div><span class="kbd">Del</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Ustawienia POS</strong><small>Katalog produktów i konfiguracja drukarki</small></div><span class="kbd">F10</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Płatność gotówką</strong><small>W oknie płatności</small></div><span class="kbd">1</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Płatność kartą</strong><small>W oknie płatności</small></div><span class="kbd">2</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Potwierdź / kontynuuj</strong><small>W oknach płatności, dokumentu i potwierdzeń</small></div><span class="kbd">Enter</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Zamknij okno / anuluj</strong><small>Zamyka otwarty modal</small></div><span class="kbd">Esc</span></div>
                    <div class="shortcut-row"><div class="shortcut-desc"><strong>Ta legenda</strong><small>Lista wszystkich skrótów</small></div><span class="kbd">F1</span></div>
                </div>
                <div class="actions">
                    <button class="primary" onclick="closeModal()">ZAMKNIJ</button>
                </div>
            </div>
        </div></div>`;
}
function modalPrimaryAction() {
    if (!isModalOpen()) return;
    const confirmBtn = $("#confirmOk");
    if (confirmBtn) { confirmBtn.click(); return; }
    const printBtn = $("#printBtn");
    if (printBtn && !printBtn.disabled) { printBtn.click(); return; }
    const continueBtn = $("#continuePay");
    if (continueBtn) { continueBtn.click(); return; }
    const finishSaleBtn = $("#finishSaleBtn");
    if (finishSaleBtn && !finishSaleBtn.disabled) { finishSaleBtn.click(); return; }
}
function handleGlobalKeys(e) {
    const key = e.key;
    if (isModalOpen()) {
        if (key === "Escape") { e.preventDefault(); closeModal(); return; }
        if (key === "Enter" && !isTypingTarget(e.target)) { e.preventDefault(); modalPrimaryAction(); return; }
        if ($("#continuePay") && !isTypingTarget(e.target) && (key === "1" || key === "2")) {
            e.preventDefault();
            const btn = key === "1" ? $("#payCash") : $("#payCard");
            if (btn) btn.click();
        }
        return;
    }
    if (key.startsWith("Arrow") || (key === "Enter" && !isTypingTarget(e.target) && activeProductIndex().idx >= 0)) {
        if (handleProductKeys(e)) return;
    }
    if (key === "F1") { e.preventDefault(); showShortcutsModal(); return; }
    if (key === "F2") { e.preventDefault(); const s = $("#search"); if (s) { s.focus(); s.select(); } return; }
    if (key === "F9") { e.preventDefault(); openPayment(); return; }
    if (key === "F10") { e.preventDefault(); settings(); return; }
    if (key === "Delete") { e.preventDefault(); $("#clearCart").click(); return; }
}
function openConfirmModal(opts, onConfirm) {
    const cfg = typeof opts === "string" ? { message: opts } : (opts || {});
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal small confirm-modal">
            <div class="confirm-icon">${cfg.icon || "?"}</div>
            <div class="confirm-body">
                <h3>${esc(cfg.title || "Potwierdzenie")}</h3>
                <p>${esc(cfg.message || "Czy na pewno kontynuować?")}</p>
                <div class="actions">
                    <button type="button" id="confirmCancel">${esc(cfg.cancelText || "Anuluj")}</button>
                    <button type="button" class="primary ${cfg.danger ? "danger" : ""}" id="confirmOk">${esc(cfg.confirmText || "Potwierdź")} <kbd class="kbd light">Enter</kbd></button>
                </div>
            </div>
        </div></div>`;
    $("#confirmCancel").onclick = () => closeModal();
    $("#confirmOk").onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
}
function openAdjustmentModal(id, isGlobal) {
    const target = isGlobal ? globalAdjustment : cart.find(x => x.id === id)?.adjustment;
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal small">
            <div class="modal-head">
                <h3>${isGlobal ? "Rabat / narzut całego koszyka" : "Rabat / narzut pozycji"}</h3>
                <button class="close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="tabs">
                    <button class="tab active" id="kindDiscount">Rabat</button>
                    <button class="tab" id="kindSurcharge">Narzut</button>
                </div>
                <div class="tabs">
                    <button class="tab active" id="modePercent">Procent</button>
                    <button class="tab" id="modeAmount">Kwota</button>
                </div>
                <div class="field">
                    <label id="adjustLabel">Rabat (%)</label>
                    <input id="adjustValue" inputmode="decimal" type="number" min="0" step="0.01" value="${target?.value ?? ""}" autofocus>
                </div>
                <p class="adjust-help">Rabat zmniejsza cenę, narzut ją zwiększa. Przy kwocie podajesz wartość w PLN.</p>
                <div class="actions">
                    <button onclick="closeModal()">Anuluj</button>
                    <button class="primary" id="saveAdjustment">ZAPISZ</button>
                </div>
            </div>
        </div></div>`;
    let kind = target?.kind || "discount", mode = target?.mode || "percent";
    
    const sync = () => { 
        $("#kindDiscount").classList.toggle("active", kind === "discount"); 
        $("#kindSurcharge").classList.toggle("active", kind === "surcharge"); 
        $("#modePercent").classList.toggle("active", mode === "percent"); 
        $("#modeAmount").classList.toggle("active", mode === "amount"); 
        $("#adjustLabel").textContent = (kind === "discount" ? "Rabat" : "Narzut") + (mode === "percent" ? " (%)" : " (zł)") 
    };
    $("#kindDiscount").onclick = () => { 
        kind = "discount"; 
        sync() 
    }; 
    $("#kindSurcharge").onclick = () => { 
        kind = "surcharge"; 
        sync() 
    }; 
    $("#modePercent").onclick = () => {
        mode = "percent"; 
        sync() 
    }; 
    $("#modeAmount").onclick = () => { 
        mode = "amount"; 
        sync() 
    };
    $("#saveAdjustment").onclick = () => { 
        const value = parseFloat($("#adjustValue").value.replace(",", ".")); 
        if (!Number.isFinite(value) || value <= 0) { 
            toast("Podaj wartość większą od zera.", true); 
            return 
        } 
        if (mode === "percent" && value > 100) { 
            toast("Procent nie może przekraczać 100%.", true); 
            return 
        } 
        const adj = { kind, mode, value }; 
        if (isGlobal) 
            globalAdjustment = adj; 
        else { 
            const x = cart.find(x => x.id === id); 
            if (x) x.adjustment = adj 
        } 
        closeModal(); 
        renderCart() 
    }; 
    sync();
}
function openPayment() { 
    if (!cart.length) 
        return; 
    toggleCartPanel(false);
    paymentMethod = "cash"; 
    renderPaymentModal() 
}
function renderPaymentModal() { 
    const t = totals(); 
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal small">
            <div class="modal-head">
                <h3>Płatność</h3>
                <button class="close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="pay-total">
                    <small>Do zapłaty</small>
                    <strong>${money(t.gross)}</strong>
                </div>
                <div class="pay-methods">
                    <button class="pay-method active" id="payCash">💵 Gotówka <kbd class="kbd">1</kbd></button>
                    <button class="pay-method" id="payCard">💳 Karta <kbd class="kbd">2</kbd></button>
                </div>
                <div id="paymentFields" style="margin-top:16px"></div>
                <div class="actions">
                    <button onclick="closeModal()">Anuluj</button>
                    <button class="primary" id="continuePay">Dalej → <kbd class="kbd light">Enter</kbd></button>
                </div>
            </div>
        </div></div>`; 
    const fields = () => { 
        $("#paymentFields").innerHTML = paymentMethod === "cash" ? `
            <div class="field">
                <label>Otrzymano od klienta</label>
                <input id="received" inputmode="decimal" value="${t.gross.toFixed(2)}" autofocus>
            </div>
            <div class="pay-total" style="margin-top:10px">
                <small>Reszta</small>
                <strong id="change">${money(0)}</strong>
            </div>` 
                : 
            `<div class="field">
                <label>Opis płatności</label>
                <input id="cardDesc" value="Karta">
            </div>
            <p style="color:#697586;font-size:13px">Płatność kartą jest rejestrowana na dokumencie fiskalnym, ale integracja z terminalem płatniczym wymaga osobnego <a href="https://bigdotsoftware.pl/ingenicoserver-restful-service-dla-terminali-platniczych/">API</a>.</p>`; 
        if ($("#received")) $("#received").oninput = () => { 
            let v = parseFloat($("#received").value.replace(",", ".")) || 0; 
            $("#change").textContent = money(Math.max(0, v - t.gross))
        } 
    }; 
    fields(); 
    $("#payCash").onclick = () => { 
        paymentMethod = "cash"; 
        $("#payCash").classList.add("active"); 
        $("#payCard").classList.remove("active"); 
        fields() 
    }; 
    $("#payCard").onclick = () => { 
        paymentMethod = "card"; 
        $("#payCard").classList.add("active"); 
        $("#payCash").classList.remove("active"); 
        fields() 
    }; 
    $("#continuePay").onclick = () => {
        if( paymentMethod === "cash" ) {
            openDocumentModal(t);
        }else{
            openConfirmModal({
                icon: "💳",
                title: "Płatność kartą",
                message: "Czy płatność na terminalu zakończyła się pomyślnie?",
                confirmText: "Tak, zakończono",
                cancelText: "Wróć"
            }, () => openDocumentModal(t));
        }
    }
}

function openDocumentModal(t) { 
    let received = paymentMethod === "cash" ? parseFloat($("#received")?.value.replace(",", ".") || "0") : t.gross; 
    if (paymentMethod === "cash" && received + 0.001 < t.gross) { 
        toast("Kwota otrzymana jest za mała.", true); 
        return 
    } 
    const hasDiscounts = cart.some(x => x.adjustment) || !!globalAdjustment;
    const discountNotice = hasDiscounts ? `<div class="invoice-blocked-note">Faktury z rabatami/narzutami nie są obsługiwane w tej wersji. Usuń rabaty z koszyka, aby wystawić fakturę.</div>` : "";
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal">
            <div class="modal-head">
                <h3>Dokument sprzedaży</h3>
                <button class="close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="tabs">
                    <button class="tab active" id="tabReceipt">🧾 Paragon</button>
                    <button class="tab" id="tabInvoice" ${hasDiscounts ? 'disabled title="Najpierw usuń rabaty z koszyka"' : ""}>📄 Faktura</button>
                </div>
                <div id="docFields"></div>
                <div class="actions">
                    <button onclick="closeModal()">Anuluj</button>
                    <button class="primary" id="printBtn">DRUKUJ I ZAKOŃCZ <kbd class="kbd light">Enter</kbd></button>
                </div>
            </div>
        </div></div>`; 
    let type = "receipt"; 
    const receipt = () => { 
        $("#docFields").innerHTML = `
        <div class="invoice-box">
            <h4>Paragon</h4>
            <div class="grid2">
                <div>
                    <b>Sposób płatności</b>
                    <div>${paymentMethod === "cash" ? "Gotówka" : "Karta"}</div>
                </div>
                <div>
                    <b>Kwota</b>
                    <div>${money(t.gross)}</div>
                </div>
            </div>
        </div>
        <div class="invoice-box">
            <h4>eParagon</h4>
            <label class="settings-row">
            <input type="checkbox" id="eparagon"> Wyślij eParagon elektronicznie</label>
            <div id="eFields" style="display:none;margin-top:12px">
                <div class="grid2">
                    <div class="field">
                        <label>E-mail</label><input id="eparagon_email" type="email">
                    </div>
                    <div class="field">
                        <label>Telefon</label><input id="eparagon_phone" inputmode="tel">
                    </div>
                </div>
            </div>
            <p class="settings-note">Do wystawienia eParagonu konieczne jest skonfigurowanie na drukarce usługi <a href="https://eparagon.cloud/" target="_blank" rel="noopener">eparagon.cloud</a> lub podobnej.</p>
        </div>` 
        $("#eparagon").onchange = e => $("#eFields").style.display = e.target.checked ? "block" : "none";
    }; 
    const invoice = () => { 
        if (hasDiscounts) {
            toast("Aby wystawić fakturę, najpierw usuń rabaty/narzuty z koszyka.", true);
            return
        }
        $("#docFields").innerHTML = `
        <div class="grid2">
            <div class="field">
                <label>Numer systemowy</label>
                <input id="systemNumber" placeholder="Numer systemowy faktury">
            </div>
            <div class="field">
                &nbsp;
            </div>
        </div>
        <div class="grid2">
            <div class="field">
                <label>Nazwa nabywcy</label>
                <input id="buyerName" placeholder="Firma / osoba">
            </div>
            <div class="field">
                <label>NIP</label>
                <div class="nip-row">
                    <input id="buyerNip" placeholder="0000000000" inputmode="numeric" maxlength="10">
                    <button type="button" class="nip-gus" id="nipGusBtn" title="Pobierz dane firmy z Wykazu podatnikow VAT">🏛 Pobierz z GUS</button>
                </div>
            </div>
        </div>
        <div class="field">
            <label>Adres nabywcy</label>
            <textarea id="buyerAddress" placeholder="ul. ..., kod, miasto"></textarea>
        </div>
        <div class="grid2">
            <div class="field">
                <label>Sposób płatności</label>
                <input value="${paymentMethod === "cash" ? "Gotówka" : "Karta"}" disabled></div>
                <div class="field"><label>Termin płatności</label>
                <input type="date" id="paymentDate" value="${new Date().toISOString().slice(0, 10)}">
            </div>
        </div>
        <div class="invoice-box">
            <h4>eFaktura</h4><label class="settings-row">
            <input type="checkbox" id="efaktura"> Wyślij eFakturę elektronicznie</label>
            <div id="eFields" style="display:none;margin-top:12px">
                <div class="grid2">
                    <div class="field">
                        <label>E-mail</label><input id="email" type="email">
                    </div>
                    <div class="field">
                        <label>Telefon</label><input id="phone" inputmode="tel">
                    </div>
                </div>
            </div>
            <p class="settings-note">Do wystawienia eFaktury konieczne jest skonfigurowanie na drukarce usługi <a href="https://eparagon.cloud/" target="_blank" rel="noopener">eparagon.cloud</a> lub podobnej.</p>
        </div>`; 
        $("#efaktura").onchange = e => $("#eFields").style.display = e.target.checked ? "block" : "none" 
        $("#nipGusBtn").onclick = () => fetchGusByNip();
    }; 
    
    $("#tabReceipt").onclick = () => { 
        type = "receipt"; 
        $("#tabReceipt").classList.add("active"); 
        $("#tabInvoice").classList.remove("active"); 
        receipt();
        if (hasDiscounts) $("#docFields").insertAdjacentHTML("beforeend", discountNotice);
    }; 
    $("#tabInvoice").onclick = () => { 
        if (hasDiscounts) {
            toast("Aby wystawić fakturę, najpierw usuń rabaty/narzuty z koszyka.", true);
            return
        }
        type = "invoice"; 
        $("#tabInvoice").classList.add("active"); 
        $("#tabReceipt").classList.remove("active"); 
        invoice() 
    }; 
    receipt(); 
    if (hasDiscounts) $("#docFields").insertAdjacentHTML("beforeend", discountNotice);
    $("#printBtn").onclick = () => type === "receipt" ? printReceipt(received, t) : printInvoice(t) 
}
function isValidNip(nip) {
    if (!/^[0-9]{10}$/.test(nip)) return false;
    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += weights[i] * Number(nip[i]);
    return sum % 11 === Number(nip[9]);
}
async function fetchGusByNip() {
    const nipInput = $("#buyerNip");
    const btn = $("#nipGusBtn");
    const nip = (nipInput.value || "").replace(/[^0-9]/g, "");
    nipInput.value = nip;
    if (!isValidNip(nip)) { toast("Podaj poprawny NIP (10 cyfr, poprawna suma kontrolna).", true); nipInput.focus(); return }
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "⏳ Pobieranie…";
    try {
        const data = await api(`/gus/nip/${nip}`);
        if (data.name) $("#buyerName").value = data.name;
        const addr = data.workingAddress || data.residenceAddress || "";
        if (addr) $("#buyerAddress").value = addr;
        toast("Dane firmy pobrane z Wykazu podatników VAT.");
    } catch (e) {
        toast("GUS: " + e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
async function printReceipt(received, t) { 
    const body = { 
        lines: productLines(), 
        discounts: globalDiscountPayload(), 
        payments: [paymentObject(paymentMethod === "cash" ? t.gross : received, paymentMethod)], 
        summary: { 
            to: cents(t.gross), 
            fp: cents(t.gross), 
            re: paymentMethod === "cash" ? cents(Math.max(0, received - t.gross)) : 0 
        }, 
        footer: { 
            action: "cut_move",
            cashier: SETTINGS.cashier 
        } 
    }; 
    const footerSlots = getFooterSlots();
    if (footerSlots.length) body.footer['footerimages'] = footerSlots;
    if ($("#eparagon").checked) { 
        const email = $("#eparagon_email").value.trim(), 
              phone = $("#eparagon_phone").value.trim(); 
        if (!email && !phone) { 
            toast("Podaj e-mail lub telefon dla eParagonu.", true); 
            return 
        } 
        body.eparagon = { 
            idz: "123", 
            service: "https://eparagon.cloud:4051" 
        } 
        if(email) body.eparagon.email = email;
        if(phone) body.eparagon.phone = phone;
    } 
    await sendDocument("/paragon", body, "Paragon") 
}

async function printInvoice(t) { 
    const name = $("#buyerName").value.trim(), 
          nip = $("#buyerNip").value.trim(), 
          addr = $("#buyerAddress").value.trim(), 
          systemNumber = $("#systemNumber").value.trim(); 
    if (!name || !nip) { 
        toast("Dla faktury podaj nazwę nabywcy i NIP.", true); 
        return 
    } 
    const body = { 
        lines: productLines(), 
        // discounts: globalDiscountPayload(), 
        payments: [paymentObject(t.gross, paymentMethod)], 
        header: { 
            na: [name], 
            ni: nip, 
            ad: addr.split(/\n|,/).map(x => x.trim()).filter(Boolean), 
            nb: systemNumber || "FV",
            ad_sc : 0,
            ad_at: 0,
            nb_sc : 0,
            nb_at: 0,
            nm: "Vat",
            cc: 0,
            co: false,
            ln: 40,
            fn: 40
            // pt: paymentMethod === "cash" ? "Gotówka" : "Karta", 
            // pd: $("#paymentDate").value 
        }, 
        summary: { 
            to: cents(t.gross)
        }, 
        footer: { 
            action: "cut_move",
            cashier: SETTINGS.cashier 
        } 
    }; 
    if ($("#efaktura").checked) { 
        const email = $("#email").value.trim(), phone = $("#phone").value.trim(); 
        if (!email && !phone) { 
            toast("Podaj e-mail lub telefon dla eFaktury.", true); 
            return 
        } 
        body.efaktura = { email, phone } 
    } 
    await sendDocument("/faktura", body, "Faktura") 
}

async function sendDocument(path, body, label) { 
    const btn = $("#printBtn"); 
    btn.disabled = true; 
    btn.textContent = "Fiskalizacja…"; 
    try { 
        const data = await api(path, { method: "POST", body: JSON.stringify(body) }); 
        if (data.transaction) { 
            await waitTask(path === "/paragon" ? "/paragon/" : "/faktura/", data.transaction) 
        } 
        showSuccess(label, data) 
    } catch (e) { 
        toast(`${label}: ${e.message}`, true); 
        btn.disabled = false; 
        btn.textContent = "DRUKUJ I ZAKOŃCZ" 
    } 
}
async function waitTask(prefix, id) { 
    for (let i = 0; i < 30; i++) { 
        await new Promise(r => setTimeout(r, 500)); 
        const d = await api(prefix + encodeURIComponent(id)); 
        if (d?.hits?.[0]?.inprogress === false || d?.hits?.[0]?.stat?.ok === true || d?.ok === true) 
            return d 
    }
    throw new Error("Przekroczono czas oczekiwania na wydruk") 
}
function showSuccess(label, data) { 
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal small">
            <div class="success">
                <div class="check">✓</div>
                <h3>${label} (#${data.hn})</h3>
                <p>Dokument został poprawnie wystawiony.</p>
                <small>(numer dzienny #${data.bt})</small>
                <button id="finishSaleBtn" class="checkout" onclick="finishSale()">OK / Zamknij <kbd class="kbd light">Enter</kbd></button>
            </div>
        </div></div>`; 
    window.__lastResponse = data 
}
function finishSale() { 
    cart = []; 
    globalAdjustment = null; 
    renderCart(); 
    closeModal(); 
    toast("Sprzedaż zakończona.") 
}
async function checkPrinter() { 
    try { 
        await api("/devicestatus"); 
        $("#printerStatus").className = "status ok"; 
        $("#printerStatus").textContent = "● Drukarka OK" 
        g_DrukarkaOffline = false;
    } catch { 
        $("#printerStatus").className = "status offline"; 
        $("#printerStatus").textContent = "● Drukarka offline" 
        g_DrukarkaOffline = true;
    } 
}
function showWelcomeModal() { 
    if (localStorage.getItem("pos.welcomeHidden") === "1") return; 
    $("#modalRoot").innerHTML = `<div class="modal-backdrop">
        <div class="modal small welcome-modal">
            <div class="welcome-icon">✦</div><div class="modal-body">
                <h3>Podstawowa wersja POS</h3>
                <p>To jest podstawowa wersja aplikacji POS, przygotowana jako punkt wyjścia do dalszego rozwoju.</p>
                <p>Rozwiązanie może być <strong>dowolnie rozszerzane i dostosowywane do indywidualnych wymagań klienta</strong> — zarówno w zakresie wyglądu, funkcji sprzedażowych, integracji, jak i obsługi urządzeń.</p>
                <p class="welcome-source">Kod źródłowy aplikacji znajduje się w repozytorium <a href="https://github.com/bigdotsoftware/kiosk-templates/" target="_blank" rel="noopener">github.com/bigdotsoftware/kiosk-templates</a>.</p>
                <label class="welcome-check"><input type="checkbox" id="welcomeDontShow"> Nie pokazuj więcej</label>
                <div class="actions">
                    <button class="primary" onclick="closeWelcomeModal()">ROZPOCZNIJ PRACĘ</button>
                </div>
            </div>
        </div></div>` 
}
function closeWelcomeModal() { 
    if ($("#welcomeDontShow")?.checked) localStorage.setItem("pos.welcomeHidden", "1"); 
    closeModal() 
}

function settings(activeTab = "catalog") {
    if (settingsConnType == null) settingsConnType = SETTINGS.printer.type;
    const cats = productCategories();
    const filteredProducts = sortProducts(PRODUCTS.filter(p => !settingsSearch || `${p.name} ${p.fiscalName || ""} ${p.code} ${p.cat}`.toLowerCase().includes(settingsSearch.toLowerCase())), settingsSort);
    const html = `<div class="modal-backdrop">
        <div class="modal catalog-settings">
            <div class="modal-head">
                <h3>Ustawienia POS</h3>
                <button class="close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="settings-tabs">
                    <button class="settings-tab ${activeTab === "catalog" || activeTab === ""  || activeTab == null || activeTab == undefined? "active" : ""}" onclick="settings('catalog')">Katalog produktów i kategorie</button>
                    <button class="settings-tab ${activeTab === "reports" ? "active" : ""}" onclick="settings('reports')">Raport dobowy / okresowy</button>
                    <button class="settings-tab ${activeTab === "connection" ? "active" : ""}" onclick="settings('connection')">Drukarka fiskalna</button>
                    <button class="settings-tab ${activeTab === "images" ? "active" : ""}" onclick="settings('images')">Grafiki</button>
                    <button class="settings-tab ${activeTab === "about" ? "active" : ""}" onclick="settings('about')">O Aplikacji</button>
                </div>
                ${(activeTab === "reports" || activeTab === "images") && g_DrukarkaOffline ? `<div class="settings-section">
                    <div class="detect-status error">⚠ Brak połączenia z drukarką fiskalną. Ta zakładka jest niedostępna — sprawdź połączenie i ustawienia w zakładce "Drukarka fiskalna".</div>
                </div>` : activeTab === "reports" ? `<div class="settings-section">
                    <div class="section-head">
                        <div>
                            <h4>Raport dobowy</h4>
                            <p>Raport fiskalny dobowy za wskazany dzień.</p>
                        </div>
                    </div>
                    <div class="report-form">
                        <div class="field">
                            <label>Data raportu</label>
                            <input type="date" id="reportDailyDate" value="${new Date().toISOString().slice(0, 10)}">
                        </div>
                        <button class="primary compact" id="reportDailyBtn">🖨 Drukuj raport dobowy</button>
                    </div>
                    <div class="report-status" id="reportDailyStatus"></div>
                </div>
                <div class="settings-section">
                    <div class="section-head">
                        <div>
                            <h4>Raport okresowy</h4>
                            <p>Raport okresowy według zakresu dat.</p>
                        </div>
                    </div>
                    <div class="grid2">
                        <div class="field">
                            <label>Data od</label>
                            <input type="date" id="reportPeriodFrom" value="${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)}">
                        </div>
                        <div class="field">
                            <label>Data do</label>
                            <input type="date" id="reportPeriodTo" value="${new Date().toISOString().slice(0, 10)}">
                        </div>
                    </div>
                    <div class="field">
                        <label>Typ raportu</label>
                        <select id="reportPeriodType">
                            <option value="full">Pełny</option>
                            <option value="summary_only">Tylko podsumowanie</option>
                            <option value="monthly_full">Miesięczny pełny</option>
                            <option value="monthly_summary_only">Miesięczny — tylko podsumowanie</option>
                            <option value="settlement_full">Rozliczeniowy pełny</option>
                            <option value="settlement_summary_only">Rozliczeniowy — tylko podsumowanie</option>
                        </select>
                    </div>
                    <button class="primary compact" id="reportPeriodBtn">🖨 Drukuj raport okresowy</button>
                    <div class="report-status" id="reportPeriodStatus"></div>
                </div>` : activeTab === "connection" ? `<div class="settings-section">
                    <div class="section-head">
                        <div>
                            <h4>Drukarka fiskalna</h4>
                            <p>Parametry połączenia i ustawienia stanowiska kasjerskiego.</p>
                        </div>
                    </div>
                    <div class="field">
                        <label>Kasjer</label>
                        <input id="cashier" value="${esc(SETTINGS.cashier)}">
                    </div>
                    <div class="field">
                        <div class="grid2">
                            <div class="field">
                                <label>Producent drukarki</label>
                                <select id="printerManufacturer">${["Posnet", "Novitus"].map(b => `<option value="${b}" ${SETTINGS.printer.printerManufacturer === b ? "selected" : ""}>${b}</option>`).join("")}</select>
                            </div>
                            <div class="field">
                                &nbsp;
                            </div>
                        </div>
                    </div>
                    <div class="field">
                        <label>Typ połączenia z drukarką</label>
                        <div class="conn-toggle">
                            <button type="button" class="conn-type ${settingsConnType === "rs232" ? "active" : ""}" id="connUsb">🔌 USB / RS-232</button>
                            <button type="button" class="conn-type ${settingsConnType === "eth" ? "active" : ""}" id="connNetwork">🌐 Sieciowa (TCP/IP)</button>
                        </div>
                    </div>
                    <div id="connUsbFields" style="display:${settingsConnType === "eth" ? "none" : "block"}">
                        <div class="grid3">
                            <div class="field">
                                <label>Port szeregowy / urządzenie</label>
                                <input id="usbDevice" value="${esc(SETTINGS.printer.usbDevice)}" placeholder="/dev/ttyUSB0 lub COM3">
                            </div>
                            <div class="field">
                                <label>Prędkość transmisji (baud)</label>
                                <select id="usbBaud">${[9600, 19200, 38400, 57600, 115200].map(b => `<option value="${b}" ${Number(SETTINGS.printer.usbBaud) === b ? "selected" : ""}>${b}</option>`).join("")}</select>
                            </div>
                            <div class="field">
                                <label>Kontrola przepływu danych</label>
                                <select id="usbFlowControl">
                                    <option value="none" ${SETTINGS.printer.usbFlowControl === "none" ? "selected" : ""}>Brak</option>
                                    <option value="rtscts" ${SETTINGS.printer.usbFlowControl === "rtscts" ? "selected" : ""}>RTS/CTS</option>
                                    <option value="xonxoff" ${SETTINGS.printer.usbFlowControl === "xonxoff" ? "selected" : ""}>XON/XOFF</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div id="connNetworkFields" style="display:${settingsConnType === "eth" ? "block" : "none"}">
                        <div class="grid2">
                            <div class="field">
                                <label>Adres IP drukarki</label>
                                <input id="netIp" value="${esc(SETTINGS.printer.netIp)}" placeholder="192.168.0.50"></div>
                                <div class="field">
                                    <label>Port TCP</label>
                                    <input id="netPort" type="number" min="1" max="65535" value="${SETTINGS.printer.netPort}">
                                </div>
                            </div>
                        </div>
                        <!--<div class="grid2">
                            <div class="field">
                                <label>Typ płatności gotówka (ty)</label>
                                <input id="cashType" type="number" value="${SETTINGS.paymentTypes.cash}">
                            </div>
                            <div class="field">
                                <label>Typ płatności karta (ty)</label>
                                <input id="cardType" type="number" value="${SETTINGS.paymentTypes.card}">
                            </div>
                        </div>--> 
                        <!--<p class="settings-note">PaymentObject.ty jest liczbą. W dostarczonym schemacie przykład Visa ma ty=8; pozostałe kody ustaw zgodnie z konfiguracją drukarki.</p>-->
                        <div class="printer-detect">
                            <div>
                                <strong>Wykrywanie drukarki fiskalnej</strong>
                                <small>Skanowanie portów USB lub sieci lokalnej może potrwać kilka-kilkanaście sekund. Wykryte parametry zostaną automatycznie uzupełnione.</small>
                            </div>
                            <div class="detect-buttons">
                                <button type="button" onclick="printerDetect('rs232')">⌁ Wykryj przez USB</button>
                                <button type="button" onclick="printerDetect('eth')">⌁ Wykryj w sieci lokalnej</button>
                            </div>
                        </div>
                        <div id="detectResults"></div>
                    </div>
                    <div class="field">
                        <label>Informacje o licencji</label>
                        <div id="licenseStatus" class="license-status">
                            <span class="detect-status">⏳ Sprawdzanie licencji…</span>
                        </div>
                        <div class="detect-buttons license-refresh">
                            <button type="button" onclick="loadLicenseStatus(true)">⌁ Odśwież informacje o licencji</button>
                        </div>
                    </div>
                    <div class="field">
                        <label>Plik licencji (.lic)</label>
                        <div class="file-drop" id="licenseFileDrop" tabindex="0">
                            <input id="licenseFile" type="file" accept=".lic" hidden>
                            <div class="file-drop-content">
                                <span class="file-drop-icon">📄</span>
                                <span class="file-drop-text" id="licenseFileText">${SETTINGS.printer.licenseFileName || "Kliknij aby wybrać lub upuść plik licencji"}</span>
                                <span class="file-drop-hint">.lic · ok. 500 B</span>
                            </div>
                        </div>
                        <div class="license-actions">
                            <button type="button" class="link-btn image-clear" id="clearLicenseFile">Usuń plik licencji</button>
                            <!--<button type="button" class="nip-gus" id="uploadLicenseBtn" ${SETTINGS.printer.licenseContent ? "" : "disabled"}>⬆ Wyślij do serwera</button>-->
                        </div>
                    </div>
                    <div class="actions">
                        <button onclick="closeModal()">Anuluj</button>
                        <button class="primary" onclick="saveSettings()">ZAPISZ USTAWIENIA</button>
                    </div>` : activeTab === "images" ? `<div class="settings-section">
                        <div class="section-head">
                            <div>
                                <h4>Grafiki</h4>
                                <p>Wgrywanie grafik do pamięci drukarki fiskalnej.</p>
                            </div>
                        </div>
                        <div class="field">
                            <label>Plik graficzny</label>
                            <div class="file-drop" id="imgFileDrop" tabindex="0">
                                <input type="file" id="imgFile" accept="image/*" hidden>
                                <div class="file-drop-content">
                                    <span class="file-drop-icon">🖼</span>
                                    <span class="file-drop-text" id="imgFileText">Kliknij aby wybrać lub upuść plik graficzny</span>
                                    <span class="file-drop-hint">PNG, JPG, BMP…</span>
                                </div>
                            </div>
                        </div>
                        <div class="grid2">
                            <div class="field">
                                <label>Slot</label>
                                <select id="imgSlot">${Array.from({ length: 256 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
                            </div>
                            <div class="field">
                                <label>Algorytm</label>
                                <select id="imgAlgo">${IMAGE_ALGOS.map((a, i) => `<option value="${i}">${esc(a.label)} (${a.method}, ${a.threshold})</option>`).join("")}</select>
                            </div>
                        </div>
                        <button class="primary compact" id="imgUploadBtn">⬆ Wgraj na urządzenie</button>
                        <button class="img-show-btn" id="imgListBtn">Pobierz grafiki z urządzenia</button>
                        <div class="report-status" id="imgStatus"></div>
                        <div class="product-manager" id="imgList"></div>
                    </div>` : activeTab === "about" ? `<div class="settings-section">
                        <div class="section-head">
                            <div>
                                <h4>O Aplikacji</h4>
                                <p>Informacje o aplikacji i jej producencie.</p>
                            </div>
                        </div>
                        <div class="invoice-box">
                            <h4>EasyPOS</h4>
                            <p>Producentem aplikacji jest <strong>Big Dot Software</strong> — <a href="https://bigdotsoftware.pl/" target="_blank" rel="noopener">bigdotsoftware.pl</a>.</p>
                        </div>
                        <div class="invoice-box">
                            <h4>Open source</h4>
                            <p>Aplikacja EasyPOS jest oprogramowaniem open source. Jej kod źródłowy znajduje się w serwisie GitHub: <a href="https://github.com/bigdotsoftware/posnetserver" target="_blank" rel="noopener">github.com/bigdotsoftware/posnetserver</a>.</p>
                        </div>
                        <div class="actions">
                            <button class="primary" onclick="closeModal()">ZAMKNIJ</button>
                        </div>
                    </div>` : `<div class="settings-section">
                        <div class="section-head">
                            <div>
                                <h4>Kategorie</h4>
                                <p>Każda kategoria pokazuje liczbę przypisanych produktów.</p>
                            </div>
                            <button class="primary compact" onclick="addCategory()">+ Dodaj kategorię</button>
                        </div>
                        <div class="category-manager" id="categoryManager">${cats.length ? cats.map(c => `<div class="manage-row">
                            <div class="category-name"><span>${esc(c)}</span><b>${categoryCount(c)}</b></div>
                            <div class="manage-actions"><button onclick="renameCategory('${esc(c)}')">Edytuj</button>
                            <button class="danger" data-delete-category="${esc(c)}">Usuń</button></div></div>`).join("") : '<div class="settings-empty">Brak kategorii.</div>'}</div>
                    </div>
                    <div class="settings-section">
                        <div class="section-head">
                            <div>
                                <h4>Produkty</h4>
                                <p>${PRODUCTS.length} produktów w katalogu.</p>
                            </div>
                            <button class="primary compact" onclick="openProductEditor()">+ Dodaj produkt</button>
                        </div>
                        <div class="settings-product-toolbar">
                            <div class="search-wrap settings-search">
                                <span>⌕</span>
                                <input id="settingsProductSearch" value="${esc(settingsSearch)}" placeholder="Szukaj produktu, kodu lub kategorii…">
                            </div>
                            <select id="settingsProductSort" class="sort-select">
                                <option value="name-asc" ${settingsSort === "name-asc" ? "selected" : ""}>Nazwa A–Z</option>
                                <option value="name-desc" ${settingsSort === "name-desc" ? "selected" : ""}>Nazwa Z–A</option>
                                <option value="price-asc" ${settingsSort === "price-asc" ? "selected" : ""}>Cena rosnąco</option>
                                <option value="price-desc" ${settingsSort === "price-desc" ? "selected" : ""}>Cena malejąco</option>
                                <option value="code-asc" ${settingsSort === "code-asc" ? "selected" : ""}>Kod rosnąco</option>
                                <option value="code-desc" ${settingsSort === "code-desc" ? "selected" : ""}>Kod malejąco</option>
                            </select>
                        </div>
                        <div class="product-manager" id="productManager">
                            ${filteredProducts.length ? filteredProducts.map(p => `<div class="manage-row product-manage-row">
                                    <div class="product-manage-info">
                                        <span class="manage-icon">${productVisual(p)}</span>
                                        <div>
                                            <strong>${esc(p.name)}</strong>
                                            ${p.fiscalName ? `<small>Nazwa fiskalna: ${esc(p.fiscalName)}</small>` : ""}
                                            <small>kod ${esc(p.code)} · ${esc(p.cat)} · VAT ${esc(SETTINGS.vat[p.vat]?.vtp || p.vat)} · ${money(p.price)}</small>
                                        </div>
                                    </div>
                                    <div class="manage-actions">
                                        <button onclick="openProductEditor('${esc(p.id)}')">Edytuj</button>
                                        <button class="danger" onclick="deleteProduct('${esc(p.id)}')">Usuń</button>
                                    </div>
                                </div>`).join("") : '<div class="settings-empty">Brak produktów pasujących do wyszukiwania.</div>'}
                            </div>
                    </div>`}
            </div>
        </div></div>`;
    $("#modalRoot").innerHTML = html;
    const connUsbBtn = $("#connUsb"), connNetBtn = $("#connNetwork");
    if (connUsbBtn) connUsbBtn.onclick = () => setConnectionType("rs232");
    if (connNetBtn) connNetBtn.onclick = () => setConnectionType("eth");
    const rdb = $("#reportDailyBtn"), rpb = $("#reportPeriodBtn");
    if (rdb) rdb.onclick = () => runDailyReport();
    if (rpb) rpb.onclick = () => runPeriodReport();
    initLicenseUpload();
    loadLicenseStatus();
    if (activeTab === "images" && !g_DrukarkaOffline) initImagesTab();
    $$(`[data-delete-category]`).forEach(b => b.onclick = () => deleteCategory(b.dataset.deleteCategory));
    const ss = $("#settingsProductSearch"), so = $("#settingsProductSort");
    if (ss) ss.oninput = e => { 
        settingsSearch = e.target.value; 
        settings(activeTab); 
        setTimeout(() => { const x = $("#settingsProductSearch"); x.focus(); x.setSelectionRange(x.value.length, x.value.length) }, 0) 
    };
    if (so) so.onchange = e => { 
        settingsSort = e.target.value; 
        settings(activeTab) 
    };
}
const IMAGE_ALGOS = [
    { label: "Zdjęcia produktów", method: "dither", threshold: 128 },
    { label: "Zdjęcia ludzi", method: "dither", threshold: 135 },
    { label: "Logo firmowe", method: "threshold", threshold: 170 },
    { label: "Grafiki reklamowe", method: "threshold", threshold: 170 },
    { label: "Czarne napisy", method: "threshold", threshold: 150 },
    { label: "Ikony i piktogramy", method: "threshold", threshold: 160 }
];
const FOOTER_SLOTS_KEY = "pos.footerImageSlots";
function getFooterSlots() {
    try { const a = JSON.parse(localStorage.getItem(FOOTER_SLOTS_KEY) || "[]"); return Array.isArray(a) ? a : [] } catch { return [] }
}
function getCheckedFooterSlots() {
    return $$("[data-img-footer]:checked").map(c => Number(c.dataset.imgFooter)).sort((a, b) => a - b);
}
function setFooterSlot(slot, on) {
    const s = new Set(getCheckedFooterSlots());
    // if (on) 
    //     s.add(slot); 
    // else 
    //     s.delete(slot);
    localStorage.setItem(FOOTER_SLOTS_KEY, JSON.stringify([...s].sort((a, b) => a - b)));
}
function initImagesTab() {
    const drop = $("#imgFileDrop"), input = $("#imgFile"), text = $("#imgFileText");
    const setFile = file => {
        if (!file) return;
        if (!file.type.startsWith("image/")) { toast("Wybierz plik graficzny.", true); return }
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        text.textContent = file.name;
        text.classList.add("has-file");
    };
    input.onchange = e => setFile(e.target.files?.[0]);
    drop.onclick = () => input.click();
    drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click() } };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("dragover") };
    drop.ondragleave = () => drop.classList.remove("dragover");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("dragover"); setFile(e.dataTransfer.files?.[0]) };
    $("#imgUploadBtn").onclick = uploadDeviceImage;
    $("#imgListBtn").onclick = loadDeviceImages;
    const cached = getImgCacheSlots();
    if (cached) renderImageList(cached);
}
const IMG_CACHE_SLOTS_KEY = "pos.imageCache.slots", IMG_CACHE_PREFIX = "pos.imageCache.img.";
function getImgCacheSlots() {
    try { const a = JSON.parse(localStorage.getItem(IMG_CACHE_SLOTS_KEY)); return Array.isArray(a) ? a : null } catch { return null }
}
function setImgCacheSlots(slots) {
    try { localStorage.setItem(IMG_CACHE_SLOTS_KEY, JSON.stringify(slots)) } catch { }
}
function getImgCacheThumb(slot) { return localStorage.getItem(IMG_CACHE_PREFIX + slot) }
function setImgCacheThumb(slot, dataUrl) {
    try { localStorage.setItem(IMG_CACHE_PREFIX + slot, dataUrl) } catch { }
}
function removeImgCacheSlot(slot) {
    localStorage.removeItem(IMG_CACHE_PREFIX + slot);
    const s = getImgCacheSlots();
    if (s) setImgCacheSlots(s.filter(x => x !== slot));
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}
function renderImageList(slots) {
    const list = $("#imgList");
    if (!slots.length) { list.innerHTML = '<div class="settings-empty">Brak grafik w urz\u0105dzeniu.</div>'; return }
    const footer = new Set(getFooterSlots());
    list.innerHTML = slots.map(s => `<div class="manage-row product-manage-row" data-img-row="${s}">
        <div class="product-manage-info">
            <img data-img-thumb="${s}" alt="Slot ${s}" src="${esc(getImgCacheThumb(s) || "")}" style="max-width:80px;max-height:80px;background:#eee">
            <div><strong>Slot ${s}</strong>
            <label><input type="checkbox" data-img-footer="${s}" ${footer.has(s) ? "checked" : ""}> Drukuj w stopce</label></div>
        </div>
        <div class="manage-actions"><button class="danger" data-img-delete="${s}">Usu\u0144</button></div>
    </div>`).join("");
    $$("[data-img-footer]").forEach(c => c.onchange = () => setFooterSlot(Number(c.dataset.imgFooter), c.checked));
    $$("[data-img-delete]").forEach(b => b.onclick = async () => {
        const s = Number(b.dataset.imgDelete);
        try {
            await api(`/image/${s}`, { method: "DELETE" });
            setFooterSlot(s, false);
            removeImgCacheSlot(s);
            $(`[data-img-row="${s}"]`)?.remove();
            toast(`Usuni\u0119to grafik\u0119 ze slotu ${s}.`);
        } catch (e) { toast(`B\u0142\u0105d usuwania: ${e.message}`, true) }
    });
}
async function uploadDeviceImage() {
    const file = $("#imgFile").files[0], status = $("#imgStatus");
    if (!file) { toast("Wybierz plik graficzny.", true); return }
    const slot = $("#imgSlot").value, algo = IMAGE_ALGOS[$("#imgAlgo").value];
    const fd = new FormData();
    fd.append("image", file);
    fd.append("options", JSON.stringify({ width: 384, height: 640, threshold: algo.threshold, method: algo.method }));
    status.textContent = "⏳ Wysyłanie…";
    imgLoadAborted = false;
    showImgProgress(`Wysyłanie grafiki do slotu ${slot}…`, 0, 0, { title: "Wysyłanie grafiki", cancellable: false });
    try {
        const r = await fetch(`${SETTINGS.apiBase.replace(/\/$/, "")}/image/${slot}`, { method: "PUT", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) throw new Error(d.error || d.message || `HTTP ${r.status}`);
        status.textContent = "";
        const cachedSlots = getImgCacheSlots();
        if (cachedSlots) {
            localStorage.removeItem(IMG_CACHE_PREFIX + slot);
            if (!cachedSlots.includes(Number(slot))) setImgCacheSlots([...cachedSlots, Number(slot)].sort((a, b) => a - b));
        }
        toast(`Grafika wgrana do slotu ${slot}.`);
    } catch (e) {
        status.textContent = "";
        toast(`Błąd wgrywania: ${e.message}`, true);
    } finally {
        hideImgProgress();
    }
}
let imgLoadAborted = false;
function showImgProgress(text, done = 0, total = 0, { title = "Odczyt grafik z urządzenia", cancellable = true } = {}) {
    let ov = $("#imgProgressOverlay");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "imgProgressOverlay";
        ov.className = "progress-overlay";
        ov.innerHTML = `<div class="progress-box"><h3>${esc(title)}</h3><p id="imgProgressText"></p><div class="progress-bar"><div id="imgProgressFill"></div></div><small id="imgProgressCount"></small>${cancellable ? '<button type="button" class="progress-cancel" id="imgProgressCancel">Przerwij</button>' : ""}</div>`;
        document.body.appendChild(ov);
        if (cancellable) $("#imgProgressCancel").onclick = e => {
            imgLoadAborted = true;
            e.target.disabled = true;
            $("#imgProgressText").textContent = "Przerywanie, proszę czekać…";
        };
    }
    if (imgLoadAborted) return;
    const fill = $("#imgProgressFill");
    $("#imgProgressText").textContent = text;
    $("#imgProgressCount").textContent = total ? `${done} / ${total}` : "";
    fill.classList.toggle("indeterminate", !total);
    fill.style.width = total ? `${Math.round(done / total * 100)}%` : "";
}
function hideImgProgress() { $("#imgProgressOverlay")?.remove() }
async function loadDeviceImages() {
    const list = $("#imgList");
    list.innerHTML = "";
    imgLoadAborted = false;
    const base = SETTINGS.apiBase.replace(/\/$/, "");
    showImgProgress("Odczyt listy slotów…");
    try {
        const d = await api("/image_slots");
        const slots = d.slots || [];
        (getImgCacheSlots() || []).filter(s => !slots.includes(s)).forEach(s => localStorage.removeItem(IMG_CACHE_PREFIX + s));
        setImgCacheSlots(slots);
        renderImageList(slots);
        let done = 0;
        for (const s of slots) {
            if (imgLoadAborted) break;
            showImgProgress(`Pobieranie grafiki ze slotu ${s}…`, done, slots.length);
            try {
                const r = await fetch(`${base}/image/${s}`, { cache: "no-store" });
                if (r.ok) {
                    const dataUrl = await blobToDataUrl(await r.blob());
                    setImgCacheThumb(s, dataUrl);
                    const img = $(`[data-img-thumb="${s}"]`);
                    if (img) img.src = dataUrl;
                }
            } catch { }
            showImgProgress(`Pobieranie grafiki ze slotu ${s}…`, ++done, slots.length);
        }
    } catch (e) {
        list.innerHTML = `<div class="settings-empty">Błąd: ${esc(e.message)}</div>`;
    } finally {
        hideImgProgress();
    }
}
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(binary);
}
async function loadLicenseStatus(manual = false) {
    const box = $("#licenseStatus");
    if (!box) return;
    box.innerHTML = `<span class="detect-status">⏳ Sprawdzanie licencji…</span>`;

    if( manual) {
        if( SETTINGS.printer.licenseContent != "")
            await uploadLicenseToServer(SETTINGS.printer.licenseContent);
    }

    try {
        const data = await api("/licencja?json=1");
        const validTo = data.hits.validTo ? new Date(data.hits.validTo * 1000).toLocaleDateString("pl-PL") : "—";
        const expired = !!data.hits.expired;
        box.innerHTML = `<div class="detect-status ${expired ? "error" : "ok"}">
            ${expired ? "⚠" : "✓"} <strong>${esc(data.hits.licenseTo || "Licencja")}</strong><br>
            <small>${esc(data.hits.text || "")}</small><br>
            <small>Ważna do: <b>${validTo}</b>${data.hits.licenseId ? ` · ID: ${esc(String(data.hits.licenseId))}` : ""}</small>
        </div>`;
    } catch (e) {
        if( e.message && e.message.text)
            box.innerHTML = `<div class="detect-status error">⚠ ${esc(e.message.text || "Wersja nielicencjonowana")}</div>`;
        else
            box.innerHTML = `<div class="detect-status error">⚠ ${esc("Wersja nielicencjonowana")}</div>`;
    }
    if (manual) toast("Status licencji odświeżony.");
}
function initLicenseUpload() {
    const drop = $("#licenseFileDrop"), 
          input = $("#licenseFile"), 
          text = $("#licenseFileText");
        //   uploadBtn = $("#uploadLicenseBtn")
          
    if (!drop || !input) return;
    const setFile = (file) => {
        if (!file) return;
        if (!/\.lic$/i.test(file.name)) { 
            toast("Wybierz plik z rozszerzeniem .lic", true); 
            input.value = ""; 
            return 
        }
        if (file.size > 8 * 1024) { toast("Plik licencji jest za duży (oczekiwany ok. 500 B).", true); input.value = ""; return }
        const reader = new FileReader();
        reader.onload = () => {
            
            uploadedLicenseContent = arrayBufferToBase64(reader.result);
            uploadedLicenseFileName = file.name;

            // SETTINGS.printer.licenseContent = 
            // SETTINGS.printer.licenseFileName = 
            // localStorage.setItem("pos.printer", JSON.stringify(SETTINGS.printer));
            text.textContent = file.name;
            text.classList.add("has-file");
            // uploadBtn.disabled = false;
            toast("Plik licencji wczytany. Zapisz ustawienia aby go użyć.");
        };
        reader.readAsArrayBuffer(file);
    };
    input.onchange = e => setFile(e.target.files?.[0]);
    drop.onclick = () => input.click();
    drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click() } };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("dragover") };
    drop.ondragleave = () => drop.classList.remove("dragover");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("dragover"); setFile(e.dataTransfer.files?.[0]) };
    $("#clearLicenseFile").onclick = () => {
        SETTINGS.printer.licenseContent = "";
        SETTINGS.printer.licenseFileName = "";
        uploadedLicenseContent = null;
        uploadedLicenseFileName = null;

        // localStorage.setItem("pos.printer", JSON.stringify(SETTINGS.printer));
        text.textContent = "Kliknij aby wybrać lub upuść plik licencji";
        text.classList.remove("has-file");
        input.value = "";
        // uploadBtn.disabled = true;
    };
    // uploadBtn.onclick = () => uploadLicenseToServer();
}
async function uploadLicenseToServer(content) {
    // const uploadBtn = $("#uploadLicenseBtn");
    if (!content) { toast("Najpierw wybierz plik licencji.", true); return }
    // uploadBtn.disabled = true;
    // const original = uploadBtn.textContent;
    // uploadBtn.textContent = "⏳ Wysyłanie…";
    try {
        const data = await api("/licencja/use", { 
            method: "POST", 
            body: JSON.stringify({ content: content }) 
        });
        // toast(`Licencja wysłana i zapisana jako ${data.file || "plik tymczasowy"}.`);
    } catch (e) {
        toast("Licencja: " + e.message, true);
    } finally {
        // uploadBtn.disabled = false;
        // uploadBtn.textContent = original;
    }
}
async function runDailyReport() {
    const btn = $("#reportDailyBtn"), status = $("#reportDailyStatus"), dateEl = $("#reportDailyDate");
    const da = dateEl.value;
    if (!da) { toast("Wybierz datę raportu.", true); dateEl.focus(); return }
    btn.disabled = true;
    status.innerHTML = `<div class="detect-status">⏳ Drukowanie raportu dobowego…</div>`;
    try {
        await api("/raporty/dobowy", { method: "POST", body: JSON.stringify({ da }) });
        status.innerHTML = `<div class="detect-status ok">✓ Raport dobowy za ${da} został wydrukowany.</div>`;
        toast("Raport dobowy wydrukowany.");
    } catch (e) {
        status.innerHTML = `<div class="detect-status error">${esc(e.message)}</div>`;
        toast("Raport dobowy: " + e.message, true);
    } finally {
        btn.disabled = false;
    }
}
async function runPeriodReport() {
    const btn = $("#reportPeriodBtn"), status = $("#reportPeriodStatus"), fromEl = $("#reportPeriodFrom"), toEl = $("#reportPeriodTo"), typeEl = $("#reportPeriodType");
    const fd = fromEl.value, td = toEl.value;
    if (!fd || !td) { toast("Wybierz zakres dat.", true); if (!fd) fromEl.focus(); else toEl.focus(); return }
    if (fd > td) { toast("Data początkowa nie może być późniejsza niż końcowa.", true); fromEl.focus(); return }
    btn.disabled = true;
    status.innerHTML = `<div class="detect-status">⏳ Drukowanie raportu okresowego…</div>`;
    try {
        await api("/raporty/okresowy/daty", { method: "POST", body: JSON.stringify({ fd, td, type: typeEl.value }) });
        status.innerHTML = `<div class="detect-status ok">✓ Raport okresowy ${fd} – ${td} został wydrukowany.</div>`;
        toast("Raport okresowy wydrukowany.");
    } catch (e) {
        status.innerHTML = `<div class="detect-status error">${esc(e.message)}</div>`;
        toast("Raport okresowy: " + e.message, true);
    } finally {
        btn.disabled = false;
    }
}
function setConnectionType(t) {
    settingsConnType = t === "eth" ? "eth" : "rs232";
    const usbBtn = $("#connUsb"), netBtn = $("#connNetwork");
    if (usbBtn) usbBtn.classList.toggle("active", settingsConnType === "rs232");
    if (netBtn) netBtn.classList.toggle("active", settingsConnType === "eth");
    const uf = $("#connUsbFields"), nf = $("#connNetworkFields");
    if (uf) uf.style.display = settingsConnType === "rs232" ? "block" : "none";
    if (nf) nf.style.display = settingsConnType === "eth" ? "block" : "none";
}
function detectPrinterLabel(type, p) {
    if (type === "rs232")
        return `🔌 ${esc(p.path || "?")} · ${p.baudRate || "?"} baud${p.brand ? " · " + esc(String(p.brand).toUpperCase()) : ""}${p.manufacturer ? " · " + esc(p.manufacturer) : ""}`;
    return `🌐 ${esc(p.ip || "?")}:${p.port || "?"}${p.brand ? " · " + esc(String(p.brand).toUpperCase()) : ""}`;
}
function applyDetectedPrinter(type, p) {
    if( p.brand == "posnet") {
        if ($("#printerManufacturer")) $("#printerManufacturer").value = "Posnet";
    }
    if( p.brand == "novitus") {
        if ($("#printerManufacturer")) $("#printerManufacturer").value = "Novitus";
    }
    if (type === "rs232") {
        setConnectionType("rs232");
        if ($("#usbDevice")) $("#usbDevice").value = p.path || "";
        if ($("#usbBaud") && p.baudRate) $("#usbBaud").value = String(p.baudRate);
    } else {
        setConnectionType("eth");
        if ($("#netIp")) $("#netIp").value = p.ip || "";
        if ($("#netPort") && p.port) $("#netPort").value = String(p.port);
    }
}
async function printerDetect(type) {
    const isUsb = type === "rs232";
    const resultsBox = $("#detectResults");
    const buttons = $$(".detect-buttons button");
    buttons.forEach(b => b.disabled = true);
    if (resultsBox) resultsBox.innerHTML = `<div class="detect-status">⏳ Trwa skanowanie ${isUsb ? "portów USB" : "sieci lokalnej"}…</div>`;
    try {
        const data = await api(`/detect/printers?source=${isUsb ? "rs232" : "eth"}`);
        const found = (isUsb ? data.usb : data.network) || [];
        if (!found.length) {
            if (resultsBox) resultsBox.innerHTML = `<div class="detect-status error">Nie wykryto drukarki ${isUsb ? "podłączonej przez USB" : "w sieci lokalnej"}. Sprawdź podłączenie i spróbuj ponownie.</div>`;
            toast("Nie wykryto żadnej drukarki.", true);
            return;
        }
        if (found.length === 1) {
            applyDetectedPrinter(type, found[0]);
            if (resultsBox) resultsBox.innerHTML = `<div class="detect-status ok">✓ ${detectPrinterLabel(type, found[0])} — konfiguracja uzupełniona.</div>`;
            toast("Wykryto drukarkę — pola konfiguracji zostały uzupełnione.");
            return;
        }
        if (resultsBox) {
            resultsBox.innerHTML = `<div class="detect-list-head">Wykryto ${found.length} urządzenia — wybierz drukarkę:</div>` + found.map((p, i) => `<button type="button" class="detect-item" data-detect-idx="${i}">${detectPrinterLabel(type, p)}</button>`).join("");
            $$("#detectResults [data-detect-idx]").forEach(b => b.onclick = () => {
                const p = found[Number(b.dataset.detectIdx)];
                applyDetectedPrinter(type, p);
                resultsBox.innerHTML = `<div class="detect-status ok">✓ ${detectPrinterLabel(type, p)} — konfiguracja uzupełniona.</div>`;
                toast("Wybrano drukarkę — pola konfiguracji zostały uzupełnione.");
            });
        }
    } catch (e) {
        if (resultsBox) resultsBox.innerHTML = `<div class="detect-status error">Błąd wykrywania: ${esc(e.message)}</div>`;
        toast("Wykrywanie nie powiodło się: " + e.message, true);
    } finally {
        buttons.forEach(b => b.disabled = false);
    }
}

function openCategoryModal(oldName = "") { 
    const editing = !!oldName; 
    const html = `<div class="modal-backdrop">
        <div class="modal small category-editor">
            <div class="modal-head">
                <h3>${editing ? "Edytuj kategorię" : "Dodaj kategorię"}</h3>
                <button class="close" onclick="settings()">×</button>
            </div>
            <div class="modal-body">
                <div class="field">
                    <label>Nazwa kategorii</label>
                    <input id="categoryNameInput" value="${esc(oldName)}" maxlength="60" autofocus>
                </div>
                <p class="settings-note">Produkty przypisane do kategorii pozostaną w niej po zmianie nazwy.</p>
                <div class="actions">
                    <button onclick="settings()">Anuluj</button>
                    <button class="primary" id="saveCategoryBtn">${editing ? "ZAPISZ ZMIANY" : "DODAJ KATEGORIĘ"}</button>
                </div>
            </div>
        </div></div>`; 
    $("#modalRoot").innerHTML = html; 
    const input = $("#categoryNameInput"); 
    $("#saveCategoryBtn").onclick = () => { 
        const name = input.value.trim(); 
        if (!name) { 
            toast("Podaj nazwę kategorii.", true); 
            input.focus(); 
            return 
        } 
        if (productCategories().some(c => c.toLowerCase() === name.toLowerCase() && c !== oldName)) { 
            toast("Taka kategoria już istnieje.", true); 
            input.focus(); 
            return 
        } 
        if (editing) { 
            CATEGORIES = CATEGORIES.map(c => c === oldName ? name : c); 
            PRODUCTS.forEach(p => { if (p.cat === oldName) p.cat = name }); 
            cart.forEach(x => { if (x.cat === oldName) x.cat = name }); 
            if (category === oldName) category = name; 
            saveCategories(); 
            saveProducts(); 
            renderCategories(); 
            renderProducts(); 
            renderCart(); 
            settings(); 
            toast("Nazwa kategorii została zmieniona.") 
        } else { 
            CATEGORIES.push(name); 
            saveCategories(); 
            renderCategories(); 
            renderProducts(); 
            settings(); 
            toast(`Dodano kategorię „${name}”.`) 
        } 
    }; 
    input.onkeydown = e => { if (e.key === "Enter") $("#saveCategoryBtn").click() } 
}

function addCategory() { openCategoryModal() }
function renameCategory(oldName) { openCategoryModal(oldName) }

function deleteCategory(name) {
    const products = PRODUCTS.filter(p => p.cat === name);
    if (products.length) { 
        toast(`Nie można usunąć kategorii „${name}” — zawiera ${products.length} produkt${products.length === 1 ? "" : "y"}. Najpierw usuń lub przenieś produkty.`, true); 
        return 
    }
    openConfirmModal({
        icon: "🗑",
        title: "Usuwanie kategorii",
        message: `Usunąć kategorię „${name}”?`,
        confirmText: "Usuń",
        danger: true
    }, () => {
        CATEGORIES = CATEGORIES.filter(c => c !== name);
        saveCategories();
        if (category === name) category = "Wszystko";
        renderCategories(); 
        renderProducts(); 
        settings();
        toast(`Usunięto kategorię „${name}”.`);
    });
}
function openProductEditor(id = null) {
    const p = id ? PRODUCTS.find(x => x.id === id) : null;
    const cats = productCategories();
    const categoryOptions = cats.map(c => `<option value="${esc(c)}" ${p?.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    const icons = ["🛒", "☕", "🍵", "💧", "🥤", "🍰", "🍪", "🥐", "🥪", "🥗", "🍕", "🍔", "🌭", "🍟", "🍎", "🍊", "🧃", "🍺", "🍷", "🥛", "🍦", "🍩", "🎂", "🍫", "🥨", "🍜", "🍣", "🌮", "🍱", "🧁", "⭐", "🎁", "📦", "💻", "📱"];
    const iconOptions = icons.map(i => `<button type="button" class="icon-choice ${!p?.image && p?.icon === i ? "active" : ""}" data-icon="${i}">${i}</button>`).join("");
    const preview = p?.image ? `<img src="${p.image}" alt="">` : esc(p?.icon || "🛒");
    const html = `<div class="modal-backdrop">
        <div class="modal product-editor">
            <div class="modal-head">
                <h3>${p ? "Edytuj produkt" : "Dodaj produkt"}</h3>
                <button class="close" onclick="settings()">×</button>
            </div>
            <div class="modal-body">
                <div class="grid2">
                    <div class="field">
                        <label>Nazwa produktu</label>
                        <input id="productName" value="${esc(p?.name || "")}" autofocus>
                    </div>
                    <div class="field">
                        <label>Nazwa fiskalna</label>
                        <input id="productFiscalName" maxlength="40" value="${esc(p?.fiscalName || "")}" placeholder="Nazwa drukowana na paragonie">
                    </div>
                </div>
                <div class="grid2"><div class="field"><label>Kod / PLU</label>
                <input id="productCode" value="${esc(p?.code || "")}"></div><div class="field">
                <label>Cena brutto (PLN)</label><input id="productPrice" type="number" min="0" step="0.01" value="${p?.price ?? ""}"></div></div>
                <div class="grid2"><div class="field"><label>VAT</label><select id="productVat"><option value="A" ${p?.vat === "A" ? "selected" : ""}>23%</option>
                <option value="B" ${p?.vat === "B" ? "selected" : ""}>8%</option><option value="C" ${p?.vat === "C" ? "selected" : ""}>5%</option><option value="ZW" ${p?.vat === "ZW" ? "selected" : ""}>0% / ZW</option>
                </select></div><div class="field"><label>Kategoria</label><select id="productCategory">${categoryOptions}</select></div></div>
                <div class="image-editor"><div class="image-preview" id="productImagePreview">${preview}</div><div class="image-options"><div class="field">
                <label>Obraz produktu</label><div class="file-drop" id="productImageDrop" tabindex="0"><input id="productImage" type="file" accept="image/*" hidden>
                <div class="file-drop-content"><span class="file-drop-icon">🖼</span><span class="file-drop-text" id="productImageText">Kliknij aby wybrać lub upuść obraz tutaj</span>
                <span class="file-drop-hint">PNG, JPG, WEBP · maks. 2 MB</span></div></div></div>
                <div class="field"><label>Albo wybierz ikonę</label><div class="icon-list">${iconOptions}</div></div>
                <button type="button" class="link-btn image-clear" id="clearProductImage">Usuń obraz / użyj ikony</button></div></div>${!cats.length ? '<p class="settings-note">Najpierw dodaj kategorię.</p>' : ""}<div class="actions">
                <button onclick="settings()">Anuluj</button><button class="primary" onclick="saveProduct(${id ? `'${esc(id)}'` : "null"})">ZAPISZ PRODUKT</button></div>
                </div></div></div>`;
    $("#modalRoot").innerHTML = html;
    let selectedIcon = p?.icon || "🛒", imageData = p?.image || "";
    const previewEl = $("#productImagePreview");
    const setPreview = () => previewEl.innerHTML = imageData ? `<img src="${imageData}" alt="">` : esc(selectedIcon);
    $$('[data-icon]').forEach(b => b.onclick = () => { 
        selectedIcon = b.dataset.icon; 
        imageData = ""; $$('[data-icon]').forEach(x => x.classList.toggle("active", x === b)); 
        setPreview() 
    });
    const imageText = $("#productImageText");
    const imageDrop = $("#productImageDrop");
    const imageInput = $("#productImage");
    const setImageFile = (file) => {
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast("Obraz jest za duży. Maksymalnie 2 MB.", true);
            imageInput.value = "";
            return
        }
        const reader = new FileReader();
        reader.onload = () => {
            imageData = reader.result;
            imageText.textContent = file.name;
            imageText.classList.add("has-file");
            $$('[data-icon]').forEach(x => x.classList.remove("active"));
            setPreview()
        };
        reader.readAsDataURL(file)
    };
    imageInput.onchange = e => setImageFile(e.target.files?.[0]);
    imageDrop.onclick = () => imageInput.click();
    imageDrop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imageInput.click() } };
    imageDrop.ondragover = e => { e.preventDefault(); imageDrop.classList.add("dragover") };
    imageDrop.ondragleave = () => imageDrop.classList.remove("dragover");
    imageDrop.ondrop = e => { e.preventDefault(); imageDrop.classList.remove("dragover"); setImageFile(e.dataTransfer.files?.[0]) };
    $("#clearProductImage").onclick = () => { 
        imageData = "";
        imageText.textContent = "Kliknij aby wybrać lub upuść obraz tutaj";
        imageText.classList.remove("has-file");
        imageInput.value = "";
        setPreview(); 
        $$('[data-icon]').forEach(x => x.classList.toggle("active", x.dataset.icon === selectedIcon)) 
    };
    window.__productImageState = () => ({ image: imageData, icon: selectedIcon });
}

function saveProduct(id) {
    const name = $("#productName").value.trim(), 
          fiscalName = $("#productFiscalName").value.trim(), 
          code = $("#productCode").value.trim(), 
          price = parseFloat($("#productPrice").value.replace(",", ".")), 
          vat = $("#productVat").value, 
          cat = $("#productCategory").value, 
          state = window.__productImageState ? window.__productImageState() : { image: "", icon: "🛒" }, 
          icon = state.icon || "🛒", 
          image = state.image || "";
    if (!name || !code || !Number.isFinite(price) || price < 0 || !cat) { 
        toast("Uzupełnij nazwę, kod, cenę i kategorię.", true); 
        return 
    }
    if (PRODUCTS.some(p => p.code === code && p.id !== id)) { 
        toast("Produkt o takim kodzie już istnieje.", true); 
        return 
    }
    if (id) { 
        const p = PRODUCTS.find(x => x.id === id); 
        if (!p) return; 
        Object.assign(p, { name, fiscalName, code, price, vat, cat, icon, image }); 
        const c = cart.find(x => x.id === id); 
        if (c) Object.assign(c, { name, fiscalName, code, price, vat, cat, icon, image }) 
    }
    else {
        PRODUCTS.push({ id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, fiscalName, code, price, vat, cat, icon, image });
    }
    saveProducts(); 
    renderCategories(); 
    renderProducts(); 
    renderCart(); 
    settings(); 
    toast(id ? "Produkt zapisany." : "Produkt dodany.");
}
function deleteProduct(id) {
    const p = PRODUCTS.find(x => x.id === id); 
    if (!p) return;
    openConfirmModal({
        icon: "🗑",
        title: "Usuwanie produktu",
        message: `Usunąć produkt „${p.name}”?`,
        confirmText: "Usuń",
        danger: true
    }, () => {
        PRODUCTS = PRODUCTS.filter(x => x.id !== id); 
        cart = cart.filter(x => x.id !== id); 
        saveProducts(); 
        renderCategories(); 
        renderProducts(); 
        renderCart(); 
        settings(); 
        toast("Produkt usunięty.");
    });
}

async function overridePrinterSettings(cb) {
    try { 
        var flowValue = 'N';
        if( SETTINGS.printer.usbFlowControl === "xonxoff" )
            flowValue = 'H';
        if( SETTINGS.printer.usbFlowControl === "rtscts" )
            flowValue = 'R';

        await api("/config/override/printer", { 
            method: "POST", 
            body: JSON.stringify({
                "driver": SETTINGS.printer.printerManufacturer.toString().toLowerCase()==="posnet"?"native":"novitus",
                "connection": {
                    "type": SETTINGS.printer.type,
                    "rs232": {
                        "params": `${SETTINGS.printer.usbDevice},${SETTINGS.printer.usbBaud},8,N,1,${flowValue}`
                    },
                    "eth": {
                        "ip": SETTINGS.printer.netIp,
                        "port": `${SETTINGS.printer.netPort}`
                    }
                }
            }) 
        });
        cb({ok: true});
    } catch { 
        cb({ok: false});
    }
}
function saveSettings() { 
    SETTINGS.cashier = $("#cashier").value.trim() || "Kasjer"; 
    SETTINGS.paymentTypes.cash = 0;//Number($("#cashType").value); 
    SETTINGS.paymentTypes.card = 2;//Number($("#cardType").value); 

    // const licContent = SETTINGS.printer.licenseContent;
    // const licFname = SETTINGS.printer.licenseFileName;

    SETTINGS.printer = {
        type: settingsConnType === "eth" ? "eth" : "rs232",
        usbDevice: $("#usbDevice") ? $("#usbDevice").value.trim() : SETTINGS.printer.usbDevice,
        usbBaud: $("#usbBaud") ? Number($("#usbBaud").value) || 9600 : SETTINGS.printer.usbBaud,
        usbFlowControl: $("#usbFlowControl") ? $("#usbFlowControl").value.trim() : SETTINGS.printer.usbFlowControl,
        printerManufacturer: $("#printerManufacturer") ? $("#printerManufacturer").value.trim() : SETTINGS.printer.printerManufacturer,
        netIp: $("#netIp") ? $("#netIp").value.trim() : SETTINGS.printer.netIp,
        netPort: $("#netPort") ? Number($("#netPort").value) || 6666 : SETTINGS.printer.netPort,
        licenseContent: uploadedLicenseContent || SETTINGS.printer.licenseContent || "",
        licenseFileName: uploadedLicenseFileName || SETTINGS.printer.licenseFileName || ""
    };
    localStorage.setItem("pos.cashier", SETTINGS.cashier); 
    localStorage.setItem("pos.printer", JSON.stringify(SETTINGS.printer)); 
    if( uploadedLicenseContent != "" && uploadedLicenseContent != null)
        uploadLicenseToServer(uploadedLicenseContent);

    saveProducts(); 
    saveCategories(); 
    closeModal();
    overridePrinterSettings(cb=>{
        setTimeout(()=>{
            checkPrinter(); 
        },2000);
    });
    renderCategories(); 
    renderProducts(); 
    toast("Ustawienia zapisane.") 
}
$("#search").addEventListener("input", renderProducts); 
$("#mainSort").value = mainSort; 
$("#mainSort").addEventListener("change", e => { 
    mainSort = e.target.value; 
    localStorage.setItem("pos.mainSort", mainSort); 
    renderProducts(); 
}); 
$("#search").addEventListener("keydown", e => { 
    if (e.key === "Enter") { 
        e.preventDefault();
        const q = e.target.value.trim();
        const exact = PRODUCTS.find(x => x.code === q);
        if (exact) { 
            add(exact.id); 
            e.target.select(); 
            return 
        }
        const visibleBtns = $$("#products .product");
        if (visibleBtns.length === 1) {
            add(visibleBtns[0].dataset.id);
            e.target.select();
        } else if (visibleBtns.length > 1) {
            focusProductButton(visibleBtns[0]);
        }
    } 
}); 
function toggleCartPanel(open) {
    const panel = $(".cart-panel");
    if (!panel) return;
    const willOpen = typeof open === "boolean" ? open : !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    const icon = $("#cartToggleIcon");
    if (icon) icon.textContent = willOpen ? "×" : "🛒";
    if( willOpen ) {
        cartToggle.classList.add("hidden");
    } else {
        cartToggle.classList.remove("hidden");
    }
}
$("#cartToggle").onclick = () => toggleCartPanel();
$("#closeCartPanel").onclick = () => toggleCartPanel(false);
$("#checkoutBtn").onclick = openPayment; 
$("#clearCart").onclick = () => { 
    if (!cart.length) return;
    openConfirmModal({
        icon: "🛒",
        title: "Czyszczenie koszyka",
        message: "Wyczyścić koszyk? Wszystkie pozycje zostaną usunięte.",
        confirmText: "Wyczyść",
        danger: true
    }, () => { cart = []; renderCart() });
}; 
$("#settingsBtn").onclick = () => settings();
$("#shortcutsBtn").onclick = () => showShortcutsModal();
document.addEventListener("keydown", handleGlobalKeys);

setInterval(() => $("#clock").textContent = new Date().toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }), 1000);

renderCategories(); 
renderProducts(); 
renderCart(); 
if( SETTINGS.printer.licenseContent != "")
    uploadLicenseToServer(SETTINGS.printer.licenseContent);

overridePrinterSettings(cb=>{
    setTimeout(()=>{
        checkPrinter(); 
    },2000);
});

setInterval(() => {
    checkPrinter();
}, 30000);

showWelcomeModal();

window.closeModal = closeModal; 
window.closeWelcomeModal = closeWelcomeModal; 
window.showShortcutsModal = showShortcutsModal;
window.loadLicenseStatus = loadLicenseStatus;
window.printerDetect = printerDetect; 
window.showWelcomeModal = showWelcomeModal; 
window.saveSettings = saveSettings; 
window.finishSale = finishSale; 
window.addCategory = addCategory; 
window.deleteCategory = deleteCategory; 
window.renameCategory = renameCategory; 
window.openProductEditor = openProductEditor; 
window.saveProduct = saveProduct; 
window.deleteProduct = deleteProduct;
