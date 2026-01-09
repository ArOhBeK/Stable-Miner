const sessionKey = "stableminer-wallet-session";
const autoKey = "stableminer-autoswap";

const state = {
  sessionId: null,
  mode: "auto",
  status: null,
  quote: null,
  busy: false,
  auto: {
    enabled: false,
    ergAmount: "",
    cooldownSec: 300,
    lpBandPercent: 2,
    requireBand: true,
    triggerFree: true,
    triggerArb: true,
    useTarget: "",
    useTargetOp: "lte",
    ergTarget: "",
    ergTargetOp: "lte",
    lastRun: 0,
    lastTx: null,
    inFlight: false
  }
};

let refreshTimer = null;
let toastTimer = null;

const elements = {
  dexyStatusDot: document.getElementById("dexyStatusDot"),
  dexyStatusLabel: document.getElementById("dexyStatusLabel"),
  dexyStatusNote: document.getElementById("dexyStatusNote"),
  mintStatusDot: document.getElementById("mintStatusDot"),
  mintStatusLabel: document.getElementById("mintStatusLabel"),
  telemetryDot: document.getElementById("telemetryDot"),
  telemetryLabel: document.getElementById("telemetryLabel"),
  telemetryNote: document.getElementById("telemetryNote"),
  swapErgAmount: document.getElementById("swapErgAmount"),
  swapPreview: document.getElementById("swapPreview"),
  swapMint: document.getElementById("swapMint"),
  quoteUse: document.getElementById("quoteUse"),
  quoteBank: document.getElementById("quoteBank"),
  quoteBuyback: document.getElementById("quoteBuyback"),
  quoteFee: document.getElementById("quoteFee"),
  quoteTotal: document.getElementById("quoteTotal"),
  quoteMode: document.getElementById("quoteMode"),
  dexyWallet: document.getElementById("dexyWallet"),
  dexyNetwork: document.getElementById("dexyNetwork"),
  dexyHeight: document.getElementById("dexyHeight"),
  dexyOracle: document.getElementById("dexyOracle"),
  dexyLpPrice: document.getElementById("dexyLpPrice"),
  dexyFreeStatus: document.getElementById("dexyFreeStatus"),
  dexyFreeAvailable: document.getElementById("dexyFreeAvailable"),
  dexyArbStatus: document.getElementById("dexyArbStatus"),
  dexyArbAvailable: document.getElementById("dexyArbAvailable"),
  dexyErgOracle: document.getElementById("dexyErgOracle"),
  dexyErgLp: document.getElementById("dexyErgLp"),
  dexyLpDiff: document.getElementById("dexyLpDiff"),
  swapToast: document.getElementById("swapToast"),
  reviewModal: document.getElementById("reviewModal"),
  reviewConfirm: document.getElementById("reviewConfirm"),
  reviewMode: document.getElementById("reviewMode"),
  reviewErgInput: document.getElementById("reviewErgInput"),
  reviewUse: document.getElementById("reviewUse"),
  reviewBank: document.getElementById("reviewBank"),
  reviewBuyback: document.getElementById("reviewBuyback"),
  reviewFee: document.getElementById("reviewFee"),
  reviewTotal: document.getElementById("reviewTotal"),
  reviewUnused: document.getElementById("reviewUnused"),
  reviewNetwork: document.getElementById("reviewNetwork"),
  reviewWallet: document.getElementById("reviewWallet"),
  successModal: document.getElementById("successModal"),
  successTxId: document.getElementById("successTxId"),
  successExplorer: document.getElementById("successExplorer"),
  successMode: document.getElementById("successMode"),
  successInput: document.getElementById("successInput"),
  successUse: document.getElementById("successUse"),
  successTotal: document.getElementById("successTotal"),
  autoStatusDot: document.getElementById("autoStatusDot"),
  autoStatusLabel: document.getElementById("autoStatusLabel"),
  autoToggle: document.getElementById("autoToggle"),
  autoCheck: document.getElementById("autoCheck"),
  autoErgAmount: document.getElementById("autoErgAmount"),
  autoCooldown: document.getElementById("autoCooldown"),
  autoLpBand: document.getElementById("autoLpBand"),
  autoUseTarget: document.getElementById("autoUseTarget"),
  autoUseTargetOp: document.getElementById("autoUseTargetOp"),
  autoErgTarget: document.getElementById("autoErgTarget"),
  autoErgTargetOp: document.getElementById("autoErgTargetOp"),
  autoFree: document.getElementById("autoFree"),
  autoArb: document.getElementById("autoArb"),
  autoBand: document.getElementById("autoBand"),
  autoNextAction: document.getElementById("autoNextAction"),
  autoLastRun: document.getElementById("autoLastRun"),
  autoLastTx: document.getElementById("autoLastTx"),
  autoNote: document.getElementById("autoNote")
};

function getErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  const raw = typeof error.message === "string" ? error.message : String(error);
  if (raw && raw.startsWith("HTTP") && raw.includes("{")) {
    const jsonStart = raw.indexOf("{");
    const jsonPayload = raw.slice(jsonStart);
    try {
      const parsed = JSON.parse(jsonPayload);
      if (parsed && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch (parseError) {
      // Ignore parsing failures and fall through.
    }
  }
  if (raw && raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch (parseError) {
      // Fall back to the raw message.
    }
  }
  return raw || fallback;
}

function getBridge() {
  return window.stableMinerBridge || null;
}

function showToast(message) {
  if (!message) {
    return;
  }
  const trimmed =
    message.length > 220 ? `${message.slice(0, 217)}...` : message;
  elements.swapToast.textContent = trimmed;
  elements.swapToast.classList.add("show");
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    elements.swapToast.classList.remove("show");
  }, 2200);
}

function truncateAddress(address) {
  if (!address || address.length < 12) {
    return address || "--";
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatUnit(value, unit) {
  if (value === undefined || value === null || value === "" || value === "--") {
    return "--";
  }
  return `${value} ${unit}`;
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function invertPrice(value) {
  const price = parseNumber(value);
  if (!price || price <= 0) {
    return null;
  }
  return 1 / price;
}

function formatErgPrice(value) {
  const inverted = invertPrice(value);
  if (!inverted) {
    return "--";
  }
  return `${inverted.toFixed(4)} USE`;
}

function percentDiff(a, b) {
  if (!a || !b) {
    return null;
  }
  return Math.abs(a - b) / b * 100;
}

function compareTarget(actual, target, op) {
  if (actual === null || target === null) {
    return { ok: true, active: false };
  }
  const useTarget = target > 0;
  if (!useTarget) {
    return { ok: true, active: false };
  }
  if (op === "gte") {
    return { ok: actual >= target, active: true };
  }
  return { ok: actual <= target, active: true };
}

function updateMintActionState(isReady) {
  const ready = Boolean(isReady);
  elements.swapPreview.disabled = state.busy || !ready;
  elements.swapMint.disabled = state.busy || !ready || !state.quote;
  if (elements.reviewConfirm) {
    elements.reviewConfirm.disabled = state.busy;
  }
}

function setBusy(isBusy) {
  state.busy = isBusy;
  updateMintActionState(state.status && state.status.dexyReady);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".segment[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function setStatus(status) {
  state.status = status;
  if (!status || !status.connected) {
    elements.dexyStatusDot.classList.remove("on", "warning");
    elements.dexyStatusDot.classList.add("warning");
    elements.dexyStatusLabel.textContent = "Disconnected";
    elements.dexyStatusNote.textContent = "Connect the node wallet on the dashboard first.";
    elements.telemetryDot.classList.remove("on", "warning");
    elements.telemetryDot.classList.add("warning");
    elements.telemetryLabel.textContent = "Offline";
    elements.telemetryNote.textContent = "Dexy data unavailable.";
    elements.mintStatusDot.classList.remove("on", "warning");
    elements.mintStatusDot.classList.add("warning");
    elements.mintStatusLabel.textContent = "Unavailable";
    updateMintActionState(false);
    applyQuote(null);
    updateTelemetry(null);
    return;
  }

  if (status.dexyReady === false) {
    elements.dexyStatusDot.classList.remove("on", "warning");
    elements.dexyStatusDot.classList.add("warning");
    elements.dexyStatusLabel.textContent = "Wallet connected";
    elements.dexyStatusNote.textContent = status.error
      ? `Dexy unavailable: ${status.error}`
      : "Dexy contracts unavailable.";
    elements.telemetryDot.classList.remove("on", "warning");
    elements.telemetryDot.classList.add("warning");
    elements.telemetryLabel.textContent = "Unavailable";
    elements.telemetryNote.textContent = "Dexy data unavailable.";
    elements.mintStatusDot.classList.remove("on", "warning");
    elements.mintStatusDot.classList.add("warning");
    elements.mintStatusLabel.textContent = "Locked";
    updateMintActionState(false);
    applyQuote(null);
    updateTelemetry(status);
    return;
  }

  elements.dexyStatusDot.classList.remove("warning");
  elements.dexyStatusDot.classList.add("on");
  elements.dexyStatusLabel.textContent = "Connected";
  elements.dexyStatusNote.textContent = "Dexy contracts are reachable.";
  elements.telemetryDot.classList.remove("warning");
  elements.telemetryDot.classList.add("on");
  elements.telemetryLabel.textContent = "Live";
  elements.telemetryNote.textContent = "Dexy metrics refresh every 15 seconds.";
  elements.mintStatusDot.classList.remove("warning");
  elements.mintStatusDot.classList.add("on");
  elements.mintStatusLabel.textContent = "Ready";
  updateMintActionState(true);
  updateTelemetry(status);
}

function updateTelemetry(status) {
  if (!status) {
    elements.dexyWallet.textContent = "--";
    elements.dexyNetwork.textContent = "--";
    elements.dexyHeight.textContent = "--";
    elements.dexyOracle.textContent = "--";
    elements.dexyLpPrice.textContent = "--";
    elements.dexyFreeStatus.textContent = "--";
    elements.dexyFreeAvailable.textContent = "--";
    elements.dexyArbStatus.textContent = "--";
    elements.dexyArbAvailable.textContent = "--";
    elements.dexyErgOracle.textContent = "--";
    elements.dexyErgLp.textContent = "--";
    elements.dexyLpDiff.textContent = "--";
    return;
  }
  elements.dexyWallet.textContent = truncateAddress(status.address);
  elements.dexyNetwork.textContent = status.network || "--";
  if (!status.dexyReady) {
    elements.dexyHeight.textContent = "--";
    elements.dexyOracle.textContent = "--";
    elements.dexyLpPrice.textContent = "--";
    elements.dexyFreeStatus.textContent = "--";
    elements.dexyFreeAvailable.textContent = "--";
    elements.dexyArbStatus.textContent = "--";
    elements.dexyArbAvailable.textContent = "--";
    elements.dexyErgOracle.textContent = "--";
    elements.dexyErgLp.textContent = "--";
    elements.dexyLpDiff.textContent = "--";
    return;
  }
  elements.dexyHeight.textContent = status.height ? `${status.height}` : "--";
  elements.dexyOracle.textContent = status.oraclePriceErg
    ? `${status.oraclePriceErg} ERG`
    : "--";
  elements.dexyLpPrice.textContent = status.lpPriceErg ? `${status.lpPriceErg} ERG` : "--";
  elements.dexyFreeStatus.textContent = status.freeMint?.eligible ? "Eligible" : "Locked";
  elements.dexyFreeAvailable.textContent = status.freeMint?.available || "--";
  elements.dexyArbStatus.textContent = status.arbMint?.eligible ? "Eligible" : "Locked";
  elements.dexyArbAvailable.textContent = status.arbMint?.available || "--";
  elements.dexyErgOracle.textContent = formatErgPrice(status.oraclePriceErg);
  elements.dexyErgLp.textContent = formatErgPrice(status.lpPriceErg);
  const oracle = parseNumber(status.oraclePriceErg);
  const lp = parseNumber(status.lpPriceErg);
  if (oracle && lp) {
    const premium = ((lp - oracle) / oracle) * 100;
    const sign = premium > 0 ? "+" : "";
    elements.dexyLpDiff.textContent = `${sign}${premium.toFixed(2)}%`;
  } else {
    elements.dexyLpDiff.textContent = "--";
  }
}

function applyQuote(quote) {
  state.quote = quote;
  if (!quote) {
    elements.quoteUse.textContent = "--";
    elements.quoteBank.textContent = "--";
    elements.quoteBuyback.textContent = "--";
    elements.quoteFee.textContent = "--";
    elements.quoteTotal.textContent = "--";
    elements.quoteMode.textContent = "--";
    updateMintActionState(state.status && state.status.dexyReady);
    return;
  }
  elements.quoteUse.textContent = `${quote.useMinted} USE`;
  elements.quoteBank.textContent = `${quote.bankErg} ERG`;
  elements.quoteBuyback.textContent = `${quote.buybackErg} ERG`;
  elements.quoteFee.textContent = `${quote.feeErg} ERG`;
  elements.quoteTotal.textContent = `${quote.totalErg} ERG`;
  elements.quoteMode.textContent = quote.mode ? quote.mode.toUpperCase() : "--";
  updateMintActionState(state.status && state.status.dexyReady);
}

function loadAutoConfig() {
  const raw = localStorage.getItem(autoKey);
  if (!raw) {
    return;
  }
  try {
    const config = JSON.parse(raw);
    state.auto.enabled = Boolean(config.enabled);
    state.auto.ergAmount =
      typeof config.ergAmount === "string" ? config.ergAmount : state.auto.ergAmount;
    state.auto.cooldownSec = Number.isFinite(Number(config.cooldownSec))
      ? Number(config.cooldownSec)
      : state.auto.cooldownSec;
    state.auto.lpBandPercent = Number.isFinite(Number(config.lpBandPercent))
      ? Number(config.lpBandPercent)
      : state.auto.lpBandPercent;
    state.auto.requireBand = config.requireBand !== undefined
      ? Boolean(config.requireBand)
      : state.auto.requireBand;
    state.auto.triggerFree = config.triggerFree !== undefined
      ? Boolean(config.triggerFree)
      : state.auto.triggerFree;
    state.auto.triggerArb = config.triggerArb !== undefined
      ? Boolean(config.triggerArb)
      : state.auto.triggerArb;
    state.auto.useTarget =
      typeof config.useTarget === "string" ? config.useTarget : state.auto.useTarget;
    state.auto.useTargetOp =
      config.useTargetOp === "gte" || config.useTargetOp === "lte"
        ? config.useTargetOp
        : state.auto.useTargetOp;
    state.auto.ergTarget =
      typeof config.ergTarget === "string" ? config.ergTarget : state.auto.ergTarget;
    state.auto.ergTargetOp =
      config.ergTargetOp === "gte" || config.ergTargetOp === "lte"
        ? config.ergTargetOp
        : state.auto.ergTargetOp;
  } catch (error) {
    // Ignore invalid config and keep defaults.
  }
}

function saveAutoConfig() {
  const config = {
    enabled: state.auto.enabled,
    ergAmount: state.auto.ergAmount,
    cooldownSec: state.auto.cooldownSec,
    lpBandPercent: state.auto.lpBandPercent,
    requireBand: state.auto.requireBand,
    triggerFree: state.auto.triggerFree,
    triggerArb: state.auto.triggerArb,
    useTarget: state.auto.useTarget,
    useTargetOp: state.auto.useTargetOp,
    ergTarget: state.auto.ergTarget,
    ergTargetOp: state.auto.ergTargetOp
  };
  localStorage.setItem(autoKey, JSON.stringify(config));
}

function formatTimestamp(ts) {
  if (!ts) {
    return "--";
  }
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

function setAutoLastTx(txId) {
  if (!elements.autoLastTx) {
    return;
  }
  if (!txId) {
    elements.autoLastTx.textContent = "--";
    elements.autoLastTx.removeAttribute("href");
    return;
  }
  elements.autoLastTx.textContent = txId;
  elements.autoLastTx.href = `https://ergexplorer.com/transactions#${txId}`;
}

function updateAutoInputs() {
  if (!elements.autoErgAmount) {
    return;
  }
  elements.autoErgAmount.value = state.auto.ergAmount;
  elements.autoCooldown.value = `${state.auto.cooldownSec}`;
  elements.autoLpBand.value = `${state.auto.lpBandPercent}`;
  elements.autoLpBand.disabled = !state.auto.requireBand;
  if (elements.autoUseTarget) {
    elements.autoUseTarget.value = state.auto.useTarget;
  }
  if (elements.autoUseTargetOp) {
    elements.autoUseTargetOp.value = state.auto.useTargetOp;
  }
  if (elements.autoErgTarget) {
    elements.autoErgTarget.value = state.auto.ergTarget;
  }
  if (elements.autoErgTargetOp) {
    elements.autoErgTargetOp.value = state.auto.ergTargetOp;
  }
  elements.autoFree.checked = state.auto.triggerFree;
  elements.autoArb.checked = state.auto.triggerArb;
  elements.autoBand.checked = state.auto.requireBand;
  if (elements.autoToggle) {
    elements.autoToggle.textContent = state.auto.enabled
      ? "Disable auto swap"
      : "Enable auto swap";
  }
}

function setAutoStatus(label, dotState) {
  if (!elements.autoStatusLabel || !elements.autoStatusDot) {
    return;
  }
  elements.autoStatusLabel.textContent = label;
  elements.autoStatusDot.classList.remove("on", "warning", "running");
  if (dotState) {
    elements.autoStatusDot.classList.add(dotState);
  }
}

function updateAutoSummary() {
  if (!elements.autoNextAction || !elements.autoLastRun) {
    return;
  }
  elements.autoLastRun.textContent = formatTimestamp(state.auto.lastRun);
  setAutoLastTx(state.auto.lastTx);
}

function syncAutoFromInputs() {
  if (!elements.autoErgAmount) {
    return;
  }
  state.auto.ergAmount = elements.autoErgAmount.value.trim();
  const cooldown = parseNumber(elements.autoCooldown.value);
  state.auto.cooldownSec = cooldown && cooldown > 0 ? Math.max(30, cooldown) : 300;
  const band = parseNumber(elements.autoLpBand.value);
  state.auto.lpBandPercent = band !== null && band >= 0 ? band : 2;
  state.auto.triggerFree = elements.autoFree.checked;
  state.auto.triggerArb = elements.autoArb.checked;
  state.auto.requireBand = elements.autoBand.checked;
  elements.autoLpBand.disabled = !state.auto.requireBand;
  if (elements.autoUseTarget) {
    state.auto.useTarget = elements.autoUseTarget.value.trim();
  }
  if (elements.autoUseTargetOp) {
    state.auto.useTargetOp = elements.autoUseTargetOp.value;
  }
  if (elements.autoErgTarget) {
    state.auto.ergTarget = elements.autoErgTarget.value.trim();
  }
  if (elements.autoErgTargetOp) {
    state.auto.ergTargetOp = elements.autoErgTargetOp.value;
  }
  saveAutoConfig();
}

function getAutoErgAmount() {
  const manual = elements.swapErgAmount.value.trim();
  return state.auto.ergAmount || manual || "";
}

function evaluateAutoConditions(status) {
  const freeOk = Boolean(state.auto.triggerFree && status?.freeMint?.eligible);
  const arbOk = Boolean(state.auto.triggerArb && status?.arbMint?.eligible);
  const hasTrigger = freeOk || arbOk;

  const oracle = parseNumber(status?.oraclePriceErg);
  const lp = parseNumber(status?.lpPriceErg);
  const lpDiff = oracle && lp ? percentDiff(lp, oracle) : null;
  const bandOk = !state.auto.requireBand
    ? true
    : lpDiff !== null && lpDiff <= state.auto.lpBandPercent;

  let mode = "auto";
  if (freeOk && !arbOk) {
    mode = "free";
  } else if (arbOk && !freeOk) {
    mode = "arbitrage";
  }

  const usePrice = oracle;
  const ergPrice = invertPrice(oracle);
  const useTarget = parseNumber(state.auto.useTarget);
  const ergTarget = parseNumber(state.auto.ergTarget);
  const useCompare = compareTarget(usePrice, useTarget, state.auto.useTargetOp);
  const ergCompare = compareTarget(ergPrice, ergTarget, state.auto.ergTargetOp);

  return {
    freeOk,
    arbOk,
    lpDiff,
    bandOk,
    hasTrigger,
    mode,
    usePrice,
    ergPrice,
    useTarget,
    ergTarget,
    useCompare,
    ergCompare
  };
}

function updateAutoUI(status) {
  if (!elements.autoStatusLabel) {
    return;
  }
  if (elements.autoNote) {
    elements.autoNote.textContent =
      "Auto swap checks every 15 seconds while this page is open.";
  }
  if (!state.auto.enabled) {
    setAutoStatus("Off", "warning");
    elements.autoNextAction.textContent = "Disabled";
    updateAutoSummary();
    return;
  }
  if (!status || !status.connected || !status.dexyReady) {
    setAutoStatus("Waiting", "warning");
    elements.autoNextAction.textContent = "Connect wallet for Dexy data.";
    updateAutoSummary();
    return;
  }
  if (state.auto.inFlight) {
    setAutoStatus("Minting", "running");
    elements.autoNextAction.textContent = "Minting now...";
    updateAutoSummary();
    return;
  }

  const cooldownMs = state.auto.cooldownSec * 1000;
  const now = Date.now();
  const remaining = state.auto.lastRun
    ? Math.max(0, cooldownMs - (now - state.auto.lastRun))
    : 0;
  if (remaining > 0) {
    setAutoStatus("Cooldown", "warning");
    elements.autoNextAction.textContent = `Cooldown ${Math.ceil(remaining / 1000)}s`;
    updateAutoSummary();
    return;
  }

  const evaluation = evaluateAutoConditions(status);
  if (elements.autoNote && evaluation.lpDiff !== null) {
    const targetHint =
      evaluation.useCompare.active || evaluation.ergCompare.active
        ? " Targets use the oracle price."
        : "";
    elements.autoNote.textContent =
      `LP vs oracle difference: ${evaluation.lpDiff.toFixed(2)}%.${targetHint}`;
  }
  if (!state.auto.triggerFree && !state.auto.triggerArb) {
    setAutoStatus("Waiting", "warning");
    elements.autoNextAction.textContent = "Select a mint trigger.";
    updateAutoSummary();
    return;
  }
  if (evaluation.useCompare.active && !evaluation.useCompare.ok) {
    setAutoStatus("Waiting", "warning");
    const direction = state.auto.useTargetOp === "gte" ? "above" : "below";
    elements.autoNextAction.textContent =
      `USE price not ${direction} target (${state.auto.useTarget}).`;
    updateAutoSummary();
    return;
  }
  if (evaluation.ergCompare.active && !evaluation.ergCompare.ok) {
    setAutoStatus("Waiting", "warning");
    const direction = state.auto.ergTargetOp === "gte" ? "above" : "below";
    elements.autoNextAction.textContent =
      `ERG price not ${direction} target (${state.auto.ergTarget}).`;
    updateAutoSummary();
    return;
  }
  if (!evaluation.hasTrigger) {
    setAutoStatus("Waiting", "warning");
    elements.autoNextAction.textContent = "No mint condition met.";
    updateAutoSummary();
    return;
  }
  if (!evaluation.bandOk) {
    setAutoStatus("Waiting", "warning");
    elements.autoNextAction.textContent = `LP band exceeds ${state.auto.lpBandPercent}%`;
    updateAutoSummary();
    return;
  }

  setAutoStatus("Ready", "on");
  elements.autoNextAction.textContent = `Ready (${evaluation.mode.toUpperCase()})`;
  updateAutoSummary();
}

async function runAutoSwap(force = false) {
  const bridge = getBridge();
  if (!bridge || !state.sessionId) {
    return;
  }
  syncAutoFromInputs();
  if (!state.auto.enabled || state.auto.inFlight || state.busy) {
    return;
  }
  const status = state.status;
  if (!status || !status.connected || !status.dexyReady) {
    updateAutoUI(status);
    return;
  }
  const cooldownMs = state.auto.cooldownSec * 1000;
  const now = Date.now();
  if (!force && state.auto.lastRun && now - state.auto.lastRun < cooldownMs) {
    updateAutoUI(status);
    return;
  }

  const evaluation = evaluateAutoConditions(status);
  updateAutoUI(status);
  if (
    !evaluation.hasTrigger ||
    !evaluation.bandOk ||
    (evaluation.useCompare.active && !evaluation.useCompare.ok) ||
    (evaluation.ergCompare.active && !evaluation.ergCompare.ok)
  ) {
    return;
  }

  const ergAmount = getAutoErgAmount();
  if (!ergAmount) {
    elements.autoNextAction.textContent = "Set an ERG amount.";
    return;
  }

  state.auto.lastRun = Date.now();
  state.auto.inFlight = true;
  setBusy(true);
  updateAutoUI(status);
  try {
    const quote = await bridge.getDexyQuote({
      sessionId: state.sessionId,
      ergAmount,
      mode: evaluation.mode
    });
    applyQuote(quote);
    const result = await bridge.mintDexy({
      sessionId: state.sessionId,
      ergAmount,
      mode: evaluation.mode
    });
    state.auto.lastRun = Date.now();
    state.auto.lastTx = result?.txId || null;
    showToast(result?.txId ? `Auto mint ${result.txId}` : "Auto mint broadcasted.");
  } catch (error) {
    showToast(getErrorMessage(error, "Auto mint failed."));
  } finally {
    state.auto.inFlight = false;
    setBusy(false);
    updateAutoUI(state.status);
  }
}

function openModal(modal) {
  if (!modal) {
    return;
  }
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  if (!modal) {
    return;
  }
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-backdrop.show")) {
    document.body.classList.remove("modal-open");
  }
}

function populateReviewModal(quote, ergAmount) {
  if (!quote) {
    return;
  }
  const ergInput = quote.ergInput || ergAmount;
  elements.reviewMode.textContent = quote.mode ? quote.mode.toUpperCase() : "--";
  elements.reviewErgInput.textContent = formatUnit(ergInput, "ERG");
  elements.reviewUse.textContent = formatUnit(quote.useMinted, "USE");
  elements.reviewBank.textContent = formatUnit(quote.bankErg, "ERG");
  elements.reviewBuyback.textContent = formatUnit(quote.buybackErg, "ERG");
  elements.reviewFee.textContent = formatUnit(quote.feeErg, "ERG");
  elements.reviewTotal.textContent = formatUnit(quote.totalErg, "ERG");
  elements.reviewUnused.textContent = formatUnit(quote.ergUnused, "ERG");
  elements.reviewNetwork.textContent = state.status?.network || "--";
  elements.reviewWallet.textContent = state.status?.address || "--";
}

function openReviewModal() {
  const quote = state.quote;
  if (!quote) {
    showToast("Preview a mint first.");
    return;
  }
  const ergAmount = elements.swapErgAmount.value.trim();
  populateReviewModal(quote, ergAmount);
  closeModal(elements.successModal);
  openModal(elements.reviewModal);
}

function populateSuccessModal(result, ergAmount) {
  const quote = result?.quote || state.quote;
  const txId = result?.txId || "";
  elements.successTxId.textContent = txId || "--";
  if (txId) {
    elements.successExplorer.href = `https://ergexplorer.com/transactions#${txId}`;
    elements.successExplorer.textContent = "View on Explorer";
  } else {
    elements.successExplorer.removeAttribute("href");
    elements.successExplorer.textContent = "Explorer link unavailable";
  }
  if (quote) {
    const ergInput = quote.ergInput || ergAmount;
    elements.successMode.textContent = quote.mode ? quote.mode.toUpperCase() : "--";
    elements.successInput.textContent = formatUnit(ergInput, "ERG");
    elements.successUse.textContent = formatUnit(quote.useMinted, "USE");
    elements.successTotal.textContent = formatUnit(quote.totalErg, "ERG");
  } else {
    elements.successMode.textContent = "--";
    elements.successInput.textContent = "--";
    elements.successUse.textContent = "--";
    elements.successTotal.textContent = "--";
  }
}

async function refreshStatus() {
  const bridge = getBridge();
  state.sessionId = localStorage.getItem(sessionKey);
  if (!bridge || !state.sessionId) {
    setStatus(null);
    updateAutoUI(null);
    return;
  }
  try {
    const status = await bridge.getDexyStatus(state.sessionId);
    setStatus(status);
    updateAutoUI(status);
    await runAutoSwap();
  } catch (error) {
    setStatus(null);
    updateAutoUI(null);
  }
}

async function previewMint() {
  const bridge = getBridge();
  if (!bridge || !state.sessionId) {
    showToast("Connect the node wallet first.");
    return;
  }
  const ergAmount = elements.swapErgAmount.value.trim();
  if (!ergAmount) {
    showToast("Enter an ERG amount.");
    return;
  }
  elements.mintStatusLabel.textContent = "Quoting...";
  try {
    const quote = await bridge.getDexyQuote({
      sessionId: state.sessionId,
      ergAmount,
      mode: state.mode
    });
    applyQuote(quote);
    elements.mintStatusLabel.textContent = "Quoted";
    showToast("Mint quote ready.");
  } catch (error) {
    applyQuote(null);
    elements.mintStatusLabel.textContent = "Error";
    showToast(getErrorMessage(error, "Unable to quote mint."));
  }
}

async function executeMint() {
  const bridge = getBridge();
  if (!bridge || !state.sessionId) {
    showToast("Connect the node wallet first.");
    return;
  }
  const ergAmount = elements.swapErgAmount.value.trim();
  if (!ergAmount) {
    showToast("Enter an ERG amount.");
    return;
  }
  closeModal(elements.reviewModal);
  setBusy(true);
  elements.mintStatusLabel.textContent = "Minting...";
  try {
    const result = await bridge.mintDexy({
      sessionId: state.sessionId,
      ergAmount,
      mode: state.mode
    });
    if (result && result.quote) {
      applyQuote(result.quote);
    }
    elements.mintStatusLabel.textContent = "Broadcast";
    populateSuccessModal(result, ergAmount);
    openModal(elements.successModal);
    showToast(result?.txId ? `Broadcasted ${result.txId}` : "Mint broadcasted.");
  } catch (error) {
    elements.mintStatusLabel.textContent = "Failed";
    showToast(getErrorMessage(error, "Mint failed. Check Dexy status."));
  } finally {
    setBusy(false);
  }
}

function bindActions() {
  document.querySelectorAll(".segment[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  elements.swapPreview.addEventListener("click", previewMint);
  elements.swapMint.addEventListener("click", openReviewModal);
  if (elements.reviewConfirm) {
    elements.reviewConfirm.addEventListener("click", executeMint);
  }
  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(elements.reviewModal);
      closeModal(elements.successModal);
    });
  });
  if (elements.reviewModal) {
    elements.reviewModal.addEventListener("click", (event) => {
      if (event.target === elements.reviewModal) {
        closeModal(elements.reviewModal);
      }
    });
  }
  if (elements.successModal) {
    elements.successModal.addEventListener("click", (event) => {
      if (event.target === elements.successModal) {
        closeModal(elements.successModal);
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal(elements.reviewModal);
      closeModal(elements.successModal);
    }
  });

  if (elements.autoToggle) {
    elements.autoToggle.addEventListener("click", () => {
      state.auto.enabled = !state.auto.enabled;
      saveAutoConfig();
      updateAutoInputs();
      updateAutoUI(state.status);
      if (state.auto.enabled) {
        runAutoSwap(true);
      }
    });
  }
  if (elements.autoCheck) {
    elements.autoCheck.addEventListener("click", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
      runAutoSwap(true);
    });
  }
  if (elements.autoErgAmount) {
    elements.autoErgAmount.addEventListener("input", () => {
      syncAutoFromInputs();
    });
  }
  if (elements.autoCooldown) {
    elements.autoCooldown.addEventListener("input", () => {
      syncAutoFromInputs();
    });
  }
  if (elements.autoLpBand) {
    elements.autoLpBand.addEventListener("input", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoUseTarget) {
    elements.autoUseTarget.addEventListener("input", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoUseTargetOp) {
    elements.autoUseTargetOp.addEventListener("change", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoErgTarget) {
    elements.autoErgTarget.addEventListener("input", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoErgTargetOp) {
    elements.autoErgTargetOp.addEventListener("change", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoFree) {
    elements.autoFree.addEventListener("change", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoArb) {
    elements.autoArb.addEventListener("change", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
  if (elements.autoBand) {
    elements.autoBand.addEventListener("change", () => {
      syncAutoFromInputs();
      updateAutoUI(state.status);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadAutoConfig();
  updateAutoInputs();
  updateAutoUI(state.status);
  setMode(state.mode);
  applyQuote(null);
  bindActions();
  refreshStatus();
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
  refreshTimer = window.setInterval(refreshStatus, 15000);
});
