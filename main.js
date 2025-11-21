const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const finalScoreElement = document.getElementById('final-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const winScreen = document.getElementById('win-screen');
const winScoreElement = document.getElementById('win-score');
const winRestartBtn = document.getElementById('win-restart-btn');
const pauseBtn = document.getElementById('pause-btn');
const muteBtn = document.getElementById('mute-btn');
const bgMusic = document.getElementById('bg-music');
let isMuted = false;
const debugBtn = document.getElementById('debug-btn');
let debugOn = false;
let debugOverlay = null;

// Game Constants
let GRID_SIZE = 20; // will be recalculated on resize
const TILE_COUNT = 30; // number of tiles per row/column (grid is square)
const GAME_SPEED = 100; // ms per frame

// Game State
let snake = [];
let direction = { x: 0, y: 0 };
let nextDirection = { x: 0, y: 0 };
let food = { x: 0, y: 0 };
let score = 0;
let gameLoopId;
let isGameRunning = false;
let isPaused = false;

// Assets (Simple drawing for now, could be replaced with images later)
const COLORS = {
    milkCarton: '#ecf0f1', // White-ish
    milkCartonDetail: '#3498db', // Blue details
    ponki: '#2c3e50', // Dark grey/black
    ponkiPaws: '#ecf0f1', // White paws
    mouse: '#95a5a6', // Grey
    mouseEars: '#e74c3c' // Pinkish
};

// Helper: draw a filled ellipse without relying on ctx.ellipse (better compatibility)
function drawFilledEllipse(x, y, rx, ry, rotation = 0, fillStyle = null) {
    if (fillStyle) ctx.fillStyle = fillStyle;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Input Handling
document.addEventListener('keydown', handleInput);
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
if (winRestartBtn) winRestartBtn.addEventListener('click', startGame);
if (muteBtn) muteBtn.addEventListener('click', toggleMute);
// debugBtn is handled via makeButtonSafe to avoid double-activation with pointer events

// Helper: attach safe pointer handlers to buttons to avoid offset/capture issues
function makeButtonSafe(button, onActivate) {
    if (!button) return;
    let tracking = null;

    button.addEventListener('pointerdown', (e) => {
        // Prevent canvas or other listeners from stealing this pointer
        e.stopPropagation();
        try { button.setPointerCapture(e.pointerId); } catch (_) {}
        tracking = { id: e.pointerId, startX: e.clientX, startY: e.clientY };
    });

    button.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        try { button.releasePointerCapture(e.pointerId); } catch (_) {}
        // Use elementFromPoint to verify the up event is over the same button
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el === button || button.contains(el)) {
            try { onActivate(e); } catch (err) { console.error('button handler error', err); }
        } else {
            // If elementFromPoint mismatch, but the bounding rect contains the point, accept it
            const r = button.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                try { onActivate(e); } catch (err) { console.error('button handler error', err); }
            } else {
                // otherwise ignore (user dragged off)
            }
        }
        tracking = null;
    });

    // Cancel tracking on pointercancel/leave
    button.addEventListener('pointercancel', (e) => { tracking = null; try { button.releasePointerCapture(e.pointerId); } catch (_) {} });
}

// Make important controls use safe handlers
makeButtonSafe(startBtn, () => startGame());
makeButtonSafe(restartBtn, () => startGame());
makeButtonSafe(winRestartBtn, () => startGame());
makeButtonSafe(pauseBtn, () => togglePause());
makeButtonSafe(muteBtn, () => toggleMute());
makeButtonSafe(debugBtn, () => { debugOn = !debugOn; debugBtn.classList.toggle('active', debugOn); if (debugOn) showDebugOverlay(); else hideDebugOverlay(); });
// Set up swipe controls for mobile (pointer events)
initSwipeControls();

// Pause button handler
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        togglePause();
    });
}

