// Start an agent on a task: { space? } (default: the shown space). Asks what
// the agent should do, has a small model name a branch for it, makes a git
// worktree on that branch (like the worktree mod: <home>/.herdr/worktrees/<repo>/<branch>)
// and opens a space there with the agent working on the task.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, focused, exec, home, window } from "herdr";

// The agent that does the task; the task is its first message (appended last).
const AGENT = ["hi", "--model", "opus-5-5", "--thinking", "medium"];
// One-shot namer: prints a branch name for the task, which is appended last.
const NAMER = ["hi", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--offline", "--model", "haiku-5-5", "--thinking", "off"];
const NAMING =
  "Name a git branch for the coding task below: 2 to 5 lowercase English words joined by hyphens, " +
  "at most 40 characters, no prefix, no quotes, no explanation. Reply with the name only.\n\nTask:\n";

const ROOT = (userHome) => `${userHome}/.herdr/worktrees`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
// A short label from the task's own words, when the namer can't answer.
const fallback = (task) => slug(task.split(/\s+/).slice(0, 5).join(" ")).slice(0, 40).replace(/-+$/, "") || "task";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The repo a folder belongs to: its main checkout and name. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop() };
}

async function remoteHome(on) {
  let r;
  try { r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on }); } catch {}
  if (!r || r.code !== 0 || !r.stdout.trim()) r = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on });
  if (r.code !== 0 || !r.stdout.trim()) throw new Error("Could not find the remote home folder.");
  return r.stdout.trim().replace(/\\/g, "/");
}

export default class Task extends View {
  init(_props, cx) {
    this.text = "";
    this.input = TextareaState.new({ placeholder: "What should the agent do?", rows: 5 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    // Enter types a new line; cmd-enter (ctrl-enter off macOS) starts.
    this.input.on("submit", (e, cx) => { if (e.secondary) this.go(cx); });
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.step = ""; // what it's doing once started
    this.error = "";
  }

  space() {
    const id = props()?.space;
    return spaces().find((s) => s.id === id) ?? spaces().find((s) => s.active);
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.step || !this.text.trim()) return;
    cx.spawn(async (cx) => {
      try {
        await this.start(this.text.trim(), cx);
        this.close();
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.step = "";
        cx.notify();
      }
    });
  }

  say(step, cx) {
    this.step = step;
    cx.notify();
  }

  async start(task, cx) {
    const s = this.space();
    if (!s) throw new Error("Open a space first.");
    const on = s.machine ?? undefined;
    const f = focused();
    const folder = (f?.space === s.id && f.cwd) || place(s);
    this.say("Finding the repository…", cx);
    const userHome = on ? await remoteHome(on) : home();
    const repo = folder ? await repoOf(folder, on) : null;
    if (!repo) throw new Error(`${folder ?? "This space"} is not in a git repository.`);

    this.say("Naming the task…", cx);
    let label = "";
    try {
      const r = await exec(NAMER[0], [...NAMER.slice(1), NAMING + task], { on });
      const line = (r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
      if (r.code === 0) label = slug(line.replace(/^[`"']+|[`"']+$/g, "")).slice(0, 40).replace(/-+$/, "");
    } catch {}
    label ||= fallback(task);

    // A free branch and folder: label, label-2, ...
    const taken = (await git(repo.main, ["worktree", "list", "--porcelain"], on)).out
      .split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
    const base = `${ROOT(userHome)}/${repo.name}`;
    let branch = label;
    for (let n = 2; ; n++) {
      const exists = (await git(repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
      if (!exists && !taken.includes(`${base}/${branch}`)) break;
      branch = `${label}-${n}`;
    }
    const path = `${base}/${branch}`;
    this.say(`Making worktree ${branch}…`, cx);
    const add = await git(repo.top, ["worktree", "add", "-b", branch, path, "HEAD"], on);
    if (!add.ok) throw new Error(add.err || "git worktree add failed.");

    // Unnamed, so the space follows the checkout and nests under its repo.
    run("space.new", { folder: path, machine: on ?? "", argv: AGENT, task });
  }

  key(e, cx) {
    if (e.key === "escape") {
      cx.stop_propagation();
      this.close();
    }
  }

  render() {
    const t = theme();
    const s = this.space();
    const where = s ? `${s.name}${s.machine ? ` on ${s.machine}` : ""}` : "";
    const ready = !this.step && Boolean(this.text.trim());
    const button = (id, text, primary, enabled, action) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8)
        .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
        .when(enabled, (el) => el.cursor_pointer().hover((st) => st.opacity(0.88)).on_click(action))
        .when(!enabled, (el) => el.opacity(0.5))
        .child(text);
    return v_flex()
      .id("task")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex().items_center().gap(8)
          .child(div().text_size(15).font_semibold().child("New task"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(where ? `in ${where}` : ""))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(div().text_size(11.5).text_color(t.dim).child("The agent works in a new worktree of this space's repository."))
      .child(
        Textarea.new(this.input).h(120).px(10).py(8).rounded(9).border_1()
          .border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(
        h_flex().pt(4).gap(8).items_center()
          .child(div().flex_1().text_size(11.5).text_color(this.step ? t.muted : t.dim).child(this.step || (window()?.platform === "macos" ? "\u2318\u21b5 start" : "ctrl+\u21b5 start")))
          .child(button("task-cancel", "Cancel", false, true, () => this.close()))
          .child(button("task-start", "Start", true, ready, (_e, cx) => this.go(cx))),
      );
  }
}
