import { TriplePendulumPhysics } from './physics.js';

class TriplePendulum {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Physics Parameters
        this.params = {
            m1: 1.0, m2: 1.0, m3: 1.0,
            l1: 1.0, l2: 1.0, l3: 1.0,
            g: 9.81,
            damping: 0.0
        };

        this.physics = new TriplePendulumPhysics(
            this.params.m1, this.params.m2, this.params.m3,
            this.params.l1, this.params.l2, this.params.l3,
            this.params.g, this.params.damping
        );

        // State: [theta1, theta2, theta3, omega1, omega2, omega3]
        this.reset();

        // Trace
        this.trace = [];
        this.maxTraceLength = 500;

        // Heatmap Worker Manager
        this.worker = null;
        this.pendingHeatmap = false;

        this.heatmapCanvas = document.getElementById('heatmapCanvas');
        this.heatmapCtx = this.heatmapCanvas.getContext('2d');
        this.heatmapStatus = document.getElementById('heatmap-status');
        this.heatmapContainer = document.getElementById('heatmap-container');

        // Heatmap View State (Ranges for Theta1 and Theta2)
        this.view = {
            t1Min: -Math.PI,
            t1Max: Math.PI,
            t2Min: -Math.PI,
            t2Max: Math.PI
        };

        this.setupHeatmapInteraction();
        this.setupHeatmapControls();

        // Animation
        this.lastTime = 0;
        this.running = true;

