const storageKey = "stableminer-config";
const sessionKey = "stableminer-wallet-session";

const demoMiner = {
  hashrate: "1.06 GH/s",
  power: "238 W",
  shares: "99.4%",
  uptime: "2h 18m"
};

const state = {
  walletConnected: false,
  walletMode: "none",
  walletSessionId: null,
  walletError: "",
  minerRunning: false,
  minerMode: "none",
  mode: "pool",
  wallet: null,
  miner: null,
  taskId: null,
  taskType: null,
  rigelInstalledPath: ""
};

let toastTimer = null;
let walletPollTimer = null;
let minerPollTimer = null;
let taskPollTimer = null;

const elements = {
  walletDot: document.getElementById("walletDot"),
  walletStatus: document.getElementById("walletStatus"),
  walletModeChip: document.getElementById("walletModeChip"),
  walletAddress: document.getElementById("walletAddress"),
  walletBalance: document.getElementById("walletBalance"),
  walletTokens: document.getElementById("walletTokens"),
  walletNetwork: document.getElementById("walletNetwork"),
  walletNote: document.getElementById("walletNote"),
  walletEndpoint: document.getElementById("walletEndpoint"),
  walletToken: document.getElementById("walletToken"),
  walletConnect: document.getElementById("walletConnect"),
  walletDisconnect: document.getElementById("walletDisconnect"),
  walletScan: document.getElementById("walletScan"),
  minerDot: document.getElementById("minerDot"),
  minerStatus: document.getElementById("minerStatus"),
  minerModeChip: document.getElementById("minerModeChip"),
  minerHashrate: document.getElementById("minerHashrate"),
  minerPower: document.getElementById("minerPower"),
  minerShares: document.getElementById("minerShares"),
  minerUptime: document.getElementById("minerUptime"),
  minerNote: document.getElementById("minerNote"),
  minerPath: document.getElementById("minerPath"),
  minerPool: document.getElementById("minerPool"),
  minerWorker: document.getElementById("minerWorker"),
  minerApiBind: document.getElementById("minerApiBind"),
  minerAddress: document.getElementById("minerAddress"),
  minerArgs: document.getElementById("minerArgs"),
  minerStart: document.getElementById("minerStart"),
  minerStop: document.getElementById("minerStop"),
  taskDot: document.getElementById("taskDot"),
  taskStatus: document.getElementById("taskStatus"),
  installRigel: document.getElementById("installRigel"),
  useRigelPath: document.getElementById("useRigelPath"),
  rigelPathNote: document.getElementById("rigelPathNote"),
  buildLog: document.getElementById("buildLog"),
  modeNote: document.getElementById("modeNote"),
  heroConnect: document.getElementById("heroConnect"),
  heroStartMiner: document.getElementById("heroStartMiner"),
  openConfig: document.getElementById("openConfig"),
  copyConfig: document.getElementById("copyConfig"),
  toast: document.getElementById("toast")
};

function getBridge() {
  return window.stableMinerBridge || null;
}

function showToast(message) {
  if (!message) {
    return;
  }
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2200);
}

function getErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  const raw = typeof error.message === "string" ? error.message : String(error);
  if (raw && raw.includes("{")) {
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
  return raw || fallback;
}

