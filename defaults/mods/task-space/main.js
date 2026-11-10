// Choose a space, then start a task there (the task mod, with { space }).
// Type to filter, ↑/↓ and Enter to choose, Esc to leave.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, spaces } from "herdr";

export default class TaskSpace extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = null;
    this.input = InputState.new({ placeholder: "Start a task in…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.choose(this.rows()[this.at ?? 0]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  rows() {
    const f = this.filter.trim().toLowerCase();
    return spaces().filter((s) => !f || `${s.name} ${s.machine ?? ""} ${s.branch ?? ""} ${s.folder}`.toLowerCase().includes(f));
  }

  close() {
    closeOverlay(props().overlay);
  }

  choose(s) {
    if (!s) return;
    this.close();
    openOverlay({ mod: "task", kind: "dialog", width: 520, props: { space: s.id } });
  }

  key(e, cx) {
    const n = this.rows().length;
    if (e.key === "escape") this.close();
    else if ((e.key === "down" || e.key === "up") && n) this.at = ((this.at ?? 0) + (e.key === "down" ? 1 : n - 1)) % n;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const rows = this.rows();
    // Opens on the shown space.
    if (this.at === null) this.at = Math.max(0, rows.findIndex((s) => s.active));
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const row = (s, i) =>
      h_flex()
        .id(`ts-${s.id}`)
        .flex_none()
        .h(32)
        .px(10)
        .gap(8)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .when(i !== this.at, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click(() => this.choose(s))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name))
        .when(Boolean(s.branch), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(11).text_color(t.dim).child(s.branch)))
        .when(Boolean(s.machine), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child(s.machine)));
    return v_flex()
      .id("task-space")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("New task in…")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(36).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(
        div()
          .relative()
          .h(Math.min(320, Math.max(32, rows.length * 32)))
          .child(
            v_flex()
              .id("ts-list")
              .size_full()
              .overflow_y_scroll()
              .children(rows.map(row))
              .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(spaces().length ? "No matching spaces." : "No spaces yet."))),
          )
          .child(Scrollbar.vertical("ts-list").absolute().inset_0()),
      )
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 next \u00b7 esc close"));
  }
}
