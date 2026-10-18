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

  // قوانین بازی پیشرفته؛ قانون تازه را اینجا اضافه کنید
  const ADVANCED = {
    specialCount: 3, // تعداد سوال‌های ویژه که تصادفی انتخاب می‌شوند
    correctMultiplier: 2, // ضریب امتیاز جواب درست در سوال ویژه
    wrongPenalty: 1, // ضریب امتیاز منفی جواب غلط در سوال ویژه
  };
  const ADVANCED_RULES = [
    `${fa(ADVANCED.specialCount)} سوال به‌صورت تصادفی «سوال ویژه» ⭐ می‌شوند و تا باز نشوند معلوم نیستند.`,
    `در سوال ویژه، جواب درست ${fa(ADVANCED.correctMultiplier)} برابر امتیاز دارد.`,
    "در سوال ویژه، تیمی که غلط جواب بدهد به اندازه‌ی امتیاز سوال امتیاز منفی می‌گیرد.",
  ];

  // state.used: کلید "دسته-ردیف" ← { winner: اندیس تیم درست یا -1, wrong: اندیس تیم‌های غلط }
  // state.special: کلید سوال‌های ویژه‌ی بازی پیشرفته
  let state = load() || freshState();
  let current = null; // { c, r, attempts, editing }
  let timer = { left: 0, id: null, running: false };

  function freshState() {
    return { phase: "setup", teams: [], used: {}, special: [], settings: defaultSettings() };
  }

  function defaultSettings() {
    return { timer: true, secondChance: false, advanced: false };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!s || !Array.isArray(s.teams) || !s.used) return null;
      s.settings = { ...defaultSettings(), ...s.settings };
      s.special = Array.isArray(s.special) ? s.special : [];
      // نسخه‌های قبلی فقط اندیس تیم برنده را نگه می‌داشتند
      for (const k in s.used) if (typeof s.used[k] === "number") s.used[k] = { winner: s.used[k], wrong: [] };
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

  const isSpecial = (key) => state.special.includes(key);

  // امتیاز هر تیم از روی نتیجه‌ی سوال‌ها حساب می‌شود، نه با جمع و تفریق تک‌تک
  function recalcScores() {
    state.teams.forEach((t) => (t.score = 0));
    for (const key in state.used) {
      const base = POINTS[Number(key.split("-")[1])];
      const { winner, wrong } = state.used[key];
      const special = isSpecial(key);
      const team = (i) => state.teams[i];
      if (winner >= 0 && team(winner)) team(winner).score += special ? base * ADVANCED.correctMultiplier : base;
      if (special) wrong.forEach((i) => team(i) && (team(i).score -= base * ADVANCED.wrongPenalty));
    }
  }

  function resetGame() {
    state.used = {};
    state.special = [];
    if (state.settings.advanced) {
      const keys = categories.flatMap((_, c) => POINTS.map((_, r) => `${c}-${r}`));
      for (let i = 0; i < ADVANCED.specialCount && keys.length; i++) {
        state.special.push(keys.splice(Math.floor(Math.random() * keys.length), 1)[0]);
      }
    }
    recalcScores();
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
    $("opt-advanced").checked = state.settings.advanced;
    $("adv-rules").classList.toggle("hidden", !state.settings.advanced);
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
    resetGame();
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

  $("opt-advanced").onchange = (e) => {
    state.settings.advanced = e.target.checked;
    $("adv-rules").classList.toggle("hidden", !e.target.checked);
    save();
  };
  ADVANCED_RULES.forEach((rule) => {
    const li = document.createElement("li");
    li.textContent = rule;
    $("adv-rules").append(li);
  });

  $("start-btn").onclick = () => {
    resetGame();
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
      const w = state.used[key].winner;
      const name = w >= 0 && state.teams[w] ? state.teams[w].name : "—";
      btn.textContent = isSpecial(key) ? `⭐ ${name}` : name;
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
    const anyLead = state.teams.some((t) => t.score !== max);
    state.teams.forEach((t) => {
      const d = document.createElement("div");
      d.className = "score-card" + (anyLead && t.score === max ? " leader" : "") + (t.score < 0 ? " negative" : "");
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
    const special = isSpecial(key);
    const base = POINTS[r];
    $("m-points").textContent = special ? `${fa(base)} × ${fa(ADVANCED.correctMultiplier)}` : `${fa(base)} امتیاز`;
    $("m-special").classList.toggle("hidden", !special);
    $("m-special-rules").textContent = `جواب درست: ${fa(base * ADVANCED.correctMultiplier)}+ امتیاز · جواب غلط: ${fa(base * ADVANCED.wrongPenalty)}− امتیاز`;
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

    const prev = editing ? state.used[key] : null;
    if (special) renderSpecialResult(prev);
    else renderTeamButtons(prev);

    $("modal").classList.remove("hidden");
    if (editing) {
      reveal(null);
      if (special) {
        $("m-who").textContent = "✏️ نتیجه را اصلاح کنید و «ثبت امتیاز» را بزنید.";
      } else {
        const w = prev.winner;
        const name = w >= 0 && state.teams[w] ? `«${state.teams[w].name}»` : "هیچ تیمی";
        $("m-who").textContent = `✏️ امتیاز این سوال الان مال ${name} است. به کدام تیم برسد؟`;
      }
    } else {
      $("m-who").textContent = special ? "کدام تیم درست و کدام تیم غلط جواب داد؟" : "کدام تیم درست جواب داد؟";
      if (state.settings.timer) startTimer();
    }
  }

  // سوال معمولی: با یک کلیک تیمی که درست جواب داده انتخاب می‌شود
  function renderTeamButtons(prev) {
    const teams = $("m-teams");
    teams.className = "team-buttons";
    teams.innerHTML = "";
    const owner = prev ? prev.winner : null;
    state.teams.forEach((t, i) => {
      const b = document.createElement("button");
      b.className = "btn" + (owner === i ? " current" : "");
      b.textContent = t.name;
      b.onclick = () => award({ winner: i, wrong: [] });
      teams.append(b);
    });
    const none = document.createElement("button");
    none.className = "btn none" + (owner === -1 ? " current" : "");
    none.textContent = "هیچ تیمی 🙅";
    none.onclick = () => award({ winner: -1, wrong: [] });
    teams.append(none);
  }

  // سوال ویژه: برای هر تیم «درست» یا «غلط» زده می‌شود؛ فقط یک تیم می‌تواند درست باشد
  function renderSpecialResult(prev) {
    const teams = $("m-teams");
    teams.className = "special-result";
    teams.innerHTML = "";
    const result = { winner: prev ? prev.winner : -1, wrong: prev ? [...prev.wrong] : [] };
    const rows = state.teams.map((t, i) => {
      const row = document.createElement("div");
      row.className = "result-row";
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = t.name;
      const ok = document.createElement("button");
      ok.className = "btn small-btn mark-ok";
      ok.textContent = "✓ درست";
      const bad = document.createElement("button");
      bad.className = "btn small-btn mark-bad";
      bad.textContent = "✗ غلط";
      ok.onclick = () => {
        result.winner = result.winner === i ? -1 : i;
        result.wrong = result.wrong.filter((x) => x !== i);
        paint();
      };
      bad.onclick = () => {
        if (result.wrong.includes(i)) result.wrong = result.wrong.filter((x) => x !== i);
        else result.wrong.push(i);
        if (result.winner === i) result.winner = -1;
        paint();
      };
      row.append(name, ok, bad);
      teams.append(row);
      return { ok, bad, i };
    });
    function paint() {
      rows.forEach(({ ok, bad, i }) => {
        ok.classList.toggle("on", result.winner === i);
        bad.classList.toggle("on", result.wrong.includes(i));
      });
    }
    paint();
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "ثبت امتیاز";
    submit.onclick = () => award({ winner: result.winner, wrong: [...result.wrong].sort((a, b) => a - b) });
    teams.append(submit);
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

  function award(result) {
    const { c, r, editing } = current;
    state.used[`${c}-${r}`] = result;
    recalcScores();
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
    if (ranked.every((t) => t.score === 0)) title = "هیچ تیمی امتیاز نگرفت!";
    else if (winners.length > 1) title = `تساوی! ${winners.map((w) => w.name).join(" و ")}`;
    else title = `برنده: ${winners[0].name} 🎉`;
    $("winner-title").textContent = title;

    const ol = $("ranking");
    ol.innerHTML = "";
    ranked.forEach((t, i) => {
      const li = document.createElement("li");
      if (winners.length < ranked.length && t.score === top) li.className = "first";
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
    resetGame();
    showScreen("setup");
  };

  // ---------- منو ----------
  function openDrawer(open) {
    $("drawer").classList.toggle("hidden", !open);
    $("drawer-backdrop").classList.toggle("hidden", !open);
    $("menu-btn").setAttribute("aria-expanded", String(open));
  }
  $("menu-btn").onclick = () => openDrawer(true);
  $("drawer-close").onclick = () => openDrawer(false);
  $("drawer-backdrop").onclick = () => openDrawer(false);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") openDrawer(false);
  });

  // ---------- تنظیمات هوش مصنوعی ----------
  const AI_KEY = "buzzergame-ai";
  const LAST_GEN_KEY = "buzzergame-last-generated";
  const DEFAULT_TOPICS = "تاریخ، جغرافیا، علوم، ادبیات، ورزش، سینما و هنر، فناوری، طبیعت و حیوانات";
  let ai = {
    key: "",
    model: "anthropic/claude-sonnet-4.5",
    online: false,
    engine: "openrouter",
    count: 8,
    topics: DEFAULT_TOPICS,
    audience: "بزرگسالان فارسی‌زبان ایرانی با معلومات عمومی متوسط",
    title: "مجموعه‌ی جدید",
  };
  try {
    ai = { ...ai, ...JSON.parse(localStorage.getItem(AI_KEY)) };
  } catch {}

  function saveAi() {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(ai));
    } catch {}
  }

  function showStatus(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = `${el.className.split(" ")[0]} small ${kind || ""}`;
    el.classList.toggle("hidden", !text);
  }

  $("or-key").value = ai.key;
  $("or-model").value = ai.model;
  $("or-online").checked = ai.online;
  $("gen-count").value = ai.count;
  $("gen-topics").value = ai.topics;
  $("gen-audience").value = ai.audience;
  $("gen-title").value = ai.title;

  $("or-key-toggle").onclick = () => {
    const input = $("or-key");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("or-key-toggle").textContent = show ? "پنهان" : "نمایش";
  };

  $("or-save").onclick = () => {
    ai.key = $("or-key").value.trim();
    ai.model = $("or-model").value.trim() || "anthropic/claude-sonnet-4.5";
    ai.online = $("or-online").checked;
    $("or-model").value = ai.model;
    saveAi();
    if (!ai.key) showStatus("or-status", "کلید خالی است.", "error");
    else if (!ai.key.startsWith("sk-or-")) showStatus("or-status", "ذخیره شد، ولی کلیدهای OpenRouter معمولاً با sk-or- شروع می‌شوند. دوباره بررسی کنید.", "error");
    else showStatus("or-status", "✓ ذخیره شد.", "ok");
  };

  $("or-clear").onclick = () => {
    ai.key = "";
    $("or-key").value = "";
    saveAi();
    showStatus("or-status", "کلید حذف شد.", "");
  };

  // ---------- تولید سوال ----------
  // گزینه‌ی Claude فقط وقتی دیده می‌شود که بازی داخل claude.ai باز شده باشد
  let sampleFn = null;
  window.claude?.use?.("sample")?.then((fn) => {
    if (!fn) return;
    sampleFn = fn;
    $("gen-engine").classList.remove("hidden");
    if (!ai.key) ai.engine = "claude";
    document.querySelector(`input[name="gen-engine"][value="${ai.engine}"]`).checked = true;
  });
  document.querySelectorAll('input[name="gen-engine"]').forEach((r) => {
    r.onchange = () => {
      ai.engine = r.value;
      saveAi();
    };
  });

  function buildPrompt() {
    const settings = [
      `- **تعداد دسته‌ها:** ${fa(ai.count)}`,
      `- **موضوع دسته‌ها:** ${ai.topics || "به انتخاب خودت"}`,
      `- **مخاطب:** ${ai.audience || "بزرگسالان فارسی‌زبان"}`,
      `- **عنوان مجموعه:** ${ai.title || "مجموعه‌ی جدید"}`,
      "- **سوال‌هایی که نباید تکرار شوند:** سوال‌های خیلی کلیشه‌ای و معروف (مثل پایتخت فرانسه، نویسنده‌ی شاهنامه، نماد شیمیایی طلا)",
    ].join("\n");
    return GENERATION_PROMPT.replace(
      /## تنظیمات درخواست[\s\S]*?\n---/,
      `## تنظیمات درخواست\n\n${settings}\n\n---`
    );
  }

  // تعداد دسته‌هایی که تا الان نوشته شده، برای نمایش پیشرفت
  function progressText(text) {
    const done = (text.match(/"name"\s*:/g) || []).length;
    return done ? `✍️ در حال نوشتن… دسته‌ی ${fa(done)} از ${fa(ai.count)}` : "✍️ در حال نوشتن…";
  }

  async function generateWithOpenRouter(prompt, signal, onText) {
    if (!ai.key) throw new Error("اول کلید OpenRouter را در بخش بالا وارد و ذخیره کنید.");
    let model = ai.model;
    if (ai.online && !model.endsWith(":online")) model += ":online";
    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${ai.key}`,
          "Content-Type": "application/json",
          "X-Title": "BuzzerGame",
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.7,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error(
        "اتصال به OpenRouter برقرار نشد. اینترنت را بررسی کنید. اگر بازی را از لینک claude.ai باز کرده‌اید، آن لینک اجازه‌ی اتصال به سایت‌های دیگر را نمی‌دهد؛ گزینه‌ی Claude را انتخاب کنید یا فایل index.html را مستقیم باز کنید."
      );
    }
    if (!res.ok) {
      let msg = "";
      try {
        msg = (await res.json()).error?.message || "";
      } catch {}
      if (res.status === 401) throw new Error("کلید OpenRouter نامعتبر است.");
      if (res.status === 402) throw new Error("اعتبار حساب OpenRouter کافی نیست. حسابتان را شارژ کنید.");
      if (res.status === 429) throw new Error("درخواست‌ها زیاد بوده. کمی صبر کنید و دوباره امتحان کنید.");
      if (res.status === 400 || res.status === 404) throw new Error(`مدل «${model}» پیدا نشد یا درخواست را نپذیرفت. نام مدل را بررسی کنید. ${msg}`);
      throw new Error(`خطای OpenRouter (${res.status}): ${msg}`);
    }

    // پاسخ به‌صورت جریانی (SSE) می‌آید
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let finish = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`خطای OpenRouter: ${chunk.error.message || ""}`);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          text += choice.delta.content;
          onText(text);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
    return { text, truncated: finish === "length" };
  }

  async function generateWithClaude(prompt, signal, onText) {
    try {
      return await sampleFn(prompt, {
        signal,
        modelTier: "complex",
        cache: false,
        onText: ({ text }) => onText(text),
      });
    } catch (e) {
      if (e.code === "cancelled") throw Object.assign(new Error(), { name: "AbortError" });
      const msgs = {
        not_granted: "اجازه‌ی استفاده از Claude داده نشد.",
        sampling_disabled: "استفاده از Claude برای این حساب فعال نیست.",
        rate_limited: "به سقف استفاده رسیده‌اید. کمی بعد دوباره امتحان کنید.",
        session_expired: "دوباره وارد حساب claude.ai شوید.",
        refused: "Claude این درخواست را انجام نداد. تنظیمات را تغییر دهید و دوباره امتحان کنید.",
      };
      throw new Error(msgs[e.code] || "اتصال به Claude قطع شد. دوباره امتحان کنید.");
    }
  }

  let genCtl = null;
  let generated = null; // { set, raw }
  try {
    const last = JSON.parse(localStorage.getItem(LAST_GEN_KEY));
    if (last) generated = { set: validateSet(last.set), raw: last.raw };
    if (!generated.set) generated = null;
  } catch {
    generated = null;
  }

  function renderGenerated() {
    $("gen-result").classList.toggle("hidden", !generated);
    if (!generated) return;
    const { set } = generated;
    const total = set.categories.length * POINTS.length;
    $("gen-summary").textContent = `✓ «${set.title || "مجموعه‌ی جدید"}»: ${fa(set.categories.length)} دسته، ${fa(total)} سوال`;
    const ul = $("gen-cats");
    ul.innerHTML = "";
    set.categories.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = `${c.icon} ${c.name}`;
      ul.append(li);
    });
    $("gen-warn").classList.toggle("hidden", state.phase === "setup");
  }

  $("gen-go").onclick = async () => {
    ai.count = Math.min(12, Math.max(1, parseInt($("gen-count").value, 10) || 8));
    ai.topics = $("gen-topics").value.trim();
    ai.audience = $("gen-audience").value.trim();
    ai.title = $("gen-title").value.trim();
    ai.key = $("or-key").value.trim() || ai.key;
    ai.model = $("or-model").value.trim() || ai.model;
    ai.online = $("or-online").checked;
    $("gen-count").value = ai.count;
    saveAi();

    const useClaude = sampleFn && ai.engine === "claude";
    genCtl = new AbortController();
    $("gen-go").disabled = true;
    $("gen-stop").classList.remove("hidden");
    let started = Date.now();
    let text = "";
    const tickStatus = () => {
      if (!text) showStatus("gen-status", `🤔 هوش مصنوعی در حال فکر کردن است… (${fa(Math.round((Date.now() - started) / 1000))} ثانیه). ممکن است چند دقیقه طول بکشد.`, "");
    };
    tickStatus();
    const clock = setInterval(tickStatus, 1000);
    const onText = (t) => {
      text = t;
      showStatus("gen-status", progressText(t), "");
    };

    try {
      const run = useClaude ? generateWithClaude : generateWithOpenRouter;
      const res = await run(buildPrompt(), genCtl.signal, onText);
      text = res.text;
      if (res.truncated) throw new Error("خروجی نیمه‌کاره ماند (خیلی طولانی بود). تعداد دسته‌ها را کمتر کنید و دوباره امتحان کنید.");
      let set;
      try {
        set = parseSet(text);
      } catch (e) {
        throw new Error(`خروجی هوش مصنوعی ایراد داشت: ${e.message} دوباره امتحان کنید.`);
      }
      generated = { set, raw: text };
      try {
        localStorage.setItem(LAST_GEN_KEY, JSON.stringify(generated));
      } catch {}
      showStatus("gen-status", "", "");
      renderGenerated();
    } catch (e) {
      if (e.name === "AbortError") showStatus("gen-status", "متوقف شد.", "");
      else showStatus("gen-status", e.message, "error");
    } finally {
      clearInterval(clock);
      $("gen-go").disabled = false;
      $("gen-stop").classList.add("hidden");
      genCtl = null;
    }
  };

  $("gen-stop").onclick = () => genCtl?.abort();

  $("gen-apply").onclick = () => {
    if (!generated) return;
    setQuestionSet(generated.set);
    generated = null;
    try {
      localStorage.removeItem(LAST_GEN_KEY);
    } catch {}
    renderGenerated();
    openDrawer(false);
    showScreen("setup");
  };

  $("gen-copy").onclick = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.raw);
      $("gen-copy").textContent = "✓ کپی شد";
    } catch {
      $("gen-copy").textContent = "کپی نشد";
    }
    setTimeout(() => ($("gen-copy").textContent = "کپی متن خروجی"), 2000);
  };

  renderGenerated();

  showScreen(state.phase === "board" || state.phase === "end" ? state.phase : "setup");
})();
