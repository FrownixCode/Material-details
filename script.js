/* UNIVERSAL METAL CALCULATOR — MTO + Excel BOM export */

/* ===== CONSTANTS ===== */
/* База материалов пустая: она загружается через Material Database -> Import settings */
const UNITS = { Profile: "kg/m", Plate: "kg/m³", Fastener: "kg/pcs", Other: "kg/unit" };
const DEFAULT_GRADES = {
    Profile: ["S355J2", "S275JR"],
    Plate: ["S355J2", "S275JR"],
    Fastener: ["8.8", "10.9"],
    Other: ["-"]
};
const DEFAULT_NOTES = {
    Profile: ["SHAPED", "SHIM"],
    Plate: ["SHAPED", "SHIM"],
    Fastener: ["SETSCREW FIXING SET", "STUD BOLT SET"]
};
const ADMIN_PASSWORD = "Metalcalc01";
const STORAGE = {
    db: "metalCalculatorDatabase",
    items: "metalCalculatorMaterials",
    grades: "metalCalculatorGrades",
    notes: "metalCalculatorNotes"
};
const MERGE_IDS = true; /* true — одинаковые ID подряд объединяются в одну ячейку */

/* ===== STATE / HELPERS ===== */
let materialsDatabase = [], materialsList = [], gradeList = {}, noteList = {};
let editingId = null, editingDatabaseId = null, isAdministrator = false;
let assemblyCache = null;

const $ = id => document.getElementById(id);
const escapeHTML = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cmp = (a, b) => String(a || "").localeCompare(String(b || ""), "en", { numeric: true });
const sortedItems = () => [...materialsList].sort((a, b) => cmp(a.idNumber, b.idNumber) || cmp(a.assyNo, b.assyNo));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const sameId = (a, b) => String(a) === String(b);
const typeLabel = t => (t === "Other" ? "Non-Steel" : t);
const findMaterial = (type, name) => materialsDatabase.find(m => m.type === type && m.name === name);
/* убирает хвост "; -" / ";" / "\t-" из названия (остаток от списка вида "Название; вес") */
const cleanName = s => String(s ?? "").replace(/\s*[;\t]\s*-?\s*$/, "").trim();

function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { alert("Could not save data (storage is full or blocked): " + e.message); }
}

const saveDatabase = () => save(STORAGE.db, materialsDatabase);
const saveGrades = () => save(STORAGE.grades, gradeList);
const saveNotes = () => save(STORAGE.notes, noteList);
function saveMaterials() {
    assemblyCache = null;
    save(STORAGE.items, materialsList);
}

function loadApplicationData() {
    materialsDatabase = readStorage(STORAGE.db, null) || [];
    materialsList = readStorage(STORAGE.items, []);

    /* чистим уже сохранённые названия вида "NEOPRENE; -" */
    materialsDatabase.forEach(m => { m.name = cleanName(m.name); });
    materialsList.forEach(i => { i.section = cleanName(i.section); });

    const savedGrades = readStorage(STORAGE.grades, null);
    Object.keys(DEFAULT_GRADES).forEach(t => {
        gradeList[t] = Array.isArray(savedGrades?.[t]) && savedGrades[t].length ? savedGrades[t] : [...DEFAULT_GRADES[t]];
    });

    noteList = readStorage(STORAGE.notes, null) || JSON.parse(JSON.stringify(DEFAULT_NOTES));
}

/* Поставить значение в <select>; если такой опции уже нет (удалён грейд/материал) — добавить её временно */
function setSelectValue(id, value) {
    const sel = $(id);
    if (value && ![...sel.options].some(o => o.value === value)) {
        sel.add(new Option(value, value));
    }
    sel.value = value || "";
}

/* ===== ADMIN / PAGES ===== */
function setAdminUI(on) {
    $("adminPanel").style.display = on ? "inline-flex" : "none";
    $("roleStatus").textContent = on ? "Administrator" : "User";
}

/* Окно ввода пароля: символы скрыты (type="password"), поле внутри формы */
function askPassword() {
    return new Promise(resolve => {
        const o = document.createElement("div");
        o.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center";
        o.innerHTML = `
            <form style="background:#fff;padding:22px;border-radius:8px;width:320px;max-width:95%;box-shadow:0 5px 15px rgba(0,0,0,.3)">
                <h3 style="margin:0 0 12px">Administrator password</h3>
                <input type="text" name="username" value="admin" autocomplete="username" hidden>
                <label for="adminPassword" style="position:absolute;left:-9999px">Password</label>
                <input id="adminPassword" name="password" type="password" autocomplete="off" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px">
                <div style="text-align:right;margin-top:16px">
                    <button type="button" data-cancel style="padding:7px 14px;border:none;border-radius:4px;background:#94a3b8;color:#fff;font-weight:bold">Cancel</button>
                    <button type="submit" style="padding:7px 14px;border:none;border-radius:4px;background:#22c55e;color:#fff;font-weight:bold;margin-left:8px">OK</button>
                </div>
            </form>`;
        document.body.appendChild(o);

        const input = o.querySelector("#adminPassword");
        const done = v => { o.remove(); resolve(v); };
        o.querySelector("form").addEventListener("submit", e => { e.preventDefault(); done(input.value); });
        o.querySelector("[data-cancel]").onclick = () => done(null);
        input.addEventListener("keydown", e => { if (e.key === "Escape") done(null); });
        input.focus();
    });
}

async function openAdvanced() {
    if (isAdministrator) return true;
    const p = await askPassword();
    if (p === null) return false;
    if (p !== ADMIN_PASSWORD) { alert("Incorrect administrator password."); return false; }

    isAdministrator = true;
    setAdminUI(true);
    renderMaterialDatabase();
    renderGrades();
    return true;
}

function logoutAdministrator() {
    isAdministrator = false;
    setAdminUI(false);
    switchTab("mto-page");
}

function switchTab(pageId) {
    if (pageId === "database-page" && !isAdministrator) return alert("Administrator access is required.");
    document.querySelectorAll(".page-content").forEach(p => p.classList.toggle("active", p.id === pageId));
    if (pageId === "database-page") { renderMaterialDatabase(); renderGrades(); }
}

async function openTemplateFromHeader() {
    if (await openAdvanced()) openTemplateEditor();
}

/* ===== MTO FORM ===== */
function initializeAssyNumbers() {
    const options = Array.from({ length: 20 }, (_, i) => `<option>${String(i + 1).padStart(2, "0")}</option>`).join("");
    ["assyNo", "editAssyNo"].forEach(id => { $(id).innerHTML = options; });
}

