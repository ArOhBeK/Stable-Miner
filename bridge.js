const apiHeaders = {
  'Content-Type': 'application/json'
};

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...apiHeaders,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

const stableMinerBridge = {
  async connectWallet(payload) {
    return apiRequest('/api/wallet/connect', {
      method: 'POST',
      body: JSON.stringify({
        network: payload?.network || 'mainnet',
        endpoint: payload?.endpoint,
        token: payload?.token
      })
    });
  },
  async getWalletStatus(sessionId) {
    return apiRequest(`/api/wallet/status?session=${encodeURIComponent(sessionId)}`);
  },
  async disconnectWallet(sessionId) {
    return apiRequest('/api/wallet/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    });
  },
  async scanNode() {
    return apiRequest('/api/node/scan');
  },
  async getDexyStatus(sessionId) {
    return apiRequest(`/api/dexy/status?session=${encodeURIComponent(sessionId)}`);
  },
  async getDexyQuote(payload) {
    return apiRequest('/api/dexy/quote', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async mintDexy(payload) {
    return apiRequest('/api/dexy/mint', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async startMiner(payload) {
    return apiRequest('/api/miner/start', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  async stopMiner() {
    return apiRequest('/api/miner/stop', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },
  async getMinerStatus() {
    return apiRequest('/api/miner/status');
  },
  async getMinerStats() {
    return apiRequest('/api/miner/stats');
  },
  async installRigel() {
    return apiRequest('/api/tasks/rigel/install', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },
  async getTask(taskId) {
    return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`);
  }
};

window.stableMinerBridge = stableMinerBridge;
