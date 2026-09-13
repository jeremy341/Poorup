# Poorup socket capacity harness

`poorup-socket-load.mjs` is an opt-in, bounded Socket.IO scenario for the Nest
**testing** deployment. It connects up to 1,000 simulated clients, lists rooms,
creates four-seat public rooms, joins seats, and reconnects a small sample. It
prints a JSON evidence record and never stores account, chat, or game-private
data.

The script refuses to run unless `POORUP_LOAD_ENV=testing` and
`POORUP_LOAD_TARGET` are set. Production-looking hosts are rejected. For local
development only, add `POORUP_LOAD_ALLOW_LOCAL=true`.

Example (testing only):

```powershell
$env:POORUP_LOAD_ENV = 'testing'
$env:POORUP_LOAD_TARGET = 'https://testing.example.invalid'
$env:POORUP_LOAD_CLIENTS = '1000'
node qa/load/poorup-socket-load.mjs | Tee-Object qa/load/evidence-<sha>.json
```

The release gate requires zero authoritative-state loss, zero duplicate
settlement, reconnect success ≥99%, p95 connect acknowledgement below 150 ms,
event-loop lag below 100 ms, memory trending back toward baseline, and a
maintenance-drain check proving new rooms/rounds are blocked while active
rounds continue. Capture those server-side measurements with the deployment
runbook; this client harness intentionally cannot infer private server memory
or event-loop health.