function handleItemTypeChange(typeId, sectionId, widthGroupId) {
    const type = $(typeId).value;
    const isEdit = typeId !== "itemType";

    $(sectionId).innerHTML = materialsDatabase
        .filter(m => m.type === type)
        .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }))
        .map(m => `<option>${escapeHTML(m.name)}</option>`)
        .join("");

    /* ширина: для Plate и Non-Steel; длина: для всех типов */
    const showWidth = type === "Plate" || type === "Other";
    $(widthGroupId).style.display = showWidth ? "" : "none";
    if (!showWidth) $(widthGroupId.replace("Group", "")).value = "";
    $(isEdit ? "editLengthGroup" : "lengthGroup").style.display = "";

    const gradeId = isEdit ? "editGrade" : "grade";
    const current = $(gradeId).value;
    const grades = gradeList[type] || [];
    $(gradeId).innerHTML = grades.map(g => `<option>${escapeHTML(g)}</option>`).join("");
    if (grades.includes(current)) $(gradeId).value = current;

    setNoteHints(typeId, sectionId);
}

function refreshSelects() {
    handleItemTypeChange("itemType", "thickness", "widthGroup");
    handleItemTypeChange("editItemType", "editThickness", "editWidthGroup");
}

/* ===== WEIGHTS / GROUPING ===== */
function calculateCalculatedWeight(type, section, length, width, qty) {
    const m = findMaterial(type, section);
    const L = Number(length), W = Number(width), Q = Number(qty);
    if (!m || !Number.isFinite(L) || !Number.isFinite(Q)) return 0;
    const k = Number(m.weight) || 0;

    if (type === "Profile") return k * (L / 1000) * Q;
    if (type === "Plate") {
        const t = parseFloat(String(section).match(/[\d.]+/)?.[0]);
        if (!(W > 0) || !t) return 0;
        return (L / 1000) * (W / 1000) * (t / 1000) * k * Q;
    }
    return k * Q;
}

/* Пересчёт авто-весов после изменения базы (ручные веса и позиции без материала в базе не трогаются) */
function recalcAllWeights() {
    materialsList.forEach(i => {
        if (!findMaterial(i.itemType, i.section)) return;
        i.calculatedWeight = calculateCalculatedWeight(i.itemType, i.section, i.length ?? 0, i.width, i.qty);
    });
    saveMaterials();
}

function getWeight(item) {
    if (item.isManualOverride && Number.isFinite(Number(item.manualWeight))) return Number(item.manualWeight);
    return Number(item.calculatedWeight ?? 0);
}

const hasNote = word => { const re = new RegExp(`\\b${word}\\b`, "i"); return i => re.test(String(i.notes || "")); };
const isShaped = hasNote("shaped");
const isShim = hasNote("shim");
const isAccessory = i => i.itemType === "Fastener" || i.itemType === "Other";
const getAssemblyKey = i => `${String(i.idNumber || "").trim()}|||${String(i.assyNo || "").trim()}`;

/* Один проход по списку: вес и число «основных» деталей для каждой сборки (сбрасывается в saveMaterials) */
function assemblies() {
    if (!assemblyCache) {
        assemblyCache = new Map();
        materialsList.forEach(i => {
            const k = getAssemblyKey(i);
            const a = assemblyCache.get(k) || { weight: 0, main: 0 };
            a.weight += getWeight(i);
            if (!isAccessory(i) && !isShim(i)) a.main++;
            assemblyCache.set(k, a);
        });
    }
    return assemblyCache;
}

const getAssemblyWeight = item => assemblies().get(getAssemblyKey(item))?.weight ?? 0;

/* Loose: крепёж, Non-Steel, SHIM, либо единственная деталь в сборке. Остальное — Assembly */
const isLooseItem = item => isAccessory(item) || isShim(item) || (assemblies().get(getAssemblyKey(item))?.main ?? 0) <= 1;

/* ID Number - A/L - Item Number */
const getCombinedId = i => [
    String(i.idNumber || "").trim(),
    isLooseItem(i) ? "L" : "A",
    String(i.assyNo || "").trim()
].filter(Boolean).join("-");

const qtyUnitOf = item => item.itemType === "Other" ? (findMaterial("Other", item.section)?.qtyUnit || "pcs") : "pcs";
const formatQty = item => { const u = qtyUnitOf(item); return u === "pcs" ? item.qty : `${item.qty} ${u}`; };

/* "140x12" -> "140 x 12", "Tube 40x40x3" -> "Tube 40 x 40 x 3" */
const spaceDimensions = s => String(s).replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1 x ");

function getBOMDescription(item) {
    if (isAccessory(item)) {
        return spaceDimensions([item.section, item.notes, item.width ? `(W: ${item.width} mm)` : ""].filter(Boolean).join(" "));
    }
    if (item.itemType === "Plate") {
        const t = String(item.section).match(/[\d.]+/)?.[0];
        return spaceDimensions(item.width && t ? `${item.width}x${t} THK PLT` : item.section);
    }
    return spaceDimensions(item.section);
}

/* ===== ADD / EDIT / DELETE ITEMS ===== */
const ADD_IDS = { idNumber: "idNumber", assyNo: "assyNo", itemType: "itemType", section: "thickness", grade: "grade", length: "length", width: "width", qty: "qty", notes: "notes" };
const EDIT_IDS = { idNumber: "editIdNumber", assyNo: "editAssyNo", itemType: "editItemType", section: "editThickness", grade: "editGrade", length: "editLength", width: "editWidth", qty: "editQty", notes: "editNotes" };

function readItemForm(ids) {
    const v = {};
    for (const k in ids) v[k] = $(ids[k]).value.trim();
    const length = Number(v.length), width = Number(v.width), qty = Number(v.qty);
    const plate = v.itemType === "Plate", other = v.itemType === "Other";

    const error =
        !v.idNumber ? "Please enter ID Number." :
        !v.section ? "No materials of this type in the database. Load them via Advanced -> Material Database -> Import settings." :
        !other && !(length > 0) ? "Please enter a valid length." :
        other && v.length !== "" && !(length > 0) ? "Please enter a valid length." :
        !(qty > 0) ? "Please enter a valid quantity." :
        plate && !(width > 0) ? "Please enter a valid width for Plate." :
        other && v.width !== "" && !(width > 0) ? "Please enter a valid width." : "";
    if (error) { alert(error); return null; }

    return {
        ...v,
        length: other && v.length === "" ? null : length,
        qty,
        width: plate || (other && v.width !== "") ? width : null,
        calculatedWeight: calculateCalculatedWeight(v.itemType, v.section, other ? 0 : length, width, qty)
    };
}

function addMaterial() {
    const item = readItemForm(ADD_IDS);
    if (!item) return;
    materialsList.push({ id: newId(), ...item, manualWeight: null, isManualOverride: false });
    saveMaterials();
    renderEverything();
    $("length").value = "";
    $("width").value = "";
    $("qty").value = "1";
    $("notes").value = "";
}

function deleteMaterial(id) {
    if (!materialsList.some(m => sameId(m.id, id)) || !confirm("Delete this material item?")) return;
    materialsList = materialsList.filter(m => !sameId(m.id, id));
    saveMaterials();
    renderEverything();
}