function truncateAddress(address) {
  if (!address || address.length < 12) {
    return address || "Not linked";
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function setWalletAddress(address) {
  if (!address) {
    elements.walletAddress.textContent = "Not linked";
    elements.walletAddress.removeAttribute("title");
    return;
  }
  elements.walletAddress.textContent = truncateAddress(address);
  elements.walletAddress.title = address;
}

function updateMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.segment[data-mode]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  elements.modeNote.textContent =
    mode === "solo" ? "Solo mining with direct payout." : "Pooling with shared payout.";
  saveConfig();
}


function updateWalletUI() {
  const isConnecting = state.walletMode === "connecting";
  const needsKey = state.walletMode === "needs_key";
  const hasError = state.walletMode === "error";
  elements.walletDot.classList.toggle("on", state.walletConnected);
  elements.walletDot.classList.toggle("warning", needsKey || hasError || isConnecting);
  elements.walletStatus.textContent = state.walletConnected
    ? "Online"
    : isConnecting
      ? "Connecting"
    : needsKey
      ? "Needs API key"
      : hasError
        ? "Error"
      : "Offline";
  elements.walletConnect.disabled = state.walletConnected || isConnecting;
  elements.walletDisconnect.disabled = !(state.walletConnected || needsKey || hasError);
  if (elements.walletModeChip) {
    elements.walletModeChip.hidden = !needsKey;
    if (needsKey) {
      elements.walletModeChip.textContent = "API key required";
    }
  }

  if (!state.walletConnected || !state.wallet) {
    setWalletAddress(null);
    elements.walletBalance.textContent = "--";
    elements.walletTokens.textContent = "--";
    elements.walletNetwork.textContent = "--";
    elements.walletNote.textContent = isConnecting
      ? "Checking the local Ergo node..."
      : needsKey
        ? "Enter the Ergo node API key to access wallet addresses."
      : hasError
        ? state.walletError || "Unable to reach the local Ergo node."
      : "Connect to a local Ergo node wallet to auto-fill payouts.";
    return;
  }

  setWalletAddress(state.wallet.address);
  elements.walletBalance.textContent = state.wallet.balance;
  elements.walletTokens.textContent = state.wallet.tokens;
  elements.walletNetwork.textContent = state.wallet.network;
  if (state.walletMode === "live") {
    if (state.wallet.spendable) {
      const utxoNote = state.wallet.utxoCount !== undefined
        ? ` across ${state.wallet.utxoCount} UTXO${state.wallet.utxoCount === 1 ? "" : "s"}`
        : "";
      elements.walletNote.textContent =
        `Wallet linked. Spendable ${state.wallet.spendable} ERG${utxoNote}.`;
    } else {
      elements.walletNote.textContent = "Wallet linked. Routing payouts to this address.";
    }
  } else {
    elements.walletNote.textContent = "Wallet connection active.";
  }
}

function updateMinerUI() {
  elements.minerDot.classList.toggle("running", state.minerRunning);
  elements.minerStatus.textContent = state.minerRunning ? "Running" : "Idle";
  elements.minerStart.disabled = state.minerRunning;
  elements.minerStop.disabled = !state.minerRunning;
  elements.minerModeChip.hidden = !(state.minerRunning && state.minerMode === "demo");

  if (!state.minerRunning || !state.miner) {
    elements.minerHashrate.textContent = "--";
    elements.minerPower.textContent = "--";
    elements.minerShares.textContent = "--";
    elements.minerUptime.textContent = "--";
    elements.minerNote.textContent = "Linking to the wallet auto-fills payout address.";
    return;
  }

  elements.minerHashrate.textContent = state.miner.hashrate;
  elements.minerPower.textContent = state.miner.power;
  elements.minerShares.textContent = state.miner.shares;
  elements.minerUptime.textContent = state.miner.uptime;
  if (state.minerMode === "live") {
    elements.minerNote.textContent = state.miner.source
      ? `Rigel API: ${state.miner.source}`
      : "Rigel Miner running with wallet-linked payout.";
  } else {
    elements.minerNote.textContent = "Rigel bridge not detected. Showing demo stats.";
  }
}

function updateTaskStatus(status, label) {
  elements.taskDot.classList.remove("running", "on", "warning");
  if (status === "running") {
    elements.taskDot.classList.add("running");
  } else if (status === "failed") {
    elements.taskDot.classList.add("warning");
  } else if (status === "completed") {
    elements.taskDot.classList.add("on");
  }
  elements.taskStatus.textContent = label || "Idle";
}

function updateRigelPathNote() {
  if (state.rigelInstalledPath) {
    elements.rigelPathNote.textContent = `Installed at ${state.rigelInstalledPath}`;
    elements.useRigelPath.disabled = false;
  } else {
    elements.rigelPathNote.textContent = "No Rigel install detected yet.";
    elements.useRigelPath.disabled = true;
  }
}

function updateTaskButtons(isBusy) {
  elements.installRigel.disabled = isBusy;
  elements.useRigelPath.disabled = isBusy || !state.rigelInstalledPath;
}

function stopTaskPolling() {
  if (taskPollTimer) {
    window.clearInterval(taskPollTimer);
    taskPollTimer = null;
  }
}

async function pollTask() {
  const bridge = getBridge();
  if (!bridge || !state.taskId) {
    return;
  }
  try {
    const task = await bridge.getTask(state.taskId);
    if (task.log) {
      elements.buildLog.textContent = task.log;
      elements.buildLog.scrollTop = elements.buildLog.scrollHeight;
    }
    if (task.status === "running") {
      updateTaskStatus("running", "Running");
      return;
    }
    stopTaskPolling();
    if (task.status === "failed") {
      updateTaskStatus("failed", "Failed");
      showToast("Task failed. See logs for details.");
    } else {
      updateTaskStatus("completed", "Completed");
      showToast("Task completed.");
    }
    if (task.result && task.result.rigelPath) {
      state.rigelInstalledPath = task.result.rigelPath;
      updateRigelPathNote();
    }
    state.taskId = null;
    state.taskType = null;
    updateTaskButtons(false);
  } catch (error) {
    showToast("Unable to fetch task status.");
  }
}

function startTaskPolling(taskId, type) {
  state.taskId = taskId;
  state.taskType = type;
  updateTaskStatus("running", "Running");
  updateTaskButtons(true);
  stopTaskPolling();
  taskPollTimer = window.setInterval(pollTask, 2000);
  pollTask();
}

async function installRigel() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.installRigel !== "function") {
    showToast("Install bridge unavailable.");
    return;
  }
  if (state.taskId) {
    showToast("A task is already running.");
    return;
  }
  elements.buildLog.textContent = "Starting Rigel install...\n";
  try {
    const response = await bridge.installRigel();
    startTaskPolling(response.taskId, "rigel");
  } catch (error) {
    showToast("Failed to start Rigel install.");
  }
}

