import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot, query, where, setDoc, updateDoc,
  addDoc, deleteDoc, writeBatch, serverTimestamp, increment, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(window.FZ_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sar = (v) => `${Number(v || 0).toLocaleString("en", { maximumFractionDigits: 2 })} SAR`;
const fmtDate = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "");
const img = (b64) => (b64 ? `data:image/jpeg;base64,${b64}` : "");

const CATS = { ac: "AC", plumbing: "Plumbing", electric: "Electrical", cleaning: "Cleaning", furniture: "Furniture", painting: "Painting", other: "Other" };
const STATUS = {
  requested: ["Waiting", "b-wait"], accepted: ["Accepted", "b-p"], on_the_way: ["On the way", "b-p"],
  arrived: ["Arrived", "b-p"], working: ["Working", "b-p"], completed: ["Completed", "b-ok"],
  visit_only: ["Visit only", "b-ok"], cancelled: ["Cancelled", "b-bad"],
};
const ACTIVE = ["requested", "accepted", "on_the_way", "arrived", "working"];

let workers = [], jobs = [], services = [], payments = [], settings = {};
let unsubs = [];

/* ---------- login ---------- */
let confirmation = null;
$("sendCode").onclick = async () => {
  $("loginMsg").textContent = "Sending...";
  try {
    if (!window._rv) window._rv = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
    let p = $("phone").value.replace(/[^0-9+]/g, "");
    if (!p.startsWith("+")) p = "+966" + p.replace(/^0/, "");
    confirmation = await signInWithPhoneNumber(auth, p, window._rv);
    $("codeBox").hidden = false;
    $("loginMsg").textContent = "Code sent to " + p;
  } catch (e) { $("loginMsg").textContent = e.message; }
};
$("verify").onclick = async () => {
  try { await confirmation.confirm($("code").value.trim()); }
  catch (e) { $("loginMsg").textContent = e.message; }
};
$("logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = true));
  $("tabs").hidden = $("logout").hidden = true;
  $("notAdmin").hidden = true;
  $("login").hidden = !!user;
  if (!user) return;
  const a = await getDoc(doc(db, "admins", user.uid));
  if (!a.exists()) { $("myUid").textContent = user.uid; $("notAdmin").hidden = false; return; }
  $("tabs").hidden = $("logout").hidden = false;
  showTab("dash");
  listen();
});

/* ---------- tabs ---------- */
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== name));
  if (name === "map") setTimeout(drawMap, 50);
}

/* ---------- live data ---------- */
function listen() {
  unsubs.push(onSnapshot(collection(db, "workers"), (s) => { workers = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); }));
  unsubs.push(onSnapshot(collection(db, "jobs"), (s) => { jobs = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); }));
  unsubs.push(onSnapshot(collection(db, "services"), (s) => { services = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderServices(); }));
  unsubs.push(onSnapshot(collection(db, "payments"), (s) => { payments = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderMoney(); }));
  unsubs.push(onSnapshot(doc(db, "settings", "app"), (s) => { settings = s.data() || {}; renderSettings(); }));
}
function renderAll() { renderStats(); renderWorkers(); renderJobs(); renderMoney(); drawMap(); }

/* ---------- dashboard ---------- */
function renderStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = jobs.filter((j) => j.status === "completed" || j.status === "visit_only");
  const doneToday = done.filter((j) => j.finishedAt?.toDate && j.finishedAt.toDate() >= today);
  const commission = done.reduce((a, j) => a + (j.commission || 0), 0);
  const due = workers.reduce((a, w) => a + (w.due || 0), 0);
  const items = [
    ["Online workers", workers.filter((w) => w.online && w.status === "approved").length, ""],
    ["Waiting for approval", workers.filter((w) => w.status === "pending").length, "g"],
    ["Active jobs", jobs.filter((j) => ACTIVE.includes(j.status)).length, "p"],
    ["Jobs done today", doneToday.length, ""],
    ["Jobs done (all time)", done.length, ""],
    ["Commission earned", sar(commission), "p"],
    ["Commission today", sar(doneToday.reduce((a, j) => a + (j.commission || 0), 0)), "p"],
    ["Still owed by workers", sar(due), "g"],
  ];
  $("stats").innerHTML = items.map(([t, v, c]) => `<div class="stat ${c}"><span class="muted">${t}</span><b>${v}</b></div>`).join("");
}

