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

const CATS = { ac: "AC", plumbing: "Plumbing", electric: "Electrical", cleaning: "Cleaning", furniture: "Furniture", painting: "Painting", car: "Car mechanic", appliances: "Home appliances", electronics: "TV & electronics", other: "Other" };
const STATUS = {
  requested: ["Waiting", "b-wait"], accepted: ["Accepted", "b-p"], on_the_way: ["On the way", "b-p"],
  arrived: ["Arrived", "b-p"], working: ["Working", "b-p"], completed: ["Completed", "b-ok"],
  visit_only: ["Visit only", "b-ok"], cancelled: ["Cancelled", "b-bad"],
};
const ACTIVE = ["requested", "accepted", "on_the_way", "arrived", "working"];

let workers = [], jobs = [], services = [], payments = [], settings = {};
let customers = [], wallets = [], wreqs = [];
const charts = {};
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
  $("side").hidden = $("menuBtn").hidden = true;
  $("notAdmin").hidden = true;
  $("login").hidden = !!user;
  $("pageTitle").textContent = "Admin"; $("pageSub").textContent = ""; $("who").textContent = "";
  if (!user) return;
  const a = await getDoc(doc(db, "admins", user.uid));
  if (!a.exists()) { $("myUid").textContent = user.uid; $("notAdmin").hidden = false; return; }
  $("side").hidden = $("menuBtn").hidden = false;
  $("who").textContent = user.phoneNumber || "";
  showTab("dash");
  listen();
});

/* ---------- tabs ---------- */
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
const TITLES = {
  dash: ["Dashboard", "Today at a glance"], map: ["Live map", "Workers and open requests"], jobs: ["Jobs", "All requests"],
  workers: ["Workers", "Approve, block and review providers"], customers: ["Customers", "Everyone who uses NK Fazaa"],
  wallets: ["Wallets", "Withdraw requests and balances"], money: ["Worker dues", "Cash the workers owe the company"],
  prices: ["Prices", "Services and fixed prices"], requests: ["Requests", "Account delete requests"],
  settings: ["Settings", "Commission, limits and support"],
};
$("menuBtn").onclick = () => $("side").classList.toggle("open");
function showTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== name));
  $("pageTitle").textContent = TITLES[name]?.[0] || ""; $("pageSub").textContent = TITLES[name]?.[1] || "";
  $("side").classList.remove("open");
  if (name === "map") setTimeout(drawMap, 50);
  if (name === "dash") setTimeout(renderCharts, 30);
}

/* ---------- live data ---------- */
function listen() {
  unsubs.push(onSnapshot(collection(db, "workers"), (s) => { workers = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); }));
  unsubs.push(onSnapshot(collection(db, "jobs"), (s) => { jobs = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); }));
  unsubs.push(onSnapshot(collection(db, "services"), (s) => { services = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderServices(); }));
  unsubs.push(onSnapshot(collection(db, "payments"), (s) => { payments = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderMoney(); }));
  unsubs.push(onSnapshot(doc(db, "settings", "app"), (s) => { settings = s.data() || {}; renderSettings(); }));
  unsubs.push(onSnapshot(collection(db, "customers"), (s) => { customers = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderPeople(); renderStats(); }));
  unsubs.push(onSnapshot(collection(db, "wallets"), (s) => { wallets = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderPeople(); }));
  unsubs.push(onSnapshot(collection(db, "walletRequests"), (s) => { wreqs = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderPeople(); }));
}
setInterval(() => { if (jobs.length) renderStats(); }, 60000);
function renderAll() { renderStats(); renderWorkers(); renderJobs(); renderMoney(); renderPeople(); drawMap(); }
function renderPeople() { renderCustomers(); renderWallets(); renderRequests(); renderPills(); }
function renderPills() {
  const n = (v) => (v ? String(v) : "");
  $("nPending").textContent = n(workers.filter((w) => w.status === "pending").length);
  $("nWithdraw").textContent = n(wreqs.filter((r) => r.status === "pending").length);
  $("nDelete").textContent = n([...customers, ...workers].filter((x) => x.deleteRequested).length);
}

