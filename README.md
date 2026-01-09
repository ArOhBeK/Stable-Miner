# StableMiner local UI

StableMiner is a local dashboard for Ergo mining + Dexy USE minting. It runs a tiny
bridge server and serves a couple HTML pages. Think “home command center,” not “cloud
octopus.”

## Dependencies (ELI5 snack list)

- Node.js 18+ (the engine that makes the dashboard go vroom).
- A running Ergo node with wallet API enabled (the piggy bank).
- Rigel Miner (the pickaxe) and GPU drivers.
- Linux users: `tar` or `unzip` + `chmod` (the box cutters).

No `npm install` is required for this repo. It’s plain HTML/CSS/JS with a small Node
bridge.

## Quick start

1. Install Node.js 18+.
2. In this folder, run:

```
node server.cjs
```

3. Open `http://localhost:4310` in a browser.

## Pages

- `index.html` hosts the mining and build console.
- `swap.html` hosts the dedicated swap desk.

## Dexy USE minting (Swap Desk)

- Open the swap desk and connect the node wallet first (session persists from the dashboard).
- Enter an ERG amount and preview the mint.
- Review the transaction in the **Review mint** modal so you know what you’re signing.
- Submit to broadcast; you’ll get a success modal with a link to the explorer.
- Minting uses on-chain Dexy contracts directly through the local node wallet and
  broadcasts a signed transaction.
- A 0.001 ERG fee and a minimum output box value are added on top of the ERG you swap.

## Auto swap (a.k.a. the “I want to nap” mode)

- Enable auto swap and set an ERG amount.
- Choose conditions: free mint available, arb mint available, LP vs oracle band, and
  price targets for USE (ERG) and ERG (USE).
- Targets use the **oracle** price.
- **Cooldown:** set **120 seconds or higher** to reduce double‑spend failures when the
  network is busy.

## Ergo Node Wallet

- Run a local Ergo node (default `http://127.0.0.1:9053`).
- Enter the node **API key** and click **Connect** to load wallet addresses.
- Use **Scan local node** to auto-detect a running node.
- The UI uses the node wallet API for addresses and the public explorer for balance.

## Rigel Miner

- Fill in **Rigel path**, **Pool URL**, **Worker name**, and (optionally) **API bind**.
- Press **Start** to launch Rigel. The bridge adds:
  - `-a autolykos2` (unless you specify an algorithm in extra args)
  - `-o <pool>`
  - `-u <address>`
  - `-w <worker>`
  - `-p x`
  - `--api-bind <API bind>`

The UI polls the Rigel HTTP API and tries common endpoints (`/stat`, `/stats`,
`/api/v1/stats`, `/summary`, `/`).

## Build & Deploy

- **Rigel Miner**: click **Download/Update Rigel** to fetch the latest release from GitHub
  and extract it.
  - After install, click **Use installed path** to populate the Rigel path field.
  - On Linux the bridge uses `tar` or `unzip` and applies `chmod +x`.

## Ergo context

ErgoScript reference material is embedded under `context/` for local development.

## Environment variables

- `PORT` sets the local server port (default `4310`).
- `EXPLORER_MAINNET` overrides the mainnet explorer URL for balance lookups.
- `EXPLORER_TESTNET` overrides the testnet explorer URL.
- `ERGO_NODE_URL` overrides the default Ergo node endpoint for scans.

Video Demo: 

https://github.com/user-attachments/assets/f88d6e61-82d2-4789-a177-b9ec4400387f


Donation Address: 9eumEjApDtdixZo2r8M7d66ZxaRKmXhaT8a4fEYSr3VJztorn7g
