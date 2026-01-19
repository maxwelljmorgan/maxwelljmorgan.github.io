// Hockey Shootout Game

class HockeyShootout {
    constructor() {
        // Game state
        this.state = {
            screen: 'start',
            difficulty: 'medium',
            playerScore: 0,
            goalieSaves: 0,
            currentShot: 1,
            totalShots: 5,
            selectedZone: null,
            isCharging: false,
            power: 0,
            canShoot: true,
            gameOver: false
        };

        // Difficulty settings
        this.difficulties = {
            easy: { saveChance: 0.25, reactionSpeed: 0.6, telegraphTime: 400 },
            medium: { saveChance: 0.45, reactionSpeed: 0.75, telegraphTime: 300 },
            hard: { saveChance: 0.65, reactionSpeed: 0.9, telegraphTime: 200 }
        };

        // Zone positions for puck movement
        this.zonePositions = {
            'top-left': { x: 25, y: 15 },
            'top-center': { x: 50, y: 12 },
            'top-right': { x: 75, y: 15 },
            'bottom-left': { x: 25, y: 50 },
            'bottom-center': { x: 50, y: 50 },
            'bottom-right': { x: 75, y: 50 }
        };

        // Audio context for sound effects
        this.audioContext = null;

        // DOM Elements
        this.elements = {};

        // Animation frame
        this.powerAnimationFrame = null;

        // Bind methods
        this.init = this.init.bind(this);
        this.handleZoneClick = this.handleZoneClick.bind(this);
        this.startCharge = this.startCharge.bind(this);
        this.releaseShot = this.releaseShot.bind(this);
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.initAudio();
        this.showScreen('start');
    }

    cacheElements() {
        this.elements = {
            // Screens
            startScreen: document.getElementById('start-screen'),
            howToScreen: document.getElementById('how-to-screen'),
            gameScreen: document.getElementById('game-screen'),
            resultScreen: document.getElementById('result-screen'),

            // Buttons
            playBtn: document.getElementById('play-btn'),
            howToPlayBtn: document.getElementById('how-to-play-btn'),
            backBtn: document.getElementById('back-btn'),
            playAgainBtn: document.getElementById('play-again-btn'),
            mainMenuBtn: document.getElementById('main-menu-btn'),
            diffButtons: document.querySelectorAll('.diff-btn'),

            // Game elements
            scoreboard: document.getElementById('scoreboard'),
            playerScore: document.getElementById('player-score'),
            goalieSaves: document.getElementById('goalie-saves'),
            currentShot: document.getElementById('current-shot'),
            totalShots: document.getElementById('total-shots'),
            targetZones: document.querySelectorAll('.target-zone'),
            goalie: document.getElementById('goalie'),
            puck: document.getElementById('puck'),
            player: document.getElementById('player'),
            powerMeter: document.getElementById('power-meter'),
            powerFill: document.getElementById('power-fill'),
            gameMessage: document.getElementById('game-message'),
            aimIndicator: document.getElementById('aim-indicator'),

            // Result elements
            resultTitle: document.getElementById('result-title'),
            finalGoals: document.getElementById('final-goals'),
            finalShots: document.getElementById('final-shots'),
            finalAccuracy: document.getElementById('final-accuracy')
        };
    }