/* ---------- dashboard ---------- */
const isDone = (j) => j.status === "completed" || j.status === "visit_only";
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function renderStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const done = jobs.filter(isDone);
  const fin = (j) => j.finishedAt?.toDate?.();
  const doneToday = done.filter((j) => fin(j) >= today);
  const doneMonth = done.filter((j) => fin(j) >= month);
  const sum = (l, f) => l.reduce((a, j) => a + (j[f] || 0), 0);
  const items = [
    ["engineering", "Online workers", workers.filter((w) => w.online && w.status === "approved").length, ""],
    ["pending_actions", "Waiting for approval", workers.filter((w) => w.status === "pending").length, "g"],
    ["bolt", "Active jobs", jobs.filter((j) => ACTIVE.includes(j.status)).length, "p"],
    ["group", "Customers", customers.length, ""],
    ["task_alt", "Jobs done today", doneToday.length, ""],
    ["savings", "Income today", sar(sum(doneToday, "commission")), "p"],
    ["calendar_month", "Income this month", sar(sum(doneMonth, "commission")), "p"],
    ["point_of_sale", "Customer spending (month)", sar(sum(doneMonth, "paidByCustomer")), ""],
    ["account_balance", "Owed by workers", sar(workers.reduce((a, w) => a + (w.due || 0), 0)), "g"],
    ["star", "Average rating", (() => { const r = done.filter((j) => j.rating); return r.length ? (r.reduce((a, j) => a + j.rating, 0) / r.length).toFixed(1) : "–"; })(), "g"],
  ];
  const late = jobs.filter((j) => j.status === "requested" && j.createdAt?.toDate && Date.now() - j.createdAt.toDate() > 10 * 60 * 1000);
  $("nLate").textContent = late.length ? String(late.length) : "";
  document.title = late.length ? `(${late.length}) waiting · NK Fazaa Admin` : "NK Fazaa Admin";
  $("alerts").innerHTML = late.length
    ? `<div class="alert"><i class="ms">notification_important</i><div>${late.length} request${late.length > 1 ? "s have" : " has"} waited more than 10 minutes with no worker. Call the customer or assign a worker.</div>
       <button class="small danger" id="goLate">Open jobs</button></div>` : "";
  $("goLate")?.addEventListener("click", () => { $("jFilter").value = "requested"; renderJobs(); showTab("jobs"); });
  $("stats").innerHTML = items.map(([ic, t, v, c]) =>
    `<div class="stat ${c}"><i class="ms">${ic}</i><div><span>${t}</span><b>${v}</b></div></div>`).join("");

  const top = workers.filter((w) => w.status === "approved")
    .map((w) => ({ w, n: done.filter((j) => j.workerId === w.id).length, inc: sum(done.filter((j) => j.workerId === w.id), "commission") }))
    .sort((a, b) => b.n - a.n).slice(0, 6);
  $("topWorkers").innerHTML = `<tr><th>Worker</th><th class="num">Jobs</th><th class="num">Rating</th><th class="num">Income</th></tr>` +
    (top.length ? top.map(({ w, n, inc }) => `<tr><td>${esc(w.name)}${w.accountType === "company" ? ' <span class="badge b-wait">Company</span>' : ""}</td>
      <td class="num">${n}</td><td class="num">★ ${Number(w.rating || 0).toFixed(1)}</td><td class="num">${sar(inc)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">No approved workers yet.</td></tr>`);

  const latest = [...jobs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
  $("latestJobs").innerHTML = `<tr><th>Time</th><th>Service</th><th>Customer</th><th>Worker</th><th>Status</th></tr>` +
    (latest.length ? latest.map((j) => { const st = STATUS[j.status] || [j.status, ""];
      return `<tr><td>${fmtDate(j.createdAt)}</td><td>${esc(j.serviceNameEn || j.serviceName)}</td><td>${esc(j.customerName)}</td>
        <td>${esc(j.workerName || "–")}</td><td><span class="badge ${st[1]}">${st[0]}</span></td></tr>`; }).join("")
      : `<tr><td colspan="5" class="muted">No jobs yet.</td></tr>`);
  renderCharts();
}

function barChart(id, labels, data, color, money) {
  if (!window.Chart || $("dash").hidden) return;
  const cfg = {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, borderSkipped: "start", maxBarThickness: 26 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      indexAxis: id === "chCats" ? "y" : "x",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (money ? sar(c.parsed[id === "chCats" ? "x" : "y"]) : c.formattedValue) } } },
      scales: {
        x: { grid: { display: id === "chCats", color: "#EEF1F2" }, ticks: { color: "#5A6B70", font: { size: 11 } }, beginAtZero: true },
        y: { grid: { display: id !== "chCats", color: "#EEF1F2" }, ticks: { color: "#5A6B70", font: { size: 11 }, precision: 0 }, beginAtZero: true },
      },
    },
  };
  if (charts[id]) { charts[id].data = cfg.data; charts[id].update(); } else charts[id] = new Chart($(id), cfg);
}
function renderCharts() {
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); return d; });
  const labels = days.map((d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
  const count = Object.fromEntries(days.map((d) => [dayKey(d), 0])), money = { ...count };
  jobs.filter(isDone).forEach((j) => { const d = j.finishedAt?.toDate?.(); if (!d) return; const k = dayKey(d);
    if (k in count) { count[k]++; money[k] += j.commission || 0; } });
  barChart("chJobs", labels, days.map((d) => count[dayKey(d)]), "#0A8A80", false);
  barChart("chMoney", labels, days.map((d) => Math.round(money[dayKey(d)])), "#6A1B78", true);
  const byCat = {};
  jobs.filter((j) => j.status !== "cancelled").forEach((j) => (byCat[j.category] = (byCat[j.category] || 0) + 1));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  barChart("chCats", cats.map(([c]) => CATS[c] || c), cats.map(([, n]) => n), "#0A8A80", false);
}

/* ---------- workers ---------- */
$("wFilter").onchange = $("wType").onchange = $("wSearch").oninput = renderWorkers;
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
    .filter((w) => !$("wType").value || (w.accountType || "individual") === $("wType").value)
    .filter((w) => !q || (w.name || "").toLowerCase().includes(q) || (w.phone || "").includes(q))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("workerList").innerHTML = list.length ? list.map((w) => `
    <div class="worker" data-id="${w.id}">
      <div class="head">
        <img class="av" src="${img(w.photo)}" alt="">
        <div>
          <b>${esc(w.name)}</b> ${w.accountType === "company" ? '<span class="badge b-wait">Company</span>' : ""} ${w.online ? '<span class="badge b-ok">online</span>' : ""}<br>
          ${w.accountType === "company" ? `<span class="muted">Contact: ${esc(w.contactName)} · CR ${esc(w.crNumber)}</span><br>` : ""}
          <span class="muted">${esc(w.phone)}</span><br>
          ★ ${w.rating || 0} (${w.ratingCount || 0}) · ${w.jobsDone || 0} jobs · owes ${sar(w.due)}
        </div>
      </div>
      <div>${(w.skills || []).map((s) => `<span class="badge b-p">${CATS[s] || s}</span>`).join(" ")} ${w.accountType === "company" ? "" : iqamaBadge(w)}</div>
      ${w.status === "pending" ? `
        <div class="docs" data-docs="${w.id}"><span class="muted">Loading Iqama &amp; selfie…</span></div>
        <label class="check"><input type="checkbox" class="huroob"> ${w.accountType === "company" ? "I checked the CR (commercial registration)" : "I checked: no huroob case"}</label>
        <div class="row"><button class="approve" disabled>Approve</button><button class="danger reject">Block</button></div>`
      : w.status === "approved" ? `<div class="row"><button class="ghost docsBtn">View Iqama</button><button class="danger block">Block</button></div>`
      : `<div class="row"><button class="ghost docsBtn">View Iqama</button><button class="unblock">Unblock</button></div>`}
    </div>`).join("") : `<p class="muted">No workers here.</p>`;

  list.filter((w) => w.status === "pending").forEach(async (w) => {
    const d = (await getDoc(doc(db, "workerDocs", w.id))).data() || {};
    const box = document.querySelector(`[data-docs="${w.id}"]`);
    if (box) box.innerHTML = `<img src="${img(d.iqamaPhoto)}" alt="Iqama" title="${d.accountType === "company" ? "CR " + esc(d.crNumber) : "Iqama " + esc(d.iqamaNo)}"><img src="${img(d.selfie)}" alt="Selfie">`
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
      openDialog(`<h3>${d.accountType === "company" ? "CR " + esc(d.crNumber) : "Iqama " + esc(d.iqamaNo)}</h3><img src="${img(d.iqamaPhoto)}"><img src="${img(d.selfie)}" style="margin-top:8px"><p><button>Close</button></p>`);
    });
  });
}
function setStatus(id, status) {
  if (status === "blocked" && !confirm("Block this worker?")) return;
  updateDoc(doc(db, "workers", id), { status, online: false });
}

