(() => {
  const STORAGE_KEY = "buzzergame-state";
  const EDITS_KEY = "buzzergame-question-edits";
  const SET_KEY = "buzzergame-question-set";
  const QUESTION_TIME = 30; // ثانیه

  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString("fa-IR");
  // بدون جداکننده‌ی هزارگان، برای فیلدهایی که کاربر ویرایش می‌کند
  const faPlain = (n) => Number(n).toLocaleString("fa-IR", { useGrouping: false });
  const LETTERS = ["الف", "ب", "ج", "د"];
  const BZ = window.Buzzer;
  const TEAM_COLORS = BZ?.colors || ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
  const MAX_TEAMS = 12;
  // روی خانه‌های جدول، اسم‌های بلند کوتاه می‌شوند تا خانه بیش از حد بلند نشود
  const SHORT_NAME = 14;
  const shortName = (name) => (name.length > SHORT_NAME ? name.slice(0, SHORT_NAME - 1).trim() + "…" : name);
  const teamColor = (t) => TEAM_COLORS[(t.color || 0) % TEAM_COLORS.length];

  // سری‌های پیش‌فرض در QUESTION_SETS هستند؛ سوال‌های واردشده یک سری جدا با شناسه‌ی "imported" می‌شوند
  let questionSet = loadQuestionSet();
  // دسته‌ها و امتیازهای سری انتخاب‌شده، بعد از خواندن state مقدار می‌گیرند
  let categories;
  let levels; // امتیاز ردیف‌ها، مثلاً [200, 400, 600, 800, 1000]؛ هر سری می‌تواند امتیازهای خودش را داشته باشد
  const gridTotal = () => categories.length * levels.length;
  // در حالت یک‌امتیازی فقط سوال‌های داخل state.order پرسیده می‌شوند
  const onePoint = () => state.settings.onePoint;
  const totalQuestions = () => (onePoint() ? state.order.length : gridTotal());

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
  // state.order: در حالت یک‌امتیازی، کلید سوال‌ها به ترتیب تصادفی پرسیده شدن
  let state = load() || freshState();
  let current = null; // { c, r, attempts, editing }
  let timer = { left: 0, id: null, running: false };

  function freshState() {
    return { phase: "setup", teams: [], used: {}, special: [], order: [], settings: defaultSettings() };
  }

  function defaultSettings() {
    // onePointCount: تعداد سوال‌های حالت یک‌امتیازی؛ ۰ یعنی همه‌ی سوال‌های سری
    return { timer: true, secondChance: false, advanced: false, onePoint: false, onePointCount: 0, setId: QUESTION_SETS[0].id };
  }

  function setFor(id) {
    if (id === "imported" && questionSet) return questionSet;
    const set = QUESTION_SETS.find((x) => x.id === id) || QUESTION_SETS[0];
    return { categories: set.categories, points: set.points || POINTS };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!s || !Array.isArray(s.teams) || !s.used) return null;
      s.settings = { ...defaultSettings(), ...s.settings };
      s.special = Array.isArray(s.special) ? s.special : [];
      s.order = Array.isArray(s.order) ? s.order : [];
      // نسخه‌های قبلی به تیم‌ها شناسه و رنگ نمی‌دادند
      s.teams.forEach((t, i) => {
        t.id ||= newId();
        if (typeof t.color !== "number") t.color = i % 8;
      });
      // نسخه‌های قبلی سری انتخابی نداشتند: اگر سوالی وارد شده بود همان در حال استفاده بود
      if (!s.settings.setId || (s.settings.setId === "imported" && !questionSet))
        s.settings.setId = questionSet && !s.settings.setId ? "imported" : QUESTION_SETS[0].id;
      // نسخه‌های قبلی فقط اندیس تیم برنده را نگه می‌داشتند
      for (const k in s.used) if (typeof s.used[k] === "number") s.used[k] = { winner: s.used[k], wrong: [] };
      return s;
    } catch {
      return null;
    }
  }

  ({ categories, points: levels } = setFor(state.settings.setId));

  // سوال‌های ویرایش‌شده برای هر سری جدا ذخیره می‌شوند تا در بازی‌های بعدی هم بمانند
  let edits = {};
  try {
    edits = JSON.parse(localStorage.getItem(EDITS_KEY)) || {};
  } catch {}
  // نسخه‌های قبلی ویرایش‌ها را بدون سری نگه می‌داشتند (کلیدهایی مثل "0-1")
  if (Object.keys(edits).some((k) => /^\d+-\d+$/.test(k))) {
    edits = { [questionSet ? "imported" : QUESTION_SETS[0].id]: edits };
  }
  const setEdits = () => (edits[state.settings.setId] ||= {});

  function saveEdits() {
    try {
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
    } catch {}
  }

  function getQuestion(c, r) {
    return setEdits()[`${c}-${r}`] || categories[c].questions[r];
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
    publishHost();
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // رنگی که هنوز هیچ تیمی ندارد؛ اگر همه گرفته شده باشند، به ترتیب تکرار می‌شوند
  function freeColor() {
    for (let c = 0; c < TEAM_COLORS.length; c++) if (!state.teams.some((t) => t.color === c)) return c;
    return state.teams.length % TEAM_COLORS.length;
  }

  function addTeam(name) {
    const team = { id: newId(), name, color: freeColor(), score: 0 };
    state.teams.push(team);
    return team;
  }

  const isSpecial = (key) => state.special.includes(key);

  // امتیاز هر تیم از روی نتیجه‌ی سوال‌ها حساب می‌شود، نه با جمع و تفریق تک‌تک
  function recalcScores() {
    state.teams.forEach((t) => (t.score = 0));
    for (const key in state.used) {
      const base = onePoint() ? 1 : levels[Number(key.split("-")[1])];
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
    state.order = [];
    const keys = categories.flatMap((_, c) => levels.map((_, r) => `${c}-${r}`));
    if (onePoint()) {
      // همه‌ی سوال‌ها از همه‌ی دسته‌ها و سطح‌ها قاطی و به‌هم ریخته می‌شوند
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      const n = state.settings.onePointCount;
      state.order = n > 0 ? keys.slice(0, n) : keys;
    } else if (state.settings.advanced) {
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
      li.style.setProperty("--team", teamColor(t));
      const name = document.createElement("span");
      name.className = "team-name";
      name.textContent = `${fa(i + 1)}. ${t.name}`;
      if (phones[t.id]) name.textContent += ` 📱${phones[t.id] > 1 ? fa(phones[t.id]) : ""}`;
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
    $("adv-rules").classList.toggle("hidden", !state.settings.advanced || onePoint());
    renderOnePointOptions();
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
    if (state.teams.length >= MAX_TEAMS) return;
    addTeam(name);
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
  // defaultPoints برای وقتی است که متن فیلد points نداشته باشد
  function parseSet(text, defaultPoints = POINTS) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("متن JSON پیدا نشد. مطمئن شوید کل خروجی را کپی کرده‌اید.");
    let data;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      throw new Error("متن JSON خراب است و خوانده نشد. از هوش مصنوعی بخواهید خروجی را به‌صورت JSON معتبر تکرار کند.");
    }
    return validateSet(data, true, defaultPoints);
  }

  // اگر strict باشد، به‌جای null خطای قابل‌فهم پرتاب می‌کند
  function validateSet(data, strict = false, defaultPoints = POINTS) {
    const fail = (msg) => {
      if (strict) throw new Error(msg);
      return null;
    };
    if (!data || !Array.isArray(data.categories)) return fail("فیلد «categories» پیدا نشد.");
    if (data.categories.length < 1 || data.categories.length > 12)
      return fail("تعداد دسته‌ها باید بین ۱ تا ۱۲ باشد.");
    let points = defaultPoints;
    if (data.points !== undefined) {
      points = cleanPoints(data.points);
      if (!points) return fail("فیلد «points» باید فهرستی از ۱ تا ۱۰ عدد مثبت و متفاوت باشد.");
    }
    const cats = [];
    for (const [ci, cat] of data.categories.entries()) {
      const where = `دسته‌ی ${fa(ci + 1)}`;
      const name = clean(cat && cat.name);
      if (!name) return fail(`${where}: نام دسته خالی است.`);
      if (!Array.isArray(cat.questions) || cat.questions.length !== points.length)
        return fail(`دسته‌ی «${name}» باید دقیقاً ${fa(points.length)} سوال داشته باشد (به تعداد امتیازها).`);
      const questions = [];
      for (const [qi, item] of cat.questions.entries()) {
        const at = `دسته‌ی «${name}»، سوال ${fa(points[qi])} امتیازی`;
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
    return { title: clean(data.title), points, categories: cats };
  }

  // فهرست امتیازها را بررسی و از کم به زیاد مرتب می‌کند؛ اگر نامعتبر باشد null
  function cleanPoints(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 10) return null;
    const nums = list.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n <= 0 || n > 100000)) return null;
    if (new Set(nums).size !== nums.length) return null;
    return nums.sort((a, b) => a - b);
  }

  // متن امتیازها را از ورودی کاربر می‌خواند؛ رقم فارسی و جداکننده‌های مختلف را می‌پذیرد
  function parsePointsText(text) {
    const latin = String(text)
      .replace(/\u066C/g, "") // جداکننده‌ی هزارگان فارسی، مثل ۱٬۰۰۰
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    const parts = latin.split(/[^0-9]+/).filter(Boolean);
    return cleanPoints(parts);
  }

  // سوال‌های واردشده را ذخیره و انتخاب می‌کند؛ با null حذفشان می‌کند و به سری اول برمی‌گردد
  function setQuestionSet(set) {
    questionSet = set;
    try {
      if (set) localStorage.setItem(SET_KEY, JSON.stringify(set));
      else localStorage.removeItem(SET_KEY);
    } catch {}
    // ویرایش‌های قبلی مال سوال‌های واردشده‌ی دیگری بودند
    delete edits.imported;
    saveEdits();
    selectSet(set ? "imported" : QUESTION_SETS[0].id);
  }

  function selectSet(id) {
    state.settings.setId = id;
    ({ categories, points: levels } = setFor(id));
    resetGame();
    save();
  }

  function renderSetInfo() {
    const list = $("set-list");
    list.innerHTML = "";
    const options = QUESTION_SETS.map((x) => ({ id: x.id, title: x.title, cats: x.categories, points: x.points || POINTS }));
    if (questionSet)
      options.push({
        id: "imported",
        title: `واردشده${questionSet.title ? `: «${questionSet.title}»` : ""}`,
        cats: questionSet.categories,
        points: questionSet.points,
      });
    options.forEach((o) => {
      const label = document.createElement("label");
      label.className = "check set-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "question-set";
      input.value = o.id;
      input.checked = o.id === state.settings.setId;
      input.onchange = () => selectSet(o.id);
      const text = document.createElement("span");
      text.textContent = o.title;
      const count = document.createElement("span");
      count.className = "muted small";
      count.textContent = ` (${fa(o.cats.length)} دسته، ${fa(o.cats.length * o.points.length)} سوال، امتیاز ${fa(o.points[0])} تا ${fa(o.points[o.points.length - 1])})`;
      text.append(count);
      label.append(input, text);
      list.append(label);
    });
    $("set-reset").classList.toggle("hidden", !questionSet);
    $("set-reset").textContent = "حذف سوال‌های واردشده";
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

  // در حالت یک‌امتیازی گزینه‌ای نمایش داده نمی‌شود و همه‌ی سوال‌ها یک امتیازند،
  // پس فرصت دوم (رد شدن گزینه) و بازی پیشرفته (سوال ویژه) معنی ندارند
  function renderOnePointOptions() {
    const on = onePoint();
    $("opt-onepoint").checked = on;
    $("onepoint-box").classList.toggle("hidden", !on);
    ["opt-second", "opt-advanced"].forEach((id) => {
      $(id).disabled = on;
      $(id).closest("label").classList.toggle("disabled", on);
    });
    $("adv-rules").classList.toggle("hidden", !state.settings.advanced || on);
    const total = gridTotal();
    const count = $("onepoint-count");
    count.max = total;
    count.placeholder = `همه (${fa(total)})`;
    const n = state.settings.onePointCount;
    if (document.activeElement !== count) count.value = n > 0 ? faPlain(Math.min(n, total)) : "";
  }

  $("opt-onepoint").onchange = (e) => {
    state.settings.onePoint = e.target.checked;
    renderOnePointOptions();
    save();
  };

  $("onepoint-count").oninput = (e) => {
    const digits = e.target.value.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    const n = parseInt(digits, 10);
    state.settings.onePointCount = n > 0 ? Math.min(n, gridTotal()) : 0;
    save();
  };
  $("onepoint-count").onblur = renderOnePointOptions;

  $("opt-advanced").onchange = (e) => {
    state.settings.advanced = e.target.checked;
    $("adv-rules").classList.toggle("hidden", !e.target.checked);
    save();
  };
  $("adv-hint").textContent = `${fa(ADVANCED.specialCount)} سوال ویژه‌ی مخفی: جواب درست ${fa(ADVANCED.correctMultiplier)} برابر امتیاز، جواب غلط امتیاز منفی.`;
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
      btn.textContent = (isSpecial(key) ? "⭐ " : "") + shortName(name);
      if (name.length > SHORT_NAME) btn.title = name;
    } else {
      btn.textContent = fa(levels[r]);
    }
    btn.onclick = () => openQuestion(c, r);
    return btn;
  }

  // حالت یک‌امتیازی: به‌جای جدول، دکمه‌ی سوال بعدی و فهرست سوال‌های پرسیده‌شده
  const nextKey = () => state.order.find((k) => !(k in state.used));
  const openKey = (key) => openQuestion(...key.split("-").map(Number));

  function renderOnePointBoard(board) {
    board.className = "board onepoint";
    const done = Object.keys(state.used).length;
    const total = totalQuestions();
    const panel = document.createElement("div");
    panel.className = "onepoint-panel";
    const progress = document.createElement("div");
    progress.className = "onepoint-progress";
    progress.textContent = done < total ? `سوال ${fa(done + 1)} از ${fa(total)}` : "همه‌ی سوال‌ها پرسیده شد";
    const hint = document.createElement("p");
    hint.className = "muted small";
    hint.textContent = "سوال‌ها تصادفی از همه‌ی دسته‌ها می‌آیند و هر جواب درست ۱ امتیاز دارد.";
    panel.append(progress, hint);
    const key = nextKey();
    if (key) {
      const next = document.createElement("button");
      next.className = "btn btn-primary btn-big";
      next.textContent = done ? "سوال بعدی ▶" : "سوال اول ▶";
      next.onclick = () => openKey(key);
      panel.append(next);
    } else {
      const end = document.createElement("button");
      end.className = "btn btn-primary btn-big";
      end.textContent = "نمایش نتیجه 🏆";
      end.onclick = () => showScreen("end");
      panel.append(end);
    }
    board.append(panel);

    // سوال‌های پرسیده‌شده؛ با کلیک می‌شود نتیجه را اصلاح کرد
    const asked = state.order.filter((k) => k in state.used);
    if (!asked.length) return;
    const title = document.createElement("p");
    title.className = "muted small onepoint-history-title";
    title.textContent = "سوال‌های پرسیده‌شده (برای اصلاح امتیاز کلیک کنید):";
    const list = document.createElement("div");
    list.className = "onepoint-history";
    asked.forEach((k) => {
      const b = document.createElement("button");
      b.className = "cell used";
      const w = state.used[k].winner;
      const team = w >= 0 ? state.teams[w] : null;
      const name = team ? team.name : "—";
      b.textContent = `${fa(state.order.indexOf(k) + 1)}. ${shortName(name)}`;
      b.title = `${categories[k.split("-")[0]]?.name || ""} — ${name}`;
      if (team) b.style.setProperty("--team", teamColor(team));
      b.onclick = () => openKey(k);
      list.append(b);
    });
    board.append(title, list);
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";
    if (onePoint()) {
      renderOnePointBoard(board);
      renderScores();
      const left = totalQuestions() - Object.keys(state.used).length;
      $("remaining").textContent = `${fa(left)} سوال باقی مانده`;
      return;
    }
    board.className = "board";
    board.classList.toggle("rotated", narrow.matches);
    board.style.setProperty("--levels", levels.length);

    if (narrow.matches) {
      categories.forEach((cat, c) => {
        board.append(catHead(cat));
        levels.forEach((_, r) => board.append(cell(c, r)));
      });
    } else {
      board.style.setProperty("--cols", categories.length);
      categories.forEach((cat) => board.append(catHead(cat)));
      levels.forEach((_, r) => categories.forEach((_, c) => board.append(cell(c, r))));
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
      d.style.setProperty("--team", teamColor(t));
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
    const one = onePoint();
    $("m-cat").textContent = `${cat.icon} ${cat.name}` + (one ? ` — سوال ${fa(state.order.indexOf(key) + 1)} از ${fa(totalQuestions())}` : "");
    const special = isSpecial(key);
    const base = levels[r];
    $("m-points").textContent = one
      ? "۱ امتیاز"
      : special
        ? `${fa(base)} × ${fa(ADVANCED.correctMultiplier)}`
        : `${fa(base)} امتیاز`;
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
    // در حالت یک‌امتیازی گزینه‌ها نشان داده نمی‌شوند؛ هر کس زودتر درست جواب بدهد امتیاز می‌گیرد
    opts.classList.toggle("hidden", one);
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
      setRound({ open: true, qid: key, n: round.n + 1, first: null, blocked: [] });
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
      b.className = "btn team-btn" + (owner === i ? " current" : "");
      b.style.setProperty("--team", teamColor(t));
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
    setRound({ ...closedRound(), n: round.n });
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
    $("e-reset").classList.toggle("hidden", !setEdits()[`${c}-${r}`]);
    updateSearchLink();
    showEditForm(true);
  };

  // متن سوال و جواب درست، همان‌طور که الان در فرم نوشته شده
  function verifyText() {
    const q = $("e-q").value.trim();
    const checked = document.querySelector('input[name="e-correct"]:checked');
    const answer = checked ? $(`e-opt-${checked.value}`).value.trim() : "";
    return answer ? `${q} جواب: ${answer}` : q;
  }

  function updateSearchLink() {
    $("e-search").href = "https://www.google.com/search?q=" + encodeURIComponent(verifyText());
  }
  $("m-edit").addEventListener("input", updateSearchLink);
  $("m-edit").addEventListener("change", updateSearchLink);

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
    setEdits()[`${c}-${r}`] = item;
    saveEdits();
    openQuestion(c, r);
  });

  $("e-cancel").onclick = () => openQuestion(current.c, current.r);

  $("e-reset").onclick = () => {
    const { c, r } = current;
    delete setEdits()[`${c}-${r}`];
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
      // بازر برای بقیه‌ی تیم‌ها دوباره باز می‌شود
      if (round.qid)
        setRound({ ...round, open: true, n: round.n + 1, first: null, blocked: round.first ? [...round.blocked, round.first] : round.blocked });
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
    if (round.open) setRound({ ...round, open: false });
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

  // ---------- بازر گوشی تیم‌ها (فقط در لینک claude.ai) ----------
  let hostRoom = null;
  let round = closedRound(); // بازر سوالی که الان باز است
  let phones = {}; // تعداد گوشی‌های وصل به هر تیم
  const handled = new Set(); // پیام‌های تیم‌ها که قبلاً حساب شده‌اند

  // n شماره‌ی هر بار باز شدن بازر است تا گوشی‌ها بعد از «بازر دوباره» بتوانند دوباره بزنند
  function closedRound() {
    return { open: false, qid: null, n: 0, first: null, blocked: [] };
  }

  function publishHost() {
    hostRoom
      ?.presence({
        role: "host",
        s: {
          phase: state.phase,
          teams: state.teams.map((t) => ({ id: t.id, name: t.name, c: t.color, score: t.score })),
          round,
          // در حالت یک‌امتیازی جدولی برای نشان دادن به گوشی‌ها نیست
          b: state.phase === "board" && !onePoint() ? boardSnapshot() : null,
        },
      })
      .catch(() => {});
  }

  // جدول برای گوشی تیم‌ها، فشرده تا در سقف ۴ کیلوبایتی presence جا شود:
  // used برای هر دسته یک رشته است؛ "." یعنی مانده، "-" یعنی هیچ تیمی، و بقیه اندیس تیم برنده (0 تا 9 و a، b)
  // sp فقط سوال‌های ویژه‌ای است که جواب داده شده‌اند؛ ویژه‌های مانده لو نمی‌روند
  function boardSnapshot(nameLen = 24) {
    const snap = {
      cats: categories.map((c) => [c.icon, c.name.slice(0, nameLen)]),
      pts: levels,
      used: categories.map((_, c) =>
        levels
          .map((_, r) => {
            const u = state.used[`${c}-${r}`];
            return !u ? "." : u.winner >= 0 ? u.winner.toString(36) : "-";
          })
          .join("")
      ),
      sp: Object.keys(state.used).filter(isSpecial),
    };
    const size = new TextEncoder().encode(JSON.stringify(snap)).length;
    return size > 1800 && nameLen > 8 ? boardSnapshot(8) : snap;
  }

  function setRound(next) {
    round = next;
    renderBuzzBar();
    publishHost();
  }

  function renderBuzzBar() {
    const bar = $("m-buzz");
    const active = hostRoom && Object.keys(phones).length > 0 && current && !current.editing;
    bar.classList.toggle("hidden", !active);
    if (!active) return;
    const first = state.teams.find((t) => t.id === round.first);
    bar.classList.toggle("won", !!first);
    bar.style.setProperty("--team", first ? teamColor(first) : "transparent");
    $("m-buzz-text").textContent = first
      ? `🔔 نوبت تیم «${first.name}» است`
      : round.open
        ? "🔔 بازر باز است؛ منتظر تیم‌ها…"
        : "🔕 بازر بسته است";
    $("m-buzz-reset").classList.toggle("hidden", round.open && !first);
  }

  $("m-buzz-reset").onclick = () => {
    if (current && !current.editing) setRound({ ...round, qid: `${current.c}-${current.r}`, open: true, n: round.n + 1, first: null });
  };

  function teamJoined(rawName) {
    const name = clean(rawName).slice(0, 30);
    if (!name || state.teams.some((t) => t.name === name) || state.teams.length >= MAX_TEAMS) return;
    addTeam(name);
    recalcScores();
    save();
    if (state.phase === "setup") renderSetup();
    else if (state.phase === "board") renderBoard();
  }

  function teamBuzzed(teamId, qid, n) {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team || !round.open || round.first || qid !== round.qid || n !== round.n || round.blocked.includes(teamId)) return;
    BZ.sound(team.color);
    setRound({ ...round, open: false, first: teamId });
  }

  function onPeers(change) {
    const updates = [...change.joined, ...change.updated]
      .filter((p) => !p.isMe && p.presence?.role === "team")
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const p of updates) {
      const { join, buzz, team } = p.presence;
      if (join && typeof join.name === "string" && !handled.has(`${p.peer}:j${join.n}`)) {
        handled.add(`${p.peer}:j${join.n}`);
        teamJoined(join.name);
      }
      if (buzz && !handled.has(`${p.peer}:b${buzz.n}`)) {
        handled.add(`${p.peer}:b${buzz.n}`);
        teamBuzzed(team, buzz.qid, buzz.r);
      }
    }
    const next = {};
    change.peers.forEach((p) => {
      const id = p.presence?.role === "team" && p.presence.team;
      if (!p.isMe && id) next[id] = (next[id] || 0) + 1;
    });
    if (JSON.stringify(next) !== JSON.stringify(phones)) {
      phones = next;
      if (state.phase === "setup") renderSetup();
      if (state.phase === "board") renderScores();
      renderQrStatus();
      renderBuzzBar();
    }
  }

  // ---------- QR برای اتصال گوشی‌ها ----------
  const joinUrl = BZ?.pageUrl ? `${BZ.pageUrl}#team` : "";

  function renderQrStatus() {
    const n = Object.values(phones).reduce((a, b) => a + b, 0);
    $("qr-status").textContent = n ? `📱 ${fa(n)} گوشی وصل است` : "هنوز گوشی‌ای وصل نشده";
  }

  function openQr() {
    if (!joinUrl || typeof qrcode !== "function") return;
    const qr = qrcode(0, "M");
    qr.addData(joinUrl);
    qr.make();
    $("qr-code").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    $("qr-link").textContent = joinUrl;
    renderQrStatus();
    $("qr-overlay").classList.remove("hidden");
  }

  $("qr-open").onclick = openQr;
  $("qr-board-btn").onclick = openQr;
  $("qr-close").onclick = () => $("qr-overlay").classList.add("hidden");

  (BZ?.hostRoom || Promise.resolve(null)).then((r) => {
    const ready = !!(r && joinUrl);
    $("qr-open").classList.toggle("hidden", !ready);
    $("qr-board-btn").classList.toggle("hidden", !ready);
    $("qr-note").textContent = ready
      ? "تیم‌ها QR را اسکن می‌کنند، اسم تیمشان را انتخاب می‌کنند و روی گوشی بازر دارند. هر تیم باید با حساب claude.ai خودش وارد شده باشد و شما از منوی Share همین صفحه دعوتش کرده باشید."
      : "بازر گوشی فقط وقتی کار می‌کند که بازی از لینک claude.ai باز شده باشد. بدون آن هم می‌توانید تیم‌ها را دستی اضافه کنید.";
    if (!r) return;
    hostRoom = r;
    r.onPeers(onPeers, () => {});
    publishHost();
  });

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
    points: POINTS,
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
  $("gen-points").value = ai.points.map(faPlain).join("، ");
  document.querySelectorAll("[data-points]").forEach((b) => {
    b.onclick = () => ($("gen-points").value = b.dataset.points.split(",").map(faPlain).join("، "));
  });
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
      `- **امتیازها:** ${ai.points.map(fa).join("، ")} (هر دسته دقیقاً ${fa(ai.points.length)} سوال؛ در JSON بنویس "points": ${JSON.stringify(ai.points)})`,
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
    const total = set.categories.length * set.points.length;
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
    const points = parsePointsText($("gen-points").value);
    if (!points) {
      showStatus("gen-status", "امتیازها را درست بنویسید: ۱ تا ۱۰ عدد مثبت و متفاوت، مثلاً «۱۰۰، ۲۰۰، ۳۰۰».", "error");
      return;
    }
    ai.points = points;
    $("gen-points").value = points.map(faPlain).join("، ");
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
        set = parseSet(text, ai.points);
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