// Responsive canvas handling
function resizeCanvas() {
    // Keep the canvas square and fit within the viewport with a small margin
    let margin = 40; // px

    // If portrait on mobile, reserve some vertical space for UI (menus, buttons)
    let reserve = 0;
    if (window.innerHeight > window.innerWidth) {
        // Reserve ~120-160px for menus/controls in portrait mode
        reserve = 140;
        // reduce margin a bit on small screens
        margin = 12;
    }

    const maxSize = Math.min(window.innerWidth, window.innerHeight - reserve) - margin;
    const size = Math.max(200, Math.min(800, maxSize)); // clamp to reasonable range

    // Support high-DPI displays for crisp rendering
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.floor(size * ratio);
    canvas.height = Math.floor(size * ratio);

    // Reset transforms and scale drawing so code can use CSS pixel coordinates
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    // GRID_SIZE is measured in CSS pixels
    GRID_SIZE = size / TILE_COUNT;
}

// Enable or disable pointer events on the canvas. When overlays/screens are visible
// we disable canvas pointer handling so buttons inside the overlay receive pointer events.
function setCanvasInteractive(enabled) {
    try {
        canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    } catch (_) {}
}

// Initialize canvas interactive state depending on whether start screen is visible
try {
    if (startScreen && startScreen.classList.contains('active')) setCanvasInteractive(false);
    else setCanvasInteractive(true);
} catch (_) {}

// Disable or enable body scrolling (used to stop the page from moving on mobile swipes)
function setBodyScrollEnabled(enabled) {
    try {
        document.body.style.overflow = enabled ? '' : 'hidden';
        document.documentElement.style.overflow = enabled ? '' : 'hidden';
    } catch (_) {}
}

// Initialize canvas interactive state depending on whether start screen is visible
try {
    if (startScreen && startScreen.classList.contains('active')) {
        setCanvasInteractive(false);
        setBodyScrollEnabled(true); // allow scrolling on start screen by default
    } else {
        setCanvasInteractive(true);
        setBodyScrollEnabled(true);
    }
} catch (_) {}

// Debounced resize to avoid thrashing
let _resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimeout);
    _resizeTimeout = setTimeout(() => {
        resizeCanvas();
    }, 120);
});

// Call once to initialize canvas size
resizeCanvas();

function handleInput(e) {
    if (!isGameRunning) return;

    // Spacebar should toggle pause/resume when the game is running
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        togglePause();
        return;
    }

    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            if (direction.y === 0) nextDirection = { x: 0, y: -1 };
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            if (direction.y === 0) nextDirection = { x: 0, y: 1 };
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            if (direction.x === 0) nextDirection = { x: -1, y: 0 };
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            if (direction.x === 0) nextDirection = { x: 1, y: 0 };
            break;
    }
}

// Swipe handling: translate swipe gestures on the canvas into directional input
function initSwipeControls() {
    let swipeStart = null;
    const threshold = 30; // minimum px to consider a swipe

    // Double-tap detection
    let lastTap = { t: 0, x: 0, y: 0 };
    const doubleTapTimeout = 300; // ms
    const doubleTapDist = 40; // px

    function onPointerDown(e) {
        // Only respond when game is running
        if (!isGameRunning) return;

        const now = Date.now();
        const x = e.clientX;
        const y = e.clientY;

        // Detect double-tap: two taps within timeout and small distance
        if (now - lastTap.t < doubleTapTimeout && Math.hypot(x - lastTap.x, y - lastTap.y) < doubleTapDist) {
            // clear lastTap so triple-tap doesn't retrigger
            lastTap.t = 0;
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            togglePause();
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            return;
        }

        // Not a double-tap: record this tap and start swipe
        lastTap = { t: now, x, y };

        // Capture pointer to receive the up event even if finger moves off-canvas
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        swipeStart = { x: x, y: y, t: now };
        e.preventDefault();
    }

    // Prevent native touch scrolling while interacting with the canvas
    // Use a non-passive listener so e.preventDefault() works
    try {
        canvas.addEventListener('touchmove', function (ev) {
            if (isGameRunning) ev.preventDefault();
        }, { passive: false });
        canvas.addEventListener('touchstart', function (ev) {
            if (isGameRunning) ev.preventDefault();
        }, { passive: false });
    } catch (_) {}

    function onPointerUp(e) {
        if (!swipeStart) return;
        const dx = e.clientX - swipeStart.x;
        const dy = e.clientY - swipeStart.y;
        // Determine dominant direction
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
            swipeStart = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            return; // too small -> ignore (could be a tap)
        }

        if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal swipe
            if (dx > 0) {
                // Right
                if (direction.x === 0) nextDirection = { x: 1, y: 0 };
            } else {
                // Left
                if (direction.x === 0) nextDirection = { x: -1, y: 0 };
            }
        } else {
            // Vertical swipe
            if (dy > 0) {
                // Down
                if (direction.y === 0) nextDirection = { x: 0, y: 1 };
            } else {
                // Up
                if (direction.y === 0) nextDirection = { x: 0, y: -1 };
            }
        }

        swipeStart = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
    }

    function onPointerCancel(e) {
        swipeStart = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
}

