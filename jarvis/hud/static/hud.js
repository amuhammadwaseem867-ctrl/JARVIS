// JARVIS HUD: draws events from the local JARVIS server and sends input back.
"use strict";

(() => {
  const token = document.querySelector('meta[name="jarvis-token"]').content;
  const $ = (id) => document.getElementById(id);
  const log = $("log"), tools = $("tools"), text = $("text"), mic = $("mic"), send = $("send");
  const speak = $("speak"), speakWrap = $("speak-wrap"), voiceNote = $("voice-note");
  const statusLine = $("status-line"), stateLabel = $("state-label");
  const confirmBox = $("confirm");

  const LABELS = {
    idle: "Standing by", thinking: "Thinking", listening: "Listening",
    speaking: "Speaking", loading: "Loading voice", connecting: "Connecting", offline: "Offline",
  };

  let state = "connecting";
  let toolCount = 0;
  let micAvailable = false;
  let fatal = null;
  let pending = [];          // yes/no questions waiting for the user
  let typingEl = null;

  // ------------------------------------------------------------ clock

  const clock = $("clock");
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour12: false }); };
  tick(); setInterval(tick, 1000);

  // ------------------------------------------------------------ state

  function setState(next) {
    state = next;
    document.body.dataset.state = next;
    stateLabel.textContent = LABELS[next] || next;
    const busy = next !== "idle";
    send.disabled = busy || !!fatal;
    mic.disabled = (busy && next !== "listening") || !micAvailable || !!fatal;
    $("reset").disabled = busy;
    if (next === "thinking") showTyping(); else hideTyping();
    if (next === "idle" || next === "thinking") status("");
  }

  function status(msg) { statusLine.textContent = msg || ""; }

  // ------------------------------------------------------------ comms

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Small, safe markdown: code, bold, italics, links, bullet lists, paragraphs.
  function markdown(src) {
    const blocks = [];
    let s = escapeHtml(src).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
      blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    const inline = (t) => t
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s.split(/\n{2,}/).map((para) => {
      if (/^\u0000\d+\u0000$/.test(para.trim())) return para.trim();
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) {
        return "<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>`).join("") + "</ul>";
      }
      return `<p>${lines.map((l) => inline(l.replace(/^#{1,6}\s+/, ""))).join("<br>")}</p>`;
    }).join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  }

  function addMessage(role, body) {
    $("empty")?.remove();
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    const who = role === "user" ? "You" : role === "assistant" ? "JARVIS" : "Notice";
    el.innerHTML = `<div class="who">${who}</div><div class="body"></div>`;
    const b = el.querySelector(".body");
    if (role === "assistant") b.innerHTML = markdown(body); else b.textContent = body;
    log.insertBefore(el, typingEl && typingEl.isConnected ? typingEl : null);
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    if (typingEl && typingEl.isConnected) return;
    typingEl = document.createElement("div");
    typingEl.className = "msg assistant";
    typingEl.innerHTML = '<div class="who">JARVIS</div><div class="body"><span class="typing"><i></i><i></i><i></i></span></div>';
    log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;
  }
  function hideTyping() { typingEl?.remove(); }

  function clearLog() {
    log.innerHTML = '<p class="empty" id="empty">New session. How can I help?</p>';
  }

  // ------------------------------------------------------------ systems

  const LABEL_OF = {
    web_search: "Web search", web_fetch: "Read web page", get_weather: "Weather",
    get_current_time: "Clock", calculate: "Calculator", remember: "Memory: save",
    recall: "Memory: recall", forget: "Memory: forget", open_app: "Open app",
    open_website: "Open website", set_volume: "Volume", mute: "Mute",
    get_system_info: "System info", list_files: "List files", find_files: "Find files",
    read_file: "Read file", write_file: "Write file", move_file: "Move file", delete_file: "Delete file",
  };

  function addTool(t) {
    $("tools-empty")?.remove();
    toolCount += 1;
    $("tool-count").textContent = toolCount;
    const li = document.createElement("li");
    li.className = "tool" + (t.is_error ? " error" : "");
    const when = new Date((t.at || Date.now() / 1000) * 1000).toLocaleTimeString([], { hour12: false });
    const args = Object.entries(t.input || {}).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
    li.innerHTML = `<div class="tool-head"><span class="tool-name"></span><span class="tool-time"></span></div>
      <div class="tool-args"></div><div class="tool-result"></div>`;
    li.querySelector(".tool-name").textContent = LABEL_OF[t.name] || t.name;
    li.querySelector(".tool-name").title = t.name;
    li.querySelector(".tool-time").textContent = when;
    li.querySelector(".tool-args").textContent = args || "(no input)";
    const res = li.querySelector(".tool-result");
    res.textContent = (t.is_error ? "Error: " : "") + (t.result || "");
    tools.prepend(li);
    if (res.scrollHeight > res.clientHeight + 4) {
      res.classList.add("long");
      res.title = "Click to expand";
      res.addEventListener("click", () => res.classList.toggle("open"));
    }
  }

  // ------------------------------------------------------------ confirm

  function showConfirm() {
    const q = pending[0];
    if (!q) { confirmBox.hidden = true; return; }
    $("confirm-q").textContent = q.question;
    confirmBox.hidden = false;
    $("confirm-no").focus();
  }

  async function answerConfirm(yes) {
    const q = pending.shift();
    showConfirm();
    if (q) await post("/api/confirm", { id: q.id, answer: yes });
  }
  $("confirm-yes").addEventListener("click", () => answerConfirm(true));
  $("confirm-no").addEventListener("click", () => answerConfirm(false));
  document.addEventListener("keydown", (e) => {
    if (!confirmBox.hidden && e.key === "Escape") answerConfirm(false);
  });

  // ------------------------------------------------------------ voice

  function setVoice(v) {
    if (v.mic !== undefined) micAvailable = v.mic;
    if (v.speech !== undefined) {
      speak.disabled = !v.speech;
      speakWrap.classList.toggle("off", !v.speech);
    }
    if (v.speak_replies !== undefined) speak.checked = v.speak_replies;
    if (v.error !== undefined) voiceNote.textContent = v.error || "";
    mic.title = micAvailable ? "Talk to JARVIS (Ctrl+Space)" : "Mic unavailable: install the voice extras";
    setState(state);
  }

  speak.addEventListener("change", () => post("/api/voice", { speak_replies: speak.checked }));

  // ------------------------------------------------------------ server

  async function post(path, body = {}) {
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Jarvis-Token": token },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        status(data.error || `Request failed (${r.status}).`);
        return false;
      }
      return true;
    } catch {
      status("Can't reach JARVIS. Is it still running?");
      return false;
    }
  }

  function handle(ev) {
    switch (ev.type) {
      case "hello":
        log.innerHTML = "";
        if (!ev.history.length) log.innerHTML = '<p class="empty" id="empty">Systems online. Type below or press the mic to talk to JARVIS.</p>';
        ev.history.forEach((m) => addMessage(m.role, m.text));
        $("model").textContent = ev.model;
        fatal = ev.fatal;
        if (fatal) addMessage("system", fatal);
        setVoice(ev.voice);
        pending = ev.pending.slice();
        showConfirm();
        setState(ev.state);
        break;
      case "state": setState(ev.state); break;
      case "message": addMessage(ev.role, ev.text); break;
      case "tool": addTool(ev); break;
      case "status": status(ev.text); break;
      case "error": addMessage("system", ev.text); break;
      case "fatal": fatal = ev.text; addMessage("system", ev.text); setState(state); break;
      case "voice": setVoice(ev); break;
      case "reset": clearLog(); break;
      case "confirm": pending.push({ id: ev.id, question: ev.question }); showConfirm(); break;
      case "confirm_done":
        pending = pending.filter((q) => q.id !== ev.id);
        showConfirm();
        if (!ev.answer) status("Okay, I won't do that.");
        break;
    }
  }

  function connect() {
    const es = new EventSource(`/events?token=${encodeURIComponent(token)}`);
    es.onopen = () => { $("link").textContent = "secure · local"; };
    es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
    es.onerror = () => {
      $("link").textContent = "offline";
      setState("offline");
      status("Lost the connection to JARVIS. Retrying...");
    };
  }

  // ------------------------------------------------------------ input

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = text.value.trim();
    if (!msg || state !== "idle") return;
    if (msg === "/reset") { text.value = ""; return post("/api/reset"); }
    text.value = "";
    if (!(await post("/api/message", { text: msg }))) text.value = msg;
  });

  mic.addEventListener("click", () => { if (state === "idle") post("/api/listen"); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.code === "Space" && state === "idle" && micAvailable) { e.preventDefault(); post("/api/listen"); }
  });
  $("reset").addEventListener("click", () => post("/api/reset"));

  setState("connecting");
  connect();
  text.focus();
})();
