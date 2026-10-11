// Puts the colour scheme the user chose on the root element before the page is first painted, so that a dark
// scheme never starts with a light flash. A file of its own, loaded from the head: the Content-Security-Policy
// of the page refuses a script written into it. The key and the values are those of `src/lib/theme.ts`.
(function () {
  try {
    var theme = window.localStorage.getItem("smarternews.theme");
    if (theme === "light" || theme === "dark" || theme === "darkblue") document.documentElement.setAttribute("data-theme", theme);
  } catch {
    // without storage the page follows the device
  }
})();