function startGame() {
    initAudio(); // Initialize audio context on user gesture
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    startEngine();

    // Reset State
    snake = [
        { x: 10, y: 10 }, // Head
        { x: 9, y: 10 },
        { x: 8, y: 10 }
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    scoreElement.textContent = `Score: ${score}`;
    isGameRunning = true;
    isPaused = false;

    // Enable pause button now that the game is active
    if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('active');
        pauseBtn.textContent = 'Pause';
        pauseBtn.setAttribute('aria-pressed', 'false');
    }

    // UI
    startScreen.classList.add('hidden');
    startScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');
    gameOverScreen.classList.remove('active');
    // Re-enable canvas interaction now the overlay is hidden
    setCanvasInteractive(true);
    spawnFood();

    if (gameLoopId) clearInterval(gameLoopId);
    gameLoopId = setInterval(gameLoop, GAME_SPEED);

    // Start background music on user gesture (if available and not muted)
    try {
        if (bgMusic && !isMuted) {
            // some browsers require play() to be called on a user gesture
            const p = bgMusic.play();
            if (p && p.catch) p.catch(() => {});
        }
    } catch (_) {}
    // Disable body scrolling while the game runs
    try { setBodyScrollEnabled(false); } catch (_) {}
}

function update() {
    direction = nextDirection;

    // Compute next head position and wrap around borders (toroidal world)
    let nextX = snake[0].x + direction.x;
    let nextY = snake[0].y + direction.y;
    // Wrap horizontally and vertically
    nextX = (nextX + TILE_COUNT) % TILE_COUNT;
    nextY = (nextY + TILE_COUNT) % TILE_COUNT;
    const head = { x: nextX, y: nextY };

    // Self Collision
    for (let segment of snake) {
        if (head.x === segment.x && head.y === segment.y) {
            gameOver();
            return;
        }
    }

    snake.unshift(head);

    // Food Collision
    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreElement.textContent = `Score: ${score}`;
        playMeow(); // Play sound
        spawnFood();
    } else {
        snake.pop();
    }
}

function spawnFood() {
    food = {
        x: Math.floor(Math.random() * TILE_COUNT),
        y: Math.floor(Math.random() * TILE_COUNT)
    };
    // Avoid spawning on the snake
    for (let segment of snake) {
        if (segment.x === food.x && segment.y === food.y) {
            spawnFood();
            return;
        }
    }
}

// Audio Context
let audioCtx;
let engineOscillator;
let engineGain;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function startEngine() {
    if (!audioCtx) return;

    // Stop existing engine if running
    if (engineOscillator) {
        stopEngine();
    }

    engineOscillator = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    // Engine rumble setup
    engineOscillator.type = 'sawtooth';
    engineOscillator.frequency.value = 60; // Low rumble

    // Lowpass filter to muffle the sound
    filter.type = 'lowpass';
    filter.frequency.value = 120;

    // Connect: Osc -> Filter -> Gain -> Dest
    engineOscillator.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioCtx.destination);

    // Low volume
    engineGain.gain.value = 0.05;

    engineOscillator.start();
}

