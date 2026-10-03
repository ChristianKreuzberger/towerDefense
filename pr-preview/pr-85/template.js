// Static markup only: nothing user-supplied is interpolated here (names are set via textContent elsewhere).
export const APP_TEMPLATE = `
  <section id="menuScreen" class="menu-screen">
    <div class="menu-card">
      <canvas id="menuHero" class="menu-hero" aria-hidden="true"></canvas>
      <div class="menu-body">
        <div class="menu-badge">Offline mode &bull; local skirmish &bull; 1&ndash;8 players</div>
        <h1 class="menu-title">Tower <span>Defense</span></h1>
        <p class="menu-subtitle">Place your tower, hold the line, and race to 1000 points before the field collapses.</p>
        <div class="menu-fields">
          <div class="menu-field">
            <label for="menuSeed">Map Seed</label>
            <input id="menuSeed" type="number" value="777" />
          </div>
          <div class="menu-field">
            <label for="menuPlayerCount">Players</label>
            <select id="menuPlayerCount">
              ${Array.from({ length: 8 }, (_, index) => {
    const count = index + 1;
    const selected = count === 2 ? "selected" : "";
    return `<option value="${count}" ${selected}>${count}</option>`;
}).join("")}
            </select>
          </div>
          <div class="menu-field">
            <label for="menuAiPlayers">AI Players</label>
            <input id="menuAiPlayers" type="number" value="0" disabled />
            <span class="menu-hint">Coming later</span>
          </div>
        </div>
        <div id="menuPlayerNames" class="menu-player-names"></div>
        <div class="menu-actions">
          <button id="menuStartBtn" class="primary">Start Match</button>
          <button id="menuResumeBtn" class="primary hidden">Resume Match</button>
          <button id="menuRefreshBtn" class="ghost">Refresh Existing Match</button>
          <button id="menuTourBtn" class="ghost">How to play</button>
          <button id="menuSettingsBtn" class="ghost menu-settings">Settings</button>
        </div>
        <div id="menuMessage" class="menu-message"></div>
      </div>
    </div>
  </section>

  <section id="gameScreen" class="game-screen hidden">
    <div class="stage">
      <header class="topbar">
        <div class="brand">Tower <span>Defense</span></div>
        <section class="phase-banner" id="phaseBanner">
          <div class="phase-label" id="phaseLabel">NO MATCH</div>
          <div class="phase-sub" id="phaseSub"></div>
        </section>
        <div id="playbackControls" class="playback-controls hidden" role="group" aria-label="Playback">
          <button id="playPauseBtn" aria-pressed="true">Pause</button>
          <button class="speed-btn" data-speed="1" aria-pressed="true">1x</button>
          <button class="speed-btn" data-speed="2" aria-pressed="false">2x</button>
          <button class="speed-btn" data-speed="4" aria-pressed="false">4x</button>
        </div>
      </header>

      <div class="wave-preview" id="wavePreview" aria-live="polite"></div>

      <div id="guideOverlay" class="guide-overlay guide-idle" aria-live="polite">
        <div id="guideCard" class="guide-card hint">
          <div class="guide-text">
            <div id="guideTitle" class="guide-title"></div>
            <div id="guideBody" class="guide-body"></div>
          </div>
          <button id="guideActionBtn" class="guide-action"></button>
          <button id="guideCloseBtn" class="guide-close" aria-label="Dismiss guidance" title="Dismiss guidance">&times;</button>
        </div>
      </div>

      <section class="battlefield">
        <div class="board-frame">
          <div id="board" class="board-grid"></div>
          <div id="waveBanner" class="wave-banner" aria-live="polite"><strong></strong><span></span></div>
          <div id="turnBanner" class="turn-banner" aria-live="polite"><strong></strong><span></span></div>
        </div>
        <div class="small battlefield-meta" id="battlefieldMeta">Click a marked tower spot to place your tower.</div>
      </section>
    </div>

    <aside class="control-panel">
      <div class="hud-chip-row" id="playerCards" aria-label="Scoreboard"></div>

      <div class="panel-block">
        <label for="playerId">Active Player <span class="hint">(1-8)</span></label>
        <select id="playerId"></select>
      </div>

      <div class="grid2 debug-only">
        <div>
          <label for="x">Tile X</label>
          <input id="x" type="number" value="0" />
        </div>
        <div>
          <label for="y">Tile Y</label>
          <input id="y" type="number" value="1" />
        </div>
      </div>

      <div class="toolbar" role="group" aria-label="Actions">
        <button id="placeTowerBtn" data-sfx="none" class="tool" title="Place your tower on the highlighted tile (T)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 12h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="tool-label">Place Tower</span><span class="tool-cost">free</span><kbd>T</kbd>
        </button>
<button id="moveTowerBtn" data-sfx="none" class="tool" aria-pressed="false" title="Move your tower once, free, after round 5 (V)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="tool-label">Move Tower</span><span class="tool-cost" id="moveTowerCost">-</span><kbd>V</kbd>
        </button>
        <button id="upgradeRangeBtn" data-track="range" data-sfx="none" class="tool upgrade-btn" title="Upgrade tower range (U)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16M7 7l-3 5 3 5M17 7l3 5-3 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="tool-label">Range</span><span class="tool-cost" id="upgradeRangeCost">-</span><kbd>U</kbd>
        </button>
        <button id="upgradeDamageBtn" data-track="damage" data-sfx="none" class="tool upgrade-btn" title="Upgrade tower damage (I)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="tool-label">Damage</span><span class="tool-cost" id="upgradeDamageCost">-</span><kbd>I</kbd>
        </button>
        <button id="upgradeAccuracyBtn" data-track="accuracy" data-sfx="none" class="tool upgrade-btn" title="Upgrade tower accuracy (O)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 5a4 4 0 110 8 4 4 0 010-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="tool-label">Accuracy</span><span class="tool-cost" id="upgradeAccuracyCost">-</span><kbd>O</kbd>
        </button>
        <button id="readyBtn" data-sfx="none" class="tool good" title="Lock in your setup (R)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="tool-label">Ready For Wave</span><span class="tool-cost">&nbsp;</span><kbd>R</kbd>
        </button>
      </div>

      <div class="panel-block">
        <label for="mode">Target Mode</label>
        <select id="mode">
          <option value="first">first</option>
          <option value="last">last</option>
          <option value="strongest">strongest</option>
          <option value="nearest">nearest</option>
        </select>
      </div>

      <div class="panel-block">
        <label for="damageType">Damage Type</label>
        <select id="damageType">
          <option value="physical">physical</option>
          <option value="explosive">explosive</option>
          <option value="magic">magic</option>
        </select>
      </div>

      <div class="stack debug-only">
        <button id="advanceBtn" class="primary">Advance Wave Tick</button>
        <button id="autoBtn">Advance Wave (Auto)</button>
        <button id="demoBtn">Demo Combat</button>
      </div>

      <div id="status" class="status">No match yet.</div>

      <div class="session-row">
        <button id="refreshBtn" class="ghost">Refresh Snapshot</button>
        <button id="backToMenuBtn" class="ghost">Back To Menu</button>
        <button id="tourBtn" class="ghost">How to play</button>
        <button id="settingsBtn" class="ghost">Settings</button>
      </div>
    </aside>

    <section class="snapshot-panel debug-only">
      <h3>Snapshot JSON</h3>
      <textarea id="snapshot" readonly></textarea>
    </section>
  </section>

  <footer class="shortcuts-bar" id="shortcutBar">
    <div><kbd>R</kbd> ready <kbd>T</kbd> tower <kbd>V</kbd> move tower <kbd>U</kbd>/<kbd>I</kbd>/<kbd>O</kbd> upgrade range/damage/accuracy <kbd>1</kbd>-<kbd>8</kbd> switch player <kbd>P</kbd> pause <kbd>M</kbd> mute <kbd>Arrows</kbd> move cursor</div>
  </footer>

  <div id="settingsRoot"></div>
  <div id="mapPreviewRoot"></div>
  <div id="tourRoot"></div>

  <div id="feedbackQueue" class="toasts" role="status" aria-live="polite"></div>

  <div class="match-end-overlay" id="matchEndOverlay">
    <div class="match-end-modal" role="dialog" aria-modal="true" aria-labelledby="matchEndTitle">
      <h2 id="matchEndTitle">Match Ended</h2>
      <div id="matchEndSummary" class="small"></div>
      <div id="matchEndScores" class="match-end-grid"></div>
      <div class="stack">
        <button id="rematchBtn" class="primary">Rematch</button>
        <button id="restartBtn">Return To Menu</button>
        <button id="closeOverlayBtn" class="ghost">Close</button>
      </div>
    </div>
  </div>
`;
