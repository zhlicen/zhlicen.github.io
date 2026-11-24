/* 牛牛跨栏 1.0.2 —— 音效。全部用 Web Audio 现场合成，包里不带音频文件。
   默认关闭；用户点了“音效”按钮、并且做了操作之后才会创建音频（浏览器要求声音必须由用户的操作触发）。 */
var NainiuAudio = (function () {
  'use strict';

  var ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  var enabled = false;                 // 用户是否打开了音效
  var musicOn = false;                 // 现在是否应该在放背景音乐
  var timer = null, step = 0, nextTime = 0;
  var listeners = [];
  var STEP = 60 / 128 / 4;             // 128 拍 / 分钟，一步是一个 16 分音符，约 0.117 秒
  var VOL = { master: 0.9, music: 0.3, sfx: 0.8 };

  // ---------- 基础：一个带音高滑动的振荡音、一段经过滤波的噪声 ----------
  function tone(ac, dest, t, type, f0, f1, dur, vol, slide) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * (slide || 1));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
    return o;
  }
  function noise(ac, dest, buf, t, dur, vol, filterType, freq, q) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = buf;
    s.loop = true;
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t);
    s.stop(t + dur + 0.03);
  }
  function makeNoise(ac) {
    var len = Math.floor(ac.sampleRate * 1.5), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // 贝斯：锯齿波过低通滤波，短促的音头
  function bass(ac, dest, t, freq, dur) {
    var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // ---------- 四种音效 ----------
  // 跳跃：“啵”地往上弹
  function sfxJump(ac, dest, buf, t) {
    tone(ac, dest, t, 'triangle', 320, 720, 0.16, 0.5, 0.7);
    tone(ac, dest, t, 'sine', 640, 1400, 0.12, 0.14, 0.7);
  }
  // 哞：两支略微错开音高的锯齿波，音高先降后稳，带一点颤动，再过低通滤波变成圆润的鼻音
  function sfxMoo(ac, dest, buf, t) {
    var f = ac.createBiquadFilter(), g = ac.createGain(), dur = 0.62;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(620, t + 0.18);
    f.frequency.linearRampToValueAtTime(360, t + dur);
    f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.07);
    g.gain.setValueAtTime(0.5, t + dur - 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    g.connect(dest);
    [1, 1.011].forEach(function (k) {
      var o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(138 * k, t);
      o.frequency.exponentialRampToValueAtTime(98 * k, t + 0.25);
      o.frequency.linearRampToValueAtTime(104 * k, t + dur);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.03);
      var lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = 4.5;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t + 0.2);
      lfo.stop(t + dur);
    });
  }
  // 观众欢呼：一层由弱到强的宽带噪声，再加一串零散的掌声
  function cheer(ac, dest, buf, t, dur, vol) {
    var up = dur * 0.2, down = t + dur;
    [[1100, 0.6, 1], [2700, 0.8, 0.45]].forEach(function (p) {
      var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = buf;
      s.loop = true;
      f.type = 'bandpass';
      f.frequency.value = p[0];
      f.Q.value = p[1];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * p[2], t + up);
      g.gain.setValueAtTime(vol * p[2], t + dur * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, down);
      s.connect(f);
      f.connect(g);
      g.connect(dest);
      s.start(t);
      s.stop(down + 0.03);
    });
    for (var i = 0; i < Math.round(dur * 14); i++) {
      noise(ac, dest, buf, t + Math.random() * dur * 0.7, 0.04, vol * 0.5, 'highpass', 1600);
    }
  }
  function sfxCheer(ac, dest, buf, t) { cheer(ac, dest, buf, t, 0.9, 0.35); }
  // 完美：更响的欢呼，加两个清脆的铃音
  function sfxPerfect(ac, dest, buf, t) {
    cheer(ac, dest, buf, t, 1.3, 0.5);
    tone(ac, dest, t, 'sine', 1318, 1318, 0.3, 0.22);
    tone(ac, dest, t + 0.1, 'sine', 1760, 1760, 0.45, 0.22);
  }
  // 摔倒：一段三折的卡通音 —— 先“啪叽”一声闷响带起尘土，接着一声滑稽的滑哨抖着往下掉，
  // 最后是泄了气的小号“哇——哇——哇———”，一个音比一个音低
  function sfxCrash(ac, dest, buf, t) {
    tone(ac, dest, t, 'sine', 170, 40, 0.22, 0.9, 0.4);                        // 闷响
    noise(ac, dest, buf, t, 0.18, 0.5, 'lowpass', 900);                         // 啪叽
    noise(ac, dest, buf, t + 0.02, 0.3, 0.25, 'bandpass', 300, 1.5);
    var w = tone(ac, dest, t + 0.08, 'sine', 1500, 380, 0.6, 0.22);             // 滑哨
    var lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 11;
    lg.gain.value = 60;
    lfo.connect(lg);
    lg.connect(w.frequency);
    lfo.start(t + 0.08);
    lfo.stop(t + 0.7);
    var notes = [233, 220, 196, 165], at = t + 0.62;
    notes.forEach(function (f, i) {
      var last = i === notes.length - 1, dur = last ? 0.9 : 0.26;
      var o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, at);
      if (last) o.frequency.linearRampToValueAtTime(f * 0.9, at + dur);       // 最后一个音越拖越低
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      lp.Q.value = 2;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.36, at + 0.04);
      g.gain.setValueAtTime(0.36, at + dur - 0.08);
      g.gain.linearRampToValueAtTime(0.0001, at + dur);
      o.connect(lp);
      lp.connect(g);
      g.connect(dest);
      var v = ac.createOscillator(), vg = ac.createGain();                      // “哇哇”的颤动
      v.frequency.value = 7;
      vg.gain.value = 5;
      v.connect(vg);
      vg.connect(o.frequency);
      o.start(at);
      o.stop(at + dur + 0.02);
      v.start(at);
      v.stop(at + dur);
      at += dur + 0.04;
    });
  }
  var SFX = { jump: sfxJump, moo: sfxMoo, cheer: sfxCheer, perfect: sfxPerfect, crash: sfxCrash };

  // ---------- 背景电子音乐：16 步一循环，每 16 步换一个和弦 ----------
  var BASS = [55, 0, 55, 0, 55, 65.41, 0, 55, 49, 0, 49, 0, 49, 82.41, 0, 73.42];     // A1 C2 G1 E2 D2
  var CHORDS = [                                                                     // Am F C G
    [220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23],
    [261.63, 329.63, 392, 523.25], [196, 246.94, 293.66, 392],
  ];
  var ARP = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 1, 0, 2];
  function stepNote(ac, dest, buf, t, i) {
    var s = i % 16;
    if (s % 4 === 0) tone(ac, dest, t, 'sine', 150, 45, 0.16, 1.6, 0.5);            // 底鼓
    if (s % 4 === 2) noise(ac, dest, buf, t, 0.08, 0.4, 'highpass', 7000);          // 开镲
    noise(ac, dest, buf, t, 0.025, 0.16, 'highpass', 9000);                         // 闭镲
    if (BASS[s]) bass(ac, dest, t, BASS[s], STEP * 0.9);                            // 贝斯
    var chord = CHORDS[Math.floor(i / 16) % CHORDS.length];
    tone(ac, dest, t, 'square', chord[ARP[s]], chord[ARP[s]], STEP * 0.85, 0.16);   // 琶音
  }

  // ---------- 对外的接口 ----------
  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      var comp = ctx.createDynamicsCompressor();        // 压限：几种声音叠在一起时不会破音
      comp.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = VOL.master;
      master.connect(comp);
      musicBus = ctx.createGain();
      musicBus.gain.value = VOL.music;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = VOL.sfx;
      sfxBus.connect(master);
      noiseBuf = makeNoise(ctx);
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();   // 必须在用户操作的事件处理函数里调用才会生效
    return true;
  }
  function startMusic() {
    if (!enabled || !musicOn || timer || !ensure()) return;
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    timer = setInterval(function () {                // 每次提前排好接下来 0.25 秒的音符
      while (nextTime < ctx.currentTime + 0.25) {
        stepNote(ctx, musicBus, noiseBuf, nextTime, step++);
        nextTime += STEP;
      }
    }, 80);
  }
  function stopMusic() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function setEnabled(v) {
    v = !!v;
    if (v === enabled) return;
    enabled = v;
    if (!enabled) stopMusic();
    else startMusic();
    listeners.forEach(function (fn) { fn(enabled); });
  }
  return {
    isEnabled: function () { return enabled; },
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); },
    onChange: function (fn) { listeners.push(fn); },
    // 在用户操作里调用：如果音效是开着的，这时才真正把音频启动起来
    unlock: function () { if (enabled) ensure(); },
    sfx: function (name) {
      if (!enabled || !SFX[name] || !ensure()) return;
      if (ctx.state !== 'running') return;
      SFX[name](ctx, sfxBus, noiseBuf, ctx.currentTime + 0.005);
    },
    music: function (on) {
      musicOn = !!on;
      if (musicOn) startMusic(); else stopMusic();
    },
    // 页面隐藏时停掉声音，回来后接着放
    pause: function (hidden) {
      if (!ctx) return;
      if (hidden) { if (ctx.suspend) ctx.suspend(); }
      else if (enabled && ctx.resume) ctx.resume();
    },
    // 自检用：离线渲染一段音效（或 4 小节音乐），返回 AudioBuffer
    renderOffline: function (name) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return Promise.reject(new Error('当前环境不支持 OfflineAudioContext'));
      var sec = name === 'music' ? STEP * 64 + 0.3 : 3;      // 摔倒那段约两秒半，其余都短
      var ac = new OAC(1, Math.ceil(sec * 44100), 44100), buf = makeNoise(ac);
      var bus = ac.createGain();
      bus.gain.value = VOL.master * (name === 'music' ? VOL.music : VOL.sfx);
      bus.connect(ac.destination);
      if (name === 'music') {
        for (var i = 0; i < 64; i++) stepNote(ac, bus, buf, 0.05 + i * STEP, i);
      } else if (SFX[name]) {
        SFX[name](ac, bus, buf, 0.05);
      } else {
        return Promise.reject(new Error('没有这个音效: ' + name));
      }
      return ac.startRendering();
    },
  };
})();
