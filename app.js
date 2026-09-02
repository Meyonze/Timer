const STORAGE_KEY = "jikkantai-settings-v1";
const DEFAULT_SETTINGS = {
  color: "#2878d4",
  volume: 0.55,
  sound: "gentle",
  defaultMode: "disk"
};

const $ = selector => document.querySelector(selector);

class Timer {
  constructor(onFinish) {
    this.durationSeconds = 10 * 60;
    this.remainingSeconds = 0;
    this.endAt = null;
    this.state = "idle";
    this.onFinish = onFinish;
  }

  setDuration(minutes) {
    this.durationSeconds = Math.min(60, Math.max(1, minutes)) * 60;
    this.remainingSeconds = this.durationSeconds;
    this.endAt = null;
    this.state = "idle";
  }

  start() {
    this.remainingSeconds = this.durationSeconds;
    this.endAt = Date.now() + this.durationSeconds * 1000;
    this.state = "running";
  }

  cancel() {
    this.remainingSeconds = 0;
    this.endAt = null;
    this.state = "finished";
  }

  update() {
    if (this.state !== "running") return;
    this.remainingSeconds = Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000));
    if (this.remainingSeconds === 0) {
      this.state = "finished";
      this.endAt = null;
      this.onFinish();
    }
  }

  get isRunning() { return this.state === "running"; }
  get fraction() { return this.durationSeconds ? this.remainingSeconds / this.durationSeconds : 0; }
}

class SoundPlayer {
  constructor() { this.context = null; }

  ensureContext() {
    if (!(window.AudioContext || window.webkitAudioContext)) return null;
    if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  play(type, volume) {
    if (!volume || !(window.AudioContext || window.webkitAudioContext)) return;
    const context = this.ensureContext();
    const notes = type === "bell" ? [[784, 0, 1.35]] : type === "chime" ? [[659, 0, .7], [880, .18, .95]] : [[523.25, 0, .65], [659.25, .14, .75]];
    const now = context.currentTime;
    notes.forEach(([frequency, offset, length]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type === "bell" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .16), now + offset + .025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + length + .03);
    });
  }
}

class WakeLockManager {
  constructor() {
    this.sentinel = null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.acquire();
    });
  }

  async acquire() {
    if (this.sentinel || !navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", () => { this.sentinel = null; });
    } catch (_) {
      // 非対応・省電力モードなどでもタイマーは継続する。
    }
  }
}

class TimerView {
  constructor(timer) { this.timer = timer; }
  render() {}
}

class DiskView extends TimerView {
  constructor(timer, root, onChoose) {
    super(timer);
    this.root = root;
    this.svg = root.querySelector(".dial-svg");
    this.fill = root.querySelector(".disk-fill");
    this.mainText = root.querySelector(".dial-main-text");
    this.helpText = root.querySelector(".dial-help-text");
    this.onChoose = onChoose;
    this.dragging = false;
    this.createMarks();
    this.svg.addEventListener("pointerdown", event => this.pointerDown(event));
    this.svg.addEventListener("pointermove", event => this.pointerMove(event));
    this.svg.addEventListener("pointerup", event => this.pointerUp(event));
    this.svg.addEventListener("pointercancel", () => this.pointerCancel());
  }

  createMarks() {
    const ticks = this.root.querySelector(".dial-ticks");
    const labels = this.root.querySelector(".dial-labels");
    for (let minute = 1; minute <= 60; minute += 1) {
      const angle = minute / 60 * Math.PI * 2 - Math.PI / 2;
      const major = minute % 5 === 0;
      const outer = 204;
      const inner = major ? 184 : 192;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", 250 + Math.cos(angle) * inner);
      line.setAttribute("y1", 250 + Math.sin(angle) * inner);
      line.setAttribute("x2", 250 + Math.cos(angle) * outer);
      line.setAttribute("y2", 250 + Math.sin(angle) * outer);
      line.setAttribute("class", `dial-tick${major ? " major" : ""}`);
      ticks.append(line);
      if (major) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", 250 + Math.cos(angle) * 167);
        text.setAttribute("y", 256 + Math.sin(angle) * 167);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "dial-label");
        text.textContent = String(minute);
        labels.append(text);
      }
    }
  }

  minuteAt(event) {
    const rect = this.svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 500 - 250;
    const y = (event.clientY - rect.top) / rect.height * 500 - 250;
    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    return Math.max(1, Math.min(60, Math.round(angle / (Math.PI * 2) * 60) || 60));
  }

  pointerDown(event) {
    if (this.timer.isRunning) return;
    this.dragging = true;
    this.svg.setPointerCapture(event.pointerId);
    this.onChoose(this.minuteAt(event), false);
  }

  pointerMove(event) {
    if (this.dragging) this.onChoose(this.minuteAt(event), false);
  }

  pointerUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.onChoose(this.minuteAt(event), true);
  }

  pointerCancel() { this.dragging = false; }

  render({ fraction, label, help }) {
    this.fill.setAttribute("d", wedgePath(fraction));
    this.mainText.textContent = label;
    this.helpText.textContent = help;
  }
}

function wedgePath(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f === 0) return "";
  if (f >= .9999) return "M250 250 m0 -201 a201 201 0 1 1 0 402 a201 201 0 1 1 0 -402";
  const end = f * Math.PI * 2 - Math.PI / 2;
  const x = 250 + Math.cos(end) * 201;
  const y = 250 + Math.sin(end) * 201;
  return `M250 250 L250 49 A201 201 0 ${f > .5 ? 1 : 0} 1 ${x} ${y} Z`;
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}