function applyRigelPath() {
  if (!state.rigelInstalledPath) {
    return;
  }
  elements.minerPath.value = state.rigelInstalledPath;
  saveConfig();
  showToast("Rigel path updated.");
}

function linkWalletToMiner() {
  if (!state.walletConnected || !state.wallet) {
    return;
  }
  if (!elements.minerAddress.value || elements.minerAddress.dataset.linked === "true") {
    elements.minerAddress.value = state.wallet.address;
    elements.minerAddress.dataset.linked = "true";
  }
}

function stopWalletPolling() {
  if (walletPollTimer) {
    window.clearInterval(walletPollTimer);
    walletPollTimer = null;
  }
}

async function pollWalletStatus() {
  const bridge = getBridge();
  if (!bridge || !state.walletSessionId) {
    return;
  }
  try {
    const status = await bridge.getWalletStatus(state.walletSessionId);
    if (status && status.connected) {
      const wasConnected = state.walletConnected;
      state.walletConnected = true;
      state.walletMode = "live";
      state.walletError = "";
      state.wallet = {
        address: status.address,
        balance: status.balance || "--",
        tokens: status.tokens || "--",
        network: status.network || "--",
        spendable: status.spendable,
        utxoCount: status.utxoCount
      };
      updateWalletUI();
      linkWalletToMiner();
      if (!wasConnected) {
        showToast("Wallet connected.");
      }
      return;
    }
    if (status && status.error) {
      state.walletConnected = false;
      state.walletMode = "error";
      state.walletError = status.error;
      state.wallet = null;
      updateWalletUI();
      return;
    }
    if (status && status.connected === false) {
      state.walletConnected = false;
      state.walletMode = "error";
      state.walletError = "Wallet session expired.";
      state.walletSessionId = null;
      localStorage.removeItem(sessionKey);
      state.wallet = null;
      updateWalletUI();
    }
  } catch (error) {
    // Keep polling silently.
  }
}