        this.setupControls();

        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this.scheduleHeatmapUpdate(); // debounce handled inside
        });

        // Initial generation
        this.scheduleHeatmapUpdate();

        requestAnimationFrame(t => this.loop(t));
    }

    // Terminate existing worker and start a new one
    startWorker() {
        if (this.worker) {
            this.worker.terminate();
        }
        this.worker = new Worker('heatmap.worker.js', { type: 'module' });
        this.worker.onmessage = (e) => {
            const { buffer, width, height } = e.data;
            const imageData = new ImageData(buffer, width, height);

            // If this was a low-res pass, draw it scaled up
            // If it was high-res, draw it normally

            // To support scaling, we might need an offscreen canvas or just putImageData and let CSS scale it
            // putImageData doesn't scale. It fills 0,0 to w,h. 
            // Since we resize the canvas.width/height to match the simulation resolution, it works fine with CSS pixelated.

            this.heatmapCanvas.width = width;
            this.heatmapCanvas.height = height;
            this.heatmapCtx.putImageData(imageData, 0, 0);

            this.heatmapStatus.style.display = 'none'; // Changed from heatmapOverlay
            this.generatingHeatmap = false;

            // If we just finished low-res, trigger high-res?
            // User asked for "doesn't work when it doesn't have multiple".
            // Progressive: Low Res -> High Res.
            if (width < 300) { // Bumped up high res threshold for zoom
                // Check if fullscreen, do even higher res?
                const isFullscreen = this.heatmapContainer.classList.contains('fullscreen');
                const highRes = isFullscreen ? 400 : 150;
                this.generateHeatmap(highRes);
            }
        };
    }

    scheduleHeatmapUpdate() {
        if (this.heatmapTimeout) clearTimeout(this.heatmapTimeout);
        this.heatmapStatus.style.display = 'block';
        this.heatmapStatus.textContent = "Updating...";
        this.heatmapTimeout = setTimeout(() => {
            this.generateHeatmap(50);
        }, 100); // Faster debounce
    }

    generateHeatmap(resolution) {
        this.generatingHeatmap = true;
        this.heatmapStatus.style.display = 'block';
        if (resolution < 100) this.heatmapStatus.textContent = "Previewing...";
        else this.heatmapStatus.textContent = "Refining...";

        // Start (or restart) the worker
        this.startWorker();

        // Send params AND current view range
        this.worker.postMessage({
            width: resolution,
            height: resolution,
            params: this.params,
            range: {
                minT1: this.view.t1Min, maxT1: this.view.t1Max,
                minT2: this.view.t2Min, maxT2: this.view.t2Max
            }
        });
    }

    setupHeatmapControls() {
        // Fullscreen toggle
        document.getElementById('heatmap-max-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.heatmapContainer.classList.toggle('fullscreen');
            this.resize(); // Resize simulation canvas if needed (it shares space)
            // Re-generate heatmap at higher quality if fullscreen?
            this.scheduleHeatmapUpdate();
        });

        // Reset View
        document.getElementById('heatmap-reset-view-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.view = {
                t1Min: -Math.PI, t1Max: Math.PI,
                t2Min: -Math.PI, t2Max: Math.PI
            };
            this.scheduleHeatmapUpdate();
        });
    }

    setupHeatmapInteraction() {
        let isDragging = false;
        let lastX, lastY;

        // Pan
        this.heatmapCanvas.addEventListener('mousedown', (e) => {
            // Check if clicking controls? No, they stopProp.
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            this.heatmapCanvas.style.cursor = 'grabbing';
            e.preventDefault(); // Prevent text selection
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.heatmapCanvas.style.cursor = 'crosshair';
                // Trigger refinement on release
                this.scheduleHeatmapUpdate();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const dxPixels = e.clientX - lastX;
            const dyPixels = e.clientY - lastY;

            lastX = e.clientX;
            lastY = e.clientY;

            // Map pixels to view units
            const wRange = this.view.t1Max - this.view.t1Min;
            const hRange = this.view.t2Max - this.view.t2Min;

            const dx = -dxPixels * (wRange / this.heatmapCanvas.clientWidth);
            const dy = -dyPixels * (hRange / this.heatmapCanvas.clientHeight);

            this.view.t1Min += dx; this.view.t1Max += dx;
            this.view.t2Min += dy; this.view.t2Max += dy;

            this.generateHeatmap(50); // Fast preview while panning
        });

        // Zoom (Wheel)
        this.heatmapCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

            // Zoom towards mouse pointer
            const rect = this.heatmapCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const wPx = this.heatmapCanvas.clientWidth;
            const hPx = this.heatmapCanvas.clientHeight;

            // Mouse position in relative coords (0 to 1)
            const rx = x / wPx;
            const ry = y / hPx;

            const wRange = this.view.t1Max - this.view.t1Min;
            const hRange = this.view.t2Max - this.view.t2Min;

            const newW = wRange * zoomFactor;
            const newH = hRange * zoomFactor;

            // Adjust Min/Max to keep cursor stationary in math space
            // t_cursor = min + w * rx
            // new_t_cursor = new_min + new_w * rx
            // we want t_cursor == new_t_cursor

            // min + w*rx = new_min + newW*rx
            // new_min = min + (w - newW) * rx

            this.view.t1Min = this.view.t1Min + (wRange - newW) * rx;
            this.view.t1Max = this.view.t1Min + newW;

            this.view.t2Min = this.view.t2Min + (hRange - newH) * ry;
            this.view.t2Max = this.view.t2Min + newH;

            this.scheduleHeatmapUpdate();
        });

        // Double Click to simulate
        this.heatmapCanvas.addEventListener('dblclick', (e) => {
            const rect = this.heatmapCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const w = this.heatmapCanvas.width; // simulation calculation resolution used? NO.
            // We use display size mapping to current view

            const wPx = this.heatmapCanvas.clientWidth;
            const hPx = this.heatmapCanvas.clientHeight;

            const t1 = this.view.t1Min + (x / wPx) * (this.view.t1Max - this.view.t1Min);
            const t2 = this.view.t2Min + (y / hPx) * (this.view.t2Max - this.view.t2Min);

            this.state = [t1, t2, 0, 0, 0, 0];
            this.trace = [];

            // Exit fullscreen if desired? Nah.
        });

        // Remove single click listener or conflict?
        // Dragging takes precedence. If movement < threshold, treat as click?
        // Let's rely on dblclick for simulation reset to separate it from panning.
        // User said "interactable" earlier, meaning click to set.
        // If I make it draggable, click is hard.
        // Let's say SHORT click (no drag) = set simulation.
        // I'll handle that in mouseup.

        // Actually, let's keep it simple. dblclick to set state is safer with pan/zoom.
        // The original code had click. I should update that.
    }

    reset() {
        // Start near global stable equilibrium (down) or unstable (up)?
        // Let's start slightly perturbed from Up-Up-Up for chaos
        this.state = [Math.PI - 0.1, Math.PI, Math.PI, 0, 0, 0];
        this.trace = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setupControls() {
        const bind = (id, param) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(id + '-val');
            el.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.params[param] = val;
                valEl.textContent = val.toFixed(1);
                this.scheduleHeatmapUpdate();
            });
        };

        bind('m1', 'm1'); bind('m2', 'm2'); bind('m3', 'm3');
        bind('l1', 'l1'); bind('l2', 'l2'); bind('l3', 'l3');
        bind('g', 'g');

        const dEl = document.getElementById('d');
        const dVal = document.getElementById('d-val');
        dEl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.params.damping = val;
            dVal.textContent = val.toFixed(2);
            this.scheduleHeatmapUpdate();
        });

        document.getElementById('reset-btn').addEventListener('click', () => {
            this.reset();
        });
    }

    // Additional Click handling for simulation reset (Short click)
    // We already handled drag in setupInteraction. 
    // We can add a specialized click handler there that checks if it was a drag or not.
    // For now, let's just stick to dblclick for setting state, it's cleaner.

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
    }

    // Equations of Motion (Lagrangian) needed here
    getDerivatives(state) {
        // Update physics params in case they changed from UI (optimization: only do this when needed)
        this.physics.m1 = this.params.m1; this.physics.m2 = this.params.m2; this.physics.m3 = this.params.m3;
        this.physics.l1 = this.params.l1; this.physics.l2 = this.params.l2; this.physics.l3 = this.params.l3;
        this.physics.g = this.params.g; this.physics.damping = this.params.damping;

        return this.physics.getDerivatives(state);
    }

    rk4(dt) {
        const k1 = this.getDerivatives(this.state);

        const state2 = this.state.map((s, i) => s + k1[i] * dt * 0.5);
        const k2 = this.getDerivatives(state2);

        const state3 = this.state.map((s, i) => s + k2[i] * dt * 0.5);
        const k3 = this.getDerivatives(state3);

        const state4 = this.state.map((s, i) => s + k3[i] * dt);
        const k4 = this.getDerivatives(state4);

        this.state = this.state.map((s, i) => s + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }

    update(dt) {
        // Run physics sub-steps for stability
        const subSteps = 10;
        const subDt = dt / subSteps;
        for (let i = 0; i < subSteps; i++) {
            this.rk4(subDt);
        }
    }

    draw() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // Trail effect
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 3;
        const scale = Math.min(width, height) / (2 * (this.params.l1 + this.params.l2 + this.params.l3));

        const [t1, t2, t3] = this.state;

        const x1 = cx + this.params.l1 * Math.sin(t1) * scale;
        const y1 = cy + this.params.l1 * Math.cos(t1) * scale;

        const x2 = x1 + this.params.l2 * Math.sin(t2) * scale;
        const y2 = y1 + this.params.l2 * Math.cos(t2) * scale;

        const x3 = x2 + this.params.l3 * Math.sin(t3) * scale;
        const y3 = y2 + this.params.l3 * Math.cos(t3) * scale;

        // Update trace
        this.trace.push({ x: x3, y: y3 });
        if (this.trace.length > this.maxTraceLength) this.trace.shift();

        // Draw Trace
        if (this.trace.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#f472b6';
            ctx.lineWidth = 1;
            for (let i = 0; i < this.trace.length - 1; i++) {
                ctx.moveTo(this.trace[i].x, this.trace[i].y);
                ctx.lineTo(this.trace[i + 1].x, this.trace[i + 1].y);
            }
            ctx.stroke();
        }

        // Draw Arms
        ctx.beginPath();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.stroke();

        // Draw Bobs
        const drawBob = (x, y, m, color) => {
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(x, y, 5 + m * 2, 0, Math.PI * 2);
            ctx.fill();
        };

        drawBob(x1, y1, this.params.m1, '#38bdf8');
        drawBob(x2, y2, this.params.m2, '#fbbf24');
        drawBob(x3, y3, this.params.m3, '#f472b6');
    }

    loop(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        // Cap dt to prevent explosion on tab switch
        if (dt < 0.1) {
            this.update(dt);
            this.draw();
        }

        if (this.running) {
            requestAnimationFrame(t => this.loop(t));
        }
    }
}

// Initialize
const sim = new TriplePendulum('simCanvas');

// Connect Controls
// ... (TODO)
