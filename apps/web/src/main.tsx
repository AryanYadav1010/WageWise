import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import App from "./App";
import "./index.css";
import { restoreTheme } from "./theme.ts";

restoreTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