function startWalletPolling() {
  stopWalletPolling();
  walletPollTimer = window.setInterval(pollWalletStatus, 2000);
}

function stopMinerPolling() {
  if (minerPollTimer) {
    window.clearInterval(minerPollTimer);
    minerPollTimer = null;
  }
}

async function pollMinerStats() {
  const bridge = getBridge();
  if (!bridge) {
    return;
  }
  try {
    const response = await bridge.getMinerStats();
    if (!response || !response.running) {
      state.minerRunning = false;
      state.minerMode = "none";
      state.miner = null;
      stopMinerPolling();
      updateMinerUI();
      return;
    }
    if (response.stats) {
      state.miner = {
        hashrate: response.stats.hashrate || "--",
        power: response.stats.power || "--",
        shares: response.stats.shares || "--",
        uptime: response.stats.uptime || "--",
        source: response.stats.source || ""
      };
      updateMinerUI();
    }
  } catch (error) {
    // Ignore transient API errors.
  }
}

function startMinerPolling() {
  stopMinerPolling();
  minerPollTimer = window.setInterval(pollMinerStats, 4000);
}

async function scanLocalNode() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.scanNode !== "function") {
    showToast("Node scan unavailable.");
    return;
  }
  elements.walletStatus.textContent = "Scanning...";
  try {
    const result = await bridge.scanNode();
    if (result && result.found && result.endpoint) {
      elements.walletEndpoint.value = result.endpoint;
      saveConfig();
      showToast("Local Ergo node detected.");
    } else {
      showToast("No local Ergo node detected.");
    }
  } catch (error) {
    showToast("Node scan failed.");
  }
  updateWalletUI();
}

async function connectWallet() {
  if (state.walletConnected || state.walletMode === "connecting") {
    return;
  }

  elements.walletStatus.textContent = "Connecting...";
  state.walletMode = "connecting";
  state.walletError = "";
  updateWalletUI();
  stopWalletPolling();

  const bridge = getBridge();
  if (!bridge || typeof bridge.connectWallet !== "function") {
    state.walletMode = "error";
    state.walletError = "Wallet bridge unavailable.";
    updateWalletUI();
    showToast("Wallet bridge unavailable.");
    return;
  }

  try {
    const response = await bridge.connectWallet({
      endpoint: elements.walletEndpoint.value.trim(),
      token: elements.walletToken.value.trim()
    });
    if (response && response.status === "connected") {
      state.walletConnected = true;
      state.walletMode = "live";
      state.walletSessionId = response.sessionId;
      localStorage.setItem(sessionKey, response.sessionId);
      state.wallet = {
        address: response.address || "--",
        balance: "--",
        tokens: "--",
        network: response.network || "--"
      };
      updateWalletUI();
      startWalletPolling();
      await pollWalletStatus();
      linkWalletToMiner();
      showToast("Wallet connected.");
      return;
    }
    if (response && response.status === "needs_key") {
      state.walletConnected = false;
      state.walletMode = "needs_key";
      state.walletError = response.message || "API key required.";
      state.walletSessionId = null;
      localStorage.removeItem(sessionKey);
      state.wallet = null;
      updateWalletUI();
      showToast(state.walletError);
      return;
    }
    if (response && response.status === "offline") {
      state.walletConnected = false;
      state.walletMode = "error";
      state.walletError = response.error || "Ergo node not reachable.";
      state.walletSessionId = null;
      localStorage.removeItem(sessionKey);
      state.wallet = null;
      updateWalletUI();
      showToast(state.walletError);
      return;
    }
    if (response && response.status === "empty") {
      state.walletConnected = false;
      state.walletMode = "error";
      state.walletError = response.message || "No wallet addresses found.";
      state.walletSessionId = null;
      localStorage.removeItem(sessionKey);
      state.wallet = null;
      updateWalletUI();
      showToast(state.walletError);
      return;
    }
    state.walletMode = "error";
    state.walletError = "Unexpected response from the Ergo node.";
    state.walletConnected = false;
    state.walletSessionId = null;
    localStorage.removeItem(sessionKey);
    state.wallet = null;
    updateWalletUI();
    showToast(state.walletError);
  } catch (error) {
    state.walletMode = "error";
    state.walletError = "Unable to connect to the Ergo node.";
    state.walletConnected = false;
    state.walletSessionId = null;
    localStorage.removeItem(sessionKey);
    state.wallet = null;
    updateWalletUI();
    showToast(state.walletError);
  }
}

