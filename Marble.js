const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = 400;
canvas.height = 600;

// ---------- Tunables ----------
const BALL_SPEED = 12;        // was 7 -- marbles fly much faster now
const BALL_RADIUS = 12;
const LAUNCH_GAP = 5;         // frames between marbles in a volley stream
const COLS = 8;               // 8 columns x 50px = 400px canvas width
const MIN_BLOCKS = 6;
const MAX_BLOCKS = 9;
const BLOCK_SIZE = 45;
const ROW_H = 50;
const TOP_LIMIT = 100;        // blocks touching this line = game over
const COLLECT_Y = 55;         // marbles above this (moving up) get collected
const START_AMMO = 8;
const BALL_TIMEOUT = 60 * 30; // failsafe: force-collect a marble after ~30s

// ---------- State ----------
let score = 0;
let wave = 1;
let frame = 0;

let balls = [];          // marbles in flight
let blocks = [];
let fallingBalls = [];   // marbles animating into the collector
let ammo = [];           // inventory queue of values (front = first out)
let pendingShots = [];   // values waiting to launch during the current volley
let lockedDir = null;    // aim direction captured at the moment of the click
let turnInProgress = false;
let gameIsOver = false;
let isPaused = false;
let isSpeedBoosted = false;
let targetBlockCount = rollBlockTarget();

const mouse = { x: 200, y: 400 };

const scoreText = document.getElementById("score");
const bestText = document.getElementById("best");
const waveText = document.getElementById("wave");
const statusText = document.getElementById("statusText");
const gameOverBox = document.getElementById("gameOver");
const resetBtn = document.getElementById("resetBtn");
const pauseBtn = document.getElementById("pauseBtn");
const speedBtn = document.getElementById("speedBtn");
const playAgainBtn = document.getElementById("playAgainBtn");

if (window.PP) {
    PP.startCoinTimer({ rate: 2, isActive: () => !gameIsOver && !isPaused });
}

function bestStorageKey() {
    if (window.PP && typeof PP.storageKey === "function") {
        return PP.storageKey("marble-best");
    }

    return "marble-best:guest";
}

function loadBestScore() {
    return Number(localStorage.getItem(bestStorageKey())) || 0;
}

let bestScore = loadBestScore();

const colors = ["#ff5252", "#42a5f5", "#66bb6a", "#ffeb3b", "#ab47bc"];

const shooter = { x: 200, y: 62 };        // shooter lives at the TOP now
const FUNNEL_MOUTH = { x: 200, y: 30 };   // collected marbles converge here

function rollBlockTarget() {
    return Math.floor(MIN_BLOCKS + Math.random() * (MAX_BLOCKS - MIN_BLOCKS + 1));
}

function blockRowIndex(block) {
    return Math.round((canvas.height - block.targetY) / ROW_H) - 1;
}

function occupiedSlots() {
    const used = new Set();
    for (const block of blocks) {
        used.add(`${blockRowIndex(block)}:${Math.round(block.x / ROW_H)}`);
    }
    return used;
}

function updateHud() {
    scoreText.textContent = fmt(score);
    bestText.textContent = fmt(bestScore);
    waveText.textContent = String(wave);
}

function saveBestScore() {
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem(bestStorageKey(), String(bestScore));
        updateHud();
    }
}

function addScore(amount) {
    score += amount;
    saveBestScore();
    updateHud();
}

function setStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    }
}

function setPaused(nextPaused) {
    if (gameIsOver) return;

    isPaused = nextPaused;
    if (pauseBtn) {
        pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    }
    setStatus(isPaused ? "Paused." : "Ready to launch.");
}

function setSpeedBoost(nextBoosted) {
    if (gameIsOver) return;

    isSpeedBoosted = nextBoosted;
    if (speedBtn) {
        speedBtn.textContent = isSpeedBoosted ? "Speeding" : "Speed Up";
    }

    if (!isPaused) {
        setStatus(isSpeedBoosted ? "Speed boost active." : "Ready to launch.");
    }
}

