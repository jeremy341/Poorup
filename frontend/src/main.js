const root = typeof document !== 'undefined' ? document.getElementById('app') : null;

if (root) {
  root.innerHTML = `
    <main class="landing">
      <div class="landing-card">
        <h1 class="brand">Poorup</h1>
        <p class="muted">This frontend scaffold is not wired to the live game runtime.</p>
      </div>
    </main>
  `;
}