/* ---------- jobs ---------- */
$("jFilter").onchange = $("jSearch").oninput = renderJobs;
function renderJobs() {
  const f = $("jFilter").value;
  const list = jobs
    .filter((j) => !f || (f === "active" ? ACTIVE.includes(j.status) : j.status === f))
    .filter((j) => { const q = $("jSearch").value.toLowerCase(); return !q || [j.customerName, j.customerPhone, j.workerName, j.serviceNameEn, j.serviceName]
      .some((x) => (x || "").toLowerCase().includes(q)); })
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
  ["car", "Car battery change (at your place)", "تغيير بطارية السيارة (في موقعك)", "গাড়ির ব্যাটারি বদল (আপনার জায়গায়)", 80, 30],
  ["car", "Car oil change (at your place)", "تغيير زيت السيارة (في موقعك)", "গাড়ির তেল বদল (আপনার জায়গায়)", 70, 30],
  ["car", "Car check & small repair", "فحص السيارة وإصلاح بسيط", "গাড়ি চেক ও ছোট মেরামত", 120, 50],
  ["car", "Car AC check & gas", "فحص مكيف السيارة وتعبئة غاز", "গাড়ির এসি চেক ও গ্যাস", 150, 30],
  ["appliances", "Washing machine repair", "إصلاح غسالة", "ওয়াশিং মেশিন মেরামত", 150, 50],
  ["appliances", "Fridge / freezer repair", "إصلاح ثلاجة / فريزر", "ফ্রিজ / ফ্রিজার মেরামত", 150, 50],
  ["appliances", "Fridge gas refill", "تعبئة غاز ثلاجة", "ফ্রিজের গ্যাস ভরা", 200, 50],
  ["appliances", "Oven / dishwasher repair", "إصلاح فرن / غسالة صحون", "ওভেন / ডিশওয়াশার মেরামত", 150, 50],
  ["electronics", "TV repair", "إصلاح تلفزيون", "টিভি মেরামত", 150, 50],
  ["electronics", "Satellite / receiver setup", "تركيب ستلايت / رسيفر", "স্যাটেলাইট / রিসিভার লাগানো", 100, 30],
  ["electronics", "Wi-Fi / CCTV camera setup", "تركيب واي فاي / كاميرات مراقبة", "ওয়াই-ফাই / সিসিটিভি ক্যামেরা লাগানো", 150, 30],
];
$("seedServices").onclick = async () => {
  // Only adds starter services that are not in the list yet (matched by English name).
  const have = new Set(services.map((s) => s.nameEn));
  const missing = STARTER.map((r, i) => [r, i]).filter(([r]) => !have.has(r[1]));
  if (!missing.length) return alert("All starter services are already in the list.");
  if (!confirm(`Add ${missing.length} starter services?`)) return;
  const b = writeBatch(db);
  missing.forEach(([[category, nameEn, nameAr, nameBn, price, visitFee], i]) =>
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

/* ---------- customers ---------- */
const balanceOf = (id) => wallets.find((w) => w.id === id)?.balance || 0;
$("cSearch").oninput = renderCustomers;
function renderCustomers() {
  const q = $("cSearch").value.toLowerCase();
  const list = customers.filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("customerTable").innerHTML = `<tr><th>Name</th><th>Phone</th><th>Joined</th><th class="num">Requests</th><th class="num">Spent</th><th class="num">Wallet</th><th></th></tr>` +
    (list.length ? list.map((c) => { const mine = jobs.filter((j) => j.customerId === c.id);
      return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${fmtDate(c.createdAt)}</td>
        <td class="num">${mine.length}</td><td class="num">${sar(mine.filter(isDone).reduce((a, j) => a + (j.paidByCustomer || 0), 0))}</td>
        <td class="num">${sar(balanceOf(c.id))}</td>
        <td>${c.deleteRequested ? '<span class="badge b-bad">Delete requested</span>' : ""}</td></tr>`; }).join("")
      : `<tr><td colspan="7" class="muted">No customers yet.</td></tr>`);
}

/* ---------- wallets ---------- */
const personName = (uid) => customers.find((c) => c.id === uid)?.name || workers.find((w) => w.id === uid)?.name || uid;
$("rFilter").onchange = renderWallets;
function renderWallets() {
  const f = $("rFilter").value;
  const list = wreqs.filter((r) => !f || r.status === f).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const RS = { pending: ["Waiting", "b-wait"], paid: ["Paid", "b-ok"], rejected: ["Rejected", "b-bad"] };
  $("withdrawTable").innerHTML = `<tr><th>Date</th><th>Who</th><th class="num">Amount</th><th class="num">Balance</th><th>Bank</th><th>Status</th><th></th></tr>` +
    (list.length ? list.map((r) => { const st = RS[r.status] || [r.status, ""];
      return `<tr><td>${fmtDate(r.createdAt)}</td><td><b>${esc(personName(r.uid))}</b><br><span class="muted">${esc(r.role)}</span></td>
        <td class="num"><b>${sar(r.amount)}</b></td><td class="num">${sar(balanceOf(r.uid))}</td>
        <td>${esc(r.accountName)}<br><span class="muted">${esc(r.bankName)} · ${esc(r.iban)}</span></td>
        <td><span class="badge ${st[1]}">${st[0]}</span></td>
        <td>${r.status === "pending" ? `<div class="row"><button class="small" data-wpaid="${r.id}">Mark paid</button><button class="small danger" data-wrej="${r.id}">Reject</button></div>` : ""}</td></tr>`; }).join("")
      : `<tr><td colspan="7" class="muted">No requests.</td></tr>`);
  document.querySelectorAll("[data-wpaid]").forEach((b) => (b.onclick = async () => {
    const r = wreqs.find((x) => x.id === b.dataset.wpaid);
    if (balanceOf(r.uid) < r.amount) return alert("Balance is lower than the request.");
    if (!confirm(`Did you transfer ${sar(r.amount)} to ${r.accountName} (${r.iban})?`)) return;
    const batch = writeBatch(db);
    batch.update(doc(db, "walletRequests", r.id), { status: "paid", paidAt: serverTimestamp() });
    batch.set(doc(db, "wallets", r.uid), { balance: increment(-r.amount), updatedAt: serverTimestamp() }, { merge: true });
    await batch.commit();
  }));
  document.querySelectorAll("[data-wrej]").forEach((b) => (b.onclick = () => {
    if (confirm("Reject this request?")) updateDoc(doc(db, "walletRequests", b.dataset.wrej), { status: "rejected", rejectedAt: serverTimestamp() });
  }));
  const people = [...customers.map((c) => [c.id, `${c.name || ""} · customer · ${c.phone || ""}`]),
    ...workers.map((w) => [w.id, `${w.name || ""} · worker · ${w.phone || ""}`])];
  const keep = $("balUser").value;
  $("balUser").innerHTML = `<option value="">Choose a customer or worker…</option>` + people.map(([id, t]) => `<option value="${id}">${esc(t)}</option>`).join("");
  $("balUser").value = keep;
  const withBal = wallets.filter((w) => w.balance).sort((a, b) => b.balance - a.balance);
  $("balanceTable").innerHTML = `<tr><th>Who</th><th class="num">Balance</th><th>Updated</th></tr>` +
    (withBal.length ? withBal.map((w) => `<tr><td>${esc(personName(w.id))}</td><td class="num"><b>${sar(w.balance)}</b></td><td>${fmtDate(w.updatedAt)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">No wallet balances yet.</td></tr>`);
}
$("balSave").onclick = async () => {
  const uid = $("balUser").value, amt = Number($("balAmount").value);
  if (!uid || !amt) return;
  if (balanceOf(uid) + amt < 0) return alert("Balance cannot go below 0.");
  if (!confirm(`${amt > 0 ? "Add" : "Remove"} ${sar(Math.abs(amt))} ${amt > 0 ? "to" : "from"} ${personName(uid)}'s wallet?`)) return;
  await setDoc(doc(db, "wallets", uid), { balance: increment(amt), updatedAt: serverTimestamp() }, { merge: true });
  $("balAmount").value = "";
};

/* ---------- delete requests ---------- */
function renderRequests() {
  const list = [...customers.filter((c) => c.deleteRequested).map((c) => ({ ...c, kind: "customer" })),
    ...workers.filter((w) => w.deleteRequested).map((w) => ({ ...w, kind: "worker" }))]
    .sort((a, b) => (a.deleteRequestedAt?.seconds || 0) - (b.deleteRequestedAt?.seconds || 0));
  $("deleteTable").innerHTML = `<tr><th>Asked on</th><th>Who</th><th>Phone</th><th>Type</th><th></th></tr>` +
    (list.length ? list.map((x) => `<tr><td>${fmtDate(x.deleteRequestedAt)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.phone)}</td>
      <td>${x.kind}</td><td><div class="row"><button class="small danger" data-del-${x.kind}="${x.id}">Remove data</button>
      <button class="small ghost" data-keep-${x.kind}="${x.id}">Cancel request</button></div></td></tr>`).join("")
      : `<tr><td colspan="5" class="muted">No delete requests.</td></tr>`);
  const wire = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(Object.values(b.dataset)[0])));
  wire("[data-del-customer]", async (id) => { if (confirm("Delete this customer's profile and wallet?")) {
    const b = writeBatch(db); b.delete(doc(db, "customers", id)); b.delete(doc(db, "wallets", id)); await b.commit(); } });
  wire("[data-del-worker]", async (id) => { if (confirm("Delete this worker's profile, documents and wallet?")) {
    const b = writeBatch(db); b.delete(doc(db, "workers", id)); b.delete(doc(db, "workerDocs", id)); b.delete(doc(db, "wallets", id)); await b.commit(); } });
  wire("[data-keep-customer]", (id) => updateDoc(doc(db, "customers", id), { deleteRequested: false }));
  wire("[data-keep-worker]", (id) => updateDoc(doc(db, "workers", id), { deleteRequested: false }));
}

/* ---------- settings ---------- */
function renderSettings() {
  $("sVisit").value = Math.round((settings.visitCommission ?? 0.5) * 100);
  $("sJob").value = (settings.jobCommission ?? 0.05) * 100;
  $("sDue").value = settings.dueLimit ?? 200;
  $("sRadius").value = settings.radiusKm ?? 15;
  $("sSupport").value = settings.supportPhone ?? "";
}
$("saveSettings").onclick = async () => {
  await setDoc(doc(db, "settings", "app"), {
    visitCommission: Number($("sVisit").value) / 100,
    jobCommission: Number($("sJob").value) / 100,
    dueLimit: Number($("sDue").value),
    radiusKm: Number($("sRadius").value),
    supportPhone: $("sSupport").value.replace(/[^0-9+]/g, ""),
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
