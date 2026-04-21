async function login(e) {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data.error ||
        (res.status === 401
          ? "Invalid username or password. Admin: admin / 1234. Faculty demo: prof.turing / 1234."
          : "Login failed. Check the server terminal for errors.");
      alert(msg);
      return;
    }
    localStorage.setItem("acadex_token", data.token);
    localStorage.setItem("loggedIn", "true");
    if (data.user) {
      localStorage.setItem("acadex_user", JSON.stringify(data.user));
    }
    window.location.href = "index.html";
  } catch {
    alert(
      "Cannot reach the server. Start the app (npm start) and open http://localhost:3000 (not a file:// page)."
    );
  }
}