# StableMiner local UI

 - StableMiner is a locally hosted platform that allow minting of Dexy (USE) stable coin directly from your node wallet. Integreate your miner locallay and convert your mined $ERG directly into $USE. StableMiner is open source and free to use.  Mint USE stablecoins locally without the need for an exchange. 

## Quick start

1. Install Node.js (16+).
2. Run the local bridge server:

```
node server.cjs
```

3. Open `http://localhost:4310` in a browser.

## Pages

- `index.html` hosts the mining and build console.
- `swap.html` hosts the dedicated swap desk.

## Dexy USE minting

- Open the swap desk and connect the node wallet first (session persists from the dashboard).
- Enter an ERG amount and preview the mint; StableMiner will choose free or arbitrage mint if available.
- Minting uses on-chain Dexy contracts directly through the local node wallet and broadcasts a signed transaction.
- A 0.001 ERG fee and a minimum output box value are added on top of the ERG you swap.

## Ergo context

ErgoScript reference material is embedded under `context/` for local development.

## Ergo Node Wallet

- Run a local Ergo node (default `http://127.0.0.1:9053`).
- Enter the node **API key** and click **Connect** to load wallet addresses.
- Use **Scan local node** to auto-detect a running node.

The UI uses the node wallet API for addresses and the public explorer for balance.

## Rigel Miner

- Fill in **Rigel path**, **Pool URL**, **Worker name**, and (optionally) **API bind**.
- Press **Start** to launch Rigel. The bridge adds:
  - `-a autolykos2` (unless you specify an algorithm in extra args)
  - `-o <pool>`
  - `-u <address>`
  - `-w <worker>`
  - `-p x`
  - `--api-bind <API bind>`

The UI polls the Rigel HTTP API and tries common endpoints (`/stat`, `/stats`, `/api/v1/stats`, `/summary`, `/`).

## Build & Deploy

- **Rigel Miner**: click **Download/Update Rigel** to fetch the latest Windows release from GitHub and extract it.
  - After install, click **Use installed path** to populate the Rigel path field.

## Environment variables

- `PORT` sets the local server port (default `4310`).
- `EXPLORER_MAINNET` overrides the mainnet explorer URL for balance lookups.
- `EXPLORER_TESTNET` overrides the testnet explorer URL.
- `ERGO_NODE_URL` overrides the default Ergo node endpoint for scans.

Video Demo: 

https://github.com/user-attachments/assets/f88d6e61-82d2-4789-a177-b9ec4400387f


Donation Address: 9eumEjApDtdixZo2r8M7d66ZxaRKmXhaT8a4fEYSr3VJztorn7g