function editMaterial(id) {
    const item = materialsList.find(m => sameId(m.id, id));
    if (!item) return;
    editingId = item.id;

    $("editIdNumber").value = item.idNumber || "";
    $("editAssyNo").value = item.assyNo || "01";
    $("editItemType").value = item.itemType;
    handleItemTypeChange("editItemType", "editThickness", "editWidthGroup");
    setSelectValue("editThickness", item.section);
    setSelectValue("editGrade", item.grade);
    $("editLength").value = item.length ?? "";
    $("editWidth").value = item.width ?? "";
    $("editQty").value = item.qty ?? 1;
    $("editNotes").value = item.notes || "";
    $("editManualWeight").value = item.isManualOverride ? item.manualWeight : "";
    $("editModal").style.display = "flex";
}

function saveEditedItem() {
    const item = materialsList.find(m => sameId(m.id, editingId));
    if (!item) return;
    const data = readItemForm(EDIT_IDS);
    if (!data) return;

    const text = $("editManualWeight").value.trim().replace(",", ".");
    let manual = null;
    if (text !== "") {
        manual = Number(text);
        if (!(manual >= 0)) return alert("Please enter a valid Manual Weight.");
    }

    Object.assign(item, data, { manualWeight: manual, isManualOverride: manual !== null });
    saveMaterials();
    closeEditModal();
    renderEverything();
}

function closeEditModal() {
    $("editModal").style.display = "none";
    editingId = null;
}

/* ===== TABLES ===== */
const actionButtons = (editAct, delAct, id) => `
    <button class="edit-btn" data-act="${editAct}" data-id="${escapeHTML(id)}">Edit</button>
    <button class="delete-btn" data-act="${delAct}" data-id="${escapeHTML(id)}">Delete</button>`;

function renderMTOTable() {
    let totalQty = 0, totalWeight = 0;

    $("tableBody").innerHTML = sortedItems().map(item => {
        const w = getWeight(item);
        totalQty += item.itemType === "Other" ? 0 : Number(item.qty || 0);
        totalWeight += w;

        const cells = [item.idNumber, item.assyNo, typeLabel(item.itemType), item.section, item.grade,
            item.length ?? "-", item.width ?? "-", formatQty(item), w.toFixed(2), getAssemblyWeight(item).toFixed(2), item.notes];

        return `<tr>${cells.map(c => `<td>${escapeHTML(c ?? "")}</td>`).join("")}
            <td>${actionButtons("editMaterial", "deleteMaterial", item.id)}</td></tr>`;
    }).join("");

    $("totalQty").textContent = totalQty;
    $("totalCalculatedWeight").textContent = totalWeight.toFixed(2);
}

function renderMaterialDatabase() {
    const body = $("materialDatabaseBody");
    if (!isAdministrator) { body.innerHTML = ""; return; }

    if (!materialsDatabase.length) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b">The database is empty. Use "Import settings" to load materials.</td></tr>`;
        return;
    }

    body.innerHTML = [...materialsDatabase]
        .sort((a, b) => String(a.type).localeCompare(String(b.type)) || cmp(a.name, b.name))
        .map(m => `<tr><td>${escapeHTML(typeLabel(m.type))}</td><td>${escapeHTML(m.name)}</td>
            <td>${Number(m.weight)}</td>
            <td>${escapeHTML(m.type === "Other" ? `kg/${m.qtyUnit || "pcs"}` : UNITS[m.type])}</td>
            <td>${actionButtons("editDatabaseMaterial", "deleteDatabaseMaterial", m.id)}</td></tr>`)
        .join("");
}

function renderEverything() {
    renderMTOTable();
    if (isAdministrator) { renderMaterialDatabase(); renderGrades(); }
}

/* ===== GRADES ===== */
function renderGrades() {
    const box = $("gradesBox");
    if (!box) return;

    box.innerHTML = Object.keys(DEFAULT_GRADES).map(type => `
        <div style="margin-bottom:10px">
            <strong>${typeLabel(type)}:</strong>
            ${gradeList[type].map(g => `<span class="grade-chip">${escapeHTML(g)}
                <button data-act="deleteGrade" data-type="${type}" data-grade="${escapeHTML(g)}">✕</button></span>`).join("")}
            <input id="newGrade_${type}" placeholder="new grade" style="width:130px;height:28px;padding:2px 6px">
            <button class="primary-btn" style="padding:4px 12px;margin:0" data-act="addGrade" data-type="${type}">Add</button>
        </div>`).join("");

    renderNotes();
}

function addGrade(type) {
    if (!isAdministrator) return alert("Administrator access is required.");
    const grade = $("newGrade_" + type).value.trim().toUpperCase();
    if (!grade) return;
    if (gradeList[type].some(g => g.toUpperCase() === grade)) return alert("This grade already exists.");

    gradeList[type].push(grade);
    saveGrades();
    refreshSelects();
    renderGrades();
}

function deleteGrade(type, grade) {
    if (!isAdministrator) return;
    if (gradeList[type].length <= 1) return alert("At least one grade must remain.");

    const used = materialsList.filter(i => i.itemType === type && i.grade === grade).length;
    const note = used ? `\n\nIt is used by ${used} item(s) in the list. They will keep this grade.` : "";
    if (!confirm(`Delete grade "${grade}" from ${type}?${note}`)) return;

    gradeList[type] = gradeList[type].filter(g => g !== grade);
    saveGrades();
    refreshSelects();
    renderGrades();
}

/* ===== NOTES ===== */
/* Profile / Plate / Fastener: заметки по типу. Non-Steel: заметки отдельно для каждого материала */
const noteKey = (type, name) => (type === "Other" ? `Other::${name}` : type);

function setNoteHints(typeId, sectionId) {
    const list = noteList[noteKey($(typeId).value, $(sectionId).value)] || [];
    $("notesList").innerHTML = list.map(n => `<option value="${escapeHTML(n)}">`).join("");
}

function renderNotes() {
    let box = $("notesBox");
    if (!box) {
        const h = document.createElement("h3");
        h.textContent = "Notes";
        box = document.createElement("div");
        box.id = "notesBox";
        box.className = "orange-box";
        $("gradesBox").after(h, box);
    }

    const row = (label, key, id) => `
        <div style="margin-bottom:8px"><strong>${escapeHTML(label)}:</strong>
            ${(noteList[key] || []).map(n => `<span class="grade-chip">${escapeHTML(n)}
                <button data-act="deleteNote" data-key="${escapeHTML(key)}" data-note="${escapeHTML(n)}">✕</button></span>`).join("")}
            <input id="newNote_${id}" placeholder="new note" style="width:170px;height:28px;padding:2px 6px">
            <button class="primary-btn" style="padding:4px 12px;margin:0" data-act="addNote" data-key="${escapeHTML(key)}" data-input="newNote_${id}">Add</button>
        </div>`;

    const others = materialsDatabase.filter(m => m.type === "Other").sort((a, b) => cmp(a.name, b.name));

    box.innerHTML = ["Profile", "Plate", "Fastener"].map(t => row(t, t, t)).join("")
        + `<div style="margin-top:12px"><strong>Non-Steel:</strong></div>`
        + others.map((m, i) => row(m.name, noteKey("Other", m.name), "O" + i)).join("");
}