/* ---------- workers ---------- */
$("wFilter").onchange = $("wSearch").oninput = renderWorkers;
function iqamaBadge(w) {
  const t = w.iqamaExpiry?.toDate?.();
  if (!t) return "";
  return t < new Date()
    ? `<span class="badge b-bad">Iqama expired ${t.toLocaleDateString("en-GB")}</span>`
    : `<span class="badge b-ok">Iqama valid to ${t.toLocaleDateString("en-GB")}</span>`;
}
function renderWorkers() {
  const f = $("wFilter").value, q = $("wSearch").value.toLowerCase();
  const list = workers
    .filter((w) => !f || w.status === f)
    .filter((w) => !q || (w.name || "").toLowerCase().includes(q) || (w.phone || "").includes(q))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("workerList").innerHTML = list.length ? list.map((w) => `
    <div class="worker" data-id="${w.id}">
      <div class="head">
        <img class="av" src="${img(w.photo)}" alt="">
        <div>
          <b>${esc(w.name)}</b> ${w.online ? '<span class="badge b-ok">online</span>' : ""}<br>
          <span class="muted">${esc(w.phone)}</span><br>
          ★ ${w.rating || 0} (${w.ratingCount || 0}) · ${w.jobsDone || 0} jobs · owes ${sar(w.due)}
        </div>
      </div>
      <div>${(w.skills || []).map((s) => `<span class="badge b-p">${CATS[s] || s}</span>`).join(" ")} ${iqamaBadge(w)}</div>
      ${w.status === "pending" ? `
        <div class="docs" data-docs="${w.id}"><span class="muted">Loading Iqama &amp; selfie…</span></div>
        <label class="check"><input type="checkbox" class="huroob"> I checked: no huroob case</label>
        <div class="row"><button class="approve" disabled>Approve</button><button class="danger reject">Block</button></div>`
      : w.status === "approved" ? `<div class="row"><button class="ghost docsBtn">View Iqama</button><button class="danger block">Block</button></div>`
      : `<div class="row"><button class="ghost docsBtn">View Iqama</button><button class="unblock">Unblock</button></div>`}
    </div>`).join("") : `<p class="muted">No workers here.</p>`;

  list.filter((w) => w.status === "pending").forEach(async (w) => {
    const d = (await getDoc(doc(db, "workerDocs", w.id))).data() || {};
    const box = document.querySelector(`[data-docs="${w.id}"]`);
    if (box) box.innerHTML = `<img src="${img(d.iqamaPhoto)}" alt="Iqama" title="Iqama ${esc(d.iqamaNo)}"><img src="${img(d.selfie)}" alt="Selfie">`
      + `<div class="muted" style="align-self:end">Iqama no. <b>${esc(d.iqamaNo)}</b></div>`;
    box?.querySelectorAll("img").forEach((i) => (i.onclick = () => bigImage(i.src)));
  });

  document.querySelectorAll("#workerList .worker").forEach((el) => {
    const id = el.dataset.id;
    const hb = el.querySelector(".huroob");
    if (hb) hb.onchange = () => (el.querySelector(".approve").disabled = !hb.checked);
    el.querySelector(".approve")?.addEventListener("click", () =>
      updateDoc(doc(db, "workers", id), { status: "approved", huroobChecked: true, approvedAt: serverTimestamp() }));
    el.querySelector(".reject")?.addEventListener("click", () => setStatus(id, "blocked"));
    el.querySelector(".block")?.addEventListener("click", () => setStatus(id, "blocked"));
    el.querySelector(".unblock")?.addEventListener("click", () => setStatus(id, "approved"));
    el.querySelector(".docsBtn")?.addEventListener("click", async () => {
      const d = (await getDoc(doc(db, "workerDocs", id))).data() || {};
      openDialog(`<h3>Iqama ${esc(d.iqamaNo)}</h3><img src="${img(d.iqamaPhoto)}"><img src="${img(d.selfie)}" style="margin-top:8px"><p><button>Close</button></p>`);
    });
  });
}
function setStatus(id, status) {
  if (status === "blocked" && !confirm("Block this worker?")) return;
  updateDoc(doc(db, "workers", id), { status, online: false });
}