function stopEngine() {
    if (engineOscillator) {
        // Fade out to avoid clicking
        const now = audioCtx.currentTime;
        if (engineGain) {
            engineGain.gain.setTargetAtTime(0, now, 0.1);
        }
        engineOscillator.stop(now + 0.2);
        engineOscillator = null;
        engineGain = null;
    }
}

function playMeow() {
    if (!audioCtx) return;

    const now = audioCtx.currentTime;

    // Oscillator 1: The main tone (Triangle)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'triangle';
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);

    // Oscillator 2: Harmonic support (Sine)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);

    // Pitch Envelope (Meow contour: Rise slightly then fall)
    // Start mid-high
    osc1.frequency.setValueAtTime(800, now);
    osc2.frequency.setValueAtTime(1600, now); // Octave up

    // Rise
    osc1.frequency.linearRampToValueAtTime(1100, now + 0.1);
    osc2.frequency.linearRampToValueAtTime(2200, now + 0.1);

    // Fall
    osc1.frequency.exponentialRampToValueAtTime(400, now + 0.4);
    osc2.frequency.exponentialRampToValueAtTime(800, now + 0.4);

    // Volume Envelope
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.2, now + 0.05); // Attack
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.4); // Decay

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    osc1.start(now);
    osc1.stop(now + 0.4);
    osc2.start(now);
    osc2.stop(now + 0.4);
}

function playVictory() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.5);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.8);
}

function toggleMute() {
    isMuted = !isMuted;
    try {
        if (bgMusic) {
            bgMusic.muted = isMuted;
            // if unmuting and game is running, resume playback on user gesture
            if (!isMuted && isGameRunning) {
                const p = bgMusic.play(); if (p && p.catch) p.catch(()=>{});
            }
        }
    } catch (_) {}

    if (muteBtn) {
        if (isMuted) {
            muteBtn.classList.add('active');
            muteBtn.textContent = '🔇';
            muteBtn.setAttribute('aria-pressed', 'true');
        } else {
            muteBtn.classList.remove('active');
            muteBtn.textContent = '🔈';
            muteBtn.setAttribute('aria-pressed', 'false');
        }
    }
}

function draw() {
    // Clear Canvas
    ctx.fillStyle = '#ecf0f1'; // Match CSS canvas bg
    // Use CSS pixel dimensions because `ctx` is transformed for devicePixelRatio
    const cssW = canvas.clientWidth || (canvas.width / (window.devicePixelRatio || 1));
    const cssH = canvas.clientHeight || (canvas.height / (window.devicePixelRatio || 1));
    ctx.fillRect(0, 0, cssW, cssH);

    // Draw a black border around the playing field so UI outside won't overlap sprites
    try {
        const borderWidth = Math.max(2, Math.floor(GRID_SIZE * 0.06));
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = '#000000';
        // inset by half line width for crispness
        const inset = borderWidth / 2;
        ctx.strokeRect(inset, inset, cssW - borderWidth, cssH - borderWidth);
    } catch (e) {
        // ignore drawing border if something goes wrong
    }

    // Draw Food (Mouse)
    drawMouse(food.x, food.y);

    // Draw Snake
    snake.forEach((segment, index) => {
        if (index === 0) {
            drawHead(segment.x, segment.y);
        } else {
            drawTailSegment(segment.x, segment.y);
        }
    });

    if (debugOn) updateDebugOverlay();
}

function showDebugOverlay() {
    if (debugOverlay) return;
    debugOverlay = document.createElement('div');
    debugOverlay.className = 'debug-overlay';
    debugOverlay.id = 'debug-overlay';
    debugOverlay.innerHTML = '<div id="dbg-text">Debug: waiting for events...</div>';
    document.body.appendChild(debugOverlay);

    // Track pointer events to show markers
    window.addEventListener('pointerdown', debugPointerDown);
    window.addEventListener('pointermove', debugPointerMove);
    window.addEventListener('pointerup', debugPointerUp);
}