function addNote(key, inputId) {
    if (!isAdministrator) return;
    const note = $(inputId).value.trim();
    if (!note) return;
    const list = (noteList[key] ??= []);
    if (list.some(n => n.toLowerCase() === note.toLowerCase())) return alert("This note already exists.");
    list.push(note);
    saveNotes();
    renderNotes();
}

function deleteNote(key, note) {
    if (!isAdministrator) return;
    noteList[key] = (noteList[key] || []).filter(n => n !== note);
    saveNotes();
    renderNotes();
}

/* ===== MATERIAL DATABASE MODAL ===== */
function updateDatabaseUnit() {
    $("databaseMaterialUnit").value = UNITS[$("databaseMaterialType").value];
}

function openMaterialDatabaseModal(type) {
    if (!isAdministrator) return alert("Administrator access is required.");
    showDatabaseModal(null, type);
}

function showDatabaseModal(m, type = "Profile") {
    editingDatabaseId = m ? m.id : null;
    const t = m ? m.type : type;
    $("materialDatabaseModalTitle").textContent = (m ? "Edit " : "Add ") + typeLabel(t);
    $("databaseMaterialType").value = t;
    $("databaseMaterialName").value = m ? m.name : "";
    $("databaseMaterialWeight").value = m ? m.weight : "";
    $("databaseBulkText").value = "";
    $("databaseBulkBox").style.display = m ? "none" : "block";
    $("databaseQtyUnitGroup").style.display = t === "Other" ? "" : "none";
    $("databaseQtyUnit").value = m?.qtyUnit || "pcs";
    updateDatabaseUnit();
    $("materialDatabaseModal").style.display = "flex";
}

function editDatabaseMaterial(id) {
    const m = isAdministrator && materialsDatabase.find(x => sameId(x.id, id));
    if (m) showDatabaseModal(m);
}

function upsertMaterial(type, name, weight, qtyUnit) {
    name = cleanName(name);
    const m = materialsDatabase.find(x => x.type === type && x.name.toLowerCase() === name.toLowerCase());
    if (m) {
        if (weight !== null) m.weight = weight;
        if (qtyUnit) m.qtyUnit = qtyUnit;
        return "updated";
    }
    materialsDatabase.push({
        id: "CUSTOM_" + newId(),
        type, name, ...(qtyUnit ? { qtyUnit } : {}),
        weight: weight ?? (type === "Plate" ? 7850 : 0)
    });
    return "added";
}

function parseBulk(type, text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
        /* вес — число, либо "-" / пусто (тогда веса нет) */
        const m = line.match(/^(.+?)\s*[\t;,]\s*(\d+(?:[.,]\d+)?|-)?\s*$/);
        let name = m ? m[1].trim() : line;
        if (type === "Plate" && /^[\d.]+$/.test(name)) name += " THK PLT";
        if (type === "Fastener") name = name.toUpperCase();
        return { name, weight: m && m[2] && m[2] !== "-" ? Number(m[2].replace(",", ".")) : null };
    });
}

function loadBulkFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $("databaseBulkText").value = String(reader.result); };
    reader.readAsText(file);
    input.value = "";
}

function saveMaterialDatabaseItem() {
    if (!isAdministrator) return alert("Administrator access is required.");
    const type = $("databaseMaterialType").value;
    const bulk = $("databaseBulkText").value.trim();
    const qtyUnit = type === "Other" ? $("databaseQtyUnit").value : undefined;

    if (bulk && !editingDatabaseId) {
        let added = 0, updated = 0, skipped = 0;
        parseBulk(type, bulk).forEach(r => {
            if (type === "Profile" && r.weight === null) { skipped++; return; }
            upsertMaterial(type, r.name, r.weight, qtyUnit) === "added" ? added++ : updated++;
        });
        alert(`Added: ${added}, updated: ${updated}` + (skipped ? `, skipped (no weight): ${skipped}` : ""));
    } else {
        const name = $("databaseMaterialName").value.trim();
        const text = $("databaseMaterialWeight").value;
        const weight = text === "" ? null : Number(text);

        if (!name) return alert("Please enter material name.");
        if (weight === null ? type === "Profile" : !(weight >= 0)) return alert("Please enter a valid weight.");

        const existing = editingDatabaseId && materialsDatabase.find(m => sameId(m.id, editingDatabaseId));
        if (existing) Object.assign(existing, { name, weight: weight ?? existing.weight, ...(qtyUnit ? { qtyUnit } : {}) });
        else upsertMaterial(type, name, weight, qtyUnit);
    }

    saveDatabase();
    recalcAllWeights();
    closeMaterialDatabaseModal();
    refreshSelects();
    renderEverything();
}

function deleteDatabaseMaterial(id) {
    const m = isAdministrator && materialsDatabase.find(x => sameId(x.id, id));
    if (!m || !confirm(`Delete "${m.name}" from the material database?`)) return;
    materialsDatabase = materialsDatabase.filter(x => !sameId(x.id, id));
    if (m.type === "Other") { delete noteList[noteKey("Other", m.name)]; saveNotes(); }
    saveDatabase();
    refreshSelects();
    renderEverything();
}

function closeMaterialDatabaseModal() {
    $("materialDatabaseModal").style.display = "none";
    editingDatabaseId = null;
}

/* ===== EXPORT / IMPORT SETTINGS ===== */
function exportSettings() {
    const data = {
        version: 3,
        materials: materialsDatabase,
        grades: gradeList,
        notes: noteList,
        template: readStorage(REPORT_TEMPLATE_KEY, null)
    };

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "metal-calculator-settings.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importSettings(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!Array.isArray(data.materials)) throw new Error("This is not a settings file.");

            let added = 0, updated = 0;

            data.materials.forEach(m => {
                if (!UNITS[m.type] || !m.name) return;
                const w = Number(m.weight);
                upsertMaterial(m.type, String(m.name), Number.isFinite(w) ? w : null, m.qtyUnit) === "added" ? added++ : updated++;
            });
            saveDatabase();
            recalcAllWeights();

            if (data.grades) {
                Object.keys(DEFAULT_GRADES).forEach(t => {
                    (data.grades[t] || []).forEach(g => { if (!gradeList[t].includes(g)) gradeList[t].push(g); });
                });
                saveGrades();
            }

            if (data.notes) {
                Object.entries(data.notes).forEach(([k, list]) => {
                    const cur = (noteList[k] ??= []);
                    (list || []).forEach(n => { if (!cur.includes(n)) cur.push(n); });
                });
                saveNotes();
            }

            /* шаблон подходит только если он той же версии, что и текущий формат отчёта */
            if (data.template && data.template.version === 6 && confirm("Also replace the report template with the one from the file?")) {
                reportTemplate = data.template;
                saveReportTemplate();
            }

            refreshSelects();
            renderEverything();
            alert(`Imported. Added: ${added}, updated: ${updated}`);
        } catch (e) {
            alert("Could not import settings: " + e.message);
        }
    };

    reader.readAsText(file);
    input.value = "";
}

