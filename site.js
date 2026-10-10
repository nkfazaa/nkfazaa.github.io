// English / Arabic switch. Remembers the choice; first visit follows the phone's language.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("nk-lang"); } catch (e) {}
  var lang = saved || ((navigator.language || "").toLowerCase().indexOf("ar") === 0 ? "ar" : "en");
  function apply(l) {
    document.documentElement.lang = l;
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
    var b = document.getElementById("lang");
    if (b) b.textContent = l === "ar" ? "English" : "العربية";
  }
  apply(lang);
  document.addEventListener("DOMContentLoaded", function () {
    apply(lang);
    var b = document.getElementById("lang");
    if (b) b.onclick = function () {
      lang = lang === "ar" ? "en" : "ar";
      try { localStorage.setItem("nk-lang", lang); } catch (e) {}
      apply(lang);
    };
  });
})();