function disconnectWallet() {
  const bridge = getBridge();
  if (bridge && typeof bridge.disconnectWallet === "function") {
    bridge.disconnectWallet(state.walletSessionId);
  }
  stopWalletPolling();
  state.walletConnected = false;
  state.walletMode = "none";
  state.walletError = "";
  state.wallet = null;
  state.walletSessionId = null;
  localStorage.removeItem(sessionKey);
  if (elements.minerAddress.dataset.linked === "true") {
    elements.minerAddress.value = "";
  }
  updateWalletUI();
  saveConfig();
  showToast("Wallet disconnected.");
}

async function startMiner() {
  if (state.minerRunning) {
    return;
  }

  const address = elements.minerAddress.value.trim();
  if (!address) {
    showToast("Enter a payout address or connect the wallet.");
    return;
  }
  if (!elements.minerPath.value.trim() || !elements.minerPool.value.trim()) {
    showToast("Rigel path and pool URL are required.");
    return;
  }

  elements.minerStatus.textContent = "Starting...";

  const bridge = getBridge();
  if (!bridge || typeof bridge.startMiner !== "function") {
    elements.minerStatus.textContent = "Idle";
    showToast("Bridge unavailable. Start the server first.");
    return;
  }

  try {
    const response = await bridge.startMiner({
      path: elements.minerPath.value.trim(),
      pool: elements.minerPool.value.trim(),
      worker: elements.minerWorker.value.trim(),
      address,
      apiBind: elements.minerApiBind.value.trim(),
      args: elements.minerArgs.value.trim(),
      mode: state.mode,
      openConsole: true
    });
    if (!response || !response.running) {
      elements.minerStatus.textContent = "Idle";
      showToast(response?.error || "Miner failed to start.");
      return;
    }
    state.minerRunning = true;
    state.minerMode = "live";
    state.miner = null;
    updateMinerUI();
    showToast("Miner started.");
    startMinerPolling();
    await pollMinerStats();
  } catch (error) {
    state.minerRunning = false;
    state.minerMode = "none";
    state.miner = null;
    updateMinerUI();
    elements.minerStatus.textContent = "Idle";
    showToast(getErrorMessage(error, "Miner failed to start."));
  }
}

function stopMiner() {
  const bridge = getBridge();
  if (bridge && typeof bridge.stopMiner === "function") {
    bridge.stopMiner();
  }
  stopMinerPolling();
  state.minerRunning = false;
  state.minerMode = "none";
  state.miner = null;
  updateMinerUI();
  showToast("Miner stopped.");
}

function saveConfig() {
  const config = {
    mode: state.mode,
    walletEndpoint: elements.walletEndpoint.value.trim(),
    walletToken: elements.walletToken.value.trim(),
    minerPath: elements.minerPath.value.trim(),
    minerPool: elements.minerPool.value.trim(),
    minerWorker: elements.minerWorker.value.trim(),
    minerApiBind: elements.minerApiBind.value.trim(),
    minerAddress: elements.minerAddress.value.trim(),
    minerArgs: elements.minerArgs.value.trim()
  };
  localStorage.setItem(storageKey, JSON.stringify(config));
}