/* =========================================================
   REPORT TEMPLATE
========================================================= */
const REPORT_TEMPLATE_KEY = "metalCalculatorExcelTemplateV6";
const TABLE_PLACEHOLDERS = ["BOM_TABLE"];
const PLACEHOLDER_LABELS = {
    COMPANY: "Company", PROJECT: "Project", DOCUMENT_NUMBER: "Document Number", TITLE: "Title", REVISION: "Revision", DATE: "Date",
    PREPARED: "Prepared", CHECKED: "Checked", APPROVED: "Approved", TOTAL_WEIGHT: "Total Weight", BOM_TABLE: "BOM table"
};
const DOC_FIELDS = [["company", "Company"], ["project", "Project"], ["documentNumber", "Document Number"], ["title", "Title"],
    ["revision", "Revision"], ["date", "Date"], ["prepared", "Prepared"], ["checked", "Checked"], ["approved", "Approved"]];

let reportTemplate = null;
let sel = { row: 1, col: 1 }, selEnd = { row: 1, col: 1 };

const defaultCell = () => ({ value: "", bold: false, italic: false, fontSize: 10, align: "left", vertical: "middle", fill: "", border: false });

/* cellAt — только чтение (ничего не создаёт); cellEdit — создаёт ячейку для изменения */
const cellAt = (t, row, col) => t.cells[`${row}:${col}`] || defaultCell();
const cellEdit = (t, row, col) => (t.cells[`${row}:${col}`] ??= defaultCell());

function createDefaultReportTemplate() {
    const columns = 6, rows = 29;
    const cells = {}, columnWidths = {}, rowHeights = {};

    [30, 6, 54, 10, 10, 10].forEach((w, i) => { columnWidths[i + 1] = w; });
    for (let r = 1; r <= rows; r++) rowHeights[r] = 18;
    rowHeights[1] = 24;

    const set = (r, c, value, style = {}) => {
        cells[`${r}:${c}`] = { ...defaultCell(), border: true, align: "center", fontSize: 9, value, ...style };
    };

    set(1, 1, "MATERIAL LIST FOR SHIPPED ASSEMBLIES AND LOOSE ITEMS", { bold: true, fontSize: 14 });
    ["ITEM ID No", "QTY", "DESCRIPTION", "LENGTH", "GRD", "WT (kg)"].forEach((h, i) => set(2, i + 1, h, { bold: true }));
    set(3, 1, "{{BOM_TABLE}}", { border: false });

    for (let c = 1; c <= 6; c++) set(29, c, "");
    set(29, 3, "TOTAL WEIGHT (kg) =", { bold: true });
    set(29, 6, "{{TOTAL_WEIGHT}}", { bold: true });

    return {
        version: 6, rows, columns, cells, columnWidths, rowHeights,
        merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 6 }],
        metadata: {
            company: "", project: "", documentNumber: "", title: "BILL OF MATERIALS", revision: "A",
            date: new Date().toISOString().slice(0, 10), prepared: "", checked: "", approved: ""
        },
        page: { paper: "A4", orientation: "portrait", repeatRows: 2 }
    };
}

function loadReportTemplate() {
    const d = createDefaultReportTemplate();
    const saved = readStorage(REPORT_TEMPLATE_KEY, null);

    reportTemplate = saved
        ? { ...d, ...saved, metadata: { ...d.metadata, ...saved.metadata }, page: { ...d.page, ...saved.page } }
        : d;

    if (!saved) saveReportTemplate();
    return reportTemplate;
}

function saveReportTemplate() {
    save(REPORT_TEMPLATE_KEY, reportTemplate);
}

/* Итоги возвращаются числами, чтобы в Excel их можно было суммировать */
function reportPlaceholderValue(name) {
    const m = reportTemplate.metadata;
    const values = {
        COMPANY: m.company, PROJECT: m.project, DOCUMENT_NUMBER: m.documentNumber, TITLE: m.title,
        REVISION: m.revision, DATE: m.date, PREPARED: m.prepared, CHECKED: m.checked, APPROVED: m.approved,
        TOTAL_WEIGHT: Number(materialsList.reduce((s, i) => s + getWeight(i), 0).toFixed(3))
    };
    return values[name] ?? "";
}

