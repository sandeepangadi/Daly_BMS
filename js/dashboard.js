/* ==========================================================================
   EV Charging Station — Dashboard logic
   Polls /api/data every POLL_MS and renders BMS + energy-meter panels.
   ========================================================================== */

const POLL_MS = 3000;
const GAUGE_C = 270.2;                 // 2πr for r=43
const CELL_MIN = 2.5, CELL_MAX = 4.5;  // Li-ion cell display range

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- clock ---------- */
function tickClock() {
    const d = new Date();
    document.getElementById('clockTime').textContent = d.toLocaleTimeString();
    document.getElementById('clockDate').textContent =
        d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
setInterval(tickClock, 1000);
tickClock();

/* ---------- helpers ---------- */
function setVal(id, text, unit) {
    const el = document.getElementById(id);
    el.innerHTML = unit ? text + '<small>' + unit + '</small>' : text;
}

/* Tween a numeric text value toward a target (count-up animation). */
const tweens = {};
function tweenVal(id, target, decimals, unit) {
    const el = document.getElementById(id);
    const write = v => {
        const text = v.toFixed(decimals);
        el.innerHTML = unit ? text + '<small>' + unit + '</small>' : text;
    };
    if (REDUCED_MOTION) { write(target); return; }

    const from = parseFloat(el.textContent) || 0;
    if (from === target) { write(target); return; }

    cancelAnimationFrame(tweens[id]);
    const start = performance.now(), DUR = 600;
    (function step(now) {
        const t = Math.max(0, Math.min(1, (now - start) / DUR));
        const eased = 1 - Math.pow(1 - t, 3);           // ease-out cubic
        write(from + (target - from) * eased);
        if (t < 1) tweens[id] = requestAnimationFrame(step);
    })(start);
}

function socColor(soc) {
    if (soc <= 15) return 'var(--critical)';
    if (soc <= 30) return 'var(--warning)';
    return 'var(--accent)';
}

/* ---------- mini sparkline chart (voltage / current / power factor / frequency) ---------- */
const HIST_LEN = 24;
const history = {
    voltage: [403, 404, 406, 405, 407, 404, 406, 405, 408, 406, 405, 407],
    current: [124, 126, 128, 125, 127, 129, 126, 128, 124, 127, 126, 128],
    pf: [0.96, 0.97, 0.98, 0.97, 0.99, 0.98, 0.97, 0.98, 0.99, 0.97, 0.98, 0.97],
    freq: [49.9, 50.0, 50.1, 50.0, 49.9, 50.0, 50.1, 50.0, 50.2, 50.0, 49.9, 50.0]
};
function pushHistory(key, value) {
    const h = history[key];
    h.push(value);
    if (h.length > HIST_LEN) h.shift();
}
function updateSparkline(lineId, areaId, key, minVal, maxVal) {
    const h = history[key];
    if (h.length < 2) return;
    let min = Math.min(...h);
    let max = Math.max(...h);
    if (max === min) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.15;
    max += span * 0.15;
    const range = max - min;

    const w = 120, hgt = 40, pad = 4;
    const step = (w - pad * 2) / (HIST_LEN - 1);
    const startX = w - pad - (h.length - 1) * step;
    const pts = h.map((v, i) => {
        const x = startX + i * step;
        const frac = Math.max(0, Math.min(1, (v - min) / range));
        const y = pad + (1 - frac) * (hgt - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
    });
    document.getElementById(lineId).setAttribute('points', pts.join(' '));
    const areaPts = [pts[0].split(',')[0] + ',' + hgt].concat(pts).concat([pts[pts.length - 1].split(',')[0] + ',' + hgt]);
    document.getElementById(areaId).setAttribute('points', areaPts.join(' '));
}

/* ---------- demo fallback ----------
   Used only when /api/data can't be reached (e.g. previewing the static
   file with no backend running), so the layout still has something to show. */
const DEMO_DATA = {
    bms: {
        success: true, charger_running: true, mode: 'Active (Charging)',
        voltage: 392.5, highest_temperature: 28.5, soc: 50,
        cell_voltages: { c1: 3.75, c2: 3.72, c3: 3.78, c4: 3.71 }
    },
    meter: {
        success: true, power: 50.25, voltage: 405.0, current: 126.6,
        power_factor: 0.98, frequency: 50.0
    }
};
let usingDemoData = false;

/* ---------- data ---------- */
async function loadData() {
    let data, isDemo = false;
    try {
        const res = await fetch('/api/data');
        data = await res.json();
    } catch (err) {
        isDemo = true;
        const j = (base, spread) => +(base + (Math.random() - 0.5) * spread).toFixed(3);
        data = {
            bms: { ...DEMO_DATA.bms },
            meter: {
                success: true,
                power: j(50.25, 2),
                voltage: j(405.0, 6),
                current: j(126.6, 8),
                power_factor: Math.max(0.85, Math.min(1, j(0.98, 0.03))),
                frequency: j(50.0, 0.3)
            }
        };
    }

    try {
        const bms = data.bms || {};
        const meter = data.meter || {};

        usingDemoData = isDemo;
        const pill = document.getElementById('backendPill');
        pill.className = 'pill ok';
        pill.innerHTML = isDemo
            ? '<span class="dot"></span><span>Demo data</span>'
            : '<span class="dot"></span><span>System online</span>';

        /* ----- BMS: charger status ----- */
        const isCharging = bms.success && (bms.status === 'Charging' || bms.charger_running);
        const state = document.getElementById('chargerState');
        state.className = 'state' + (isCharging ? ' charging' : '');
        document.getElementById('chargerText').textContent = isCharging ? 'Charging' : (bms.status || 'Standby');

        /* ----- BMS: mode / voltage / temperature ----- */
        document.getElementById('bmsMode').textContent = bms.status || bms.mode || (bms.success ? 'Active' : 'Offline');
        tweenVal('bmsVoltage', Number(bms.voltage || 0), 1, 'V');

        const temps = bms.temperatures || {};
        const tempVals = Object.values(temps).map(Number).filter(n => !isNaN(n));
        const temp = (bms.highest_temperature ?? (tempVals.length ? Math.max(...tempVals) : (bms.temperature ?? null)));
        if (temp === null || temp === undefined) {
            setVal('bmsTemp', '--', '°C');
        } else {
            tweenVal('bmsTemp', Number(temp), 0, '°C');
        }

        /* ----- BMS: SOC gauge ----- */
        const soc = Math.max(0, Math.min(100, Number(bms.soc || 0)));
        tweenVal('socVal', soc, 0);
        const fill = document.getElementById('socFill');
        fill.style.strokeDashoffset = GAUGE_C * (1 - soc / 100);
        fill.style.stroke = socColor(soc);

        /* ----- BMS: 4 cell voltages (battery illustrations) ----- */
        const cells = bms.cell_voltages || {};
        const keys = Object.keys(cells).slice(0, 4);
        for (let i = 0; i < 4; i++) {
            const v = keys[i] !== undefined ? Number(cells[keys[i]]) : null;
            const valEl = document.getElementById('c' + (i + 1) + 'v');
            const fillEl = document.getElementById('c' + (i + 1) + 'f');
            if (v === null || isNaN(v)) {
                valEl.textContent = '--';
                fillEl.style.height = '0%';
            } else {
                valEl.textContent = v.toFixed(3) + ' V';
                const pct = Math.max(0, Math.min(1, (v - CELL_MIN) / (CELL_MAX - CELL_MIN)));
                fillEl.style.height = (pct * 100).toFixed(1) + '%';
                /* color like a real battery indicator: low = red, mid = amber, ok = blue */
                const color = pct <= 0.15
                    ? 'linear-gradient(180deg, #e05a5a, var(--critical))'
                    : pct <= 0.3
                        ? 'linear-gradient(180deg, #fcc55c, var(--warning))'
                        : 'linear-gradient(180deg, #48bb78, #276749)';
                fillEl.style.background = color;
            }
        }

        /* ----- Energy meter ----- */
        const meterOnline = !!meter.success;
        const badge = document.getElementById('meterBadge');
        if (badge) {
            badge.className = 'badge ' + (meterOnline ? 'good' : 'bad');
            document.getElementById('meterStatus').textContent = meterOnline ? 'Online' : 'Offline';
        }

        const activePower = Number(meter.power || 0);
        const pf = Number(meter.power_factor || 0);
        const apparentPower = meter.apparent_power !== undefined
            ? Number(meter.apparent_power)
            : (pf > 0 ? activePower / pf : 0);
        const reactivePower = meter.reactive_power !== undefined
            ? Number(meter.reactive_power)
            : Math.sqrt(Math.max(0, apparentPower * apparentPower - activePower * activePower));

        if (document.getElementById('meterPower')) {
            tweenVal('meterPower', activePower, 2);
            tweenVal('meterReactive', reactivePower, 1);
            tweenVal('meterApparent', apparentPower, 1);
            tweenVal('meterVoltage', Number(meter.voltage || 0), 1, 'V');
            tweenVal('meterCurrent', Number(meter.current || 0), 1, 'A');
            tweenVal('meterPf', pf, 2);
            tweenVal('meterFreq', Number(meter.frequency || 0), 1, 'Hz');

            pushHistory('voltage', Number(meter.voltage || 0));
            pushHistory('current', Number(meter.current || 0));
            pushHistory('pf', pf);
            pushHistory('freq', Number(meter.frequency || 0));
            updateSparkline('voltSparkLine', 'voltSparkArea', 'voltage', 350, 450);
            updateSparkline('curSparkLine', 'curSparkArea', 'current', 80, 180);
            updateSparkline('pfSparkLine', 'pfSparkArea', 'pf', 0.85, 1.0);
            updateSparkline('freqSparkLine', 'freqSparkArea', 'freq', 49, 51);
        }

        /* EV Instrument Cluster Telemetry Updates */
        if (document.getElementById('clusterRpmVal')) {
            const rpm = isDemo ? Math.floor(3100 + Math.random() * 300) : Number(bms.motor_rpm || 3250);
            const speed = isDemo ? Math.floor(82 + Math.random() * 7) : Math.round((rpm / 8000) * 160);
            
            document.getElementById('clusterRpmVal').textContent = rpm;
            document.getElementById('clusterSpeedVal').textContent = speed;
            document.getElementById('clusterTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            /* Rotate Needles (-135deg to +135deg around center 170 170) */
            const rpmAngle = -135 + (Math.min(rpm, 8000) / 8000) * 270;
            const speedAngle = -135 + (Math.min(speed, 160) / 160) * 270;
            
            const rpmNeedle = document.getElementById('rpmNeedleGroup');
            const speedNeedle = document.getElementById('speedNeedleGroup');
            if (rpmNeedle) rpmNeedle.setAttribute('transform', `rotate(${rpmAngle} 170 170)`);
            if (speedNeedle) speedNeedle.setAttribute('transform', `rotate(${speedAngle} 170 170)`);
            
            /* Update Active Glowing Arc Fills (Radius 110, 270 deg = 518px) */
            const rpmArc = document.getElementById('rpmArcPath');
            const speedArc = document.getElementById('speedArcPath');

            const rpmFillLen = (Math.min(rpm, 8000) / 8000) * 518;
            const speedFillLen = (Math.min(speed, 160) / 160) * 518;

            if (rpmArc) {
                rpmArc.style.strokeDasharray = `${rpmFillLen} 518`;
                rpmArc.style.strokeDashoffset = '0';
            }
            if (speedArc) {
                speedArc.style.strokeDasharray = `${speedFillLen} 518`;
                speedArc.style.strokeDashoffset = '0';
            }

            /* Update Single Gear Indicator (D when forward, R when backward, N otherwise) */
            const gearValEl = document.getElementById('activeGearVal');
            if (gearValEl) {
                const rawDir = (bms.direction || bms.motor_direction || bms.gear_mode || '').toString().toLowerCase();
                let computedGear = 'N';

                if (rawDir === 'r' || rawDir === 'reverse' || rawDir === 'backward' || rpm < 0) {
                    computedGear = 'R';
                } else if (rawDir === 'd' || rawDir === 'drive' || rawDir === 'forward' || rpm > 0 || speed > 0) {
                    computedGear = 'D';
                } else {
                    computedGear = 'N';
                }

                gearValEl.textContent = computedGear;

                if (computedGear === 'R') {
                    gearValEl.style.color = '#fc8181';
                    gearValEl.style.textShadow = '0 0 20px rgba(229, 62, 62, 0.9)';
                } else if (computedGear === 'D') {
                    gearValEl.style.color = '#fff5f0';
                    gearValEl.style.textShadow = '0 0 20px rgba(253, 211, 141, 1), 0 0 40px rgba(237, 137, 54, 0.8)';
                } else {
                    gearValEl.style.color = '#feebc8';
                    gearValEl.style.textShadow = '0 0 16px rgba(237, 137, 54, 0.6)';
                }
            }
        }

        document.getElementById('lastUpdate').textContent =
            (isDemo ? 'Demo data — ' : 'Last update: ') + new Date().toLocaleTimeString();

    } catch (err) {
        console.log(err);
        const pill = document.getElementById('backendPill');
        pill.className = 'pill';
        pill.innerHTML = '<span class="dot"></span><span>System offline</span>';
        document.getElementById('chargerState').className = 'state';
        document.getElementById('chargerText').textContent = 'Not Charging';
        const badge = document.getElementById('meterBadge');
        badge.className = 'badge bad';
        document.getElementById('meterStatus').textContent = 'Offline';
    }
}

loadData();
let pollIntervalTimer = setInterval(loadData, POLL_MS);

/* ---------- Options Menu & Navigation Controls ---------- */
document.addEventListener('DOMContentLoaded', () => {
    const optionsBtn = document.getElementById('optionsBtn');
    const optionsDropdown = document.getElementById('optionsDropdown');
    const optionsOverlay = document.getElementById('optionsOverlay');
    const closeOptionsBtn = document.getElementById('closeOptionsBtn');
    const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');

    const optMenuSettings = document.getElementById('optMenuSettings');
    const optMenuMotor = document.getElementById('optMenuMotor');
    const bmsView = document.querySelector('.grid:not(.motor-grid-view)');
    const motorView = document.getElementById('motorDashboardView');
    const backToMainBtn = document.getElementById('backToMainBtn');

    /* Toggle Options Dropdown Popup */
    if (optionsBtn && optionsDropdown) {
        optionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsDropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => {
            optionsDropdown.classList.remove('open');
        });
    }

    /* Option 1: Open Settings Modal */
    if (optMenuSettings && optionsOverlay) {
        optMenuSettings.addEventListener('click', () => {
            optionsDropdown.classList.remove('open');
            optionsOverlay.classList.add('open');
            optionsOverlay.setAttribute('aria-hidden', 'false');
        });
    }

    /* Option 2: Switch to Motor Dashboard View */
    if (optMenuMotor && motorView && bmsView) {
        optMenuMotor.addEventListener('click', () => {
            optionsDropdown.classList.remove('open');
            bmsView.style.display = 'none';
            motorView.style.display = 'flex';
        });
    }

    /* Back to BMS Dashboard View */
    if (backToMainBtn && motorView && bmsView) {
        backToMainBtn.addEventListener('click', () => {
            motorView.style.display = 'none';
            bmsView.style.display = 'grid';
        });
    }

    /* Close Settings Modal */
    if (closeOptionsBtn && optionsOverlay) {
        closeOptionsBtn.addEventListener('click', () => {
            optionsOverlay.classList.remove('open');
            optionsOverlay.setAttribute('aria-hidden', 'true');
        });
        optionsOverlay.addEventListener('click', (e) => {
            if (e.target === optionsOverlay) {
                optionsOverlay.classList.remove('open');
                optionsOverlay.setAttribute('aria-hidden', 'true');
            }
        });
    }

    /* Auto refresh rate choices */
    document.querySelectorAll('.opt-choice').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.opt-choice').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const ms = parseInt(this.getAttribute('data-interval'));
            if (!isNaN(ms)) {
                clearInterval(pollIntervalTimer);
                POLL_MS = ms;
                pollIntervalTimer = setInterval(loadData, POLL_MS);
            }
        });
    });

    /* Toggle Fullscreen */
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen().catch(() => {});
                }
            }
        });
    }
});