function fireVolley() {
    if (gameIsOver || turnInProgress || ammo.length === 0 || isPaused) return;

    lockedDir = aimDirection();
    pendingShots = ammo;
    ammo = [];
    turnInProgress = true;
    setStatus("Volley in motion.");
}

// values double forever (1, 2, 4, 8...): first 5 tiers use the palette,
// higher tiers get generated hues so colors never run out
function colorFor(value) {
    const tier = Math.round(Math.log2(value));
    if (tier < colors.length) return colors[tier];
    return `hsl(${(tier * 47) % 360}, 75%, 60%)`;
}

// 1500 -> "1.5K", 150000000 -> "150M"
function fmt(n) {
    if (n >= 1e12) return trimNum(n / 1e12) + "T";
    if (n >= 1e9)  return trimNum(n / 1e9) + "B";
    if (n >= 1e6)  return trimNum(n / 1e6) + "M";
    if (n >= 1e3)  return trimNum(n / 1e3) + "K";
    return String(n);
}
function trimNum(x) {
    return (Math.round(x * 10) / 10).toString();
}

// ---------- Ball ----------
class Ball {
    constructor(x, y, value, dx, dy) {
        this.x = x;
        this.y = y;
        this.r = BALL_RADIUS;
        this.value = value;
        this.dx = dx;
        this.dy = dy;
        this.active = true;
        this.collected = false;
        this.age = 0;
    }

    get color() {
        return colorFor(this.value);
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();

        ctx.fillStyle = "black";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.fillText(fmt(this.value), this.x, this.y + 4);
    }

    update() {
        this.x += this.dx;
        this.y += this.dy;
        this.age++;

        // side walls
        if (this.x < this.r) {
            this.x = this.r;
            this.dx *= -1;
            this.unstick();
        }
        if (this.x > canvas.width - this.r) {
            this.x = canvas.width - this.r;
            this.dx *= -1;
            this.unstick();
        }

        // bottom wall bounces (blocks live down there now)
        if (this.y > canvas.height - this.r) {
            this.y = canvas.height - this.r;
            this.dy *= -1;
        }

        // back at the top and moving upward -> collected
        if ((this.y < COLLECT_Y && this.dy < 0) || this.age > BALL_TIMEOUT) {
            this.active = false;
            fallingBalls.push(this);
        }
    }

    // no gravity: a nearly-horizontal marble would ping-pong between the
    // walls forever and never reach the collector, so nudge it upward
    unstick() {
        if (Math.abs(this.dy) < 1) this.dy -= 1;
    }
}

// ---------- Block ----------
class Block {
    constructor(col, y, hp) {
        this.x = col * ROW_H + (ROW_H - BLOCK_SIZE) / 2;
        this.y = y;
        this.targetY = y;   // blocks ease toward targetY when rows rise
        this.size = BLOCK_SIZE;
        this.hp = hp;
    }

    draw() {
        // hue shifts per order of magnitude so a 2M block reads
        // differently than a 200 block at a glance
        const tier = Math.floor(Math.log10(Math.max(this.hp, 1)));
        ctx.fillStyle = `hsl(${(tier * 45) % 360}, 35%, 42%)`;
        ctx.fillRect(this.x, this.y, this.size, this.size);

        ctx.fillStyle = "white";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "center";
        ctx.fillText(fmt(this.hp), this.x + this.size / 2, this.y + this.size / 2 + 5);
    }

    update() {
        this.y += (this.targetY - this.y) * 0.15;
    }
}

// exponential HP growth: tune the 1.18 base to make the ramp gentler or harsher.
function rollBlockHp() {
    const base = wave * Math.pow(1.18, wave);
    return Math.max(1, Math.floor(base * (0.7 + Math.random() * 0.6)));
}

function spawnBlockAt(rowIndex, usedSlots) {
    const candidates = [];

    for (let col = 0; col < COLS; col++) {
        const slot = `${rowIndex}:${col}`;
        if (!usedSlots.has(slot)) {
            candidates.push(col);
        }
    }

    if (!candidates.length) return false;

    const col = candidates[Math.floor(Math.random() * candidates.length)];
    const y = canvas.height - ROW_H * (rowIndex + 1);
    blocks.push(new Block(col, y, rollBlockHp()));
    usedSlots.add(`${rowIndex}:${col}`);
    return true;
}

