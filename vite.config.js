import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the GitHub repo name for Pages:
// https://tanvidhuria.github.io/finlearn/
export default defineConfig({
  plugins: [react()],
  base: "/finlearn/",
});
