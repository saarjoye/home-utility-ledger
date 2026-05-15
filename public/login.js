const toast = document.querySelector("#toast");
function showToast(message) {
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => toast.style.display = "none", 3200);
}

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const res = await fetch("/api/login", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  const data = await res.json();
  if (!data.ok) {
    showToast(data.message || "登录失败");
    return;
  }
  location.href = "/index.html";
});