function loadConfig() {
  const raw = localStorage.getItem(storageKey);
  const savedSession = localStorage.getItem(sessionKey);
  if (savedSession) {
    state.walletSessionId = savedSession;
  }
  if (!raw) {
    if (!elements.walletEndpoint.value) {
      elements.walletEndpoint.value = "http://127.0.0.1:9053";
    }
    if (!elements.minerApiBind.value) {
      elements.minerApiBind.value = "127.0.0.1:5000";
    }
    return;
  }

  try {
    const config = JSON.parse(raw);
    if (config.walletEndpoint) {
      elements.walletEndpoint.value = config.walletEndpoint;
    }
    if (config.walletToken) {
      elements.walletToken.value = config.walletToken;
    }
    if (config.minerPath) {
      elements.minerPath.value = config.minerPath;
    }
    if (config.minerPool) {
      elements.minerPool.value = config.minerPool;
    }
    if (config.minerWorker) {
      elements.minerWorker.value = config.minerWorker;
    }
    if (config.minerApiBind) {
      elements.minerApiBind.value = config.minerApiBind;
    }
    if (config.minerAddress) {
      elements.minerAddress.value = config.minerAddress;
    }
    if (config.minerArgs) {
      elements.minerArgs.value = config.minerArgs;
    }
    if (config.mode) {
      updateMode(config.mode);
    }
  } catch (error) {
    showToast("Saved config is invalid.");
  }

  if (!elements.walletEndpoint.value) {
    elements.walletEndpoint.value = "http://127.0.0.1:9053";
  }
  if (!elements.minerApiBind.value) {
    elements.minerApiBind.value = "127.0.0.1:5000";
  }
}

async function exportConfig() {
  const payload = {
    mode: state.mode,
    wallet: {
      endpoint: elements.walletEndpoint.value.trim()
    },
    miner: {
      path: elements.minerPath.value.trim(),
      pool: elements.minerPool.value.trim(),
      worker: elements.minerWorker.value.trim(),
      apiBind: elements.minerApiBind.value.trim(),
      address: elements.minerAddress.value.trim(),
      args: elements.minerArgs.value.trim()
    },
    createdAt: new Date().toISOString()
  };

  const json = JSON.stringify(payload, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    showToast("Config copied to clipboard.");
  } catch (error) {
    console.log(json);
    showToast("Clipboard unavailable. Config logged to console.");
  }
}

function bindInputs() {
  const saveOnInput = [
    elements.walletEndpoint,
    elements.walletToken,
    elements.minerPath,
    elements.minerPool,
    elements.minerWorker,
    elements.minerApiBind,
    elements.minerAddress,
    elements.minerArgs
  ];

  saveOnInput.forEach((input) => {
    input.addEventListener("input", () => {
      if (input === elements.minerAddress) {
        elements.minerAddress.dataset.linked = "false";
      }
      saveConfig();
    });
  });
}

function bindActions() {
  elements.walletConnect.addEventListener("click", connectWallet);
  elements.walletDisconnect.addEventListener("click", disconnectWallet);
  elements.walletScan.addEventListener("click", scanLocalNode);
  elements.minerStart.addEventListener("click", startMiner);
  elements.minerStop.addEventListener("click", stopMiner);
  elements.installRigel.addEventListener("click", installRigel);
  elements.useRigelPath.addEventListener("click", applyRigelPath);
  elements.heroConnect.addEventListener("click", connectWallet);
  elements.heroStartMiner.addEventListener("click", startMiner);
  elements.openConfig.addEventListener("click", () => {
    showToast("Preferences are saved locally in this browser.");
  });
  elements.copyConfig.addEventListener("click", exportConfig);

  document.querySelectorAll('.segment[data-mode]').forEach((button) => {
    button.addEventListener("click", () => updateMode(button.dataset.mode));
  });
}

async function syncMinerStatus() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getMinerStatus !== "function") {
    return;
  }
  try {
    const status = await bridge.getMinerStatus();
    if (status && status.running) {
      state.minerRunning = true;
      state.minerMode = "live";
      state.miner = null;
      updateMinerUI();
      startMinerPolling();
      await pollMinerStats();
    }
  } catch (error) {
    // Ignore bridge errors on load.
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  updateWalletUI();
  updateMinerUI();
  updateTaskStatus("idle", "Idle");
  updateRigelPathNote();
  bindInputs();
  bindActions();
  syncMinerStatus();
  if (state.walletSessionId) {
    state.walletMode = "connecting";
    updateWalletUI();
    startWalletPolling();
    pollWalletStatus();
  }
});