function getExcelColumnName(n) {
    let s = "";
    while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

/* =========================================================
   TEMPLATE EDITOR
========================================================= */
const TOOLBAR = [
    ["+ Row", "insertLine('row')"], ["+ Column", "insertLine('col')"], ["Merge", "templateMerge()"], ["Unmerge", "templateUnmerge()"],
    ["Border", "templateToggle('border')"], ["Bold", "templateToggle('bold')"], ["Italic", "templateToggle('italic')"],
    ["Left", "templateAlign('left')"], ["Center", "templateAlign('center')"], ["Right", "templateAlign('right')"],
    ["Font Size", "templateSetFontSize()"], ["Fill", "templateSetFill()"],
    ["Save Template", "saveTemplateFromEditor()"], ["Reset", "resetTemplateFromEditor()"], ["Close", "closeTemplateEditor()"]
];

const TEMPLATE_CSS = `
#tplOverlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center}
#tplWindow{position:relative;width:96vw;height:94vh;background:#fff;border-radius:10px;display:flex;flex-direction:column;overflow:hidden}
#tplToolbar{display:flex;gap:6px;padding:8px 56px 8px 8px;border-bottom:1px solid #ccc;background:#f3f4f6;flex-wrap:wrap}
#tplToolbar button,#tplSide button{padding:6px 10px;border:1px solid #bbb;border-radius:5px;background:#fff}
#tplClose{position:absolute;top:8px;right:12px;width:34px;height:34px;border:none!important;border-radius:50%!important;background:#ef4444!important;color:#fff;font-size:18px;padding:0!important}
#tplBody{flex:1;display:flex;min-height:0}
#tplGridWrap{flex:1;overflow:auto;background:#e5e7eb;padding:20px}
#tplGrid{border-collapse:collapse;background:#fff;table-layout:fixed}
#tplGrid th,#tplGrid td{border:1px solid #9ca3af;min-width:60px;padding:3px;overflow:hidden;white-space:nowrap}
#tplGrid th{background:#e5e7eb;text-align:center;position:sticky;top:0;z-index:3}
#tplGrid th.rh{left:0;z-index:4;min-width:40px}
#tplGrid td.sel{outline:2px solid #2563eb;outline-offset:-2px;background:#dbeafe!important}
#tplSide{width:280px;border-left:1px solid #ccc;background:#f9fafb;padding:12px;overflow-y:auto}
#tplSide label{display:block;font-size:12px;font-weight:600;margin-top:8px}
#tplSide input,#tplSide select{width:100%;padding:6px;margin-top:3px}
#tplSide button{display:block;width:100%;margin-top:5px;text-align:left}
#tplSide .sec{border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:10px}`;

function createTemplateEditor() {
    if ($("tplOverlay")) return;

    const style = document.createElement("style");
    style.textContent = TEMPLATE_CSS;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "tplOverlay";
    overlay.onclick = e => { if (e.target === overlay) closeTemplateEditor(); };
    overlay.innerHTML = `
    <div id="tplWindow">
        <div id="tplToolbar">${TOOLBAR.map(([l, c]) => `<button onclick="${c}">${l}</button>`).join("")}</div>
        <button id="tplClose" title="Close" onclick="closeTemplateEditor()">✕</button>
        <div id="tplBody">
            <div id="tplGridWrap"><table id="tplGrid"></table></div>
            <div id="tplSide">
                <div class="sec"><strong>Selected Cell</strong>
                    <label>Cell Text</label><input id="tplCellText">
                    <button onclick="templateApplyCellText()">Apply Text</button></div>
                <div class="sec"><strong>Size</strong>
                    <label>Column Width</label><input id="tplColW" type="number" min="1" max="100">
                    <button onclick="templateApplySize('col')">Apply Width</button>
                    <label>Row Height</label><input id="tplRowH" type="number" min="10" max="200">
                    <button onclick="templateApplySize('row')">Apply Height</button></div>
                <div class="sec"><strong>Document</strong>
                    ${DOC_FIELDS.map(([k, l]) => `<label>${l}</label><input id="tpl_${k}">`).join("")}</div>
                <div class="sec"><strong>Page</strong>
                    <label>Paper</label><select id="tplPaper"><option>A3</option><option>A4</option></select>
                    <label>Orientation</label><select id="tplOrient"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></div>
                <div><strong>Placeholders</strong>
                    ${Object.entries(PLACEHOLDER_LABELS).map(([k, l]) => `<button onclick="templateInsertPlaceholder('${k}')">${l}</button>`).join("")}</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
}

function openTemplateEditor() {
    if (!isAdministrator) return alert("Administrator access is required.");
    loadReportTemplate();
    createTemplateEditor();

    DOC_FIELDS.forEach(([k]) => { $("tpl_" + k).value = reportTemplate.metadata[k] || ""; });
    $("tplPaper").value = reportTemplate.page.paper || "A4";
    $("tplOrient").value = reportTemplate.page.orientation || "portrait";

    renderTemplateEditorGrid();
    $("tplOverlay").style.display = "flex";
}

function closeTemplateEditor() {
    const o = $("tplOverlay");
    if (o) o.style.display = "none";
}

document.addEventListener("keydown", e => { if (e.key === "Escape") closeTemplateEditor(); });

/* ----- grid ----- */
const selRange = () => ({
    r1: Math.min(sel.row, selEnd.row), r2: Math.max(sel.row, selEnd.row),
    c1: Math.min(sel.col, selEnd.col), c2: Math.max(sel.col, selEnd.col)
});

function renderTemplateEditorGrid() {
    const t = reportTemplate, table = $("tplGrid");
    if (!table || !t) return;

    const hidden = new Set(), spans = {};
    t.merges.forEach(m => {
        spans[`${m.startRow}:${m.startCol}`] = m;
        for (let r = m.startRow; r <= m.endRow; r++)
            for (let c = m.startCol; c <= m.endCol; c++)
                if (r !== m.startRow || c !== m.startCol) hidden.add(`${r}:${c}`);
    });

    let html = `<tr><th class="rh"></th>`;
    for (let c = 1; c <= t.columns; c++) html += `<th style="width:${t.columnWidths[c] || 12}ch">${getExcelColumnName(c)}</th>`;
    html += "</tr>";
    table.innerHTML = html;

    for (let r = 1; r <= t.rows; r++) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<th class="rh">${r}</th>`;

        for (let c = 1; c <= t.columns; c++) {
            if (hidden.has(`${r}:${c}`)) continue;

            const cell = cellAt(t, r, c), m = spans[`${r}:${c}`], td = document.createElement("td");
            td.dataset.row = r;
            td.dataset.col = c;
            td.textContent = cell.value || "";
            if (m) { td.rowSpan = m.endRow - m.startRow + 1; td.colSpan = m.endCol - m.startCol + 1; }

            Object.assign(td.style, {
                fontSize: `${cell.fontSize || 10}px`,
                fontWeight: cell.bold ? "700" : "400",
                fontStyle: cell.italic ? "italic" : "normal",
                textAlign: cell.align || "left",
                verticalAlign: cell.vertical || "middle",
                height: `${t.rowHeights[r] || 20}px`,
                background: cell.fill || (m ? "#f1f5f9" : "")
            });
            if (!cell.border) td.style.border = "1px dotted #d1d5db";

            td.addEventListener("mousedown", templateCellMouseDown);
            td.addEventListener("dblclick", templateCellDoubleClick);
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }

    highlightTemplateSelection();
    updateTemplateSideFields();
}

function templateCellMouseDown(e) {
    const pos = { row: Number(e.currentTarget.dataset.row), col: Number(e.currentTarget.dataset.col) };
    if (e.shiftKey) selEnd = pos;
    else { sel = pos; selEnd = { ...pos }; }
    highlightTemplateSelection();
    updateTemplateSideFields();
}

function templateCellDoubleClick(e) {
    const td = e.currentTarget;
    const value = prompt("Cell text:", td.textContent || "");
    if (value === null) return;
    cellEdit(reportTemplate, Number(td.dataset.row), Number(td.dataset.col)).value = value;
    renderTemplateEditorGrid();
}

function highlightTemplateSelection() {
    const { r1, r2, c1, c2 } = selRange();
    document.querySelectorAll("#tplGrid td").forEach(td => {
        const r = Number(td.dataset.row), c = Number(td.dataset.col);
        td.classList.toggle("sel", r >= r1 && r <= r2 && c >= c1 && c <= c2);
    });
}

function updateTemplateSideFields() {
    $("tplCellText").value = cellAt(reportTemplate, sel.row, sel.col).value || "";
    $("tplColW").value = reportTemplate.columnWidths[sel.col] || 12;
    $("tplRowH").value = reportTemplate.rowHeights[sel.row] || 20;
}

/* ----- editing tools ----- */
function editSelected(fn) {
    const { r1, r2, c1, c2 } = selRange();
    for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) fn(cellEdit(reportTemplate, r, c));
    renderTemplateEditorGrid();
}

function templateToggle(prop) {
    const v = !cellAt(reportTemplate, sel.row, sel.col)[prop];
    editSelected(c => { c[prop] = v; });
}

const templateAlign = a => editSelected(c => { c.align = a; });

function templateApplyCellText() {
    const v = $("tplCellText").value;
    editSelected(c => { c.value = v; });
}

function templateSetFontSize() {
    const v = prompt("Font size:", cellAt(reportTemplate, sel.row, sel.col).fontSize);
    if (v === null) return;
    const size = Number(v);
    if (!(size >= 1 && size <= 100)) return alert("Font size must be between 1 and 100.");
    editSelected(c => { c.fontSize = size; });
}

function templateSetFill() {
    const v = prompt("Fill color (example: #d9e2f3, empty = none):", cellAt(reportTemplate, sel.row, sel.col).fill || "");
    if (v !== null) editSelected(c => { c.fill = v.trim(); });
}