/* ---------- jobs ---------- */
$("jFilter").onchange = renderJobs;
function renderJobs() {
  const f = $("jFilter").value;
  const list = jobs
    .filter((j) => !f || (f === "active" ? ACTIVE.includes(j.status) : j.status === f))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 300);
  const approved = workers.filter((w) => w.status === "approved");
  $("jobTable").innerHTML = `<tr><th>Time</th><th>Service</th><th>Customer</th><th>Worker</th><th>Price + visit</th><th>Status</th><th>Commission</th><th></th></tr>` +
    list.map((j) => {
      const st = STATUS[j.status] || [j.status, ""];
      const assign = j.status === "requested"
        ? `<select data-assign="${j.id}"><option value="">Assign worker…</option>${approved
            .filter((w) => (w.skills || []).includes(j.category))
            .map((w) => `<option value="${w.id}">${esc(w.name)}${w.online ? " (online)" : ""}</option>`).join("")}</select>`
        : esc(j.workerName || "");
      return `<tr>
        <td>${fmtDate(j.createdAt)}</td>
        <td>${esc(j.serviceNameEn || j.serviceName)}${j.note ? `<br><span class="muted">${esc(j.note)}</span>` : ""}</td>
        <td>${esc(j.customerName)}<br><span class="muted">${esc(j.customerPhone)}</span></td>
        <td>${assign}</td>
        <td>${sar(j.price)} + ${sar(j.visitFee)}</td>
        <td><span class="badge ${st[1]}">${st[0]}</span>${j.rating ? `<br>★ ${j.rating}` : ""}</td>
        <td>${j.commission != null ? sar(j.commission) : ""}</td>
        <td>${ACTIVE.includes(j.status) ? `<button class="small danger" data-cancel="${j.id}">Cancel</button>` : ""}</td>
      </tr>`;
    }).join("");
  document.querySelectorAll("[data-assign]").forEach((s) => (s.onchange = () => {
    const w = workers.find((x) => x.id === s.value);
    if (!w) return;
    updateDoc(doc(db, "jobs", s.dataset.assign), {
      status: "accepted", workerId: w.id, workerName: w.name || "", workerPhone: w.phone || "",
      assignedByAdmin: true, acceptedAt: serverTimestamp(),
      ...(w.location ? { workerLocation: w.location } : {}),
    });
  }));
  document.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => {
    if (confirm("Cancel this job?")) updateDoc(doc(db, "jobs", b.dataset.cancel), { status: "cancelled", cancelledBy: "admin", cancelledAt: serverTimestamp() });
  }));
}

