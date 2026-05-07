(function () {
  const form = document.getElementById("loginForm");
  const errorBox = document.getElementById("loginError");
  const loginButton = document.getElementById("loginButton");

  document.addEventListener("DOMContentLoaded", () => {
    checkExistingSession();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();

    const formData = new FormData(form);
    const payload = {
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || "")
    };

    loginButton.disabled = true;
    loginButton.textContent = "ç»å½ä¸­...";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "ç»å½å¤±è´¥");
      }

      window.location.href = "/admin";
    } catch (error) {
      showError(error.message || "ç»å½å¤±è´¥");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "ç»å½åå°";
    }
  });

  async function checkExistingSession() {
    try {
      const response = await fetch("/api/auth/me", {
        headers: {
          Accept: "application/json"
        }
      });
      if (response.ok) {
        window.location.href = "/admin";
      }
    } catch {
      // Ignore.
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function hideError() {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }
})();