function refillBlockField() {
    targetBlockCount = rollBlockTarget();
    const usedSlots = occupiedSlots();

    while (blocks.length < targetBlockCount) {
        const rowIndex = blocks.length < COLS ? 0 : 1;
        let spawned = spawnBlockAt(rowIndex, usedSlots);
        if (!spawned && rowIndex === 0) {
            spawned = spawnBlockAt(1, usedSlots);
        }
        if (!spawned) {
            break;
        }
    }
}

// ---------- Aiming & shooting ----------
function aimDirection() {
    let dx = mouse.x - shooter.x;
    let dy = mouse.y - shooter.y;
    if (dy < 10) dy = 10; // shooter is at the top: only aim downward
    const len = Math.hypot(dx, dy);
    return { dx: dx / len, dy: dy / len };
}

function setAimFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
}

canvas.addEventListener("mousemove", event => {
    if (event.pointerType === "touch") return;
    setAimFromEvent(event);
});

canvas.addEventListener("pointermove", event => {
    if (!event.isPrimary) return;
    setAimFromEvent(event);
});

canvas.addEventListener("mousedown", () => {
    fireVolley();
});

canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    setAimFromEvent(event);
    canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointerup", event => {
    if (event.pointerType === "touch") {
        setAimFromEvent(event);
        fireVolley();
    }
});

window.addEventListener("keydown", event => {
    const step = 14;

    switch (event.key) {
        case "ArrowLeft":
            mouse.x = Math.max(30, mouse.x - step);
            event.preventDefault();
            break;
        case "ArrowRight":
            mouse.x = Math.min(canvas.width - 30, mouse.x + step);
            event.preventDefault();
            break;
        case "ArrowUp":
            mouse.y = Math.max(shooter.y + 12, mouse.y - step);
            event.preventDefault();
            break;
        case "ArrowDown":
            mouse.y = Math.min(canvas.height - 30, mouse.y + step);
            event.preventDefault();
            break;
        case " ":
        case "Enter":
            fireVolley();
            event.preventDefault();
            break;
        case "Escape":
            setPaused(!isPaused);
            event.preventDefault();
            break;
    }
});

// marbles stream out one per few frames along the locked aim; launching
// them literally on the same frame would stack same-value marbles on the
// same pixel and merge them instantly before they ever hit a block
function launchPending() {
    if (pendingShots.length === 0) return;
    if (frame % LAUNCH_GAP !== 0) return;

    const value = pendingShots.shift();
    balls.push(new Ball(
        shooter.x,
        shooter.y + 24,
        value,
        lockedDir.dx * BALL_SPEED,
        lockedDir.dy * BALL_SPEED
    ));
}

// ---------- Collisions ----------
function hitDetection() {
    for (const b of balls) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            const bl = blocks[i];

            // closest point on the block to the ball's center
            const cx = Math.max(bl.x, Math.min(b.x, bl.x + bl.size));
            const cy = Math.max(bl.y, Math.min(b.y, bl.y + bl.size));
            const dx = b.x - cx;
            const dy = b.y - cy;
            if (dx * dx + dy * dy > b.r * b.r) continue;

            // reflect off whichever face is closer, and push the ball out
            // so it can't register multiple hits on consecutive frames
            if (Math.abs(dx) > Math.abs(dy)) {
                b.dx *= -1;
                b.x = dx > 0 ? bl.x + bl.size + b.r : bl.x - b.r;
            } else {
                b.dy *= -1;
                b.y = dy > 0 ? bl.y + bl.size + b.r : bl.y - b.r;
            }

            const dmg = Math.min(b.value, bl.hp);
            bl.hp -= b.value;   // damage = the marble's full value
            addScore(dmg);

            if (bl.hp <= 0) {
                blocks.splice(i, 1);
                // broken block drops exactly ONE marble into play
                balls.push(new Ball(
                    bl.x + bl.size / 2,
                    bl.y + bl.size / 2,
                    Math.pow(2, Math.floor(Math.random() * 3)), // 1, 2, or 4
                    (Math.random() - 0.5) * BALL_SPEED,
                    -BALL_SPEED * 0.6
                ));
            }
        }
    }
}

