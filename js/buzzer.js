// بازر گوشی تیم‌ها از طریق امکان «room» صفحه‌های claude.ai
// صاحب صفحه مجری است؛ هر کس دیگری که لینک را باز کند (یا لینک با #team) صفحه‌ی بازر تیم را می‌بیند.
// همه‌ی پیام‌ها از راه presence می‌روند، چون هر بیننده‌ای اجازه‌ی تنظیم آن را دارد:
//   مجری: { role: "host", s: { phase, teams: [{id, name, c, score}], round: {open, qid, n, first, blocked} } }
//   تیم:  { role: "team", team, join: {name, n}, buzz: {qid, r, n} }  (r: شماره‌ی دور بازر)
(() => {
  const TEAM_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];
  // نشانی همین صفحه در claude.ai؛ هنگام ساخت نسخه‌ی claude.ai در window.BUZZER_URL قرار می‌گیرد
  const PAGE_URL = window.BUZZER_URL || "";
  const MY_TEAM_KEY = "buzzergame-myteam";

  const $ = (id) => document.getElementById(id);
  const fa = (n) => Number(n).toLocaleString("fa-IR");

  // ---------- صدای بازر: هر رنگ تیم یک صدای جدا ----------
  const SOUNDS = [
    { f: [523, 784], w: "square" },
    { f: [392, 330], w: "sawtooth" },
    { f: [659, 880], w: "triangle" },
    { f: [294, 440], w: "square" },
    { f: [740, 554], w: "sawtooth" },
    { f: [880, 1047], w: "triangle" },
    { f: [349, 262], w: "square" },
    { f: [587, 698], w: "sawtooth" },
  ];
  let audio = null;

  // مرورگرها صدا را فقط بعد از یک لمس کاربر اجازه می‌دهند
  function unlockAudio() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch {}
  }

  function sound(colorIndex) {
    unlockAudio();
    if (!audio) return;
    const { f, w } = SOUNDS[colorIndex % SOUNDS.length];
    const t = audio.currentTime;
    f.forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = w;
      osc.frequency.value = freq;
      const start = t + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }

  // ---------- تشخیص نقش این دستگاه ----------
  const forceTeam = location.hash === "#team";
  let roomPromise = null;
  const use = (name) => window.claude?.use?.(name) || Promise.resolve(null);

  // نقش: "host" برای مجری، "team" برای گوشی تیم‌ها
  const mode = (async () => {
    if (forceTeam) return "team";
    if (!window.claude?.use) return "host";
    const user = await use("user");
    if (!user) return "host";
    try {
      return (await user.isOwner()) ? "host" : "team";
    } catch {
      return "host";
    }
  })();

  function room() {
    roomPromise ||= use("room");
    return roomPromise;
  }

  // تا معلوم شدن نقش، صفحه‌ی مجری پنهان می‌ماند تا تیم‌ها جواب‌ها را نبینند
  document.body.classList.add("booting");
  mode.then((m) => {
    document.body.classList.remove("booting");
    if (m === "team") startTeamPage();
  });

  window.Buzzer = {
    colors: TEAM_COLORS,
    sound,
    unlockAudio,
    pageUrl: PAGE_URL,
    // برای مجری: room یا null وقتی این امکان در دسترس نیست
    hostRoom: mode.then((m) => (m === "host" ? room() : null)),
  };

  // ---------- صفحه‌ی بازر تیم ----------
  function startTeamPage() {
    document.body.classList.add("team-mode");
    $("team-screen").classList.remove("hidden");

    let myTeam = null;
    try {
      myTeam = localStorage.getItem(MY_TEAM_KEY);
    } catch {}
    let n = 0; // شماره‌ی پیام‌ها تا مجری هر درخواست را فقط یک بار حساب کند
    let host = null; // آخرین وضعیتی که مجری فرستاده
    let pendingName = null;
    let pressedFor = null; // دور بازری ("qid:n") که این گوشی در آن بازر زده
    const roundKey = () => `${host.round.qid}:${host.round.n}`;
    let r = null;

    const setMyTeam = (id) => {
      myTeam = id;
      try {
        if (id) localStorage.setItem(MY_TEAM_KEY, id);
        else localStorage.removeItem(MY_TEAM_KEY);
      } catch {}
      r?.presence({ role: "team", team: id, join: null });
    };

    room().then((rm) => {
      r = rm;
      if (!r) {
        render();
        return;
      }
      r.presence({ role: "team", team: myTeam });
      r.onPeers(({ peers }) => {
        const hosts = peers.filter((p) => !p.isMe && p.presence?.role === "host" && p.presence.s);
        hosts.sort((a, b) => b.updatedAt - a.updatedAt);
        host = hosts[0]?.presence.s || null;
        // تیمی که خواسته بودیم ساخته شد
        if (pendingName && host) {
          const t = host.teams.find((x) => x.name === pendingName);
          if (t) {
            pendingName = null;
            setMyTeam(t.id);
          }
        }
        if (myTeam && host && !host.teams.some((t) => t.id === myTeam)) setMyTeam(null);
        render();
      });
    });

    $("tm-join-form").addEventListener("submit", (e) => {
      e.preventDefault();
      unlockAudio();
      const name = $("tm-name").value.trim().slice(0, 30);
      if (!name || !r) return;
      const existing = host?.teams.find((t) => t.name === name);
      if (existing) {
        setMyTeam(existing.id);
      } else {
        pendingName = name;
        r.presence({ role: "team", team: null, join: { name, n: ++n } });
      }
      render();
    });

    $("tm-change").onclick = () => {
      pendingName = null;
      setMyTeam(null);
      render();
    };

    $("tm-buzz").onclick = () => {
      const t = host?.teams.find((x) => x.id === myTeam);
      if (!t || !canBuzz()) return;
      pressedFor = roundKey();
      sound(t.c);
      navigator.vibrate?.(120);
      r.presence({ buzz: { qid: host.round.qid, r: host.round.n, n: ++n } });
      render();
    };

    function canBuzz() {
      const round = host?.round;
      return !!(host && host.phase === "board" && round?.open && !round.first && !round.blocked?.includes(myTeam) && pressedFor !== roundKey());
    }

    function render() {
      const team = host?.teams.find((t) => t.id === myTeam);
      $("tm-join").classList.toggle("hidden", !!team);
      $("tm-play").classList.toggle("hidden", !team);
      const status = $("tm-conn");
      if (!r) status.textContent = "اتصال به بازی برقرار نشد. صفحه را دوباره باز کنید.";
      else if (!host) status.textContent = "منتظر مجری… صفحه‌ی بازی باید روی دستگاه مجری باز باشد.";
      else status.textContent = "";
      status.classList.toggle("hidden", !status.textContent);

      if (!team) {
        const list = $("tm-teams");
        list.innerHTML = "";
        (host?.teams || []).forEach((t) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn tm-team-btn";
          b.style.setProperty("--team", TEAM_COLORS[t.c % TEAM_COLORS.length]);
          b.textContent = t.name;
          b.onclick = () => {
            unlockAudio();
            setMyTeam(t.id);
            render();
          };
          list.append(b);
        });
        $("tm-teams-label").classList.toggle("hidden", !host?.teams.length);
        $("tm-wait").classList.toggle("hidden", !pendingName);
        return;
      }

      const color = TEAM_COLORS[team.c % TEAM_COLORS.length];
      document.documentElement.style.setProperty("--team", color);
      $("tm-team-name").textContent = team.name;
      $("tm-score").textContent = fa(team.score);
      const ranked = [...host.teams].sort((a, b) => b.score - a.score);
      $("tm-rank").textContent = `رتبه‌ی ${fa(ranked.findIndex((t) => t.score === team.score) + 1)} از ${fa(host.teams.length)}`;

      const round = host.round || {};
      const btn = $("tm-buzz");
      const msg = $("tm-msg");
      btn.disabled = !canBuzz();
      btn.classList.toggle("won", round.first === myTeam);
      if (host.phase !== "board") msg.textContent = "بازی هنوز شروع نشده.";
      else if (round.first === myTeam) msg.textContent = "🎉 نوبت شماست! جواب بدهید.";
      else if (round.first) {
        const other = host.teams.find((t) => t.id === round.first);
        msg.textContent = `نوبت تیم «${other ? other.name : "دیگر"}» است.`;
      } else if (round.open && round.blocked?.includes(myTeam)) msg.textContent = "این سوال را جواب داده‌اید؛ نوبت تیم‌های دیگر است.";
      else if (round.open && pressedFor === roundKey()) msg.textContent = "بازر زدید… منتظر مجری.";
      else if (round.open) msg.textContent = "سوال باز است. زود بزنید!";
      else msg.textContent = "منتظر سوال بعدی…";
    }

    render();
  }
})();