function templateApplySize(kind) {
    const isCol = kind === "col";
    const v = Number($(isCol ? "tplColW" : "tplRowH").value);
    if (!(v >= 1)) return alert("Invalid size.");
    const { r1, r2, c1, c2 } = selRange();
    const target = isCol ? reportTemplate.columnWidths : reportTemplate.rowHeights;
    for (let i = isCol ? c1 : r1; i <= (isCol ? c2 : r2); i++) target[i] = v;
    renderTemplateEditorGrid();
}

function insertLine(kind) {
    const t = reportTemplate, isRow = kind === "row";
    const after = isRow ? selRange().r2 : selRange().c2;

    const cells = {};
    Object.keys(t.cells).forEach(k => {
        let [r, c] = k.split(":").map(Number);
        if (isRow ? r > after : c > after) isRow ? r++ : c++;
        cells[`${r}:${c}`] = t.cells[k];
    });
    t.cells = cells;

    const sizeKey = isRow ? "rowHeights" : "columnWidths", sizes = {};
    Object.entries(t[sizeKey]).forEach(([k, v]) => { k = Number(k); sizes[k > after ? k + 1 : k] = v; });
    sizes[after + 1] = isRow ? 20 : 12;
    t[sizeKey] = sizes;

    const shift = n => (n > after ? n + 1 : n);
    t.merges = t.merges.map(m => isRow
        ? { ...m, startRow: shift(m.startRow), endRow: shift(m.endRow) }
        : { ...m, startCol: shift(m.startCol), endCol: shift(m.endCol) });

    t[isRow ? "rows" : "columns"]++;
    renderTemplateEditorGrid();
}

function templateMerge() {
    const { r1, r2, c1, c2 } = selRange();
    if (r1 === r2 && c1 === c2) return alert("Select at least two cells (click, then Shift+click).");

    reportTemplate.merges = reportTemplate.merges.filter(m => m.endRow < r1 || m.startRow > r2 || m.endCol < c1 || m.startCol > c2);
    reportTemplate.merges.push({ startRow: r1, startCol: c1, endRow: r2, endCol: c2 });
    sel = { row: r1, col: c1 };
    selEnd = { ...sel };
    renderTemplateEditorGrid();
}

function templateUnmerge() {
    reportTemplate.merges = reportTemplate.merges.filter(m =>
        !(sel.row >= m.startRow && sel.row <= m.endRow && sel.col >= m.startCol && sel.col <= m.endCol));
    renderTemplateEditorGrid();
}

function templateInsertPlaceholder(name) {
    cellEdit(reportTemplate, sel.row, sel.col).value = `{{${name}}}`;
    renderTemplateEditorGrid();
}

function saveTemplateFromEditor() {
    DOC_FIELDS.forEach(([k]) => { reportTemplate.metadata[k] = $("tpl_" + k).value.trim(); });
    reportTemplate.page.paper = $("tplPaper").value;
    reportTemplate.page.orientation = $("tplOrient").value;
    saveReportTemplate();
    alert("Template saved successfully.");
}

function resetTemplateFromEditor() {
    if (!confirm("Reset the template to the default layout?")) return;
    reportTemplate = createDefaultReportTemplate();
    saveReportTemplate();
    openTemplateEditor();
}

/* =========================================================
   EXCEL EXPORT
========================================================= */
function loadExcelJS() {
    return new Promise((resolve, reject) => {
        if (window.ExcelJS) return resolve(window.ExcelJS);
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
        s.onload = () => resolve(window.ExcelJS);
        s.onerror = () => reject(new Error("Could not load ExcelJS (check the internet connection)."));
        document.head.appendChild(s);
    });
}

const THIN = { style: "thin" };

function styleCell(cell, o = {}) {
    const { size = 10, bold = false, italic = false, align = "left", vertical = "middle", fill = "", border = true } = o;
    cell.font = { name: "Arial", size, bold, italic };
    cell.alignment = { horizontal: align, vertical, wrapText: true };
    if (/^#?[0-9a-f]{6}$/i.test(fill)) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + fill.replace("#", "").toUpperCase() } };
    }
    if (border) cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
}

function findPlaceholder(name) {
    for (const k in reportTemplate.cells) {
        if (reportTemplate.cells[k].value === `{{${name}}}`) {
            const [row, col] = k.split(":").map(Number);
            return { row, col };
        }
    }
    return null;
}

/* Таблица BOM: одинаковые ID подряд объединяются в одну ячейку (MERGE_IDS) */
function writeBOMBlock(ws, row, col, items) {
    let runStart = row, prevId = null;

    const closeRun = endRow => {
        if (MERGE_IDS && prevId !== null && endRow > runStart) {
            ws.mergeCells(runStart, col, endRow, col);
            ws.getCell(runStart, col).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
    };

    items.forEach(item => {
        const id = getCombinedId(item);
        if (id !== prevId) { closeRun(row - 1); runStart = row; prevId = id; }

        const w = getWeight(item);
        const desc = getBOMDescription(item) + (item.itemType === "Plate" && isShaped(item) ? " (SHAPED)" : "");
        const values = [id, formatQty(item), desc, item.length ?? "-", item.grade || "-", w > 0 ? Number(w.toFixed(3)) : "-"];

        values.forEach((v, i) => {
            const cell = ws.getCell(row, col + i);
            cell.value = v;
            styleCell(cell, { size: 9, align: "center" });
        });
        ws.getRow(row).height = Math.max(18, 13 * Math.ceil(desc.length / 55) + 4);
        row++;
    });

    closeRun(row - 1);
}

function createReportWorksheet(wb) {
    const t = reportTemplate, ws = wb.addWorksheet("BOM Report");
    const pos = findPlaceholder("BOM_TABLE");
    const all = sortedItems();
    const items = [...all.filter(i => !isLooseItem(i)), ...all.filter(i => isLooseItem(i))];

    /* если позиций много, всё, что ниже таблицы (TOTAL), сдвигается вниз */
    let from = Infinity, extra = 0;
    if (pos) {
        const below = Object.keys(t.cells)
            .map(k => k.split(":").map(Number))
            .filter(([r, c]) => r > pos.row && String(t.cells[`${r}:${c}`].value || "").trim() !== "")
            .map(([r]) => r);

        if (below.length) {
            from = Math.min(...below);
            extra = Math.max(0, pos.row + items.length + 1 - from);
        }
    }
    const mapRow = r => (r >= from ? r + extra : r);

    for (let c = 1; c <= t.columns; c++) ws.getColumn(c).width = t.columnWidths[c] || 12;
    for (let r = 1; r <= t.rows + extra; r++) ws.getRow(r).height = 18;
    for (let r = 1; r <= t.rows; r++) ws.getRow(mapRow(r)).height = t.rowHeights[r] || 18;

    for (let r = 1; r <= t.rows; r++) {
        for (let c = 1; c <= t.columns; c++) {
            const tc = cellAt(t, r, c);
            const raw = String(tc.value || "");
            const whole = raw.trim().match(/^\{\{(\w+)\}\}$/);

            /* ячейка целиком из одного плейсхолдера — пишем «как есть» (числа остаются числами) */
            const value = whole
                ? (TABLE_PLACEHOLDERS.includes(whole[1]) ? "" : reportPlaceholderValue(whole[1]))
                : raw.replace(/\{\{(\w+)\}\}/g, (_, n) => TABLE_PLACEHOLDERS.includes(n) ? "" : reportPlaceholderValue(n));

            const cell = ws.getCell(mapRow(r), c);
            cell.value = value;
            styleCell(cell, { ...tc, size: tc.fontSize });
        }
    }

    t.merges.forEach(m => {
        if (pos && pos.row === m.startRow && pos.col === m.startCol) return;
        try { ws.mergeCells(mapRow(m.startRow), m.startCol, mapRow(m.endRow), m.endCol); }
        catch (e) { console.warn("Could not merge", m, e); }
    });

    if (pos) writeBOMBlock(ws, pos.row, pos.col, items);

    const repeat = Number(t.page.repeatRows) || 0;
    ws.pageSetup = {
        paperSize: t.page.paper === "A3" ? 8 : 9,
        orientation: t.page.orientation === "landscape" ? "landscape" : "portrait",
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: .25, right: .25, top: .4, bottom: .4, header: .2, footer: .2 },
        printArea: `A1:${getExcelColumnName(t.columns)}${t.rows + extra}`,
        ...(repeat > 0 ? { printTitlesRow: `1:${repeat}` } : {})
    };
}

