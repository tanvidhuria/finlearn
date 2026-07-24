import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

/* ============================================================
   Paisa Patra — a calm 90-day finance learning ritual
   - Curriculum: public/curriculum.json (90 lessons, swappable)
   - Progress: localStorage always; optional GitHub Gist sync
   - Design: "Morning Ledger" (approved)
   ============================================================ */

const STORAGE_KEY = "paisa-patra-progress-v1";
const SETTINGS_KEY = "paisa-patra-settings-v1";
const GIST_FILENAME = "paisa-patra-progress.json";
const RESURFACE_AFTER_DAYS = 3;

const BADGES = [
  { at: 7, name: "Foundation Laid" },
  { at: 15, name: "Habit Forming" },
  { at: 30, name: "One Month Strong" },
  { at: 45, name: "Halfway Investor" },
  { at: 60, name: "Market Ready" },
  { at: 90, name: "FinLearn Graduate" },
];

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/* ---------- date helpers (local calendar days) ---------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(a, b) {
  // a,b as YYYY-MM-DD; b - a in whole days
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mon = MONTHS[d.getMonth()].charAt(0) + MONTHS[d.getMonth()].slice(1).toLowerCase();
  let h = d.getHours();
  const am = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, "0")} ${mon}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${am}`;
}

/* ---------- progress model ---------- */
function freshProgress() {
  return {
    topics: {}, // id -> { status: pending|completed|missed, completed_at, shown_dates: [YYYY-MM-DD] }
    reading_position: 0,
    streak_current: 0,
    streak_best: 0,
    badges: [],
    last_completed_date: null, // YYYY-MM-DD
    last_synced_at: null,
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...freshProgress(), ...JSON.parse(raw) };
  } catch (e) { /* corrupted -> start fresh */ }
  return freshProgress();
}
function saveLocal(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* storage full/blocked */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { pat: "", gistId: "" };
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

/* Sweep: topics shown on an earlier date and never completed become "missed" */
function sweepMissed(p, today) {
  let changed = false;
  const topics = { ...p.topics };
  for (const id of Object.keys(topics)) {
    const t = topics[id];
    if (t.status === "pending" && t.shown_dates.length) {
      const lastShown = t.shown_dates[t.shown_dates.length - 1];
      if (daysBetween(lastShown, today) >= 1) {
        topics[id] = { ...t, status: "missed" };
        changed = true;
      }
    }
  }
  return changed ? { ...p, topics } : p;
}

/* Demo data — never written to storage */
function demoProgress(lessons) {
  const p = freshProgress();
  const now = new Date();
  const t = todayStr();
  [0, 1, 2].forEach((i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (4 - i));
    d.setHours(8 + i, 12 + i * 9, 0, 0);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    p.topics[lessons[i].id] = { status: "completed", completed_at: d.toISOString(), shown_dates: [ds] };
  });
  const missedDate = new Date(now);
  missedDate.setDate(missedDate.getDate() - 1);
  const md = `${missedDate.getFullYear()}-${String(missedDate.getMonth() + 1).padStart(2, "0")}-${String(missedDate.getDate()).padStart(2, "0")}`;
  p.topics[lessons[3].id] = { status: "missed", completed_at: null, shown_dates: [md] };
  p.reading_position = 4;
  p.streak_best = 3;
  return p;
}

/* ---------- Gist sync ---------- */
async function gistRead(pat, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Gist read failed (${res.status})`);
  const data = await res.json();
  const file = data.files?.[GIST_FILENAME];
  if (!file) throw new Error("Progress file not found in gist");
  return JSON.parse(file.content);
}
async function gistWrite(pat, gistId, progress) {
  const body = JSON.stringify({
    files: { [GIST_FILENAME]: { content: JSON.stringify(progress, null, 2) } },
  });
  const res = await fetch(gistId ? `https://api.github.com/gists/${gistId}` : "https://api.github.com/gists", {
    method: gistId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: gistId ? body : JSON.stringify({ description: "Paisa Patra progress", public: false, files: { [GIST_FILENAME]: { content: JSON.stringify(progress, null, 2) } } }),
  });
  if (!res.ok) throw new Error(`Gist write failed (${res.status})`);
  const data = await res.json();
  return data.id;
}

/* ============================================================ */