    bindEvents() {
        // Menu buttons
        this.elements.playBtn.addEventListener('click', () => this.startGame());
        this.elements.howToPlayBtn.addEventListener('click', () => this.showScreen('how-to'));
        this.elements.backBtn.addEventListener('click', () => this.showScreen('start'));
        this.elements.playAgainBtn.addEventListener('click', () => this.startGame());
        this.elements.mainMenuBtn.addEventListener('click', () => this.showScreen('start'));

        // Difficulty buttons
        this.elements.diffButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.elements.diffButtons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.state.difficulty = e.target.dataset.difficulty;
            });
        });

        // Target zones
        this.elements.targetZones.forEach(zone => {
            zone.addEventListener('click', this.handleZoneClick);
            zone.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.handleZoneClick(e);
            }, { passive: false });
        });

        // Power charging - mouse
        document.addEventListener('mousedown', this.startCharge);
        document.addEventListener('mouseup', this.releaseShot);
        document.addEventListener('mouseleave', this.releaseShot);

        // Power charging - touch
        document.addEventListener('touchstart', (e) => {
            if (this.state.screen === 'game') {
                this.startCharge(e);
            }
        }, { passive: false });
        document.addEventListener('touchend', this.releaseShot);
        document.addEventListener('touchcancel', this.releaseShot);

        // Prevent context menu on long press
        document.addEventListener('contextmenu', (e) => {
            if (this.state.screen === 'game') {
                e.preventDefault();
            }
        });
    }

    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API not supported');
        }
    }

    playSound(type) {
        if (!this.audioContext) return;

        // Resume audio context if suspended (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        const now = this.audioContext.currentTime;

        switch (type) {
            case 'shoot':
                oscillator.frequency.setValueAtTime(150, now);
                oscillator.frequency.exponentialRampToValueAtTime(80, now + 0.1);
                gainNode.gain.setValueAtTime(0.3, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                oscillator.start(now);
                oscillator.stop(now + 0.15);
                break;

            case 'goal':
                oscillator.type = 'square';
                oscillator.frequency.setValueAtTime(523.25, now); // C5
                gainNode.gain.setValueAtTime(0.2, now);
                oscillator.frequency.setValueAtTime(659.25, now + 0.1); // E5
                oscillator.frequency.setValueAtTime(783.99, now + 0.2); // G5
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                oscillator.start(now);
                oscillator.stop(now + 0.4);
                break;

            case 'save':
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(200, now);
                oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.2);
                gainNode.gain.setValueAtTime(0.15, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                oscillator.start(now);
                oscillator.stop(now + 0.25);
                break;

            case 'charge':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(200 + this.state.power * 4, now);
                gainNode.gain.setValueAtTime(0.05, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                oscillator.start(now);
                oscillator.stop(now + 0.05);
                break;

            case 'click':
                oscillator.frequency.setValueAtTime(800, now);
                gainNode.gain.setValueAtTime(0.1, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                oscillator.start(now);
                oscillator.stop(now + 0.05);
                break;
        }
    }

    showScreen(screenName) {
        const screens = ['start', 'how-to', 'game', 'result'];
        screens.forEach(name => {
            const screen = this.elements[`${name.replace('-', '')}Screen`] ||
                           this.elements[`${name}Screen`];
            if (screen) {
                screen.classList.remove('active');
            }
        });

        this.state.screen = screenName;

        switch (screenName) {
            case 'start':
                this.elements.startScreen.classList.add('active');
                break;
            case 'how-to':
                this.elements.howToScreen.classList.add('active');
                break;
            case 'game':
                this.elements.gameScreen.classList.add('active');
                break;
            case 'result':
                this.elements.resultScreen.classList.add('active');
                break;
        }
    }

    startGame() {
        // Reset state
        this.state.playerScore = 0;
        this.state.goalieSaves = 0;
        this.state.currentShot = 1;
        this.state.selectedZone = null;
        this.state.isCharging = false;
        this.state.power = 0;
        this.state.canShoot = true;
        this.state.gameOver = false;

        // Update UI
        this.elements.playerScore.textContent = '0';
        this.elements.goalieSaves.textContent = '0';
        this.elements.currentShot.textContent = '1';
        this.elements.totalShots.textContent = this.state.totalShots;

        // Reset elements
        this.resetPuck();
        this.resetGoalie();
        this.clearZoneSelection();
        this.elements.powerMeter.classList.remove('active');
        this.elements.powerFill.style.width = '0%';
        this.elements.aimIndicator.textContent = 'Tap the goal to aim';

        this.showScreen('game');
        this.playSound('click');
    }

    handleZoneClick(e) {
        if (this.state.screen !== 'game' || !this.state.canShoot || this.state.isCharging) return;

        const zone = e.target.closest('.target-zone');
        if (!zone) return;

        this.playSound('click');

        // Clear previous selection
        this.clearZoneSelection();

        // Select new zone
        zone.classList.add('selected');
        this.state.selectedZone = zone.dataset.zone;

        // Update instruction
        this.elements.aimIndicator.textContent = 'Hold to charge, release to shoot!';
    }

    clearZoneSelection() {
        this.elements.targetZones.forEach(z => z.classList.remove('selected'));
        this.state.selectedZone = null;
    }

    startCharge(e) {
        if (this.state.screen !== 'game' || !this.state.canShoot || !this.state.selectedZone) return;

        // Don't start charging if clicking on a zone
        const target = e.target;
        if (target.classList.contains('target-zone')) return;

        this.state.isCharging = true;
        this.state.power = 0;
        this.elements.powerMeter.classList.add('active');

        this.animatePower();
    }

    animatePower() {
        if (!this.state.isCharging) return;

        this.state.power += 2;
        if (this.state.power > 100) {
            this.state.power = 100;
        }

        this.elements.powerFill.style.width = `${this.state.power}%`;

        // Play charging sound occasionally
        if (this.state.power % 10 === 0) {
            this.playSound('charge');
        }

        if (this.state.power < 100) {
            this.powerAnimationFrame = requestAnimationFrame(() => this.animatePower());
        }
    }

    releaseShot() {
        if (!this.state.isCharging || !this.state.selectedZone) return;

        this.state.isCharging = false;
        cancelAnimationFrame(this.powerAnimationFrame);

        // Minimum power required
        if (this.state.power < 20) {
            this.elements.powerMeter.classList.remove('active');
            this.elements.powerFill.style.width = '0%';
            this.state.power = 0;
            return;
        }

        this.shoot();
    }

    shoot() {
        this.state.canShoot = false;
        this.elements.powerMeter.classList.remove('active');

        const zone = this.state.selectedZone;
        const power = this.state.power;

        this.playSound('shoot');

        // Animate player
        this.elements.player.classList.add('shooting');
        setTimeout(() => this.elements.player.classList.remove('shooting'), 300);

        // Calculate shot accuracy based on power
        // Optimal power is between 60-80%
        let accuracy = 1;
        if (power < 60) {
            accuracy = 0.7 + (power / 60) * 0.3;
        } else if (power > 80) {
            accuracy = 1 - ((power - 80) / 20) * 0.3;
        }

        // Determine if shot is on target
        const isOnTarget = Math.random() < accuracy;

        // Move puck
        this.elements.puck.classList.add('shooting');

        const targetPos = this.zonePositions[zone];
        let finalX = targetPos.x;
        let finalY = targetPos.y;

        // If not on target, miss the goal
        if (!isOnTarget) {
            finalX += (Math.random() - 0.5) * 60;
            finalY = Math.random() < 0.5 ? -10 : 70;
        }

        // Animate goalie reaction
        const settings = this.difficulties[this.state.difficulty];
        const goalieDelay = settings.telegraphTime + Math.random() * 100;

        setTimeout(() => {
            this.moveGoalie(zone);
        }, goalieDelay);

        // Move puck to target
        setTimeout(() => {
            this.elements.puck.style.left = `${finalX}%`;
            this.elements.puck.style.bottom = `${100 - finalY}%`;
            this.elements.puck.style.transform = 'translate(-50%, 50%) scale(0.6)';
        }, 50);

        // Determine outcome
        setTimeout(() => {
            this.determineOutcome(zone, isOnTarget);
        }, 400);
    }

    moveGoalie(targetZone) {
        const settings = this.difficulties[this.state.difficulty];

        // Goalie tries to predict where the shot is going
        let goaliePrediction = targetZone;

        // Sometimes goalie guesses wrong based on difficulty
        if (Math.random() > settings.reactionSpeed) {
            const zones = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
            goaliePrediction = zones[Math.floor(Math.random() * zones.length)];
        }

        // Move goalie based on prediction
        if (goaliePrediction.includes('left')) {
            this.elements.goalie.style.left = '35%';
        } else if (goaliePrediction.includes('right')) {
            this.elements.goalie.style.left = '65%';
        } else {
            this.elements.goalie.style.left = '50%';
        }
    }

    determineOutcome(zone, isOnTarget) {
        if (!isOnTarget) {
            this.showMessage('MISS!', 'save');
            this.playSound('save');
            this.nextShot();
            return;
        }

        const settings = this.difficulties[this.state.difficulty];

        // Check if goalie is in the right position
        const goaliePos = this.elements.goalie.style.left || '50%';
        const goalieX = parseFloat(goaliePos);

        let saved = false;
        const zoneX = this.zonePositions[zone].x;

        // Goalie save logic
        const saveDistance = 25; // How close goalie needs to be to save

        if (Math.abs(goalieX - zoneX) < saveDistance) {
            // Goalie is close to the shot
            saved = Math.random() < settings.saveChance + 0.2;
        } else {
            // Goalie is far from the shot
            saved = Math.random() < settings.saveChance * 0.3;
        }

        // Animate save/goal
        if (saved) {
            // Save animation
            if (zone.includes('left')) {
                this.elements.goalie.classList.add('save-left');
            } else if (zone.includes('right')) {
                this.elements.goalie.classList.add('save-right');
            } else {
                this.elements.goalie.classList.add('save-center');
            }

            this.showMessage('SAVED!', 'save');
            this.playSound('save');
            this.state.goalieSaves++;
            this.elements.goalieSaves.textContent = this.state.goalieSaves;

            setTimeout(() => {
                this.elements.goalie.classList.remove('save-left', 'save-right', 'save-center');
            }, 500);
        } else {
            // Goal!
            this.elements.puck.classList.add('goal');
            this.showMessage('GOAL!', 'goal');
            this.playSound('goal');
            this.state.playerScore++;
            this.elements.playerScore.textContent = this.state.playerScore;
            this.createCelebration();
        }

        this.nextShot();
    }

    nextShot() {
        setTimeout(() => {
            this.state.currentShot++;

            if (this.state.currentShot > this.state.totalShots) {
                this.endGame();
                return;
            }

            this.elements.currentShot.textContent = this.state.currentShot;
            this.resetPuck();
            this.resetGoalie();
            this.clearZoneSelection();
            this.elements.aimIndicator.textContent = 'Tap the goal to aim';
            this.state.power = 0;
            this.elements.powerFill.style.width = '0%';
            this.state.canShoot = true;
        }, 1500);
    }

    resetPuck() {
        this.elements.puck.classList.remove('shooting', 'goal');
        this.elements.puck.style.left = '50%';
        this.elements.puck.style.bottom = '25%';
        this.elements.puck.style.transform = 'translateX(-50%)';
    }

    resetGoalie() {
        this.elements.goalie.style.left = '50%';
        this.elements.goalie.classList.remove('save-left', 'save-right', 'save-center');
    }

    showMessage(text, type) {
        this.elements.gameMessage.textContent = text;
        this.elements.gameMessage.className = '';
        this.elements.gameMessage.classList.add('show', type);

        setTimeout(() => {
            this.elements.gameMessage.classList.remove('show');
        }, 1500);
    }

    createCelebration() {
        const celebration = document.createElement('div');
        celebration.className = 'celebration';

        for (let i = 0; i < 30; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.backgroundColor = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'][Math.floor(Math.random() * 5)];
            confetti.style.animation = `confetti-fall ${1 + Math.random()}s ease-out forwards`;
            confetti.style.animationDelay = `${Math.random() * 0.3}s`;
            celebration.appendChild(confetti);
        }

        document.body.appendChild(celebration);

        // Add confetti animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes confetti-fall {
                0% {
                    opacity: 1;
                    transform: translateY(0) rotate(0deg);
                }
                100% {
                    opacity: 0;
                    transform: translateY(100vh) rotate(720deg);
                }
            }
        `;
        document.head.appendChild(style);

        setTimeout(() => {
            celebration.remove();
            style.remove();
        }, 2000);
    }

    endGame() {
        this.state.gameOver = true;

        const goals = this.state.playerScore;
        const shots = this.state.totalShots;
        const accuracy = Math.round((goals / shots) * 100);

        this.elements.finalGoals.textContent = goals;
        this.elements.finalShots.textContent = shots;
        this.elements.finalAccuracy.textContent = `${accuracy}%`;

        // Determine result message
        if (goals === shots) {
            this.elements.resultTitle.textContent = 'PERFECT!';
            this.elements.resultTitle.classList.add('win');
        } else if (goals >= shots * 0.6) {
            this.elements.resultTitle.textContent = 'Great Job!';
            this.elements.resultTitle.classList.add('win');
        } else if (goals >= shots * 0.4) {
            this.elements.resultTitle.textContent = 'Not Bad!';
            this.elements.resultTitle.classList.remove('win');
        } else {
            this.elements.resultTitle.textContent = 'Keep Practicing!';
            this.elements.resultTitle.classList.remove('win');
        }

        setTimeout(() => {
            this.showScreen('result');
        }, 1000);
    }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const game = new HockeyShootout();
    game.init();
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('hockey-sw.js')
            .then(registration => {
                console.log('SW registered:', registration);
            })
            .catch(error => {
                console.log('SW registration failed:', error);
            });
    });
}