class AppController {
  constructor() {
    this.settings = loadSettings();
    this.dualMode = false;
    this.sound = new SoundPlayer();
    this.units = [0, 1].map(index => {
      const timer = new Timer(() => this.sound.play(this.settings.sound, this.settings.volume));
      const root = document.querySelector(`.timer-view[data-unit="${index}"]`);
      const view = new DiskView(timer, root, (minutes, commit) => this.selectMinutes(index, minutes, commit));
      return { timer, view, pendingStart: null };
    });
    this.bindUI();
    this.applySettings();
    this.wakeLock = new WakeLockManager();
    this.wakeLock.acquire();
    window.addEventListener("resize", () => this.handleOrientationChange());
    requestAnimationFrame(() => this.frame());
  }

  bindUI() {
    $("#settings-button").addEventListener("click", () => this.openSettings());
    $("#layout-toggle").addEventListener("click", () => this.toggleDualMode());
    $("#cancel-button").addEventListener("click", () => this.cancelAll());
    $("#settings-form").addEventListener("submit", event => {
      event.preventDefault();
      if (event.submitter?.value === "save") this.saveSettings();
      $("#settings-dialog").close();
    });
    $("#settings-dialog").addEventListener("close", () => this.restoreSettingsForm());
    $("#sound-test-button").addEventListener("click", () => {
      this.sound.play($("#sound-input").value, Number($("#volume-input").value));
    });
    $("#color-input").addEventListener("input", event => document.documentElement.style.setProperty("--timer-color", event.target.value));
  }

  toggleDualMode(force) {
    const next = typeof force === "boolean" ? force : !this.dualMode;
    if (next === this.dualMode) return;
    this.dualMode = next;
    const secondUnit = this.units[1];
    if (!this.dualMode) {
      // 非表示に戻す2つ目のタイマーは念のためキャンセルしておく
      if (secondUnit.pendingStart) { clearTimeout(secondUnit.pendingStart); secondUnit.pendingStart = null; }
      secondUnit.timer.cancel();
    }
    secondUnit.view.root.hidden = !this.dualMode;
    $("#timer-stage").classList.toggle("dual-mode", this.dualMode);
    $("#layout-toggle").setAttribute("aria-pressed", String(this.dualMode));
    this.render();
  }

  handleOrientationChange() {
    // 縦向きに戻ったら横並び表示は自動的に解除する
    if (this.dualMode && window.matchMedia("(orientation: portrait)").matches) this.toggleDualMode(false);
  }

  applySettings() {
    document.documentElement.style.setProperty("--timer-color", this.settings.color);
    this.restoreSettingsForm();
  }

  restoreSettingsForm() {
    $("#color-input").value = this.settings.color;
    $("#volume-input").value = String(this.settings.volume);
    $("#sound-input").value = this.settings.sound;
    document.documentElement.style.setProperty("--timer-color", this.settings.color);
  }

  openSettings() { $("#settings-dialog").showModal(); }

  saveSettings() {
    this.settings = {
      color: $("#color-input").value,
      volume: Number($("#volume-input").value),
      sound: $("#sound-input").value,
      defaultMode: "disk"
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    this.applySettings();
  }

  selectMinutes(index, minutes, commit) {
    const unit = this.units[index];
    if (unit.pendingStart) { clearTimeout(unit.pendingStart); unit.pendingStart = null; }
    unit.timer.setDuration(minutes);
    this.render();
    if (!commit) return;
    // タッチ操作中に音声コンテキストを解放しておくと、終了時もiPadで鳴らせる。
    this.sound.ensureContext();
    unit.pendingStart = window.setTimeout(() => {
      unit.pendingStart = null;
      unit.timer.start();
      this.render();
    }, 1000);
    this.render();
  }

  cancelAll() {
    const activeUnits = this.dualMode ? this.units : [this.units[0]];
    activeUnits.forEach(unit => {
      if (unit.pendingStart) { clearTimeout(unit.pendingStart); unit.pendingStart = null; }
      unit.timer.cancel();
    });
    this.render();
  }

  unitDisplayState(unit) {
    const setting = !unit.timer.isRunning && unit.timer.state !== "finished";
    const fraction = setting ? unit.timer.durationSeconds / 3600 : unit.timer.remainingSeconds / 3600;
    const label = setting ? `${unit.timer.durationSeconds / 60}分` : formatTime(unit.timer.remainingSeconds);
    return { fraction, label, help: setting ? "円をなぞって時間を決める" : "" };
  }

  render() {
    const activeUnits = this.dualMode ? this.units : [this.units[0]];
    let anyActive = false;
    let leadRemaining = null;
    activeUnits.forEach(unit => {
      unit.timer.update();
      unit.view.render(this.unitDisplayState(unit));
      if (unit.timer.isRunning || unit.pendingStart) anyActive = true;
      if (unit.timer.isRunning && (leadRemaining === null || unit.timer.remainingSeconds < leadRemaining)) {
        leadRemaining = unit.timer.remainingSeconds;
      }
    });
    const displaySeconds = leadRemaining === null ? 0 : leadRemaining;
    $("#remaining-time").value = formatTime(displaySeconds);
    $("#remaining-time").textContent = formatTime(displaySeconds);
    $("#remaining-time").hidden = this.dualMode;
    $("#cancel-button").hidden = !anyActive;
  }

  frame() { this.render(); requestAnimationFrame(() => this.frame()); }
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
new AppController();
