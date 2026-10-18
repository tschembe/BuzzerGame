(() => {
  const STORAGE_KEY = "buzzergame-state";
  const QUESTION_TIME = 30; // ثانیه

  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString("fa-IR");
  const totalQuestions = CATEGORIES.reduce((s, c) => s + c.questions.length, 0);

  // state.used: کلید "دسته-ردیف" ← اندیس تیم برنده یا -1 برای هیچ‌کدام
  let state = load() || freshState();
  let current = null; // { c, r }
  let timer = { left: 0, id: null, running: false };

  function freshState() {
    return { phase: "setup", teams: [], used: {} };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return s && Array.isArray(s.teams) && s.used ? s : null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function showScreen(name) {
    $("setup").classList.toggle("hidden", name !== "setup");
    $("board-screen").classList.toggle("hidden", name !== "board");
    $("end-screen").classList.toggle("hidden", name !== "end");
    state.phase = name;
    save();
    if (name === "setup") renderSetup();
    if (name === "board") renderBoard();
    if (name === "end") renderEnd();
  }

  // ---------- مرحله‌ی تیم‌ها ----------
  function renderSetup() {
    const list = $("team-list");
    list.innerHTML = "";
    state.teams.forEach((t, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${fa(i + 1)}. ${t.name}`;
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.title = "حذف";
      del.textContent = "🗑";
      del.onclick = () => {
        state.teams.splice(i, 1);
        save();
        renderSetup();
      };
      li.append(name, del);
      list.append(li);
    });
    const enough = state.teams.length >= 2;
    $("start-btn").disabled = !enough;
    $("setup-hint").classList.toggle("hidden", enough);
  }

  $("team-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("team-input");
    const name = input.value.trim();
    if (!name) return;
    if (state.teams.some((t) => t.name === name)) {
      alert("این نام قبلاً اضافه شده است.");
      return;
    }
    state.teams.push({ name, score: 0 });
    input.value = "";
    input.focus();
    save();
    renderSetup();
  });

  $("start-btn").onclick = () => {
    state.used = {};
    state.teams.forEach((t) => (t.score = 0));
    showScreen("board");
  };

  // ---------- جدول ----------
  function renderBoard() {
    const board = $("board");
    board.style.setProperty("--cols", CATEGORIES.length);
    board.innerHTML = "";

    CATEGORIES.forEach((cat) => {
      const h = document.createElement("div");
      h.className = "cat-head";
      h.innerHTML = `<span class="ico"></span><span class="nm"></span>`;
      h.querySelector(".ico").textContent = cat.icon;
      h.querySelector(".nm").textContent = cat.name;
      board.append(h);
    });

    POINTS.forEach((pts, r) => {
      CATEGORIES.forEach((cat, c) => {
        const btn = document.createElement("button");
        btn.className = "cell";
        const key = `${c}-${r}`;
        if (key in state.used) {
          btn.disabled = true;
          const w = state.used[key];
          btn.textContent = w >= 0 && state.teams[w] ? state.teams[w].name : "—";
        } else {
          btn.textContent = fa(pts);
          btn.onclick = () => openQuestion(c, r);
        }
        board.append(btn);
      });
    });

    renderScores();
    const left = totalQuestions - Object.keys(state.used).length;
    $("remaining").textContent = `${fa(left)} سوال باقی مانده`;
  }

  function renderScores() {
    const sb = $("scoreboard");
    sb.innerHTML = "";
    const max = Math.max(...state.teams.map((t) => t.score));
    state.teams.forEach((t) => {
      const d = document.createElement("div");
      d.className = "score-card" + (max > 0 && t.score === max ? " leader" : "");
      const n = document.createElement("div");
      n.className = "name";
      n.textContent = t.name;
      const p = document.createElement("div");
      p.className = "pts";
      p.textContent = fa(t.score);
      d.append(n, p);
      sb.append(d);
    });
  }

  $("end-btn").onclick = () => {
    if (confirm("بازی همین‌جا تمام شود و برنده اعلام شود؟")) showScreen("end");
  };

  // ---------- پنجره‌ی سوال ----------
  function openQuestion(c, r) {
    current = { c, r };
    const cat = CATEGORIES[c];
    const item = cat.questions[r];
    $("m-cat").textContent = `${cat.icon} ${cat.name}`;
    $("m-points").textContent = `${fa(POINTS[r])} امتیاز`;
    $("m-question").textContent = item.q;
    $("m-answer").textContent = item.a;
    $("m-answer-box").classList.add("hidden");
    $("m-reveal").classList.remove("hidden");
    $("m-timer-row").classList.remove("hidden");

    const teams = $("m-teams");
    teams.innerHTML = "";
    state.teams.forEach((t, i) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = t.name;
      b.onclick = () => award(i);
      teams.append(b);
    });
    const none = document.createElement("button");
    none.className = "btn none";
    none.textContent = "هیچ تیمی 🙅";
    none.onclick = () => award(-1);
    teams.append(none);

    $("modal").classList.remove("hidden");
    startTimer();
  }

  function closeModal() {
    stopTimer();
    $("modal").classList.add("hidden");
    current = null;
  }

  $("m-close").onclick = closeModal;

  $("m-reveal").onclick = () => {
    stopTimer();
    $("m-reveal").classList.add("hidden");
    $("m-timer-row").classList.add("hidden");
    $("m-answer-box").classList.remove("hidden");
  };

  function award(teamIndex) {
    const { c, r } = current;
    state.used[`${c}-${r}`] = teamIndex;
    if (teamIndex >= 0) state.teams[teamIndex].score += POINTS[r];
    save();
    closeModal();
    if (Object.keys(state.used).length >= totalQuestions) showScreen("end");
    else renderBoard();
  }

  // ---------- زمان‌سنج ----------
  function startTimer() {
    stopTimer();
    timer.left = QUESTION_TIME;
    timer.running = true;
    updateTimer();
    timer.id = setInterval(tick, 1000);
  }

  function tick() {
    if (!timer.running) return;
    timer.left--;
    updateTimer();
    if (timer.left <= 0) {
      stopTimer();
      $("m-timer-btn").textContent = "⟳ دوباره";
    }
  }

  function stopTimer() {
    clearInterval(timer.id);
    timer.id = null;
    timer.running = false;
  }

  function updateTimer() {
    $("m-timer").textContent = fa(timer.left);
    const fill = $("m-timer-fill");
    fill.style.width = `${(timer.left / QUESTION_TIME) * 100}%`;
    fill.classList.toggle("warn", timer.left <= 10);
    $("m-timer-btn").textContent = timer.running ? "⏸ توقف" : "▶ ادامه";
  }

  $("m-timer-btn").onclick = () => {
    if (timer.left <= 0) return startTimer();
    if (timer.running) {
      stopTimer();
    } else {
      timer.running = true;
      timer.id = setInterval(tick, 1000);
    }
    updateTimer();
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) closeModal();
  });

  // ---------- پایان بازی ----------
  function renderEnd() {
    const ranked = state.teams
      .map((t) => ({ ...t }))
      .sort((a, b) => b.score - a.score);
    const top = ranked.length ? ranked[0].score : 0;
    const winners = ranked.filter((t) => t.score === top);

    let title;
    if (top === 0) title = "هیچ تیمی امتیاز نگرفت!";
    else if (winners.length > 1) title = `تساوی! ${winners.map((w) => w.name).join(" و ")}`;
    else title = `برنده: ${winners[0].name} 🎉`;
    $("winner-title").textContent = title;

    const ol = $("ranking");
    ol.innerHTML = "";
    ranked.forEach((t, i) => {
      const li = document.createElement("li");
      if (top > 0 && t.score === top) li.className = "first";
      const n = document.createElement("span");
      // رتبه‌ی تیم‌های هم‌امتیاز یکسان است
      const rank = ranked.findIndex((x) => x.score === t.score) + 1;
      n.textContent = `${fa(rank)}. ${t.name}`;
      const p = document.createElement("span");
      p.className = "pts";
      p.textContent = `${fa(t.score)} امتیاز`;
      li.append(n, p);
      ol.append(li);
    });
  }

  $("restart-btn").onclick = () => {
    // تیم‌ها نگه داشته می‌شوند تا بشود سریع دوباره بازی کرد
    state.used = {};
    state.teams.forEach((t) => (t.score = 0));
    showScreen("setup");
  };

  showScreen(state.phase === "board" || state.phase === "end" ? state.phase : "setup");
})();
