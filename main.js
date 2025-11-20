const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const finalScoreElement = document.getElementById('final-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const pauseBtn = document.getElementById('pause-btn');

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

// Input Handling
document.addEventListener('keydown', handleInput);
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
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
    const margin = 40; // px
    const maxSize = Math.min(window.innerWidth, window.innerHeight) - margin;
    const size = Math.max(240, Math.min(800, maxSize)); // clamp to reasonable range

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

    function onPointerDown(e) {
        // Only start swipe when game is running
        if (!isGameRunning) return;
        // Capture pointer to receive the up event even if finger moves off-canvas
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        swipeStart = { x: e.clientX, y: e.clientY, t: Date.now() };
        e.preventDefault();
    }

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

    spawnFood();

    if (gameLoopId) clearInterval(gameLoopId);
    gameLoopId = setInterval(gameLoop, GAME_SPEED);
}

function gameOver() {
    isGameRunning = false;
    clearInterval(gameLoopId);
    stopEngine();
    finalScoreElement.textContent = score;
    gameOverScreen.classList.remove('hidden');
    gameOverScreen.classList.add('active');
    // Disable pause button when game over
    if (pauseBtn) {
        pauseBtn.disabled = true;
    }
}

function togglePause() {
    if (isPaused) {
        resumeGame();
    } else {
        pauseGame();
    }
}

function pauseGame() {
    if (!isGameRunning) return; // only pause if running
    isPaused = true;
    isGameRunning = false;
    if (gameLoopId) {
        clearInterval(gameLoopId);
        gameLoopId = null;
    }
    // Stop sound engine while paused
    stopEngine();
    if (pauseBtn) {
        pauseBtn.classList.add('active');
        pauseBtn.textContent = 'Resume';
        pauseBtn.setAttribute('aria-pressed', 'true');
    }
}

function resumeGame() {
    if (!isPaused) return;
    // Resume audio context if necessary
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    startEngine();
    isPaused = false;
    isGameRunning = true;
    if (gameLoopId) clearInterval(gameLoopId);
    gameLoopId = setInterval(gameLoop, GAME_SPEED);
    if (pauseBtn) {
        pauseBtn.classList.remove('active');
        pauseBtn.textContent = 'Pause';
        pauseBtn.setAttribute('aria-pressed', 'false');
    }
}

function spawnFood() {
    food = {
        x: Math.floor(Math.random() * TILE_COUNT),
        y: Math.floor(Math.random() * TILE_COUNT)
    };
    // Make sure food doesn't spawn on snake
    for (let segment of snake) {
        if (segment.x === food.x && segment.y === food.y) {
            spawnFood();
            break;
        }
    }
}

function gameLoop() {
    update();
    draw();
}

function update() {
    direction = nextDirection;

    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    // Wall Collision
    if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
        gameOver();
        return;
    }

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

