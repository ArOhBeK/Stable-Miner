const sessionKey = "stableminer-wallet-session";

const state = {
  sessionId: null,
  mode: "auto",
  status: null,
  quote: null,
  busy: false
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
  successTotal: document.getElementById("successTotal")
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
    return;
  }
  try {
    const status = await bridge.getDexyStatus(state.sessionId);
    setStatus(status);
  } catch (error) {
    setStatus(null);
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
}

document.addEventListener("DOMContentLoaded", () => {
  setMode(state.mode);
  applyQuote(null);
  bindActions();
  refreshStatus();
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
  refreshTimer = window.setInterval(refreshStatus, 15000);
});
