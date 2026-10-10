// Test-only fake Firebase with made-up data, to check the admin layout.
const ts = (daysAgo, h = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return { toDate: () => d, seconds: d.getTime() / 1000 }; };
const cats = ["ac", "plumbing", "electric", "car", "appliances", "cleaning"];
const W = [
  { id: "w1", name: "Rahim Uddin", phone: "+966500000101", status: "approved", online: true, skills: ["ac", "electric"], rating: 4.8, ratingCount: 12, jobsDone: 14, due: 85, location: { latitude: 21.55, longitude: 39.17 }, createdAt: ts(30) },
  { id: "w2", name: "Al Noor Maintenance", accountType: "company", contactName: "Khalid", crNumber: "4030123456", phone: "+966500000102", status: "approved", online: true, skills: ["car", "appliances"], rating: 4.5, ratingCount: 6, jobsDone: 7, due: 240, location: { latitude: 21.5, longitude: 39.2 }, createdAt: ts(20) },
  { id: "w3", name: "Sajid Khan", phone: "+966500000103", status: "pending", skills: ["plumbing"], iqamaExpiry: ts(-200), createdAt: ts(1) },
  { id: "w4", name: "Old Account", phone: "+966500000104", status: "approved", skills: ["cleaning"], deleteRequested: true, deleteRequestedAt: ts(2), rating: 4, createdAt: ts(60) },
];
const C = [
  { id: "c1", name: "Morium", phone: "+966500000002", createdAt: ts(10) },
  { id: "c2", name: "Fatima", phone: "+966500000005", createdAt: ts(5), deleteRequested: true, deleteRequestedAt: ts(1) },
];
const J = [];
for (let i = 0; i < 40; i++) {
  const done = i % 5 !== 0;
  J.push({ id: "j" + i, category: cats[i % cats.length], serviceNameEn: ["AC cleaning (split unit)", "Blocked drain", "Light installation", "Car battery change (at your place)", "Fridge gas refill", "Apartment cleaning (4 hours)"][i % 6],
    customerId: i % 2 ? "c1" : "c2", customerName: i % 2 ? "Morium" : "Fatima", customerPhone: "+9665000000" + (i % 2 ? "02" : "05"),
    workerId: done ? (i % 3 ? "w1" : "w2") : null, workerName: done ? (i % 3 ? "Rahim Uddin" : "Al Noor Maintenance") : "",
    status: done ? (i % 7 ? "completed" : "visit_only") : (i === 0 ? "requested" : "on_the_way"), price: 100 + (i % 4) * 50, visitFee: 30,
    paidByCustomer: done ? 130 + (i % 4) * 50 : null, commission: done ? 15 + (i % 4) * 2.5 : null, rating: done ? 4 + (i % 2) : null,
    createdAt: ts(i % 14, 9), finishedAt: done ? ts(i % 14, 12) : null, location: { latitude: 21.5 + (i % 5) / 50, longitude: 39.15 + (i % 3) / 40 } });
}
const DATA = {
  workers: W, customers: C, jobs: J, services: [], payments: [{ id: "p1", workerId: "w1", workerName: "Rahim Uddin", amount: 100, createdAt: ts(3) }],
  wallets: [{ id: "c1", balance: 50, updatedAt: ts(2) }],
  walletRequests: [{ id: "r1", uid: "c1", role: "customer", amount: 50, iban: "SA0380000000608010167519", accountName: "Morium", bankName: "Al Rajhi", status: "pending", createdAt: ts(0) }],
};
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (_a, cb) => setTimeout(() => cb({ uid: "admin1", phoneNumber: "+966500000003" }), 10);
export class RecaptchaVerifier {}
export const signInWithPhoneNumber = async () => ({});
export const signOut = async () => {};
export const getFirestore = () => ({});
export const collection = (_db, name) => ({ name });
export const doc = (_db, name, id) => (typeof _db === "object" && _db.name && !name ? { name: _db.name, id: "new" } : { name, id });
export const getDoc = async (r) => ({ exists: () => true, data: () => (r.name === "workerDocs" ? { iqamaNo: "2400000000" } : {}) });
export const onSnapshot = (r, cb) => {
  setTimeout(() => {
    if (r.id) cb({ data: () => (r.name === "settings" ? { visitCommission: 0.5, jobCommission: 0.05, dueLimit: 200, radiusKm: 15, supportPhone: "+966534558168" } : {}) });
    else cb({ docs: (DATA[r.name] || []).map((x) => ({ id: x.id, data: () => x })) });
  }, 20);
  return () => {};
};
export const query = (x) => x, where = () => ({});
const log = (...a) => console.log("[mock write]", ...a);
export const setDoc = async (...a) => log("set", ...a), updateDoc = async (...a) => log("update", ...a), addDoc = async (...a) => log("add", ...a), deleteDoc = async (...a) => log("delete", ...a);
export const writeBatch = () => ({ set: log, update: log, delete: log, commit: async () => log("commit") });
export const serverTimestamp = () => "ts", increment = (n) => ({ inc: n });
export const Timestamp = {};