function draw() {
    // Clear Canvas
    ctx.fillStyle = '#ecf0f1'; // Match CSS canvas bg
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    // Ponki's Head (sizes and offsets relative to GRID_SIZE)
    const headRadius = Math.max(4, GRID_SIZE * 0.35);
    const headOffsetY = GRID_SIZE * 0.08; // raise head a bit above center
    ctx.fillStyle = COLORS.ponki;
    ctx.beginPath();
    ctx.arc(cx, cy - headOffsetY, headRadius, 0, Math.PI * 2);
    ctx.fill();
    // Ears: draw clearly above the head using proportions of headRadius
    const earWidth = Math.max(4, headRadius * 0.7);
    const earHeight = Math.max(5, headRadius * 0.9);
    const earOffsetX = headRadius * 0.7;
    const earTopY = cy - headOffsetY - headRadius - (earHeight * 0.2);

    ctx.fillStyle = COLORS.ponki; // ensure ear color matches head
    ctx.beginPath();
    // Left ear (triangle)
    ctx.moveTo(cx - earOffsetX, cy - headOffsetY - headRadius * 0.2);
    ctx.lineTo(cx - earOffsetX - earWidth * 0.5, earTopY);
    ctx.lineTo(cx - earOffsetX + earWidth * 0.4, earTopY + earHeight * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    // Right ear (triangle)
    ctx.moveTo(cx + earOffsetX, cy - headOffsetY - headRadius * 0.2);
    ctx.lineTo(cx + earOffsetX + earWidth * 0.5, earTopY);
    ctx.lineTo(cx + earOffsetX - earWidth * 0.4, earTopY + earHeight * 0.4);
    ctx.closePath();
    ctx.fill();
    // Outline the ears for better contrast on small/high-DPI displays
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, GRID_SIZE * 0.04);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    // Stroke left ear
    ctx.beginPath();
    ctx.moveTo(cx - earOffsetX, cy - headOffsetY - headRadius * 0.2);
    ctx.lineTo(cx - earOffsetX - earWidth * 0.5, earTopY);
    ctx.lineTo(cx - earOffsetX + earWidth * 0.4, earTopY + earHeight * 0.4);
    ctx.closePath();
    ctx.stroke();
    // Stroke right ear
    ctx.beginPath();
    ctx.moveTo(cx + earOffsetX, cy - headOffsetY - headRadius * 0.2);
    ctx.lineTo(cx + earOffsetX + earWidth * 0.5, earTopY);
    ctx.lineTo(cx + earOffsetX - earWidth * 0.4, earTopY + earHeight * 0.4);
    ctx.closePath();
    ctx.stroke();

    // Eyes
    ctx.fillStyle = '#F1C40F'; // Yellow eyes
    const eyeOffsetX = Math.max(2, GRID_SIZE * 0.12);
    const eyeOffsetY = Math.max(2, GRID_SIZE * 0.12);
    const eyeRadius = Math.max(1, GRID_SIZE * 0.06);
    ctx.beginPath();
    ctx.arc(cx - eyeOffsetX, cy - headOffsetY - (headRadius * 0.15), eyeRadius, 0, Math.PI * 2);
    ctx.arc(cx + eyeOffsetX, cy - headOffsetY - (headRadius * 0.15), eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    ctx.fillStyle = 'black';
    const pupilRadius = Math.max(0.5, eyeRadius * 0.4);
    ctx.beginPath();
    ctx.arc(cx - eyeOffsetX, cy - headOffsetY - (headRadius * 0.15), pupilRadius, 0, Math.PI * 2);
    ctx.arc(cx + eyeOffsetX, cy - headOffsetY - (headRadius * 0.15), pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    // Whiskers
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(0.5, GRID_SIZE * 0.02);
    ctx.beginPath();
    // Left whiskers
    ctx.moveTo(cx - GRID_SIZE * 0.08, cy - GRID_SIZE * 0.01);
    ctx.lineTo(cx - GRID_SIZE * 0.4, cy - GRID_SIZE * 0.02);
    ctx.moveTo(cx - GRID_SIZE * 0.08, cy + GRID_SIZE * 0.02);
    ctx.lineTo(cx - GRID_SIZE * 0.4, cy + GRID_SIZE * 0.04);
    // Right whiskers
    ctx.moveTo(cx + GRID_SIZE * 0.08, cy - GRID_SIZE * 0.01);
    ctx.lineTo(cx + GRID_SIZE * 0.4, cy - GRID_SIZE * 0.02);
    ctx.moveTo(cx + GRID_SIZE * 0.08, cy + GRID_SIZE * 0.02);
    ctx.lineTo(cx + GRID_SIZE * 0.4, cy + GRID_SIZE * 0.04);
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

    // Mouse attached to car
    ctx.fillStyle = COLORS.mouse;
    ctx.beginPath();
    ctx.arc(px + GRID_SIZE / 2, py + GRID_SIZE / 2, GRID_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();

    // Tail connecting to next segment (visual flair)
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + GRID_SIZE / 2, py + GRID_SIZE / 2);
    // Simple line to center, could be improved to connect to prev segment
    ctx.stroke();
}

function drawMouse(x, y) {
    const px = x * GRID_SIZE;
    const py = y * GRID_SIZE;
    // Center of the tile (CSS pixels, since ctx is scaled to CSS pixels)
    const cx = px + GRID_SIZE / 2;
    const cy = py + GRID_SIZE / 2;

    // Sizes relative to the tile size for consistent appearance across resolutions
    const bodyRadius = GRID_SIZE / 3;
    const earRadius = Math.max(1, GRID_SIZE * 0.12);
    const earOffsetX = GRID_SIZE * 0.28;
    const earOffsetY = GRID_SIZE * 0.22;

    // Body
    ctx.fillStyle = COLORS.mouse;
    ctx.beginPath();
    ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
    ctx.fill();

    // Ears (symmetrical left/right)
    ctx.fillStyle = COLORS.mouseEars;
    ctx.beginPath();
    ctx.arc(cx - earOffsetX, cy - earOffsetY, earRadius, 0, Math.PI * 2);
    ctx.arc(cx + earOffsetX, cy - earOffsetY, earRadius, 0, Math.PI * 2);
    ctx.fill();
}