/* ---------- prices ---------- */
function renderServices() {
  const list = [...services].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  $("serviceTable").innerHTML = `<tr><th>Category</th><th>English</th><th>Arabic</th><th>Bangla</th><th>Urdu</th><th>Hindi</th><th>Price</th><th>Visit fee</th><th>Shown</th><th></th></tr>` +
    list.map((s) => `<tr data-id="${s.id}">
      <td><select data-f="category">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${s.category === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><input data-f="nameEn" value="${esc(s.nameEn)}"></td>
      <td><input data-f="nameAr" value="${esc(s.nameAr)}" dir="rtl"></td>
      <td><input data-f="nameBn" value="${esc(s.nameBn)}"></td>
      <td><input data-f="nameUr" value="${esc(s.nameUr)}" dir="rtl"></td>
      <td><input data-f="nameHi" value="${esc(s.nameHi)}"></td>
      <td><input data-f="price" type="number" value="${s.price ?? 0}" style="width:90px"></td>
      <td><input data-f="visitFee" type="number" value="${s.visitFee ?? 0}" style="width:90px"></td>
      <td><input data-f="active" type="checkbox" ${s.active !== false ? "checked" : ""} style="width:20px"></td>
      <td><button class="small danger" data-del="${s.id}">Delete</button></td>
    </tr>`).join("");
  document.querySelectorAll("#serviceTable [data-f]").forEach((inp) => (inp.onchange = () => {
    const id = inp.closest("tr").dataset.id, f = inp.dataset.f;
    let v = inp.type === "checkbox" ? inp.checked : inp.value;
    if (f === "price" || f === "visitFee") v = Number(v);
    updateDoc(doc(db, "services", id), { [f]: v });
  }));
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    if (confirm("Delete this service?")) deleteDoc(doc(db, "services", b.dataset.del));
  }));
}
$("addService").onclick = () => addDoc(collection(db, "services"), {
  category: "other", nameEn: "New service", nameAr: "", nameBn: "", price: 100, visitFee: 30, active: false, sort: services.length + 1,
});

// Starter list for Jeddah, from public price research (Oct 2026). Edit freely.
const STARTER = [
  ["ac", "AC cleaning (split unit)", "غسيل مكيف سبليت", "এসি পরিষ্কার (স্প্লিট)", 100, 30],
  ["ac", "AC gas refill (1–1.5 ton)", "تعبئة فريون (1–1.5 طن)", "এসি গ্যাস (১–১.৫ টন)", 200, 30],
  ["ac", "AC repair (one unit)", "إصلاح مكيف", "এসি মেরামত (১টা)", 150, 30],
  ["ac", "AC installation (split)", "تركيب مكيف سبليت", "এসি লাগানো (স্প্লিট)", 250, 30],
  ["plumbing", "Tap or flush repair", "إصلاح حنفية أو سيفون", "কল বা ফ্লাশ মেরামত", 100, 30],
  ["plumbing", "Water heater repair", "إصلاح سخان", "পানির হিটার মেরামত", 180, 30],
  ["plumbing", "Blocked drain", "تسليك مجاري", "বন্ধ ড্রেন খোলা", 150, 30],
  ["plumbing", "Water leak fix", "إصلاح تسريب مياه", "পানি লিক মেরামত", 150, 30],
  ["electric", "Socket or switch fix", "إصلاح فيش أو مفتاح", "সকেট বা সুইচ মেরামত", 80, 30],
  ["electric", "Light installation", "تركيب إضاءة", "লাইট লাগানো", 80, 30],
  ["electric", "Move switches (up to 3)", "نقل مفاتيح (حتى 3)", "সুইচ সরানো (৩টা পর্যন্ত)", 250, 30],
  ["electric", "Sockets & lights, 2-bedroom flat", "فيش وإضاءة شقة غرفتين", "২ রুমের বাসার সকেট ও লাইট", 350, 30],
  ["cleaning", "Apartment cleaning (4 hours)", "تنظيف شقة (4 ساعات)", "বাসা পরিষ্কার (৪ ঘণ্টা)", 200, 0],
  ["furniture", "Furniture assembly (per item)", "تركيب أثاث (للقطعة)", "ফার্নিচার জোড়া (প্রতিটি)", 100, 30],
  ["furniture", "Curtain installation", "تركيب ستائر", "পর্দা লাগানো", 80, 30],
  ["furniture", "TV wall mount", "تعليق تلفزيون", "টিভি দেয়ালে লাগানো", 100, 30],
  ["painting", "Room painting (labour only)", "دهان غرفة (أجرة فقط)", "রুম রং (শুধু মজুরি)", 400, 30],
];
$("seedServices").onclick = async () => {
  if (services.length && !confirm("Services already exist. Add the starter list anyway?")) return;
  const b = writeBatch(db);
  STARTER.forEach(([category, nameEn, nameAr, nameBn, price, visitFee], i) =>
    b.set(doc(collection(db, "services")), { category, nameEn, nameAr, nameBn, price, visitFee, active: true, sort: i + 1 }));
  await b.commit();
};