function hideDebugOverlay() {
    if (!debugOverlay) return;
    window.removeEventListener('pointerdown', debugPointerDown);
    window.removeEventListener('pointermove', debugPointerMove);
    window.removeEventListener('pointerup', debugPointerUp);
    debugOverlay.remove();
    debugOverlay = null;
}

let lastPointer = null;
function debugPointerDown(e) {
    lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
    placeDebugMarker(e.clientX, e.clientY, 'down');
    updateDebugOverlay();
}

function debugPointerMove(e) {
    lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
    updateDebugOverlay();
}

function debugPointerUp(e) {
    placeDebugMarker(e.clientX, e.clientY, 'up');
    updateDebugOverlay();
}

function placeDebugMarker(x, y, type) {
    if (!debugOverlay) return;
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.style.left = (x - 5) + 'px';
    marker.style.top = (y - 5) + 'px';
    marker.style.background = (type === 'down') ? 'rgba(0,255,0,0.9)' : 'rgba(255,0,0,0.9)';
    marker.style.zIndex = 99999;
    document.body.appendChild(marker);
    setTimeout(() => marker.remove(), 700);
}

function updateDebugOverlay() {
    if (!debugOverlay) return;
    const canvasRect = canvas.getBoundingClientRect();
    const controlsRect = document.getElementById('controls').getBoundingClientRect();
    const dbg = document.getElementById('dbg-text');
    const p = lastPointer ? `${lastPointer.x}, ${lastPointer.y}` : 'none';
    dbg.innerText = `canvas: ${Math.round(canvasRect.left)},${Math.round(canvasRect.top)} ${Math.round(canvasRect.width)}x${Math.round(canvasRect.height)}\n` +
                    `controls: ${Math.round(controlsRect.left)},${Math.round(controlsRect.top)} ${Math.round(controlsRect.width)}x${Math.round(controlsRect.height)}\n` +
                    `pointer: ${p}`;
}

// Main loop wrapper with error handling so failures show on-screen
function gameLoop() {
    try {
        update();
        draw();
    } catch (err) {
        console.error('Game loop error:', err);
        showRuntimeError(err && err.stack ? err.stack.toString() : String(err));
        if (gameLoopId) {
            clearInterval(gameLoopId);
            gameLoopId = null;
        }
    }
}

// Runtime error overlay (visible on-device when devtools aren't available)
function showRuntimeError(message) {
    let overlay = document.getElementById('runtime-error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'runtime-error-overlay';
        overlay.style.position = 'fixed';
        overlay.style.left = '10px';
        overlay.style.right = '10px';
        overlay.style.top = '10px';
        overlay.style.bottom = '10px';
        overlay.style.background = 'rgba(20,20,20,0.95)';
        overlay.style.color = '#fff';
        overlay.style.padding = '12px';
        overlay.style.zIndex = 9999;
        overlay.style.overflow = 'auto';
        overlay.style.fontFamily = 'monospace';
        overlay.style.fontSize = '12px';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.position = 'absolute';
        closeBtn.style.right = '12px';
        closeBtn.style.top = '12px';
        closeBtn.addEventListener('click', () => { overlay.remove(); });
        overlay.appendChild(closeBtn);

        const pre = document.createElement('pre');
        pre.id = 'runtime-error-pre';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.marginTop = '40px';
        overlay.appendChild(pre);

        document.body.appendChild(overlay);
    }

    const pre = document.getElementById('runtime-error-pre');
    if (pre) pre.textContent = message;
}

