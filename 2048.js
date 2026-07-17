const SIZE = 4;

let board = [];
let score = 0;
let best = 0;
let gameOver = false;
let won = false;

const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score-stat");
const bestEl = document.getElementById("best-stat");
const bannerEl = document.getElementById("banner");
const newBtn = document.getElementById("new-game-btn");
const newBtnMobile = document.getElementById("new-game-btn-mobile");

if (window.PP) {
    PP.startCoinTimer({ rate: 1, isActive: () => !gameOver });
}

function bestStorageKey() {
    if (window.PP && typeof PP.storageKey === "function") {
        return PP.storageKey("2048-best");
    }

    return "2048-best:guest";
}

function loadBest() {
    return Number(localStorage.getItem(bestStorageKey())) || 0;
}

function saveBest() {
    localStorage.setItem(bestStorageKey(), String(best));
}

function init() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    score = 0;
    gameOver = false;
    won = false;
    bannerEl.textContent = "";
    best = loadBest();

    addRandomTile();
    addRandomTile();

    updateScore();
    drawBoard();
}

function updateScore() {
    scoreEl.innerHTML = `${score}<span>Score</span>`;

    if (score > best) {
        best = score;
        saveBest();
    }

    bestEl.innerHTML = `${best}<span>Best</span>`;
}

function randomEmptyCell() {
    const empty = [];

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === 0) {
                empty.push({ r, c });
            }
        }
    }

    if (empty.length === 0) return null;

    return empty[Math.floor(Math.random() * empty.length)];
}

function addRandomTile() {
    const pos = randomEmptyCell();

    if (!pos) return;

    board[pos.r][pos.c] = Math.random() < 0.9 ? 2 : 4;
}

function drawBoard() {
    boardEl.innerHTML = "";

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {

            const value = board[r][c];

            if (value === 0) {
                const bg = document.createElement("div");
                bg.className = "cell-bg pixel-frame";
                boardEl.appendChild(bg);
            } else {
                const tile = document.createElement("div");
                tile.className = "tile pixel-frame";
                tile.dataset.v = value;
                tile.textContent = value;
                boardEl.appendChild(tile);
            }
        }
    }
}

function slide(row) {

    row = row.filter(v => v);

    for (let i = 0; i < row.length - 1; i++) {
        if (row[i] === row[i + 1]) {

            row[i] *= 2;
            score += row[i];

            if (row[i] === 2048 && !won) {
                won = true;
                bannerEl.textContent = "🎉 You reached 2048!";
            }

            row.splice(i + 1, 1);
        }
    }

    while (row.length < SIZE) {
        row.push(0);
    }

    return row;
}

function reverseRows() {
    board = board.map(r => r.reverse());
}

function transpose() {
    const temp = Array.from({ length: SIZE }, () => Array(SIZE));

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            temp[c][r] = board[r][c];
        }
    }

    board = temp;
}

function moveLeft() {

    const before = JSON.stringify(board);

    for (let r = 0; r < SIZE; r++) {
        board[r] = slide(board[r]);
    }

    return before !== JSON.stringify(board);
}

function moveRight() {

    reverseRows();
    const changed = moveLeft();
    reverseRows();

    return changed;
}

function moveUp() {

    transpose();
    const changed = moveLeft();
    transpose();

    return changed;
}

function moveDown() {

    transpose();
    const changed = moveRight();
    transpose();

    return changed;
}

function movesAvailable() {

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {

            if (board[r][c] === 0)
                return true;

            if (r < SIZE - 1 && board[r][c] === board[r + 1][c])
                return true;

            if (c < SIZE - 1 && board[r][c] === board[r][c + 1])
                return true;
        }
    }

    return false;
}

function doMove(dir) {

    if (gameOver) return;

    let changed = false;

    switch (dir) {
        case "left":
            changed = moveLeft();
            break;

        case "right":
            changed = moveRight();
            break;

        case "up":
            changed = moveUp();
            break;

        case "down":
            changed = moveDown();
            break;
    }

    if (!changed) return;

    addRandomTile();

    updateScore();
    drawBoard();

    if (!movesAvailable()) {
        gameOver = true;
        bannerEl.textContent = "💀 Game Over!";
    }
}

// Keyboard

window.addEventListener("keydown", e => {

    switch (e.key) {

        case "ArrowLeft":
            e.preventDefault();
            doMove("left");
            break;

        case "ArrowRight":
            e.preventDefault();
            doMove("right");
            break;

        case "ArrowUp":
            e.preventDefault();
            doMove("up");
            break;

        case "ArrowDown":
            e.preventDefault();
            doMove("down");
            break;
    }

});

// Mobile buttons

document.querySelectorAll("[data-dir]").forEach(btn => {
    btn.addEventListener("click", () => {
        doMove(btn.dataset.dir);
    });
});

// Swipe support

let startX = 0;
let startY = 0;

boardEl.addEventListener("touchstart", e => {

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;

}, { passive: true });

boardEl.addEventListener("touchend", e => {

    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;

    if (Math.abs(dx) > Math.abs(dy)) {

        if (Math.abs(dx) > 30)
            doMove(dx > 0 ? "right" : "left");

    } else {

        if (Math.abs(dy) > 30)
            doMove(dy > 0 ? "down" : "up");

    }

}, { passive: true });

// New Game

newBtn.addEventListener("click", init);
if (newBtnMobile) {
    newBtnMobile.addEventListener("click", init);
}

if (window.PP && typeof PP.onUsernameChange === "function") {
    PP.onUsernameChange(() => {
        best = loadBest();
        updateScore();
    });
}

// Start

init();