export default function App() {
  const [lessons, setLessons] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("today");
  const [progress, setProgressRaw] = useState(loadLocal);
  const [settings, setSettings] = useState(loadSettings);
  const [deepOpen, setDeepOpen] = useState(false);
  const [newBadge, setNewBadge] = useState(null);
  const [demo, setDemo] = useState(false);
  const [demoState, setDemoState] = useState(null);
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | synced | error | off
  const [showSettings, setShowSettings] = useState(false);
  const [currentId, setCurrentId] = useState(null); // which lesson is displayed right now
  const deepRef = useRef(null);
  const syncTimer = useRef(null);

  const today = todayStr();
  const active = demo ? demoState : progress;

  /* load curriculum */
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}curriculum.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setLessons(d.lessons))
      .catch((e) => setLoadError(e.message));
  }, []);

  /* one-time: sweep missed topics + pull from gist if configured */
  useEffect(() => {
    setProgressRaw((p) => sweepMissed(p, today));
    if (settings.pat && settings.gistId) {
      setSyncState("syncing");
      gistRead(settings.pat, settings.gistId)
        .then((remote) => {
          setProgressRaw((local) => {
            // last-write-wins on completion count, favouring more progress
            const remoteDone = Object.values(remote.topics || {}).filter((t) => t.status === "completed").length;
            const localDone = Object.values(local.topics || {}).filter((t) => t.status === "completed").length;
            const winner = remoteDone >= localDone ? { ...freshProgress(), ...remote } : local;
            const swept = sweepMissed(winner, today);
            saveLocal(swept);
            return swept;
          });
          setSyncState("synced");
        })
        .catch(() => setSyncState("error"));
    } else {
      setSyncState("off");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* setProgress wrapper: persist + debounce gist push */
  const setProgress = useCallback((updater) => {
    setProgressRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveLocal(next);
      if (settings.pat && settings.gistId) {
        clearTimeout(syncTimer.current);
        setSyncState("syncing");
        syncTimer.current = setTimeout(() => {
          const stamped = { ...next, last_synced_at: new Date().toISOString() };
          gistWrite(settings.pat, settings.gistId, stamped)
            .then(() => { saveLocal(stamped); setProgressRaw(stamped); setSyncState("synced"); })
            .catch(() => setSyncState("error"));
        }, 1500);
      }
      return next;
    });
  }, [settings]);

  const applyProgress = demo
    ? (updater) => setDemoState((p) => (typeof updater === "function" ? updater(p) : updater))
    : setProgress;

  const completedCount = useMemo(
    () => Object.values(active?.topics || {}).filter((t) => t.status === "completed").length,
    [active]
  );

  /* today's lesson: resurfaced missed topic (>=3 days old) queues ahead of new topics */
  const resurfaced = useMemo(() => {
    if (!lessons || !active) return null;
    for (const l of lessons) {
      const t = active.topics[l.id];
      if (t && t.status === "missed" && t.shown_dates.length) {
        const lastShown = t.shown_dates[t.shown_dates.length - 1];
        if (daysBetween(lastShown, today) >= RESURFACE_AFTER_DAYS) return l;
      }
    }
    return null;
  }, [lessons, active, today]);

  /* which lesson to display: stays FIXED while you complete it.
     Priority on load: lesson already shown today (latest) > resurfaced missed topic > next unread */
  useEffect(() => {
    if (!lessons || !active || currentId !== null) return;
    let shownToday = null;
    for (const l of lessons) {
      const t = active.topics[l.id];
      if (t?.shown_dates?.includes(today)) shownToday = l; // keep last (highest index) shown today
    }
    const pick = shownToday || resurfaced || lessons[Math.min(active.reading_position, lessons.length - 1)];
    setCurrentId(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, active, currentId]);

  const todayLesson = lessons && active && currentId !== null
    ? lessons.find((l) => l.id === currentId) || lessons[Math.min(active.reading_position, lessons.length - 1)]
    : null;
  const allDone = lessons && active && !resurfaced && active.reading_position >= lessons.length
    && !Object.values(active.topics).some((t) => t.status === "missed");
  const todayState = todayLesson ? active.topics[todayLesson.id] : null;
  const isCompletedToday = todayState?.status === "completed";

  /* record today's showing of the lesson */
  useEffect(() => {
    if (!todayLesson || allDone) return;
    applyProgress((p) => {
      const t = p.topics[todayLesson.id];
      if (t && t.shown_dates.includes(today)) return p;
      return {
        ...p,
        topics: {
          ...p.topics,
          [todayLesson.id]: {
            status: t?.status || "pending",
            completed_at: t?.completed_at || null,
            shown_dates: [...(t?.shown_dates || []), today],
          },
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayLesson?.id, demo]);

  useEffect(() => { setDeepOpen(false); }, [todayLesson?.id, tab]);

  function markCompleted(lesson) {
    applyProgress((p) => {
      if (p.topics[lesson.id]?.status === "completed") return p;
      const nowIso = new Date().toISOString();
      const topics = {
        ...p.topics,
        [lesson.id]: {
          status: "completed",
          completed_at: nowIso,
          shown_dates: p.topics[lesson.id]?.shown_dates?.includes(today)
            ? p.topics[lesson.id].shown_dates
            : [...(p.topics[lesson.id]?.shown_dates || []), today],
        },
      };
      let streak_current = p.streak_current;
      if (p.last_completed_date !== today) {
        streak_current = p.last_completed_date && daysBetween(p.last_completed_date, today) === 1
          ? p.streak_current + 1
          : 1;
      }
      const streak_best = Math.max(p.streak_best, streak_current);
      const doneCount = Object.values(topics).filter((t) => t.status === "completed").length;
      const badges = [...p.badges];
      const earned = BADGES.find((b) => b.at === doneCount && !badges.includes(b.name));
      if (earned) { badges.push(earned.name); setNewBadge(earned); }
      const wasResurfaced = resurfaced && resurfaced.id === lesson.id;
      const idx = lessons.findIndex((l) => l.id === lesson.id);
      return {
        ...p, topics, streak_current, streak_best, badges,
        last_completed_date: today,
        reading_position: wasResurfaced ? p.reading_position : Math.max(p.reading_position, idx + 1),
      };
    });
  }

  function exploreMore() {
    // Jump the VIEW to the next topic; marks nothing on the current one
    const idx = lessons.findIndex((l) => l.id === currentId);
    if (idx < active.reading_position) {
      // viewing a resurfaced/older topic -> jump to the next unread
      setCurrentId(lessons[Math.min(active.reading_position, lessons.length - 1)].id);
      return;
    }
    const nextIdx = Math.min(idx + 1, lessons.length - 1);
    setCurrentId(lessons[nextIdx].id);
    applyProgress((p) => ({
      ...p,
      reading_position: Math.min(Math.max(p.reading_position, nextIdx + 1), lessons.length),
    }));
  }

  function openDeepDive() {
    const opening = !deepOpen;
    setDeepOpen(opening);
    if (opening && !isCompletedToday) markCompleted(todayLesson);
    if (opening) {
      setTimeout(() => deepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 220);
    }
  }

  function enterDemo() { setDemoState(demoProgress(lessons)); setDemo(true); setCurrentId(null); setTab("today"); }
  function exitDemo() { setDemo(false); setDemoState(null); setCurrentId(null); }

  async function connectGist(e) {
    e.preventDefault();
    const pat = e.target.pat.value.trim();
    let gistId = e.target.gistId.value.trim();
    if (!pat) return;
    setSyncState("syncing");
    try {
      if (gistId) {
        const remote = await gistRead(pat, gistId);
        const merged = { ...freshProgress(), ...remote };
        saveLocal(merged);
        setProgressRaw(sweepMissed(merged, today));
      } else {
        gistId = await gistWrite(pat, "", progress);
      }
      const s = { pat, gistId };
      setSettings(s); saveSettings(s);
      setSyncState("synced");
      setShowSettings(false);
    } catch (err) {
      setSyncState("error");
    }
  }
  function disconnectGist() {
    const s = { pat: "", gistId: "" };
    setSettings(s); saveSettings(s);
    setSyncState("off");
  }

  const now = new Date();
  const dayNum = String(now.getDate()).padStart(2, "0");
  const monStr = MONTHS[now.getMonth()];

  /* ---------- render ---------- */
  if (loadError) {
    return (
      <div className="fl-root"><style>{CSS}</style>
        <main className="fl-main"><div className="fl-card" style={{ marginTop: 40 }}>
          <h1 className="fl-title">Couldn't load the curriculum</h1>
          <p className="fl-body-p">curriculum.json didn't load ({loadError}). Check that the file exists in the site's root and reload.</p>
        </div></main>
      </div>
    );
  }
  if (!lessons || !active || todayLesson === null) {
    return (
      <div className="fl-root"><style>{CSS}</style>
        <main className="fl-main"><div className="fl-loading">Opening today's page…</div></main>
      </div>
    );
  }

  return (
    <div className="fl-root">
      <style>{CSS}</style>

      <header className="fl-topbar">
        <div className="fl-topbar-inner">
          <span className="fl-wordmark">Paisa Patra</span>
          <nav className="fl-topnav">
            <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}>Today</button>
            <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
          </nav>
          <span className="fl-streak-pill" title="Current streak">
            <svg className="fl-flame" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M12 2c1 4-3 5.5-3 9a3 3 0 0 0 6 0c0-1.5-.8-2.6-1.4-3.6C15.8 8.6 19 10.6 19 14.5A7 7 0 0 1 5 14.5C5 8.5 10.5 6.5 12 2z"/>
            </svg>
            {active.streak_current} day streak
          </span>
          <button className="fl-gear" onClick={() => setShowSettings(true)} aria-label="Sync settings" title="Sync settings">⚙</button>
        </div>
      </header>

      {!demo && syncState === "off" && (
        <div className="fl-banner">Progress is saved on this device only. <button className="fl-linkish" onClick={() => setShowSettings(true)}>Set up sync</button> to keep it across devices.</div>
      )}
      {!demo && syncState === "error" && (
        <div className="fl-banner fl-banner-warn">Sync failed — progress is safe on this device. <button className="fl-linkish" onClick={() => setShowSettings(true)}>Check settings</button></div>
      )}

      <main className="fl-main">
        {newBadge && (
          <div className="fl-badge-card" role="status">
            <div className="fl-badge-kicker">Milestone</div>
            <div className="fl-badge-name">{newBadge.name}</div>
            <div className="fl-badge-sub">{completedCount} topics completed. Quietly excellent.</div>
            <button className="fl-badge-dismiss" onClick={() => setNewBadge(null)}>Continue</button>
          </div>
        )}

        {tab === "today" && (
          <section>
            <div className="fl-date-hero" aria-label={`${dayNum} ${monStr}`}>
              <span className="fl-date-day">{dayNum}</span>
              <span className="fl-date-mon">{monStr}</span>
            </div>

            {allDone ? (
              <div className="fl-card">
                <h1 className="fl-title">All 90 days read.</h1>
                <p className="fl-body-p">The curriculum is complete. The habit doesn't have to be — revisit any topic from History.</p>
              </div>
            ) : (
              <article className="fl-card">
                <div className="fl-eyebrow">
                  Day {todayLesson.day} · Phase {todayLesson.phase} — {todayLesson.phaseName}
                  {resurfaced && <span className="fl-resurfaced-tag">Resurfaced</span>}
                </div>
                <h1 className="fl-title">{todayLesson.title}</h1>
                <div>
                  {todayLesson.body.split("\n\n").map((p, i) => (
                    <p className="fl-body-p" key={i}>{p}</p>
                  ))}
                </div>

                {isCompletedToday && (
                  <div className="fl-completed-note">Completed · {fmtDateTime(todayState?.completed_at)}</div>
                )}

                <div className="fl-actions">
                  <button className="fl-btn fl-btn-mist" onClick={exploreMore}>Explore More</button>
                  <button className="fl-btn fl-btn-blush" onClick={openDeepDive} aria-expanded={deepOpen}>
                    {deepOpen ? "Close Deep Dive" : "Deep Dive"}
                  </button>
                  <button className="fl-btn fl-btn-sage" onClick={() => markCompleted(todayLesson)} disabled={isCompletedToday}>
                    {isCompletedToday ? "Completed" : "Mark Completed"}
                  </button>
                </div>

                <div className={"fl-deep" + (deepOpen ? " open" : "")} ref={deepRef}>
                  <div className="fl-deep-inner">
                    <div className="fl-deep-rule" />
                    <div className="fl-deep-label">Deep Dive</div>
                    {todayLesson.deepDive.split("\n\n").map((p, i) => (
                      <p className="fl-body-p" key={i}>{p}</p>
                    ))}
                    <div className="fl-sources">
                      <div className="fl-sources-label">Sources</div>
                      {todayLesson.sources.map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="fl-source-link">
                          {i + 1}. {s.name}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            )}

            <div className="fl-demo-line">
              {!demo
                ? <><button className="fl-linkish" onClick={enterDemo}>View demo</button><span> · pre-filled sample history</span></>
                : <>Demo mode — your real progress is untouched · <button className="fl-linkish" onClick={exitDemo}>Exit</button></>}
            </div>
          </section>
        )}

        {tab === "history" && (
          <section>
            <h2 className="fl-history-head">History</h2>
            <div className="fl-history-sub">
              {completedCount} of {lessons.length} topics · best streak {active.streak_best}
              {active.last_synced_at && !demo && <> · synced {fmtDateTime(active.last_synced_at)}</>}
            </div>
            <ul className="fl-history-list">
              {lessons.map((l, idx) => {
                const t = active.topics[l.id];
                const status = t?.status === "completed" ? "completed"
                  : t?.status === "missed" ? "missed"
                  : t?.shown_dates?.length ? "seen"
                  : idx < active.reading_position ? "seen" : "upcoming";
                return (
                  <li key={l.id} className="fl-history-item">
                    <div className="fl-hi-main">
                      <span className="fl-hi-day">Day {l.day} · Phase {l.phase}</span>
                      <span className="fl-hi-title">{l.title}</span>
                    </div>
                    <div className="fl-hi-side">
                      {status === "completed" && (<><span className="fl-chip fl-chip-sage">Completed</span><span className="fl-hi-when">{fmtDateTime(t.completed_at)}</span></>)}
                      {status === "missed" && <span className="fl-chip fl-chip-blush">Missed</span>}
                      {status === "seen" && <span className="fl-chip fl-chip-mist">Seen</span>}
                      {status === "upcoming" && <span className="fl-chip">Upcoming</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {active.badges.length > 0 && (
              <div className="fl-earned">
                <div className="fl-sources-label">Badges earned</div>
                {active.badges.map((b) => <span key={b} className="fl-chip fl-chip-sage fl-chip-badge">{b}</span>)}
              </div>
            )}
          </section>
        )}
      </main>

      {showSettings && (
        <div className="fl-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="fl-deep-label">Sync across devices</h3>
            <p className="fl-body-p fl-small">
              Progress syncs to a private GitHub Gist in your account. Create a fine-grained
              personal access token with only the <strong>gist</strong> scope — nothing else.
              The token stays in this browser.
            </p>
            {settings.pat ? (
              <>
                <p className="fl-body-p fl-small">Connected to gist <code>{settings.gistId}</code>.</p>
                <div className="fl-actions" style={{ marginTop: 12 }}>
                  <button className="fl-btn fl-btn-blush" onClick={disconnectGist}>Disconnect</button>
                  <button className="fl-btn fl-btn-mist" onClick={() => setShowSettings(false)}>Close</button>
                </div>
              </>
            ) : (
              <form onSubmit={connectGist}>
                <label className="fl-label">GitHub token (gist scope)</label>
                <input className="fl-input" name="pat" type="password" placeholder="github_pat_…" required />
                <label className="fl-label">Existing gist ID (leave empty to create one)</label>
                <input className="fl-input" name="gistId" type="text" placeholder="optional" />
                <div className="fl-actions" style={{ marginTop: 16 }}>
                  <button className="fl-btn fl-btn-mist" type="button" onClick={() => setShowSettings(false)}>Cancel</button>
                  <button className="fl-btn fl-btn-sage" type="submit">Connect</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <nav className="fl-bottombar">
        <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}><span className="fl-bb-dot" />Today</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}><span className="fl-bb-dot" />History</button>
      </nav>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');

.fl-root {
  --paper:#F7F5F0; --card:#FFFFFF; --ink:#3A3F4A; --ink-soft:#8A8F9C;
  --sage:#C9D8C5; --mist:#D7E1EA; --blush:#EFD9D1;
  --sage-strong:#4C9A3F; --mist-strong:#3B7FD4; --blush-strong:#F2C230;
  --shadow:0 1px 3px rgba(58,63,74,0.06);
  min-height:100vh; background:var(--paper); color:var(--ink);
  font-family:'Inter',system-ui,sans-serif; font-size:16.5px; line-height:1.7;
  display:flex; flex-direction:column;
}
.fl-root *{box-sizing:border-box; margin:0;}
.fl-root button{font:inherit; cursor:pointer; border:none; background:none; color:inherit;}
.fl-root button:focus-visible, .fl-root a:focus-visible, .fl-root input:focus-visible{outline:2px solid var(--ink); outline-offset:2px; border-radius:4px;}

.fl-topbar{background:var(--paper); border-bottom:1px solid rgba(58,63,74,0.08);}
.fl-topbar-inner{max-width:640px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; gap:14px;}
.fl-wordmark{font-family:'Fraunces',serif; font-weight:600; font-size:19px; letter-spacing:0.2px;}
.fl-topnav{display:flex; gap:6px; margin-left:auto;}
.fl-topnav button{padding:6px 12px; border-radius:999px; color:var(--ink-soft); font-weight:500; font-size:14.5px;}
.fl-topnav button.on{background:var(--card); color:var(--ink); box-shadow:var(--shadow);}
.fl-streak-pill{background:var(--sage-strong); color:#FFFFFF; border-radius:999px; padding:5px 13px; font-size:13.5px; font-weight:600; display:inline-flex; align-items:center; gap:6px; box-shadow:0 1px 3px rgba(58,63,74,0.15); white-space:nowrap;}
.fl-flame{color:#FFE9B0;}
.fl-gear{font-size:17px; color:var(--ink-soft); padding:4px;}
.fl-gear:hover{color:var(--ink);}

.fl-banner{max-width:640px; margin:12px auto 0; padding:10px 20px; font-size:13.5px; color:var(--ink-soft); text-align:center;}
.fl-banner-warn{color:#9A5B3C;}

.fl-main{flex:1; width:100%; max-width:640px; margin:0 auto; padding:28px 20px 96px;}
.fl-loading{text-align:center; color:var(--ink-soft); margin-top:80px; font-family:'Fraunces',serif; font-size:19px;}

.fl-date-hero{display:flex; flex-direction:column; align-items:center; margin:6px 0 22px; line-height:1;}
.fl-date-day{font-family:'Fraunces',serif; font-weight:500; font-size:46px; letter-spacing:-1px;}
.fl-date-mon{font-family:'Fraunces',serif; font-weight:400; font-size:17px; letter-spacing:5px; color:var(--ink-soft); margin-top:6px;}

.fl-card{background:var(--card); border-radius:14px; box-shadow:var(--shadow); padding:30px 28px 26px;}
.fl-eyebrow{font-size:12.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--ink-soft); font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;}
.fl-resurfaced-tag{background:var(--blush); color:var(--ink); border-radius:999px; padding:2px 10px; letter-spacing:0.5px; font-size:11.5px;}
.fl-title{font-family:'Fraunces',serif; font-weight:600; font-size:27px; line-height:1.25; margin-bottom:16px;}
.fl-body-p{margin-bottom:14px;}
.fl-body-p:last-child{margin-bottom:0;}
.fl-small{font-size:14px; color:var(--ink-soft);}
.fl-completed-note{margin-top:16px; font-size:14px; color:var(--ink-soft); font-weight:500;}

.fl-actions{display:flex; justify-content:space-between; align-items:center; gap:14px; margin-top:24px; flex-wrap:wrap;}
.fl-actions .fl-btn{flex:1 1 0; min-width:150px; text-align:center; white-space:nowrap;}
.fl-btn{border-radius:999px; padding:12px 16px; font-weight:600; font-size:14.5px; color:var(--ink); transition:transform 120ms ease, box-shadow 120ms ease; box-shadow:0 2px 6px rgba(58,63,74,0.18);}
.fl-btn:hover:not(:disabled){transform:translateY(-1px); filter:brightness(0.96);}
.fl-btn:disabled{opacity:0.75; cursor:default;}
.fl-btn-sage{background:var(--sage-strong); color:#FFFFFF;}
.fl-btn-mist{background:var(--mist-strong); color:#FFFFFF;}
.fl-btn-blush{background:var(--blush-strong); color:#3A3F4A;}

.fl-deep{display:grid; grid-template-rows:0fr; transition:grid-template-rows 200ms ease; scroll-margin-top:16px;}
.fl-deep.open{grid-template-rows:1fr;}
.fl-deep-inner{overflow:hidden;}
.fl-deep-rule{height:1px; background:rgba(58,63,74,0.10); margin:24px 0 20px;}
.fl-deep-label{font-family:'Fraunces',serif; font-size:19px; font-weight:600; margin-bottom:12px;}
.fl-sources{margin-top:20px;}
.fl-sources-label{font-size:12.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--ink-soft); font-weight:600; margin-bottom:10px;}
.fl-source-link{display:block; color:var(--ink); text-decoration:none; border-bottom:1px solid var(--mist); padding:9px 2px; font-size:15px;}
.fl-source-link:hover{background:var(--mist); border-radius:6px;}

.fl-badge-card{background:var(--sage); border-radius:14px; padding:22px 24px; margin-bottom:20px; box-shadow:var(--shadow);}
.fl-badge-kicker{font-size:12px; letter-spacing:1.6px; text-transform:uppercase; font-weight:600; color:var(--ink); opacity:0.7;}
.fl-badge-name{font-family:'Fraunces',serif; font-size:23px; font-weight:600; margin-top:4px;}
.fl-badge-sub{font-size:14.5px; margin-top:4px; opacity:0.85;}
.fl-badge-dismiss{margin-top:14px; background:var(--card); border-radius:999px; padding:8px 18px; font-weight:600; font-size:14px;}

.fl-history-head{font-family:'Fraunces',serif; font-size:25px; font-weight:600;}
.fl-history-sub{color:var(--ink-soft); font-size:14px; margin:6px 0 18px;}
.fl-history-list{list-style:none; padding:0; display:flex; flex-direction:column; gap:10px;}
.fl-history-item{background:var(--card); border-radius:12px; box-shadow:var(--shadow); padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:14px;}
.fl-hi-main{display:flex; flex-direction:column; min-width:0;}
.fl-hi-day{font-size:12px; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-soft); font-weight:600;}
.fl-hi-title{font-weight:500; font-size:15.5px;}
.fl-hi-side{display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0;}
.fl-hi-when{font-size:12.5px; color:var(--ink-soft);}
.fl-chip{border-radius:999px; padding:3px 11px; font-size:12.5px; font-weight:600; background:var(--paper); color:var(--ink-soft);}
.fl-chip-sage{background:var(--sage); color:var(--ink);}
.fl-chip-mist{background:var(--mist); color:var(--ink);}
.fl-chip-blush{background:var(--blush); color:var(--ink);}
.fl-earned{margin-top:22px;}
.fl-chip-badge{margin-right:8px;}

.fl-demo-line{text-align:center; margin-top:18px; font-size:13.5px; color:var(--ink-soft);}
.fl-linkish{text-decoration:underline; text-underline-offset:3px; color:var(--ink-soft); font-size:inherit;}
.fl-linkish:hover{color:var(--ink);}

.fl-modal-backdrop{position:fixed; inset:0; background:rgba(58,63,74,0.35); display:flex; align-items:center; justify-content:center; padding:20px; z-index:50;}
.fl-modal{background:var(--card); border-radius:14px; box-shadow:0 8px 30px rgba(58,63,74,0.2); padding:26px 24px; max-width:420px; width:100%;}
.fl-label{display:block; font-size:13px; font-weight:600; color:var(--ink-soft); margin:12px 0 5px;}
.fl-input{width:100%; border:1px solid rgba(58,63,74,0.2); border-radius:10px; padding:10px 12px; font:inherit; font-size:14.5px; background:var(--paper);}
.fl-modal code{background:var(--paper); padding:1px 6px; border-radius:6px; font-size:13px;}

.fl-bottombar{display:none;}
@media (max-width:700px){
  .fl-topnav{display:none;}
  .fl-bottombar{display:flex; position:fixed; bottom:0; left:0; right:0; background:var(--card); border-top:1px solid rgba(58,63,74,0.08); box-shadow:0 -1px 3px rgba(58,63,74,0.05); z-index:40;}
  .fl-bottombar button{flex:1; padding:12px 0 16px; display:flex; flex-direction:column; align-items:center; gap:3px; font-size:12.5px; font-weight:600; color:var(--ink-soft);}
  .fl-bottombar button.on{color:var(--ink);}
  .fl-bb-dot{width:6px; height:6px; border-radius:50%; background:currentColor; opacity:0.35;}
  .fl-bottombar button.on .fl-bb-dot{background:var(--sage-strong); opacity:1; box-shadow:0 0 0 3px rgba(94,140,74,0.25);}
  .fl-card{padding:24px 20px 22px;}
  .fl-date-day{font-size:40px;}
}
@media (prefers-reduced-motion: reduce){
  .fl-deep{transition:none;}
  .fl-btn{transition:none;}
}
`;
