(() => {
  const STORAGE_KEY = "buzzergame-state";
  const EDITS_KEY = "buzzergame-question-edits";
  const SET_KEY = "buzzergame-question-set";
  const QUESTION_TIME = 30; // ثانیه

  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString("fa-IR");
  const LETTERS = ["الف", "ب", "ج", "د"];

  // سوال‌های واردشده جای سوال‌های پیش‌فرض را می‌گیرند
  let questionSet = loadQuestionSet();
  let categories = questionSet ? questionSet.categories : CATEGORIES;
  const totalQuestions = () => categories.length * POINTS.length;

  function loadQuestionSet() {
    try {
      return validateSet(JSON.parse(localStorage.getItem(SET_KEY)));
    } catch {
      return null;
    }
  }

  // state.used: کلید "دسته-ردیف" ← اندیس تیم برنده یا -1 برای هیچ‌کدام
  let state = load() || freshState();
  let current = null; // { c, r, attempts, editing }
  let timer = { left: 0, id: null, running: false };

  function freshState() {
    return { phase: "setup", teams: [], used: {}, settings: defaultSettings() };
  }

  function defaultSettings() {
    return { timer: true, secondChance: false };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!s || !Array.isArray(s.teams) || !s.used) return null;
      s.settings = { ...defaultSettings(), ...s.settings };
      return s;
    } catch {
      return null;
    }
  }

  // سوال‌های ویرایش‌شده جدا ذخیره می‌شوند تا در بازی‌های بعدی هم بمانند
  let edits = {};
  try {
    edits = JSON.parse(localStorage.getItem(EDITS_KEY)) || {};
  } catch {}

  function saveEdits() {
    try {
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
    } catch {}
  }

  function getQuestion(c, r) {
    return edits[`${c}-${r}`] || categories[c].questions[r];
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
    renderSetInfo();
    $("opt-timer").checked = state.settings.timer;
    $("opt-second").checked = state.settings.secondChance;
    const enough = state.teams.length >= 2;
    $("start-btn").disabled = !enough;
    $("setup-hint").classList.toggle("hidden", enough);
  }

  $("team-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("team-input");
    const name = input.value.trim();
    if (!name) return;
    const dup = state.teams.some((t) => t.name === name);
    $("dup-hint").classList.toggle("hidden", !dup);
    if (dup) return;
    state.teams.push({ name, score: 0 });
    input.value = "";
    input.focus();
    save();
    renderSetup();
  });

  // ---------- وارد کردن سوال ----------
  // ی و ک عربی را به فارسی تبدیل می‌کند
  function clean(v) {
    return typeof v === "string" ? v.replace(/ي/g, "ی").replace(/ك/g, "ک").trim() : "";
  }

  // متن را می‌خواند (حتی اگر داخل ```json یا همراه توضیح باشد) و بررسی می‌کند
  function parseSet(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("متن JSON پیدا نشد. مطمئن شوید کل خروجی را کپی کرده‌اید.");
    let data;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      throw new Error("متن JSON خراب است و خوانده نشد. از هوش مصنوعی بخواهید خروجی را به‌صورت JSON معتبر تکرار کند.");
    }
    return validateSet(data, true);
  }

  // اگر strict باشد، به‌جای null خطای قابل‌فهم پرتاب می‌کند
  function validateSet(data, strict = false) {
    const fail = (msg) => {
      if (strict) throw new Error(msg);
      return null;
    };
    if (!data || !Array.isArray(data.categories)) return fail("فیلد «categories» پیدا نشد.");
    if (data.categories.length < 1 || data.categories.length > 12)
      return fail("تعداد دسته‌ها باید بین ۱ تا ۱۲ باشد.");
    const cats = [];
    for (const [ci, cat] of data.categories.entries()) {
      const where = `دسته‌ی ${fa(ci + 1)}`;
      const name = clean(cat && cat.name);
      if (!name) return fail(`${where}: نام دسته خالی است.`);
      if (!Array.isArray(cat.questions) || cat.questions.length !== POINTS.length)
        return fail(`دسته‌ی «${name}» باید دقیقاً ${fa(POINTS.length)} سوال داشته باشد.`);
      const questions = [];
      for (const [qi, item] of cat.questions.entries()) {
        const at = `دسته‌ی «${name}»، سوال ${fa(POINTS[qi])} امتیازی`;
        const q = clean(item && item.q);
        if (!q) return fail(`${at}: متن سوال خالی است.`);
        const options = Array.isArray(item.options) ? item.options.map(clean) : [];
        if (options.length !== 4 || options.some((o) => !o))
          return fail(`${at}: باید دقیقاً ۴ گزینه‌ی پر داشته باشد.`);
        if (new Set(options).size !== 4) return fail(`${at}: گزینه‌ها تکراری هستند.`);
        const out = { q, options };
        const note = clean(item.note);
        if (note) out.note = note;
        questions.push(out);
      }
      cats.push({ name, icon: clean(cat.icon) || "❓", questions });
    }
    return { title: clean(data.title), categories: cats };
  }

  function setQuestionSet(set) {
    questionSet = set;
    categories = set ? set.categories : CATEGORIES;
    try {
      if (set) localStorage.setItem(SET_KEY, JSON.stringify(set));
      else localStorage.removeItem(SET_KEY);
    } catch {}
    // ویرایش‌های قبلی مال سوال‌های دیگری بودند
    edits = {};
    saveEdits();
    state.used = {};
    save();
  }

  function renderSetInfo() {
    const n = fa(categories.length);
    const total = fa(totalQuestions());
    $("set-info").textContent = questionSet
      ? `سوال‌های واردشده${questionSet.title ? `: «${questionSet.title}»` : ""} (${n} دسته، ${total} سوال)`
      : `سوال‌های پیش‌فرض (${n} دسته، ${total} سوال)`;
    $("set-reset").classList.toggle("hidden", !questionSet);
    $("set-reset").textContent = "بازگشت به سوال‌های پیش‌فرض";
    $("set-reset").dataset.armed = "";
  }

  function toggleImport(show) {
    $("import-panel").classList.toggle("hidden", !show);
    $("import-open").classList.toggle("hidden", show);
    $("import-error").classList.add("hidden");
    if (!show) {
      $("import-text").value = "";
      $("import-file").value = "";
    }
  }

  function importText(text) {
    try {
      setQuestionSet(parseSet(text));
      toggleImport(false);
      renderSetup();
    } catch (e) {
      $("import-error").textContent = e.message;
      $("import-error").classList.remove("hidden");
    }
  }

  $("import-open").onclick = () => toggleImport(true);
  $("import-cancel").onclick = () => toggleImport(false);
  $("import-go").onclick = () => importText($("import-text").value);
  $("import-file").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $("import-text").value = reader.result;
      importText(reader.result);
    };
    reader.readAsText(file);
  };

  // برای جلوگیری از کلیک اشتباه، بازگشت به پیش‌فرض دو بار زدن لازم دارد
  $("set-reset").onclick = () => {
    const btn = $("set-reset");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "سوال‌های واردشده پاک می‌شوند. دوباره بزنید";
      return;
    }
    setQuestionSet(null);
    renderSetup();
  };

  $("opt-timer").onchange = (e) => {
    state.settings.timer = e.target.checked;
    save();
  };
  $("opt-second").onchange = (e) => {
    state.settings.secondChance = e.target.checked;
    save();
  };

  $("start-btn").onclick = () => {
    state.used = {};
    state.teams.forEach((t) => (t.score = 0));
    showScreen("board");
  };

  // ---------- جدول ----------
  // در صفحه‌های باریک (گوشی) جدول چرخانده می‌شود: هر دسته یک ردیف
  const narrow = window.matchMedia("(max-width: 700px)");
  narrow.addEventListener("change", () => state.phase === "board" && renderBoard());

  function catHead(cat) {
    const h = document.createElement("div");
    h.className = "cat-head";
    h.innerHTML = `<span class="ico"></span><span class="nm"></span>`;
    h.querySelector(".ico").textContent = cat.icon;
    h.querySelector(".nm").textContent = cat.name;
    return h;
  }

  function cell(c, r) {
    const btn = document.createElement("button");
    btn.className = "cell";
    const key = `${c}-${r}`;
    if (key in state.used) {
      btn.classList.add("used");
      btn.title = "ویرایش امتیاز این سوال";
      const w = state.used[key];
      btn.textContent = w >= 0 && state.teams[w] ? state.teams[w].name : "—";
    } else {
      btn.textContent = fa(POINTS[r]);
    }
    btn.onclick = () => openQuestion(c, r);
    return btn;
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";
    board.classList.toggle("rotated", narrow.matches);

    if (narrow.matches) {
      categories.forEach((cat, c) => {
        board.append(catHead(cat));
        POINTS.forEach((_, r) => board.append(cell(c, r)));
      });
    } else {
      board.style.setProperty("--cols", categories.length);
      categories.forEach((cat) => board.append(catHead(cat)));
      POINTS.forEach((_, r) => categories.forEach((_, c) => board.append(cell(c, r))));
    }

    renderScores();
    const left = totalQuestions() - Object.keys(state.used).length;
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

  function toggleEndConfirm(show) {
    $("end-btn").classList.toggle("hidden", show);
    $("end-confirm").classList.toggle("hidden", !show);
  }
  $("end-btn").onclick = () => toggleEndConfirm(true);
  $("end-no").onclick = () => toggleEndConfirm(false);
  $("end-yes").onclick = () => {
    toggleEndConfirm(false);
    showScreen("end");
  };

  // ---------- پنجره‌ی سوال ----------
  function openQuestion(c, r) {
    // سوالی که قبلاً جواب داده شده در حالت ویرایش باز می‌شود
    const key = `${c}-${r}`;
    const editing = key in state.used;
    current = { c, r, attempts: 0, editing };
    const cat = categories[c];
    const item = getQuestion(c, r);
    showEditForm(false);
    $("m-cat").textContent = `${cat.icon} ${cat.name}`;
    $("m-points").textContent = `${fa(POINTS[r])} امتیاز`;
    $("m-question").textContent = item.q;
    $("m-answer").textContent = item.options[0];
    $("m-note").textContent = item.note || "";
    $("m-note").classList.toggle("hidden", !item.note);

    // گزینه‌ی اول جواب درست است؛ ترتیب را به‌هم می‌ریزیم
    const order = item.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const opts = $("m-options");
    opts.innerHTML = "";
    order.forEach((oi, pos) => {
      const b = document.createElement("button");
      b.className = "option";
      b.dataset.correct = oi === 0 ? "1" : "";
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = LETTERS[pos];
      const text = document.createElement("span");
      text.textContent = item.options[oi];
      b.append(letter, text);
      b.onclick = () => pick(b);
      opts.append(b);
    });
    $("m-answer-box").classList.add("hidden");
    $("m-reveal").classList.remove("hidden");
    $("m-timer-row").classList.toggle("hidden", !state.settings.timer);
    $("m-retry").classList.add("hidden");

    const teams = $("m-teams");
    teams.innerHTML = "";
    const owner = editing ? state.used[key] : null;
    state.teams.forEach((t, i) => {
      const b = document.createElement("button");
      b.className = "btn" + (owner === i ? " current" : "");
      b.textContent = t.name;
      b.onclick = () => award(i);
      teams.append(b);
    });
    const none = document.createElement("button");
    none.className = "btn none" + (owner === -1 ? " current" : "");
    none.textContent = "هیچ تیمی 🙅";
    none.onclick = () => award(-1);
    teams.append(none);

    $("modal").classList.remove("hidden");
    if (editing) {
      reveal(null);
      const name = owner >= 0 && state.teams[owner] ? `«${state.teams[owner].name}»` : "هیچ تیمی";
      $("m-who").textContent = `✏️ امتیاز این سوال الان مال ${name} است. به کدام تیم برسد؟`;
    } else {
      $("m-who").textContent = "کدام تیم درست جواب داد؟";
      if (state.settings.timer) startTimer();
    }
  }

  function closeModal() {
    stopTimer();
    $("modal").classList.add("hidden");
    current = null;
  }

  $("m-close").onclick = closeModal;

  // ---------- ویرایش سوال ----------
  function showEditForm(show) {
    $("m-edit").classList.toggle("hidden", !show);
    $("m-view").classList.toggle("hidden", show);
    $("m-edit-btn").classList.toggle("hidden", show);
  }

  $("m-edit-btn").onclick = () => {
    const { c, r } = current;
    const item = getQuestion(c, r);
    stopTimer();
    $("e-q").value = item.q;
    $("e-note").value = item.note || "";
    const box = $("e-options");
    box.innerHTML = "";
    item.options.forEach((opt, i) => {
      const row = document.createElement("label");
      row.className = "edit-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "e-correct";
      radio.value = i;
      radio.checked = i === 0;
      radio.title = "جواب درست";
      const input = document.createElement("input");
      input.type = "text";
      input.id = `e-opt-${i}`;
      input.value = opt;
      row.append(radio, input);
      box.append(row);
    });
    $("e-error").classList.add("hidden");
    $("e-reset").classList.toggle("hidden", !edits[`${c}-${r}`]);
    showEditForm(true);
  };

  $("m-edit").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("e-q").value.trim();
    const opts = [0, 1, 2, 3].map((i) => $(`e-opt-${i}`).value.trim());
    const correct = Number(document.querySelector('input[name="e-correct"]:checked').value);
    let err = "";
    if (!q) err = "متن سوال خالی است.";
    else if (opts.some((o) => !o)) err = "همه‌ی چهار گزینه باید پر شوند.";
    else if (new Set(opts).size < 4) err = "گزینه‌ها نباید تکراری باشند.";
    $("e-error").textContent = err;
    $("e-error").classList.toggle("hidden", !err);
    if (err) return;

    // جواب درست همیشه گزینه‌ی اول ذخیره می‌شود
    const options = [opts[correct], ...opts.filter((_, i) => i !== correct)];
    const item = { q, options };
    const note = $("e-note").value.trim();
    if (note) item.note = note;
    const { c, r } = current;
    edits[`${c}-${r}`] = item;
    saveEdits();
    openQuestion(c, r);
  });

  $("e-cancel").onclick = () => openQuestion(current.c, current.r);

  $("e-reset").onclick = () => {
    const { c, r } = current;
    delete edits[`${c}-${r}`];
    saveEdits();
    openQuestion(c, r);
  };

  // با فرصت دوم، اولین جواب غلط فقط همان گزینه را رد می‌کند و نوبت به تیم بعدی می‌رسد
  function pick(b) {
    if (!b.dataset.correct && state.settings.secondChance && current.attempts === 0) {
      current.attempts++;
      b.disabled = true;
      b.classList.add("wrong");
      $("m-retry").classList.remove("hidden");
      if (state.settings.timer) startTimer();
      return;
    }
    reveal(b);
  }

  // picked: گزینه‌ای که انتخاب شده (یا null برای «نمایش جواب»)
  function reveal(picked) {
    stopTimer();
    $("m-options").querySelectorAll(".option").forEach((b) => {
      b.disabled = true;
      if (b.dataset.correct) b.classList.add("correct");
      else if (b === picked) b.classList.add("wrong");
    });
    $("m-reveal").classList.add("hidden");
    $("m-retry").classList.add("hidden");
    $("m-timer-row").classList.add("hidden");
    $("m-answer-box").classList.remove("hidden");
  }

  $("m-reveal").onclick = () => reveal(null);

  function award(teamIndex) {
    const { c, r, editing } = current;
    const key = `${c}-${r}`;
    // در ویرایش، اول امتیاز را از تیم قبلی پس می‌گیریم
    const prev = state.used[key];
    if (editing && prev >= 0 && state.teams[prev]) state.teams[prev].score -= POINTS[r];
    state.used[key] = teamIndex;
    if (teamIndex >= 0) state.teams[teamIndex].score += POINTS[r];
    save();
    closeModal();
    if (!editing && Object.keys(state.used).length >= totalQuestions()) showScreen("end");
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

  $("back-btn").onclick = () => showScreen("board");

  $("restart-btn").onclick = () => {
    // تیم‌ها نگه داشته می‌شوند تا بشود سریع دوباره بازی کرد
    state.used = {};
    state.teams.forEach((t) => (t.score = 0));
    showScreen("setup");
  };

  showScreen(state.phase === "board" || state.phase === "end" ? state.phase : "setup");
})();