function drawHead(x, y) {
    const px = x * GRID_SIZE;
    const py = y * GRID_SIZE;
    const cx = px + GRID_SIZE / 2;
    const cy = py + GRID_SIZE / 2;

    // Milk Carton Body (The "Car") - keep proportions relative to GRID_SIZE
    ctx.fillStyle = COLORS.milkCarton;
    const bodyMargin = Math.max(1, GRID_SIZE * 0.03);
    const bodySize = GRID_SIZE - bodyMargin * 2;
    // Draw the carton body centered in the tile
    ctx.fillRect(px + bodyMargin, py + bodyMargin, bodySize, bodySize);

    // Blue detail: draw a quadratic (square) detail centered on the carton
    ctx.fillStyle = COLORS.milkCartonDetail;
    const detailSize = Math.max(4, GRID_SIZE * 0.48); // roughly half the tile, but not too small
    const detailX = cx - detailSize / 2;
    const detailY = cy - detailSize / 2;
    ctx.fillRect(detailX, detailY, detailSize, detailSize);

    // Ponki's Head (cat-like head scaled to GRID_SIZE)
    const headRadius = Math.max(6, GRID_SIZE * 0.34);
    const headOffsetY = GRID_SIZE * 0.06; // slight upward offset

    // Head (black)
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(cx, cy - headOffsetY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Ears: draw each ear using transforms so we can rotate them
    const earW = Math.max(8, headRadius * 1.0);
    const earH = Math.max(10, headRadius * 1.2);
    const earOffsetX = headRadius * 0.7;
    // base sits near the top edge of the head so the tip projects above
    const earBaseY = cy - headOffsetY - headRadius * 0.45;
    const earTipY = cy - headOffsetY - headRadius - earH * 0.35;

    // Left ear: rotate slightly toward upper-left
    ctx.save();
    const leftAngle = -0.45; // radians (rotate up-left)
    ctx.translate(cx - earOffsetX, earBaseY);
    ctx.rotate(leftAngle);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-earW * 0.6, -earH * 0.4);
    ctx.lineTo(earW * 0.2, -earH);
    ctx.closePath();
    ctx.fill();
    // inner left ear
    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.moveTo(-earW * 0.06, -earH * 0.06);
    ctx.lineTo(-earW * 0.38, -earH * 0.32);
    ctx.lineTo(earW * 0.06, -earH * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Right ear: rotate slightly toward upper-right
    ctx.save();
    const rightAngle = 0.45; // radians (rotate up-right)
    ctx.translate(cx + earOffsetX, earBaseY);
    ctx.rotate(rightAngle);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(earW * 0.6, -earH * 0.4);
    ctx.lineTo(-earW * 0.2, -earH);
    ctx.closePath();
    ctx.fill();
    // inner right ear
    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.moveTo(earW * 0.06, -earH * 0.06);
    ctx.lineTo(earW * 0.38, -earH * 0.32);
    ctx.lineTo(-earW * 0.06, -earH * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Eyes: yellow almond shapes
    ctx.fillStyle = '#F1C40F';
    const eyeOffsetX = Math.max(3, headRadius * 0.45);
    const eyeOffsetY = Math.max(2, headRadius * 0.05);
    const eyeRadiusX = Math.max(3, headRadius * 0.36);
    const eyeRadiusY = Math.max(2, headRadius * 0.18);

    // left eye (slightly rotated)
    drawFilledEllipse(cx - eyeOffsetX, cy - headOffsetY - eyeOffsetY, eyeRadiusX, eyeRadiusY, -0.25, '#F1C40F');
    // right eye
    drawFilledEllipse(cx + eyeOffsetX, cy - headOffsetY - eyeOffsetY, eyeRadiusX, eyeRadiusY, 0.25, '#F1C40F');

    // Pupils: narrow vertical black slits
    ctx.fillStyle = '#000000';
    const pupilW = Math.max(1, eyeRadiusX * 0.26);
    const pupilH = Math.max(3, eyeRadiusY * 1.8);
    // left pupil
    drawFilledEllipse(cx - eyeOffsetX, cy - headOffsetY - eyeOffsetY, pupilW, pupilH, 0, '#000000');
    // right pupil
    drawFilledEllipse(cx + eyeOffsetX, cy - headOffsetY - eyeOffsetY, pupilW, pupilH, 0, '#000000');

    // Whiskers: white thin lines
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(0.8, GRID_SIZE * 0.02);
    ctx.beginPath();
    // left whiskers (three lines)
    ctx.moveTo(cx - GRID_SIZE * 0.08, cy - GRID_SIZE * 0.02);
    ctx.lineTo(cx - GRID_SIZE * 0.45, cy - GRID_SIZE * 0.03);
    ctx.moveTo(cx - GRID_SIZE * 0.08, cy + GRID_SIZE * 0.01);
    ctx.lineTo(cx - GRID_SIZE * 0.45, cy + GRID_SIZE * 0.02);
    ctx.moveTo(cx - GRID_SIZE * 0.08, cy + GRID_SIZE * 0.05);
    ctx.lineTo(cx - GRID_SIZE * 0.45, cy + GRID_SIZE * 0.07);
    // right whiskers
    ctx.moveTo(cx + GRID_SIZE * 0.08, cy - GRID_SIZE * 0.02);
    ctx.lineTo(cx + GRID_SIZE * 0.45, cy - GRID_SIZE * 0.03);
    ctx.moveTo(cx + GRID_SIZE * 0.08, cy + GRID_SIZE * 0.01);
    ctx.lineTo(cx + GRID_SIZE * 0.45, cy + GRID_SIZE * 0.02);
    ctx.moveTo(cx + GRID_SIZE * 0.08, cy + GRID_SIZE * 0.05);
    ctx.lineTo(cx + GRID_SIZE * 0.45, cy + GRID_SIZE * 0.07);
    ctx.stroke();

    // Paws (white patches)
    ctx.fillStyle = COLORS.ponkiPaws;
    const pawRadius = Math.max(1, GRID_SIZE * 0.12);
    ctx.beginPath();
    ctx.arc(cx - GRID_SIZE * 0.2, cy + GRID_SIZE * 0.28, pawRadius, 0, Math.PI * 2);
    ctx.arc(cx + GRID_SIZE * 0.2, cy + GRID_SIZE * 0.28, pawRadius, 0, Math.PI * 2);
    ctx.fill();

}

function drawTailSegment(x, y) {
    const px = x * GRID_SIZE;
    const py = y * GRID_SIZE;

    // Simple tail segment drawing (a small mouse-like circle)
    ctx.fillStyle = COLORS.mouse;
    ctx.beginPath();
    ctx.arc(px + GRID_SIZE / 2, py + GRID_SIZE / 2, Math.max(2, GRID_SIZE / 3), 0, Math.PI * 2);
    ctx.fill();

    // Tail connector (visual flair)
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = Math.max(1, GRID_SIZE * 0.05);
    ctx.beginPath();
    ctx.moveTo(px + GRID_SIZE / 2, py + GRID_SIZE / 2);
    ctx.lineTo(px + GRID_SIZE / 2, py + GRID_SIZE / 2); // placeholder (could connect to prev segment)
    ctx.stroke();
}

function drawMouse(x, y) {
    const px = x * GRID_SIZE;
    const py = y * GRID_SIZE;
    const cx = px + GRID_SIZE / 2;
    const cy = py + GRID_SIZE / 2;

    // Body
    ctx.fillStyle = COLORS.mouse;
    const bodyRadius = Math.max(3, GRID_SIZE / 3);
    ctx.beginPath();
    ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.fillStyle = COLORS.mouseEars;
    const earRadius = Math.max(1, GRID_SIZE * 0.12);
    const earOffsetX = GRID_SIZE * 0.28;
    const earOffsetY = GRID_SIZE * 0.22;
    ctx.beginPath();
    ctx.arc(cx - earOffsetX, cy - earOffsetY, earRadius, 0, Math.PI * 2);
    ctx.arc(cx + earOffsetX, cy - earOffsetY, earRadius, 0, Math.PI * 2);
    ctx.fill();
}

function gameOver() {
    // Stop the main loop
    if (gameLoopId) {
        clearInterval(gameLoopId);
        gameLoopId = null;
    }

    // Stop audio engine gracefully
    try { stopEngine(); } catch (_) {}

    isGameRunning = false;
    isPaused = false;

    // Update UI
    try {
        if (finalScoreElement) finalScoreElement.textContent = score;
        if (gameOverScreen) {
            gameOverScreen.classList.remove('hidden');
            gameOverScreen.classList.add('active');
        }
        if (startScreen) {
            startScreen.classList.remove('active');
            startScreen.classList.add('hidden');
        }
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.classList.remove('active');
            pauseBtn.textContent = 'Pause';
            pauseBtn.setAttribute('aria-pressed', 'false');
        }
    } catch (e) {
        // If DOM updates fail for any reason, log but don't throw
        console.warn('gameOver UI update failed', e);
    }

    // Disable canvas interaction while game-over overlay is visible
    setCanvasInteractive(false);

    // Pause background music when game ends
    try { if (bgMusic) bgMusic.pause(); } catch (_) {}
        // Re-enable body scrolling when game ends
        try { setBodyScrollEnabled(true); } catch (_) {}
}

function win() {
    // Stop the main loop
    if (gameLoopId) {
        clearInterval(gameLoopId);
        gameLoopId = null;
    }

    // Stop engine but leave audio context available for victory sound
    try { stopEngine(); } catch (_) {}

    isGameRunning = false;
    isPaused = false;

    // Play victory sound
    try { playVictory(); } catch (_) {}

    // Update UI: show win screen
    try {
        if (winScoreElement) winScoreElement.textContent = score;
        if (winScreen) {
            winScreen.classList.remove('hidden');
            winScreen.classList.add('active');
        }
        if (gameOverScreen) {
            gameOverScreen.classList.remove('active');
            gameOverScreen.classList.add('hidden');
        }
        if (startScreen) {
            startScreen.classList.remove('active');
            startScreen.classList.add('hidden');
        }
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.classList.remove('active');
            pauseBtn.textContent = 'Pause';
            pauseBtn.setAttribute('aria-pressed', 'false');
        }
    } catch (e) {
        console.warn('win UI update failed', e);
    }

    // Pause background music when the player wins (leave option to restart)
    try { if (bgMusic) bgMusic.pause(); } catch (_) {}

    // Disable canvas interaction while win overlay is visible
    setCanvasInteractive(false);
    // Re-enable body scrolling when win overlay is shown
    try { setBodyScrollEnabled(true); } catch (_) {}
}

