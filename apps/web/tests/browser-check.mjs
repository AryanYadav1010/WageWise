// npm run test:browser (with `npm run dev` running)
// Drives the real app in headless Chrome over the DevTools protocol: real API, database and model.
// No browser library needed. Set CHROME_PATH to use another Chrome; pass a folder to keep screenshots.
// Makes 10 chat requests, the per-minute limit, so leave a minute between runs.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9347;
const shots = process.argv[2];
const profile = mkdtempSync(join(tmpdir(), "wagewise-browser-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let passed = 0;
const failed = [];
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed.push(name);
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
}

async function openPage() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = pages.find(entry => entry.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Chrome did not start");
}

const socket = new WebSocket(await openPage());
await new Promise(resolve => socket.addEventListener("open", resolve));
const pending = new Map();
const errors = [];
const chatBodies = [];
let nextId = 0;
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message.result ?? message.error);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(JSON.stringify(message.params.args.map(arg => arg.value)));
  if (message.method === "Network.requestWillBeSent" && message.params.request.url.endsWith("/api/chat") && message.params.request.method === "POST") chatBodies.push(JSON.parse(message.params.request.postData));
});
const send = (method, params = {}) => new Promise(resolve => {
  nextId += 1;
  pending.set(nextId, resolve);
  socket.send(JSON.stringify({ id: nextId, method, params }));
});
const run = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (expression, timeoutMs = 25_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await run(expression)) return true;
    await sleep(100);
  }
  return false;
};

const turnCount = () => run(`document.querySelectorAll("section[data-turn]").length`);
const lastTurn = () => run(`[...document.querySelectorAll("section[data-turn]")].at(-1)?.innerText ?? ""`);
const settled = `!document.querySelector("section[data-turn] [role=status]")`;

async function ask(question) {
  const before = await turnCount();
  await run(`(() => {
    const box = document.querySelector("#question");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(question)});
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(`!document.querySelector('button[aria-label="Ask"]')?.disabled`, 2_000);
  await run(`document.querySelector('button[aria-label="Ask"]').click()`);
  await waitFor(`document.querySelectorAll("section[data-turn]").length > ${before} && ${settled}`);
  return lastTurn();
}
const clickButton = name => run(`[...document.querySelectorAll("button")].find(button => button.offsetParent !== null && button.textContent.trim() === ${JSON.stringify(name)})?.click()`);
const screenshot = async name => {
  if (shots !== undefined) writeFileSync(join(shots, `${name}.png`), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
};

async function open(width, height, scheme, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.navigate", { url: APP });
  await waitFor(`document.querySelector("#question") !== null`);
}

try {
  await Promise.all([send("Runtime.enable"), send("Network.enable"), send("Page.enable")]);

  console.log("Desktop, light");
  await open(1280, 800, "light", false);
  const first = await ask("What is the higher rate in Scotland?");
  check("answers with the Scottish rate", first.includes("42%"), first);
  check("sends no history on the first question", chatBodies.at(-1)?.history.length === 0);
  check("offers New conversation", await run(`[...document.querySelectorAll("button")].some(button => button.offsetParent !== null && button.textContent.trim() === "New conversation")`));

  const second = await ask("What about England?");
  check("resolves a change of nation", second.includes("40%") && second.includes("Answering: What is the higher rate? (England)"), second);
  check("says the nation changed", second.includes("Your last question was about Scotland"), second);

  const compared = await ask("Compare the two.");
  check("compares both sides", compared.includes("Comparing:") && compared.includes("42%") && compared.includes("40%"), compared);

  await run(`(() => {
    const select = document.querySelector("form:has(#question) select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "england");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const conflict = await ask("What about Wales?");
  check("asks when the question and the selection disagree", conflict.includes("different part of the UK") && conflict.includes("Use Wales"), conflict);

  const before = await turnCount();
  await clickButton("Use Wales");
  await waitFor(`document.querySelectorAll("section[data-turn]").length > ${before} && ${settled}`);
  const welsh = await lastTurn();
  check("Use Wales answers for Wales", welsh.includes("Wales") && welsh.includes("40%"), welsh);
  check("Use Wales changes the selector", await run(`document.querySelector("form:has(#question) select").value`) === "wales");

  const lastYear = await ask("And last tax year?");
  check("resolves a change of year", lastYear.includes("2025 to 2026"), lastYear);

  const ambiguous = await ask("What about the other one?");
  check("asks rather than guessing a reference", ambiguous.includes("not sure what that refers to"), ambiguous);

  await run(`[...document.querySelectorAll("section[data-turn]")][0].querySelector('button[aria-label^="Source"]').click()`);
  check("opens the sources for an earlier turn", await waitFor(`[...document.querySelectorAll("a")].some(link => link.href.startsWith("https://www.gov.uk/"))`, 3_000));
  await screenshot("desktop");

  const sent = JSON.stringify(chatBodies);
  check("history holds questions and nations only", chatBodies.every(body => body.history.every(turn => Object.keys(turn).sort().join() === "nation,question")));
  check("no answer text is ever sent back", !sent.includes("£43,663") && !sent.includes("£50,271"), sent);
  check("a comparison isn't remembered as a question", !sent.includes("Compare") || chatBodies.every(body => body.history.every(turn => !turn.question.startsWith("Compare"))));
  check("nothing is written to browser storage", await run(`localStorage.length + sessionStorage.length`) === 0);

  await clickButton("New conversation");
  check("New conversation clears the thread", await waitFor(`document.querySelectorAll("section[data-turn]").length === 0 && document.body.innerText.includes("What would you like to check?")`, 3_000));
  const fresh = await ask("What about Wales?");
  check("a new conversation sends no history", chatBodies.at(-1)?.history.length === 0, JSON.stringify(chatBodies.at(-1)));
  check("a new conversation remembers nothing", !fresh.includes("Answering:"), fresh);

  await clickButton("Payday budget");
  await run(`(() => {
    const select = [...document.querySelectorAll("select")].find(entry => entry.offsetParent !== null && [...entry.options].some(option => option.value === "previous_working_day"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "previous_working_day");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await clickButton("Calculate");
  check("the payday calculator still works", await waitFor(`document.body.innerText.includes("27 Nov")`, 5_000), await run(`document.body.innerText.slice(0, 400)`));

  console.log("Mobile, dark");
  await open(390, 844, "dark", true);
  const mobileFirst = await ask("What is the higher rate in Scotland?");
  check("answers on mobile", mobileFirst.includes("42%"), mobileFirst);
  const mobileSecond = await ask("What about Wales?");
  check("follows up on mobile", mobileSecond.includes("40%") && mobileSecond.includes("Answering:"), mobileSecond);
  check("New conversation is visible without opening the menu", await run(`[...document.querySelectorAll("button")].some(button => button.offsetParent !== null && button.textContent.trim() === "New conversation")`));
  check("no sideways scrolling", await run(`document.documentElement.scrollWidth <= window.innerWidth`));
  await screenshot("mobile");

  check("no console or page errors", errors.length === 0, errors.join(" | "));
} finally {
  socket.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed.length} failed`);
process.exitCode = failed.length === 0 ? 0 : 1;