function sheetTable(ws, headers, rows, widths) {
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    [headers, ...rows].forEach((r, i) => {
        ws.addRow(r).eachCell({ includeEmpty: true }, c =>
            styleCell(c, { size: 9, bold: i === 0, align: i === 0 ? "center" : "left", fill: i === 0 ? "#D9E2F3" : "" }));
    });
}

function createMaterialListWorksheet(wb) {
    const map = {};

    materialsList.forEach(i => {
        const s = (map[[i.itemType, i.section, i.grade].join("|")] ??=
            { type: i.itemType, section: i.section, grade: i.grade, unit: qtyUnitOf(i), qty: 0, length: 0, area: 0, shaped: false, weight: 0 });
        const qty = Number(i.qty) || 0;

        s.qty += qty;
        s.weight += getWeight(i);
        if (i.itemType === "Profile") s.length += (Number(i.length) || 0) * qty;
        if (i.itemType === "Plate") {
            if (isShaped(i)) s.shaped = true;
            else s.area += (Number(i.length) || 0) * (Number(i.width) || 0) * qty / 1e6;
        }
    });

    /* профили — в метрах, пластины — в м² */
    const extent = s => s.type === "Profile" ? `${(s.length / 1000).toFixed(3)} m`
        : s.type === "Plate" ? (s.shaped ? "-" : `${s.area.toFixed(3)} m²`) : "-";

    sheetTable(wb.addWorksheet("Material List"),
        ["ITEM TYPE", "MATERIAL", "GRADE", "QTY", "TOTAL LENGTH / AREA", "WEIGHT (kg)"],
        Object.values(map).map(s => [typeLabel(s.type), s.section, s.grade,
            s.type === "Other" && s.unit !== "pcs" ? `${s.qty} ${s.unit}` : s.qty, extent(s), Number(s.weight.toFixed(2))]),
        [18, 34, 12, 10, 22, 14]);
}

async function saveWorkbook(wb, fileName) {
    const buffer = await wb.xlsx.writeBuffer();
    const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: "Excel Workbook", accept: { [type]: [".xlsx"] } }]
            });
            const w = await handle.createWritable();
            await w.write(buffer);
            await w.close();
            return true;
        } catch (e) {
            if (e?.name === "AbortError") return false;
            console.warn("Save dialog failed, using download.", e);
        }
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buffer], { type }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
}

async function exportToExcel() {
    try {
        loadReportTemplate();
        const ExcelJS = await loadExcelJS();
        const wb = new ExcelJS.Workbook();
        wb.creator = "Universal Metal Calculator";

        createReportWorksheet(wb);
        createMaterialListWorksheet(wb);

        const doc = String(reportTemplate.metadata.documentNumber || "REPORT").replace(/[<>:"/\\|?*]/g, "_");
        const name = `Universal_Metal_Calculator_${doc}_${new Date().toISOString().slice(0, 10)}.xlsx`;

        if (await saveWorkbook(wb, name)) alert("Excel report generated successfully.");
    } catch (e) {
        console.error(e);
        alert("Excel report generation failed.\n\n" + e.message);
    }
}

/* ===== CLICK ACTIONS (делегирование событий вместо inline onclick) ===== */
const ACTIONS = {
    editMaterial, deleteMaterial, editDatabaseMaterial, deleteDatabaseMaterial,
    addGrade: (_, b) => addGrade(b.dataset.type),
    deleteGrade: (_, b) => deleteGrade(b.dataset.type, b.dataset.grade),
    addNote: (_, b) => addNote(b.dataset.key, b.dataset.input),
    deleteNote: (_, b) => deleteNote(b.dataset.key, b.dataset.note)
};

document.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b) ACTIONS[b.dataset.act]?.(b.dataset.id, b);
});

/* ===== FORM ACCESSIBILITY (убирает предупреждения DevTools: label/for, name, autocomplete) ===== */
let fieldCounter = 0;

function fixFormFields(root = document) {
    root.querySelectorAll("input, select, textarea").forEach(el => {
        if (!el.id) el.id = "field_" + (++fieldCounter);
        if (!el.name) el.name = el.id;
        if (el.type !== "password" && el.type !== "file" && !el.hasAttribute("autocomplete")) el.autocomplete = "off";
        if (el.type === "file" && !el.getAttribute("aria-label")) el.setAttribute("aria-label", "Choose file");
    });

    /* привязка подписей: поле внутри подписи, следующее за ней, либо рядом в том же блоке */
    root.querySelectorAll("label:not([for])").forEach(label => {
        const next = label.nextElementSibling;
        const field = label.querySelector("input, select, textarea")
            || (next && next.matches("input, select, textarea") ? next : null)
            || label.parentElement?.querySelector("input, select, textarea");
        if (field) label.htmlFor = field.id;
    });

    /* поля без видимой подписи (новые грейды и заметки) */
    root.querySelectorAll("input:not([aria-label]), select:not([aria-label])").forEach(el => {
        if (!el.labels || !el.labels.length) el.setAttribute("aria-label", el.placeholder || el.name || "field");
    });
}

/* ===== START ===== */
function startApplication() {
    loadApplicationData();
    initializeAssyNumbers();
    refreshSelects();

    /* подсказки Notes обновляются при выборе материала и при фокусе на поле */
    [["notes", "itemType", "thickness"], ["editNotes", "editItemType", "editThickness"]].forEach(([n, t, s]) => {
        $(n).addEventListener("focus", () => setNoteHints(t, s));
        $(s).addEventListener("change", () => setNoteHints(t, s));
    });

    fixFormFields();
    new MutationObserver(list => {
        list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) fixFormFields(n); }));
    }).observe(document.body, { childList: true, subtree: true });

    renderEverything();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startApplication);
else startApplication();