// only identical marbles combine, and their value doubles.
function mergeMarbles() {
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i];
            const b = balls[j];

            if (!a.active || !b.active) continue;
            if (a.value !== b.value) continue;

            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist < a.r + b.r) {
                a.x = (a.x + b.x) / 2;
                a.y = (a.y + b.y) / 2;

                // renormalize to full speed: averaging two velocities can
                // produce a near-zero vector, which would strand the merged
                // marble mid-air with no gravity
                let ndx = (a.dx * a.value + b.dx * b.value) / Math.max(1, a.value + b.value);
                let ndy = (a.dy * a.value + b.dy * b.value) / Math.max(1, a.value + b.value);
                const sp = Math.hypot(ndx, ndy);
                if (sp < 1) { ndx = 0; ndy = -1; }
                else { ndx /= sp; ndy /= sp; }
                a.dx = ndx * BALL_SPEED;
                a.dy = ndy * BALL_SPEED;

                a.value *= 2;
                b.active = false;

                addScore(a.value);
            }
        }
    }
    balls = balls.filter(b => b.active);
}

// adjacent identical marbles in the inventory also merge, doubling in place.
function mergeAmmo() {
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < ammo.length - 1; i++) {
            if (ammo[i] != null && ammo[i + 1] != null && ammo[i] === ammo[i + 1]) {
                const newValue = ammo[i] * 2;
                ammo.splice(i, 2, newValue);
                addScore(newValue);
                merged = true;
                break; // restart the scan so cascades resolve front-first
            }
        }
    }
}

// ---------- Collection (top funnel) ----------
function collect() {
    for (const b of fallingBalls) {
        // ease toward the collector so the player can SEE marbles return
        b.x += (FUNNEL_MOUTH.x - b.x) * 0.15;
        b.y += (FUNNEL_MOUTH.y - b.y) * 0.15;

        if (Math.hypot(FUNNEL_MOUTH.x - b.x, FUNNEL_MOUTH.y - b.y) < 6) {
            ammo.push(b.value);
            b.collected = true;
        }
    }
    fallingBalls = fallingBalls.filter(b => !b.collected);
}

// ---------- Turn / wave flow ----------
function endTurn() {
    // every shot pushes all blocks one row closer to the top...
    for (const bl of blocks) bl.targetY -= ROW_H;
    // ...and the board refills only up to the low block cap
    refillBlockField();
    wave++;
    updateHud();
}

function checkGameOver() {
    if (gameIsOver) return;
    for (const bl of blocks) {
        if (bl.targetY <= TOP_LIMIT) {
            gameIsOver = true;
            saveBestScore();
            gameOverBox.querySelector("h2").textContent = "Game Over - Wave " + wave;
            gameOverBox.classList.add("show");
            setStatus("Block wall reached the danger line.");
            return;
        }
    }
}

// ---------- Drawing ----------
function drawDangerLine() {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,82,82,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, TOP_LIMIT);
    ctx.lineTo(canvas.width, TOP_LIMIT);
    ctx.stroke();
    ctx.restore();
}

function drawFunnel() {
    // inverted funnel hanging from the top edge
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(160, 0);
    ctx.lineTo(200, 55);
    ctx.lineTo(240, 0);
    ctx.fill();
}