/* ---------- money ---------- */
function renderMoney() {
  const owing = workers.filter((w) => (w.due || 0) > 0).sort((a, b) => b.due - a.due);
  $("dueTable").innerHTML = `<tr><th>Worker</th><th>Phone</th><th>Owes</th><th>Record cash received</th></tr>` +
    (owing.length ? owing.map((w) => `<tr>
      <td>${esc(w.name)}</td><td>${esc(w.phone)}</td><td><b>${sar(w.due)}</b></td>
      <td class="row"><input type="number" min="1" step="1" placeholder="SAR" style="width:110px" data-amt="${w.id}">
        <button class="small" data-pay="${w.id}">Save</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">Nobody owes anything.</td></tr>`);
  document.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.pay, w = workers.find((x) => x.id === id);
    const amt = Number(document.querySelector(`[data-amt="${id}"]`).value);
    if (!amt || amt <= 0) return;
    if (!confirm(`Record ${sar(amt)} received from ${w.name}?`)) return;
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "payments")), { workerId: id, workerName: w.name || "", amount: amt, createdAt: serverTimestamp() });
    batch.update(doc(db, "workers", id), { due: increment(-amt) });
    await batch.commit();
  }));
  const recent = [...payments].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 100);
  $("payTable").innerHTML = `<tr><th>Date</th><th>Worker</th><th>Amount</th></tr>` +
    (recent.length ? recent.map((p) => `<tr><td>${fmtDate(p.createdAt)}</td><td>${esc(p.workerName)}</td><td>${sar(p.amount)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">No payments yet.</td></tr>`);
}

/* ---------- settings ---------- */
function renderSettings() {
  $("sVisit").value = Math.round((settings.visitCommission ?? 0.5) * 100);
  $("sJob").value = (settings.jobCommission ?? 0.05) * 100;
  $("sDue").value = settings.dueLimit ?? 200;
  $("sRadius").value = settings.radiusKm ?? 15;
}
$("saveSettings").onclick = async () => {
  await setDoc(doc(db, "settings", "app"), {
    visitCommission: Number($("sVisit").value) / 100,
    jobCommission: Number($("sJob").value) / 100,
    dueLimit: Number($("sDue").value),
    radiusKm: Number($("sRadius").value),
  }, { merge: true });
  $("settingsMsg").textContent = "Saved.";
};

/* ---------- live map (OpenStreetMap, free) ---------- */
let map, layer;
function drawMap() {
  if ($("map").hidden || !window.L) return;
  if (!map) {
    map = L.map("leaflet").setView([21.5433, 39.1728], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  map.invalidateSize();
  layer.clearLayers();
  workers.filter((w) => w.online && w.location).forEach((w) =>
    L.circleMarker([w.location.latitude, w.location.longitude], { radius: 9, color: "#0A8A80", fillOpacity: 0.85 })
      .bindPopup(`<b>${esc(w.name)}</b><br>${esc(w.phone)}<br>${(w.skills || []).map((s) => CATS[s]).join(", ")}`).addTo(layer));
  jobs.filter((j) => ACTIVE.includes(j.status) && j.location).forEach((j) =>
    L.circleMarker([j.location.latitude, j.location.longitude], { radius: 9, color: "#6A1B78", fillOpacity: 0.85 })
      .bindPopup(`<b>${esc(j.serviceNameEn || j.serviceName)}</b><br>${esc(j.customerName)}<br>${(STATUS[j.status] || [j.status])[0]}`).addTo(layer));
}

/* ---------- dialog ---------- */
function openDialog(html) { $("dlgBody").innerHTML = html; $("dlg").showModal(); }
function bigImage(src) { openDialog(`<img src="${src}"><p><button>Close</button></p>`); }
