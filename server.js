const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api", apiRoutes);

// Open http://localhost:PORT/ → sign-in first (do not auto-serve index.html at /).
app.get("/", (_req, res) => {
  res.redirect(302, "/login.html");
});

app.use(express.static(path.join(__dirname), { index: false }));

const server = app.listen(PORT, () => {
  console.log(`SmartSched server running at http://localhost:${PORT}`);
  console.log("Opening that URL sends you to the sign-in page (not file://). MySQL:", process.env.DB_NAME || "acadex_db");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use (another app or an old "npm start" is still running).\n\n` +
        `Fix: close that terminal, or in PowerShell run:\n` +
        `  netstat -ano | findstr :${PORT}\n` +
        `  taskkill /PID <number_from_last_column> /F\n\n` +
        `Or set a different port in your .env file: PORT=3001\n`
    );
    process.exit(1);
  }
  throw err;
});
