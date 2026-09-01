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
  constructor(timer, svg, onChoose) {
    super(timer);
    this.svg = svg;
    this.fill = $("#disk-fill");
    this.mainText = $("#dial-main-text");
    this.helpText = $("#dial-help-text");
    this.onChoose = onChoose;
    this.dragging = false;
    this.createMarks();
    svg.addEventListener("pointerdown", event => this.pointerDown(event));
    svg.addEventListener("pointermove", event => this.pointerMove(event));
    svg.addEventListener("pointerup", event => this.pointerUp(event));
    svg.addEventListener("pointercancel", () => this.pointerCancel());
  }

  createMarks() {
    const ticks = $("#dial-ticks");
    const labels = $("#dial-labels");
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

class BarView extends TimerView {
  constructor(timer, onChoose) {
    super(timer);
    this.track = $("#bar-track");
    this.onChoose = onChoose;
    this.dragging = false;
    this.track.addEventListener("pointerdown", event => this.pointerDown(event));
    this.track.addEventListener("pointermove", event => this.pointerMove(event));
    this.track.addEventListener("pointerup", event => this.pointerUp(event));
    this.track.addEventListener("pointercancel", () => { this.dragging = false; });
  }

  minuteAt(event) {
    const rect = this.track.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.max(1, Math.min(60, Math.round(fraction * 60)));
  }

  pointerDown(event) {
    if (this.timer.isRunning) return;
    this.dragging = true;
    this.track.setPointerCapture(event.pointerId);
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

  render({ fraction }) { $("#bar-fill").style.width = `${Math.max(0, fraction) * 100}%`; }
}

class HourglassView extends TimerView {
  constructor(timer, onChoose) {
    super(timer);
    this.svg = $("#hourglass-svg");
    this.onChoose = onChoose;
    this.dragging = false;
    this.svg.addEventListener("pointerdown", event => this.pointerDown(event));
    this.svg.addEventListener("pointermove", event => this.pointerMove(event));
    this.svg.addEventListener("pointerup", event => this.pointerUp(event));
    this.svg.addEventListener("pointercancel", () => { this.dragging = false; });
  }

  minuteAt(event) {
    const rect = this.svg.getBoundingClientRect();
    const fraction = 1 - (event.clientY - rect.top) / rect.height;
    return Math.max(1, Math.min(60, Math.round(fraction * 60)));
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

  render({ fraction }) {
    const safeFraction = Math.max(0, Math.min(1, fraction));
    const topY = 52 + (1 - safeFraction) * 151;
    const bottomHeight = (1 - safeFraction) * 151;
    const top = $("#top-sand");
    const bottom = $("#bottom-sand");
    top.setAttribute("y", topY);
    top.setAttribute("height", 203 - topY);
    bottom.setAttribute("y", 367 - bottomHeight);
    bottom.setAttribute("height", bottomHeight);
    $("#sand-stream").style.opacity = safeFraction > 0 && safeFraction < 1 ? "1" : "0";
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
    this.mode = "disk";
    this.pendingStart = null;
    this.sound = new SoundPlayer();
    this.timer = new Timer(() => this.sound.play(this.settings.sound, this.settings.volume));
    this.diskView = new DiskView(this.timer, $("#dial-svg"), (minutes, commit) => this.selectMinutes(minutes, commit));
    this.views = { disk: this.diskView };
    this.bindUI();
    this.applySettings();
    this.setMode(this.mode);
    this.wakeLock = new WakeLockManager();
    this.wakeLock.acquire();
    requestAnimationFrame(() => this.frame());
  }

  bindUI() {
    $("#settings-button").addEventListener("click", () => this.openSettings());
    $("#cancel-button").addEventListener("click", () => this.cancelTimer());
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

  setMode() {
    this.mode = "disk";
    $("#disk-view").hidden = false;
  }

  selectMinutes(minutes, commit) {
    if (this.pendingStart) { clearTimeout(this.pendingStart); this.pendingStart = null; }
    this.timer.setDuration(minutes);
    this.render();
    if (!commit) return;
    // タッチ操作中に音声コンテキストを解放しておくと、終了時もiPadで鳴らせる。
    this.sound.ensureContext();
    this.pendingStart = window.setTimeout(() => {
      this.pendingStart = null;
      this.timer.start();
      this.render();
    }, 1000);
    this.render();
  }

  cancelTimer() {
    if (this.pendingStart) {
      clearTimeout(this.pendingStart);
      this.pendingStart = null;
    }
    this.timer.cancel();
    this.render();
  }

  displayState() {
    const setting = !this.timer.isRunning && this.timer.state !== "finished";
    const fraction = setting ? this.timer.durationSeconds / 3600 : this.timer.remainingSeconds / 3600;
    const label = setting ? `${this.timer.durationSeconds / 60}分` : formatTime(this.timer.remainingSeconds);
    return { fraction, label, help: setting ? "円をなぞって時間を決める" : "" };
  }

  render() {
    this.timer.update();
    const state = this.displayState();
    Object.values(this.views).forEach(view => view.render(state));
    $("#remaining-time").value = formatTime(this.timer.remainingSeconds);
    $("#remaining-time").textContent = formatTime(this.timer.remainingSeconds);
    $("#cancel-button").hidden = !this.timer.isRunning && !this.pendingStart;
  }

  frame() { this.render(); requestAnimationFrame(() => this.frame()); }
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
new AppController();