function drawShooter() {
    if (turnInProgress || gameIsOver || ammo.length === 0) return;

    // dashed aim line that follows the mouse (downward only)
    const dir = aimDirection();
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(shooter.x, shooter.y + 14);
    ctx.lineTo(shooter.x + dir.dx * 110, shooter.y + 14 + dir.dy * 110);
    ctx.stroke();
    ctx.restore();

    // preview of the first marble in the volley
    const v = ammo[0];
    ctx.beginPath();
    ctx.arc(shooter.x, shooter.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(v);
    ctx.fill();

    ctx.fillStyle = "black";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(fmt(v), shooter.x, shooter.y + 4);
}

// full inventory row along the top, in firing order (leftmost = first out)
function drawInventory() {
    const r = 9;
    const spacing = 21;
    const startX = 14;
    const y = 16;
    const maxShown = 16;

    for (let i = 0; i < Math.min(ammo.length, maxShown); i++) {
        const x = startX + i * spacing;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colorFor(ammo[i]);
        ctx.fill();

        // highlight the marble that fires first
        if (i === 0) {
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.fillStyle = "black";
        ctx.font = "bold 9px Arial";
        ctx.textAlign = "center";
        ctx.fillText(fmt(ammo[i]), x, y + 3);
    }

    if (ammo.length > maxShown) {
        ctx.fillStyle = "white";
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.fillText("+" + (ammo.length - maxShown), startX + maxShown * spacing, y + 3);
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawDangerLine();

    for (const bl of blocks) bl.draw();
    for (const b of balls) b.draw();

    drawFunnel();
    for (const b of fallingBalls) b.draw();

    drawShooter();
    drawInventory();

    ctx.fillStyle = "white";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Wave " + wave, 8, TOP_LIMIT - 8);

    if (isPaused && !gameIsOver) {
        ctx.save();
        ctx.fillStyle = "rgba(5, 8, 6, 0.68)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#b9ff3e";
        ctx.font = "bold 28px Arial";
        ctx.textAlign = "center";
        ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }
}

// ---------- Reset & main loop ----------
function resetGame() {
    score = 0;
    wave = 1;
    balls = [];
    blocks = [];
    fallingBalls = [];
    ammo = [];
    pendingShots = [];
    turnInProgress = false;
    gameIsOver = false;
    isPaused = false;
    isSpeedBoosted = false;

    scoreText.textContent = "0";
    gameOverBox.classList.remove("show");
    if (pauseBtn) {
        pauseBtn.textContent = "Pause";
    }
    if (speedBtn) {
        speedBtn.textContent = "Speed Up";
    }
    setStatus("Ready to launch.");
    bestScore = loadBestScore();
    updateHud();

    for (let i = 0; i < START_AMMO; i++) {
        ammo.push(Math.pow(2, Math.floor(Math.random() * 3))); // 1, 2, or 4
    }

    refillBlockField();
}

resetBtn.addEventListener("click", resetGame);
if (playAgainBtn) {
    playAgainBtn.addEventListener("click", resetGame);
}
if (pauseBtn) {
    pauseBtn.addEventListener("click", () => setPaused(!isPaused));
}
if (speedBtn) {
    speedBtn.addEventListener("pointerdown", event => {
        speedBtn.setPointerCapture(event.pointerId);
        setSpeedBoost(true);
    });
    speedBtn.addEventListener("pointerup", () => setSpeedBoost(false));
    speedBtn.addEventListener("pointerleave", () => setSpeedBoost(false));
    speedBtn.addEventListener("pointercancel", () => setSpeedBoost(false));
    speedBtn.addEventListener("lostpointercapture", () => setSpeedBoost(false));
}

if (window.PP && typeof PP.onUsernameChange === "function") {
    PP.onUsernameChange(() => {
        bestScore = loadBestScore();
        updateHud();
    });
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        setPaused(true);
    }
});

function stepGame() {
    frame++;

    if (!gameIsOver && !isPaused) {
        launchPending();

        for (const b of balls) {
            if (b.active) b.update();
        }
        balls = balls.filter(b => b.active);

        collect();
        mergeAmmo();
        mergeMarbles();
        hitDetection();

        for (const bl of blocks) bl.update();

        // volley fully resolved -> blocks rise, board refills if needed
        if (turnInProgress &&
            pendingShots.length === 0 &&
            balls.length === 0 &&
            fallingBalls.length === 0) {
            turnInProgress = false;
            endTurn();
        }

        checkGameOver();
    }
}

function update() {
    const steps = isSpeedBoosted && !isPaused && !gameIsOver ? 3 : 1;
    for (let i = 0; i < steps; i++) {
        stepGame();
    }
    draw();
    requestAnimationFrame(update);
}

resetGame();
updateHud();
update();