// Pause / Resume controls
function togglePause() {
    if (!isGameRunning) return;
    if (isPaused) {
        resumeGame();
    } else {
        pauseGame();
    }
}

function pauseGame() {
    if (!isGameRunning || isPaused) return;
    isPaused = true;

    // Stop the loop
    if (gameLoopId) {
        clearInterval(gameLoopId);
        gameLoopId = null;
    }

    // Gentle audio fade or stop
    try {
        if (engineGain && audioCtx) {
            const now = audioCtx.currentTime;
            engineGain.gain.setTargetAtTime(0, now, 0.05);
        }
    } catch (_) {}

    if (pauseBtn) {
        pauseBtn.classList.add('active');
        pauseBtn.textContent = 'Resume';
        pauseBtn.setAttribute('aria-pressed', 'true');
    }

    // Pause background music (but keep its position)
    try { if (bgMusic) bgMusic.pause(); } catch (_) {}
}

function resumeGame() {
    if (!isGameRunning || !isPaused) return;
    isPaused = false;

    // Ensure audio context is resumed and engine restarts
    try {
        initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        startEngine();
    } catch (_) {}

    // Restart loop
    if (!gameLoopId) gameLoopId = setInterval(gameLoop, GAME_SPEED);

    if (pauseBtn) {
        pauseBtn.classList.remove('active');
        pauseBtn.textContent = 'Pause';
        pauseBtn.setAttribute('aria-pressed', 'false');
    }

    // Resume background music if not muted
    try { if (bgMusic && !isMuted) { const p = bgMusic.play(); if (p && p.catch) p.catch(()=>{}); } } catch (_) {}
}
