(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");

  const VIEWPORTS = [
    { id: "desktop", label: "桌面", width: 1280, height: 800, fillHeight: true },
    { id: "tablet", label: "平板", width: 834, height: 1112 },
    { id: "mobile", label: "手机", width: 390, height: 844 },
    { id: "full", label: "全宽", width: 0, height: 0 }
  ];

  const ICONS = {
    parent: '<svg viewBox="0 0 16 16"><path d="M3 3.5h10v1.2H3zM8 6l3.6 3.8h-2.4v3.7H6.8V9.8H4.4z"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 3l4.2 4.6h-2.9v5.4H6.7V7.6H3.8z"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M8 13L3.8 8.4h2.9V3h2.6v5.4h2.9z"/></svg>',
    duplicate: '<svg viewBox="0 0 16 16"><path d="M5.2 2h7.3v7.3h-1.3V3.3H5.2zM3 5h7.5v8.6H3zm1.3 1.3v6h4.9v-6z"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M6 2h4l.5 1H13v1.3H3V3h2.5zM4 5.3h8L11.4 14H4.6zm2.4 1.6l.2 5.5h1.1l-.2-5.5zm2.9 0l-.2 5.5h1.1l.2-5.5z"/></svg>',
    code: '<svg viewBox="0 0 16 16"><path d="M5.7 4L2 8l3.7 4 .9-.9L3.8 8l2.8-3.1zm4.6 0l-.9.9L12.2 8l-2.8 3.1.9.9L14 8z"/></svg>',
    save: '<svg viewBox="0 0 16 16"><path d="M3 3h8.6L13 4.4V13H3zm2 1.3v2.4h5.4V4.3zm-.4 4.6V12h6.8V8.9z"/></svg>',
    chevron: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4z"/></svg>',
    search: '<svg viewBox="0 0 16 16"><path d="M10.4 9.4a4.5 4.5 0 1 0-1 1l3 3 1-1zM7 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>',
    sync: '<svg viewBox="0 0 16 16"><path d="M8 3a5 5 0 0 1 4.5 2.8l1.2-.7.3 3.2-3.1-.7 1-.6A3.8 3.8 0 0 0 8 4.2 3.8 3.8 0 0 0 4.6 6l-1.1-.6A5 5 0 0 1 8 3zM3.5 7.7l3.1.7-1 .6A3.8 3.8 0 0 0 8 11.8 3.8 3.8 0 0 0 11.4 10l1.1.6A5 5 0 0 1 8 13a5 5 0 0 1-4.5-2.8l-1.2.7z"/></svg>',
    fold: '<svg viewBox="0 0 16 16"><path d="M3 3h10v1.2H3zM3 11.8h10V13H3zM8 5.2L5.4 7.8h1.9v.4H5.4L8 10.8l2.6-2.6H8.7v-.4h1.9z"/></svg>',
    panelLeft: '<svg viewBox="0 0 16 16"><path d="M2 3h12v10H2zm1.2 1.2v7.6h3.4V4.2zm4.6 0v7.6h5V4.2z" fill-rule="evenodd"/></svg>',
    panelRight: '<svg viewBox="0 0 16 16"><path d="M2 3h12v10H2zm1.2 1.2v7.6h5V4.2zm6.2 0v7.6h3.4V4.2z" fill-rule="evenodd"/></svg>'
  };

  const state = {
    html: "",
    ir: undefined,
    library: [],
    version: 0,
    extensionVersion: "",
    fileName: "",
    dirty: false,
    selectedId: undefined,
    hoveredId: undefined,
    viewport: "desktop",
    zoom: 1,
    zoomMode: "fit",
    followSource: true,
    syncRepeat: false,
    outlineQuery: "",
    collapsed: new Set(),
    rightTab: "inspect",
    insertPosition: "after",
    dragNodeId: undefined,
    showLeft: true,
    showRight: true
  };

  /** Runtime references rebuilt per state push. */
  let nodeById = new Map();
  let nodeToEl = new Map();
  let elToNode = new Map();
  let textSlotByEl = new Map();
  let frame;
  let frameReady = false;
  let lastLoadedHtml = null;
  let inlineEditing = null;
  let pendingState = null;
  let overlayRaf = 0;

  // ---------------------------------------------------------------- shell ---

  app.innerHTML = `
    <div class="rw-shell">
      <header class="rw-topbar">
        <div class="rw-brand">
          <span class="rw-logo">Re</span>
          <span class="rw-brand-name">Reweave</span>
          <span class="rw-file" id="rwFile"></span>
          <span class="rw-dirty" id="rwDirty" title="有未保存的修改" hidden></span>
        </div>
        <div class="rw-top-center">
          <div class="rw-segmented" id="rwViewports" role="group" aria-label="视口"></div>
          <div class="rw-zoom" role="group" aria-label="缩放">
            <button class="rw-icon-btn" data-action="zoom-out" title="缩小">−</button>
            <button class="rw-zoom-value" data-action="zoom-reset" title="重置为 100%" id="rwZoomValue">100%</button>
            <button class="rw-icon-btn" data-action="zoom-in" title="放大">+</button>
            <button class="rw-icon-btn rw-fit" data-action="zoom-fit" title="适应宽度">⤢</button>
            <button class="rw-icon-btn" data-action="open-browser" title="在系统浏览器打开当前 HTML">↗</button>
          </div>
        </div>
        <div class="rw-top-right">
          <label class="rw-switch" title="选中组件时在左侧源码中同步定位">
            <input type="checkbox" id="rwFollow" checked>
            <span class="rw-switch-track"></span>
            <span>跟随源码</span>
          </label>
          <span class="rw-top-sep"></span>
          <button class="rw-icon-btn is-on" data-action="toggle-panel" data-side="left" id="rwToggleLeft" title="显示/隐藏大纲面板">${ICONS.panelLeft}</button>
          <button class="rw-icon-btn is-on" data-action="toggle-panel" data-side="right" id="rwToggleRight" title="显示/隐藏检查面板">${ICONS.panelRight}</button>
        </div>
      </header>
      <div class="rw-main" id="rwMain">
        <aside class="rw-left">
          <div class="rw-panel-head">
            <span>大纲 <span class="rw-count" id="rwOutlineCount"></span></span>
            <button class="rw-icon-btn" data-action="fold-all" id="rwFoldAll" title="折叠 / 展开全部">${ICONS.fold}</button>
          </div>
          <div class="rw-search">
            <span class="rw-search-icon">${ICONS.search}</span>
            <input type="search" id="rwSearch" placeholder="搜索组件…" spellcheck="false">
          </div>
          <div class="rw-outline" id="rwOutline" tabindex="-1"></div>
        </aside>
        <div class="rw-center">
          <div class="rw-canvas-wrap" id="rwWrap">
            <div class="rw-canvas-outer" id="rwOuter">
              <div class="rw-canvas" id="rwCanvas">
                <iframe class="rw-frame" id="rwFrame" sandbox="allow-same-origin allow-scripts" title="文档预览"></iframe>
                <div class="rw-overlay" id="rwOverlay"></div>
              </div>
            </div>
            <div class="rw-splash" id="rwSplash">
              <div class="rw-splash-logo">Re</div>
              <p>正在解析文档…</p>
            </div>
          </div>
          <div class="rw-breadcrumb" id="rwBreadcrumb"></div>
        </div>
        <aside class="rw-right">
          <div class="rw-tabs" role="tablist">
            <button class="rw-tab is-active" data-action="tab" data-tab="inspect" role="tab">检查</button>
            <button class="rw-tab" data-action="tab" data-tab="library" role="tab">组件库</button>
          </div>
          <div class="rw-tab-body" id="rwInspect"></div>
          <div class="rw-tab-body" id="rwLibrary" hidden></div>
        </aside>
      </div>
      <footer class="rw-statusbar">
        <span id="rwStats"></span>
        <span class="rw-status-right">
          <span class="rw-version" id="rwVersion"></span>
          <span class="rw-engine-badge" title="确定性规则引擎,无网络、无模型调用">纯规则 · 离线</span>
          <span id="rwParseMs"></span>
        </span>
      </footer>
      <div class="rw-toasts" id="rwToasts"></div>
    </div>
  `;

  const el = {
    main: byId("rwMain"),
    file: byId("rwFile"),
    dirty: byId("rwDirty"),
    viewports: byId("rwViewports"),
    zoomValue: byId("rwZoomValue"),
    follow: byId("rwFollow"),
    outline: byId("rwOutline"),
    outlineCount: byId("rwOutlineCount"),
    search: byId("rwSearch"),
    wrap: byId("rwWrap"),
    outer: byId("rwOuter"),
    canvas: byId("rwCanvas"),
    overlay: byId("rwOverlay"),
    splash: byId("rwSplash"),
    breadcrumb: byId("rwBreadcrumb"),
    inspect: byId("rwInspect"),
    library: byId("rwLibrary"),
    stats: byId("rwStats"),
    version: byId("rwVersion"),
    parseMs: byId("rwParseMs"),
    toasts: byId("rwToasts")
  };
  frame = byId("rwFrame");

  el.viewports.innerHTML = VIEWPORTS.map(
    (vp) => `<button data-action="viewport" data-viewport="${vp.id}" class="${vp.id === state.viewport ? "is-active" : ""}"
      title="${vp.width ? `${vp.width}×${vp.fillHeight ? "自适应高度" : vp.height}` : "撑满画布"}">${vp.label}</button>`
  ).join("");

  function byId(id) {
    return document.getElementById(id);
  }

  // Surface unexpected failures instead of dying silently.
  window.addEventListener("error", (event) => {
    toast(`界面异常：${event.message}`, "warn");
  });
  window.addEventListener("unhandledrejection", (event) => {
    toast(`界面异常：${event.reason}`, "warn");
  });

  // ------------------------------------------------------------- messages ---

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      if (inlineEditing) {
        pendingState = message;
        return;
      }
      applyState(message);
    } else if (message.type === "toast") {
      toast(message.message, message.tone || "info");
    }
  });

  function applyState(message) {
    const htmlChanged = message.html !== state.html;
    state.html = message.html || "";
    state.ir = message.ir;
    state.library = Array.isArray(message.library) ? message.library : [];
    state.version = message.version || 0;
    state.extensionVersion = message.extensionVersion || "";
    state.fileName = message.fileName || "";
    state.dirty = Boolean(message.dirty);
    state.baseHref = message.baseHref || "";

    nodeById = new Map();
    if (state.ir) {
      for (const node of state.ir.nodes) {
        nodeById.set(node.id, node);
      }
    }
    if (!state.selectedId || !nodeById.has(state.selectedId)) {
      // Land on the first concrete component so structural actions are usable at once.
      state.selectedId = state.ir
        ? (state.ir.root.children[0] ? state.ir.root.children[0].id : state.ir.root.id)
        : undefined;
    }
    if (state.hoveredId && !nodeById.has(state.hoveredId)) {
      state.hoveredId = undefined;
    }

    el.splash.hidden = Boolean(state.ir);
    updateTopbar();
    updateOutline();
    updateInspector();
    updateLibrary();
    updateBreadcrumb();
    updateStatus();

    if (htmlChanged || lastLoadedHtml === null) {
      reloadFrame();
    } else {
      scheduleOverlay();
    }
  }

  syncPanels();
  vscode.postMessage({ type: "ready" });

  // -------------------------------------------------------------- topbar ----

  function updateTopbar() {
    el.file.textContent = state.fileName;
    el.dirty.hidden = !state.dirty;
    el.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    const fitButton = document.querySelector('[data-action="zoom-fit"]');
    if (fitButton) {
      fitButton.classList.toggle("is-on", state.zoomMode === "fit");
    }
    for (const button of el.viewports.querySelectorAll("button")) {
      button.classList.toggle("is-active", button.dataset.viewport === state.viewport);
    }
  }

  function updateStatus() {
    el.version.textContent = state.extensionVersion ? `Reweave v${state.extensionVersion}` : "";
    if (!state.ir) {
      el.stats.textContent = "";
      el.parseMs.textContent = "";
      return;
    }
    const s = state.ir.stats;
    el.stats.textContent = `${s.componentCount} 个组件 · ${s.repeatGroupCount} 个重复组 · ${s.elementCount} 个元素`;
    el.parseMs.textContent = `解析 ${s.durationMs} ms`;
  }

  // -------------------------------------------------------------- outline ---

  function updateOutline() {
    if (!state.ir) {
      el.outline.innerHTML = "";
      el.outlineCount.textContent = "";
      return;
    }
    const query = state.outlineQuery.trim().toLowerCase();
    let visible;
    if (query) {
      visible = new Set();
      for (const node of state.ir.nodes) {
        const haystack = `${node.label} ${node.tagName} ${node.classList.join(" ")}`.toLowerCase();
        if (haystack.includes(query)) {
          let current = node;
          while (current) {
            visible.add(current.id);
            current = current.parentId ? nodeById.get(current.parentId) : undefined;
          }
        }
      }
    }
    el.outlineCount.textContent = String(state.ir.stats.componentCount);
    el.outline.innerHTML = renderOutlineNode(state.ir.root, 0, visible, Boolean(query));
    syncOutlineSelection();
  }

  function renderOutlineNode(node, depth, visible, forceExpand) {
    if (visible && !visible.has(node.id)) {
      return "";
    }
    const hasChildren = node.children.length > 0;
    const collapsed = !forceExpand && state.collapsed.has(node.id);
    const badge = node.kind === "repeat-group"
      ? `<span class="rw-badge rw-badge-group${node.approximate ? " is-approx" : ""}" title="${node.approximate ? "近似重复组(结构相似)" : "重复组(结构相同)"}">×${node.repeatCount || node.children.length}</span>`
      : node.kind === "repeat-item"
        ? `<span class="rw-badge" title="重复项 ${node.repeatIndex}/${node.repeatCount}">${node.repeatIndex}</span>`
        : "";
    const row = `
      <div class="rw-row${node.kind === "root" ? " is-root" : ""}" data-node-id="${node.id}" data-depth="${depth}"
        style="--depth:${depth}" draggable="${node.kind !== "root"}" title="${escapeAttr(node.domPath)}">
        <button class="rw-twist${hasChildren ? "" : " is-leaf"}${collapsed ? " is-collapsed" : ""}"
          data-action="toggle" data-node-id="${node.id}" tabindex="-1" aria-label="折叠">${hasChildren ? ICONS.chevron : ""}</button>
        <button class="rw-row-main" data-action="select" data-node-id="${node.id}">
          <span class="rw-row-label">${escapeHtml(node.label)}</span>
          <span class="rw-row-tag">${escapeHtml(node.tagName)}</span>
          ${badge}
        </button>
      </div>`;
    if (!hasChildren || collapsed) {
      return row;
    }
    return row + `<div class="rw-rows">${node.children.map((child) => renderOutlineNode(child, depth + 1, visible, forceExpand)).join("")}</div>`;
  }

  function syncOutlineSelection() {
    for (const row of el.outline.querySelectorAll(".rw-row")) {
      row.classList.toggle("is-selected", row.dataset.nodeId === state.selectedId);
      row.classList.toggle("is-hovered", row.dataset.nodeId === state.hoveredId);
    }
    const selected = el.outline.querySelector(".rw-row.is-selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  // ------------------------------------------------------------ breadcrumb --

  function updateBreadcrumb() {
    const node = getSelected();
    if (!node) {
      el.breadcrumb.innerHTML = "";
      return;
    }
    const chain = [];
    let current = node;
    while (current) {
      chain.unshift(current);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
    el.breadcrumb.innerHTML = chain
      .map((item, index) => {
        const isLast = index === chain.length - 1;
        return `<button class="rw-crumb${isLast ? " is-current" : ""}" data-action="select" data-node-id="${item.id}">${escapeHtml(item.label)}</button>`;
      })
      .join('<span class="rw-crumb-sep">›</span>');
  }

  // ------------------------------------------------------------- inspector --

  function updateInspector() {
    const node = getSelected();
    if (!node) {
      el.inspect.innerHTML = '<div class="rw-empty">在画布或大纲中选择一个组件。</div>';
      return;
    }

    let focused = null;
    if (document.activeElement && el.inspect.contains(document.activeElement)) {
      let pos = null;
      try {
        pos = document.activeElement.selectionStart;
      } catch {
        // Some input types (color, checkbox) do not support selection.
      }
      focused = { id: document.activeElement.id, pos };
    }

    const editable = node.kind !== "root";
    const repeatItem = node.kind === "repeat-item" && node.repeatCount > 1;
    const startLine = lineOf(node.source.start);
    const endLine = lineOf(node.source.end);

    const signalChips = node.signals.map((signal) => `<span class="rw-chip">${escapeHtml(signal)}</span>`).join("");
    const classChips = node.classList.slice(0, 6).map((cls) => `<span class="rw-chip rw-chip-class">.${escapeHtml(cls)}</span>`).join("");

    const inlineProps = node.editable.props.filter((p) => p.origin !== "stylesheet" && p.target === "inline-style");
    const attrProps = node.editable.props.filter((p) => p.origin === "attribute");
    const computedProps = node.editable.props.filter((p) => p.origin === "stylesheet");

    el.inspect.innerHTML = `
      ${renderPaletteDatalist()}
      <div class="rw-section rw-ident">
        <div class="rw-ident-head">
          <h2 class="rw-ident-title">${escapeHtml(node.label)}</h2>
          <span class="rw-chip rw-chip-tag">&lt;${escapeHtml(node.tagName)}&gt;</span>
        </div>
        <div class="rw-chips">${classChips}${signalChips}</div>
        <div class="rw-meta-line">
          <span>源码第 ${startLine}–${endLine} 行</span>
          <button class="rw-link-btn" data-action="reveal" title="在左侧源码编辑器中定位">${ICONS.code}<span>定位源码</span></button>
        </div>
      </div>

      <div class="rw-section">
        <div class="rw-actionbar">
          <button class="rw-act" data-action="move" data-direction="up" ${editable ? "" : "disabled"} title="上移 (Alt+↑)">${ICONS.up}<span>上移</span></button>
          <button class="rw-act" data-action="move" data-direction="down" ${editable ? "" : "disabled"} title="下移 (Alt+↓)">${ICONS.down}<span>下移</span></button>
          <button class="rw-act" data-action="duplicate" ${editable ? "" : "disabled"} title="复制 (⌘D)">${ICONS.duplicate}<span>复制</span></button>
          <button class="rw-act rw-act-danger" data-action="delete" ${editable ? "" : "disabled"} title="删除 (⌫),可用 ⌘Z 撤销">${ICONS.trash}<span>删除</span></button>
        </div>
        ${repeatItem ? `
          <label class="rw-sync${state.syncRepeat ? " is-on" : ""}" title="开启后,文本与样式修改会同步应用到该重复组的全部成员">
            <input type="checkbox" id="rwSync" ${state.syncRepeat ? "checked" : ""}>
            ${ICONS.sync}
            <span>同步修改到全部 ${node.repeatCount} 项</span>
          </label>` : ""}
        ${node.approximate ? '<p class="rw-note">该重复组由近似匹配产生:成员结构相似但不完全相同,同步编辑时请留意。</p>' : ""}
      </div>

      <div class="rw-section">
        <h3 class="rw-section-title">文本 <span class="rw-count">${node.editable.text.length}</span></h3>
        ${node.editable.text.length
          ? node.editable.text.map((slot) => renderTextField(node, slot)).join("")
          : '<p class="rw-empty-line">没有可直接编辑的文本。双击画布中的文字也可以就地编辑。</p>'}
      </div>

      ${attrProps.length ? `
      <div class="rw-section">
        <h3 class="rw-section-title">内容属性 <span class="rw-count">${attrProps.length}</span></h3>
        ${attrProps.map((prop) => renderPropField(node, prop)).join("")}
      </div>` : ""}

      ${inlineProps.length ? `
      <div class="rw-section">
        <h3 class="rw-section-title">内联样式 <span class="rw-count">${inlineProps.length}</span></h3>
        ${inlineProps.map((prop) => renderPropField(node, prop)).join("")}
      </div>` : ""}

      ${computedProps.length ? `
      <div class="rw-section">
        <h3 class="rw-section-title">来自样式表
          <span class="rw-hint" title="这些值由文档 <style> 推断。修改后会以内联样式覆写该元素,不改动原样式表。">覆写</span>
        </h3>
        ${computedProps.map((prop) => renderPropField(node, prop)).join("")}
      </div>` : ""}

      <div class="rw-section">
        <button class="rw-wide-btn" data-action="save-component" ${editable ? "" : "disabled"}>${ICONS.save}<span>保存为可复用组件</span></button>
      </div>
    `;

    if (focused && focused.id) {
      const restore = byId(focused.id);
      if (restore) {
        restore.focus();
        if (typeof focused.pos === "number" && restore.setSelectionRange) {
          try { restore.setSelectionRange(focused.pos, focused.pos); } catch { /* type=color etc. */ }
        }
      }
    }
  }

  function renderPaletteDatalist() {
    const colors = (state.ir?.palette || []).map(toHexColor).filter(Boolean);
    if (!colors.length) {
      return "";
    }
    return `<datalist id="rwPalette">${[...new Set(colors)].map((color) => `<option value="${color}"></option>`).join("")}</datalist>`;
  }

  function renderTextField(node, slot) {
    return `
      <div class="rw-field">
        <label for="${escapeAttr(slot.id)}">${escapeHtml(slot.label)}</label>
        <input id="${escapeAttr(slot.id)}" value="${escapeAttr(slot.value)}" spellcheck="false"
          data-action="set-text" data-node-id="${node.id}" data-slot-id="${escapeAttr(slot.id)}">
      </div>`;
  }

  function renderPropField(node, prop) {
    const hex = prop.kind === "color" ? toHexColor(prop.value) : null;
    const overrideChip = prop.origin === "stylesheet" ? '<span class="rw-chip rw-chip-css" title="当前值来自样式表,修改将以内联样式覆写">css</span>' : "";
    if (hex) {
      return `
        <div class="rw-field rw-field-color">
          <label for="${escapeAttr(prop.id)}">${escapeHtml(prop.label)}${overrideChip}</label>
          <div class="rw-color-row">
            <input type="color" value="${hex}" list="rwPalette" aria-label="选择 ${escapeAttr(prop.label)}"
              data-action="set-prop" data-node-id="${node.id}" data-prop-id="${escapeAttr(prop.id)}">
            <input id="${escapeAttr(prop.id)}" value="${escapeAttr(prop.value)}" spellcheck="false"
              data-action="set-prop" data-node-id="${node.id}" data-prop-id="${escapeAttr(prop.id)}">
          </div>
        </div>`;
    }
    return `
      <div class="rw-field">
        <label for="${escapeAttr(prop.id)}">${escapeHtml(prop.label)}${overrideChip}</label>
        <input id="${escapeAttr(prop.id)}" value="${escapeAttr(prop.value)}" spellcheck="false"
          data-action="set-prop" data-node-id="${node.id}" data-prop-id="${escapeAttr(prop.id)}">
      </div>`;
  }

  function lineOf(offset) {
    let line = 1;
    const limit = Math.min(offset, state.html.length);
    for (let index = 0; index < limit; index += 1) {
      if (state.html.charCodeAt(index) === 10) {
        line += 1;
      }
    }
    return line;
  }

  // -------------------------------------------------------------- library ---

  function updateLibrary() {
    const selected = getSelected();
    const canInsert = Boolean(selected && selected.kind !== "root");
    el.library.innerHTML = `
      <div class="rw-section">
        <div class="rw-insert-pos">
          <span>插入位置</span>
          <div class="rw-segmented rw-segmented-sm">
            <button data-action="insert-pos" data-position="before" class="${state.insertPosition === "before" ? "is-active" : ""}">所选之前</button>
            <button data-action="insert-pos" data-position="after" class="${state.insertPosition === "after" ? "is-active" : ""}">所选之后</button>
          </div>
        </div>
        ${renderInsertTarget(selected, canInsert)}
      </div>
      <div class="rw-library-list">
        ${state.library.length
          ? state.library.map((component) => renderLibraryCard(component, canInsert)).join("")
          : '<div class="rw-empty-line">组件库为空。可以在检查面板把当前选区保存为可复用组件。</div>'}
      </div>
    `;
  }

  function renderInsertTarget(selected, canInsert) {
    if (!selected) {
      return '<div class="rw-insert-target is-empty">先在画布或大纲中选择插入目标。</div>';
    }
    if (!canInsert) {
      return '<div class="rw-insert-target is-empty">当前选中的是整份文档；请选择一个具体组件作为插入目标。</div>';
    }
    const where = state.insertPosition === "before" ? "之前" : "之后";
    return `
      <div class="rw-insert-target">
        <div class="rw-insert-target-main">
          <span class="rw-target-k">目标</span>
          <strong>${escapeHtml(selected.label)}</strong>
          <span>${where} · 源码第 ${lineOf(selected.source.start)} 行</span>
        </div>
        <button data-action="show-target" title="在画布和源码中定位当前插入目标">定位</button>
      </div>`;
  }

  function renderLibraryCard(component, canInsert) {
    const summary = summarizeComponent(component);
    const chips = summary.chips.map((chip) => `<span class="rw-chip">${escapeHtml(chip)}</span>`).join("");
    return `
      <div class="rw-libcard">
        <div class="rw-libcard-head">
          <span class="rw-libcard-name">${escapeHtml(component.name)}</span>
          <span class="rw-chip ${component.source === "workspace" ? "rw-chip-ws" : ""}">${component.source === "workspace" ? "工作区" : "内置"}</span>
        </div>
        <p class="rw-libcard-desc">${escapeHtml(summary.description)}</p>
        <div class="rw-libcard-meta">${chips}</div>
        <details class="rw-libcard-codebox">
          <summary>HTML</summary>
          <pre class="rw-libcard-code">${escapeHtml(snippetPreview(component.html))}</pre>
        </details>
        <div class="rw-libcard-actions">
          <button data-action="insert-component" data-component-id="${escapeAttr(component.id)}" ${canInsert ? "" : "disabled"}>插入到目标</button>
          ${component.source === "workspace"
            ? `<button class="rw-ghost-danger" data-action="delete-component" data-component-id="${escapeAttr(component.id)}">删除</button>`
            : ""}
        </div>
      </div>`;
  }

  function summarizeComponent(component) {
    const parsed = describeHtml(component.html);
    return {
      description: component.description || parsed.description || "可复用 HTML 片段。",
      chips: parsed.chips.length ? parsed.chips : ["HTML"]
    };
  }

  function describeHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const body = doc.body;
      const roots = Array.from(body.children);
      const heading = body.querySelector("h1,h2,h3,h4,h5,h6");
      const textNodes = Array.from(body.querySelectorAll("p,li,a,button,span,strong"))
        .map((node) => compactText(node.textContent || ""))
        .filter(Boolean);
      const title = compactText(heading ? heading.textContent || "" : "");
      const pieces = [title, ...textNodes.filter((item) => item !== title)].filter(Boolean);
      const description = pieces.length ? truncate(pieces.slice(0, 2).join(" · "), 92) : "";
      const tags = [];
      const addTag = (tag) => {
        const value = tag.toLowerCase();
        if (!tags.includes(value)) {
          tags.push(value);
        }
      };
      roots.slice(0, 3).forEach((node) => addTag(node.tagName));
      body.querySelectorAll("h1,h2,h3,article,section,a,img,ul,ol").forEach((node) => addTag(node.tagName));
      const chips = [
        roots.length > 1 ? `${roots.length} 个片段` : roots[0] ? `<${roots[0].tagName.toLowerCase()}>` : "HTML",
        ...tags.filter((tag) => !roots[0] || tag !== roots[0].tagName.toLowerCase()).slice(0, 3).map((tag) => `<${tag}>`)
      ];
      return { description, chips };
    } catch {
      return { description: "", chips: ["HTML"] };
    }
  }

  function snippetPreview(html) {
    const flattened = html.replace(/\s+/g, " ").trim();
    return flattened.length > 150 ? `${flattened.slice(0, 150)}…` : flattened;
  }

  // --------------------------------------------------------------- canvas ---

  function viewportSpec() {
    return VIEWPORTS.find((item) => item.id === state.viewport) || VIEWPORTS[0];
  }

  function viewportSize() {
    const width = viewportWidth();
    const height = viewportHeight(width);
    return { width, height };
  }

  function viewportWidth() {
    const vp = viewportSpec();
    return vp.width ? vp.width : availableCanvasWidth();
  }

  function viewportHeight(width) {
    const vp = viewportSpec();
    if (!vp.height) {
      return availableCanvasHeight();
    }
    if (vp.fillHeight && state.zoomMode === "fit") {
      const zoom = fitZoomValue(width || viewportWidth());
      return Math.max(vp.height, Math.ceil(availableCanvasHeight() / Math.max(zoom, 0.25)));
    }
    return vp.height;
  }

  function availableCanvasWidth() {
    return Math.max(360, el.wrap.clientWidth - 56);
  }

  function availableCanvasHeight() {
    return Math.max(420, el.wrap.clientHeight - 56);
  }

  function fitZoomValue(width) {
    return clampZoom(availableCanvasWidth() / (width || viewportWidth()));
  }

  function clampZoom(value) {
    return Math.min(2, Math.max(0.25, Math.round(value * 100) / 100));
  }

  function reloadFrame() {
    frameReady = false;
    const scrollTop = el.wrap.scrollTop;
    const scrollLeft = el.wrap.scrollLeft;
    const frameScroll = frame.contentWindow
      ? { x: frame.contentWindow.scrollX, y: frame.contentWindow.scrollY }
      : { x: 0, y: 0 };
    layoutCanvas();
    frame.addEventListener("load", () => {
      setupFrame();
      el.wrap.scrollTop = scrollTop;
      el.wrap.scrollLeft = scrollLeft;
      if (frame.contentWindow) {
        frame.contentWindow.scrollTo(frameScroll.x, frameScroll.y);
      }
    }, { once: true });
    lastLoadedHtml = state.html;
    frame.srcdoc = preparePreviewHtml(state.html, state.baseHref);
  }

  /**
   * Keep the preview copy close to browser behavior. A fixed-height iframe
   * preserves viewport units such as 100vh; the page scrolls inside it.
   */
  const PREVIEW_BOOTSTRAP = `<script>(function(){
    window.addEventListener('load', function(){
      try { window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); } catch (e) {}
    });
  })();<\/script>`;

  /**
   * Injects a <base> tag (so relative images / stylesheets resolve against the
   * file's folder) and a tiny bootstrap at the very top of <head>, before the
   * document's own scripts run.
   */
  function preparePreviewHtml(html, baseHref) {
    let injection = PREVIEW_BOOTSTRAP;
    if (baseHref && !/<base\s/i.test(html)) {
      injection = `<base href="${escapeAttr(baseHref)}">` + injection;
    }
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      const at = headMatch.index + headMatch[0].length;
      return html.slice(0, at) + injection + html.slice(at);
    }
    const htmlMatch = html.match(/<html[^>]*>/i);
    if (htmlMatch) {
      const at = htmlMatch.index + htmlMatch[0].length;
      return html.slice(0, at) + injection + html.slice(at);
    }
    return injection + html;
  }

  function setupFrame() {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      return;
    }
    frameReady = true;
    nodeToEl = new Map();
    elToNode = new Map();
    textSlotByEl = new Map();

    if (state.ir) {
      for (const node of state.ir.nodes) {
        const element = resolve(doc, node.domPath);
        if (element) {
          nodeToEl.set(node.id, element);
          if (!elToNode.has(element)) {
            elToNode.set(element, node);
          }
        }
        for (const slot of node.editable.text) {
          const slotEl = resolve(doc, slot.domPath);
          if (slotEl && !textSlotByEl.has(slotEl)) {
            textSlotByEl.set(slotEl, { node, slot });
          }
        }
      }
    }

    doc.addEventListener("click", (event) => {
      if (inlineEditing) {
        return;
      }
      const node = hitTest(event.target);
      if (node) {
        event.preventDefault();
        event.stopPropagation();
        selectNode(node.id, { reveal: state.followSource });
      }
    }, true);

    let hoverPending = false;
    doc.addEventListener("mousemove", (event) => {
      if (hoverPending || inlineEditing) {
        return;
      }
      hoverPending = true;
      requestAnimationFrame(() => {
        hoverPending = false;
        const node = hitTest(event.target);
        setHovered(node ? node.id : undefined);
      });
    }, true);

    doc.addEventListener("mouseleave", () => setHovered(undefined), true);

    doc.addEventListener("dblclick", (event) => {
      const editable = findInlineEditable(event.target);
      if (editable) {
        event.preventDefault();
        event.stopPropagation();
        startInlineEdit(editable.element, editable.node, editable.slot);
        return;
      }
      const node = hitTest(event.target);
      if (node && node.editable.text.length) {
        selectNode(node.id, { reveal: false });
        focusInspectorSlot(node.editable.text[0].id);
      }
    }, true);

    doc.addEventListener("keydown", handleKeydown, true);
    win.addEventListener("scroll", scheduleOverlay, { passive: true });

    layoutCanvas();
    if (win.ResizeObserver && doc.body) {
      const observer = new win.ResizeObserver(() => {
        scheduleOverlay();
      });
      observer.observe(doc.documentElement);
      observer.observe(doc.body);
    }
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(scheduleOverlay).catch(() => undefined);
    }
    scheduleOverlay();
  }

  function resolve(doc, domPath) {
    try {
      return doc.querySelector(domPath) || undefined;
    } catch {
      return undefined;
    }
  }

  function hitTest(target) {
    let current = target && target.nodeType === 1 ? target : null;
    while (current) {
      const node = elToNode.get(current);
      if (node) {
        return node;
      }
      current = current.parentElement;
    }
    return undefined;
  }

  function layoutCanvas() {
    const width = viewportWidth();
    if (state.zoomMode === "fit") {
      state.zoom = fitZoomValue(width);
      el.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    }
    const height = viewportHeight(width);
    frame.style.height = `${height}px`;
    el.canvas.style.width = `${width}px`;
    el.canvas.style.height = `${height}px`;
    el.canvas.style.transform = `scale(${state.zoom})`;
    el.outer.style.width = `${Math.round(width * state.zoom)}px`;
    el.outer.style.height = `${Math.round(height * state.zoom)}px`;
  }

  // --------------------------------------------------------------- overlay --

  function scheduleOverlay() {
    if (overlayRaf) {
      return;
    }
    overlayRaf = requestAnimationFrame(() => {
      overlayRaf = 0;
      drawOverlay();
    });
  }

  function drawOverlay() {
    el.overlay.innerHTML = "";
    if (!frameReady || !state.ir) {
      return;
    }
    const hovered = state.hoveredId && state.hoveredId !== state.selectedId ? nodeById.get(state.hoveredId) : undefined;
    const selected = getSelected();
    if (hovered && hovered.kind !== "root") {
      drawBox(hovered, "hover");
    }
    if (selected && selected.kind !== "root") {
      drawBox(selected, "selected");
    }
  }

  function drawBox(node, mode) {
    const element = nodeToEl.get(node.id);
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const box = document.createElement("div");
    box.className = `rw-box rw-box-${mode}`;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const inverse = 1 / state.zoom;
    const label = document.createElement("div");
    label.className = "rw-box-label";
    label.style.transform = `scale(${inverse})`;
    label.innerHTML = `<span class="rw-box-name">${escapeHtml(node.label)}</span><span class="rw-box-dims">${Math.round(rect.width)}×${Math.round(rect.height)}</span>`;
    if (rect.top < 30) {
      label.classList.add("is-inside");
    }
    box.appendChild(label);

    if (mode === "selected") {
      const bar = document.createElement("div");
      bar.className = "rw-float-bar";
      bar.style.transform = `scale(${inverse})`;
      if (rect.top < 64) {
        bar.classList.add("is-inside");
      }
      bar.innerHTML = `
        <button data-action="select-parent" title="选父级 (Esc)">${ICONS.parent}</button>
        <button data-action="move" data-direction="up" title="上移 (Alt+↑)">${ICONS.up}</button>
        <button data-action="move" data-direction="down" title="下移 (Alt+↓)">${ICONS.down}</button>
        <button data-action="duplicate" title="复制 (⌘D)">${ICONS.duplicate}</button>
        <button class="rw-bar-danger" data-action="delete" title="删除 (⌫)">${ICONS.trash}</button>`;
      box.appendChild(bar);
    }
    el.overlay.appendChild(box);
  }

  // ----------------------------------------------------------- inline edit --

  function findInlineEditable(target) {
    let current = target && target.nodeType === 1 ? target : null;
    while (current) {
      const entry = textSlotByEl.get(current);
      if (entry && current.children.length === 0) {
        return { element: current, node: entry.node, slot: entry.slot };
      }
      current = current.parentElement;
    }
    return null;
  }

  function startInlineEdit(element, node, slot) {
    if (inlineEditing) {
      finishInlineEdit(true);
    }
    selectNode(node.id, { reveal: false });
    const original = element.textContent;
    try {
      element.contentEditable = "plaintext-only";
    } catch {
      element.contentEditable = "true";
    }
    element.classList.add("rw-inline-editing");
    element.focus();
    const doc = frame.contentDocument;
    if (doc) {
      const range = doc.createRange();
      range.selectNodeContents(element);
      const selection = frame.contentWindow.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setHovered(undefined);

    const onKey = (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finishInlineEdit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishInlineEdit(false);
      }
      event.stopPropagation();
    };
    const onBlur = () => finishInlineEdit(true);
    element.addEventListener("keydown", onKey);
    element.addEventListener("blur", onBlur);

    inlineEditing = { element, node, slot, original, onKey, onBlur };
    scheduleOverlay();
  }

  function finishInlineEdit(commit) {
    const session = inlineEditing;
    if (!session) {
      return;
    }
    inlineEditing = null;
    const { element, node, slot, original } = session;
    element.removeEventListener("keydown", session.onKey);
    element.removeEventListener("blur", session.onBlur);
    element.contentEditable = "false";
    element.removeAttribute("contenteditable");
    element.classList.remove("rw-inline-editing");
    const value = element.textContent;
    if (!commit || value === original) {
      element.textContent = original;
      flushPendingState();
      return;
    }
    postMutation({
      kind: "setText",
      nodeId: node.id,
      slotId: slot.id,
      value,
      sync: state.syncRepeat && node.kind === "repeat-item"
    });
    flushPendingState();
  }

  function flushPendingState() {
    if (pendingState) {
      const message = pendingState;
      pendingState = null;
      applyState(message);
    }
  }

  // ------------------------------------------------------------ selection ---

  function getSelected() {
    return state.selectedId ? nodeById.get(state.selectedId) : undefined;
  }

  function selectNode(nodeId, options) {
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    const changed = state.selectedId !== nodeId;
    state.selectedId = nodeId;
    if (changed) {
      syncOutlineSelection();
      updateInspector();
      updateLibrary();
      updateBreadcrumb();
      scheduleOverlay();
    }
    if (options && options.preview) {
      revealNodeInFrame(nodeId);
    }
    if (options && options.reveal) {
      vscode.postMessage({ type: "select", nodeId, reveal: true });
    }
  }

  function revealNodeInFrame(nodeId) {
    const target = nodeToEl.get(nodeId);
    const win = frame.contentWindow;
    if (!target || !win) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const bottomGuard = Math.max(96, viewportHeight() * 0.18);
    if (rect.top < 16 || rect.top > viewportHeight() - bottomGuard) {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
    setTimeout(scheduleOverlay, 80);
  }

  function setHovered(nodeId) {
    if (state.hoveredId === nodeId) {
      return;
    }
    state.hoveredId = nodeId;
    for (const row of el.outline.querySelectorAll(".rw-row")) {
      row.classList.toggle("is-hovered", row.dataset.nodeId === nodeId);
    }
    scheduleOverlay();
  }

  function focusInspectorSlot(slotId) {
    state.rightTab = "inspect";
    syncTabs();
    const input = byId(slotId);
    if (input) {
      input.focus();
      input.select();
    }
  }

  // ------------------------------------------------------------ mutations ---

  function postMutation(mutation) {
    vscode.postMessage({ type: "mutation", mutation, version: state.version });
  }

  function requireConcrete(node) {
    if (!node || node.kind === "root") {
      toast("请先在画布或大纲中选择一个具体组件", "info");
      return false;
    }
    return true;
  }

  function deleteSelected() {
    const node = getSelected();
    if (!node || node.kind === "root") {
      return;
    }
    const parentId = node.parentId;
    postMutation({ kind: "deleteNode", nodeId: node.id });
    if (parentId) {
      state.selectedId = parentId;
    }
    toast("已删除组件 · 在源码编辑器中按 ⌘Z 可撤销", "info");
  }

  // -------------------------------------------------------------- events ----

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) {
      return;
    }
    const action = target.dataset.action;
    const selected = getSelected();

    switch (action) {
      case "select":
        selectNode(target.dataset.nodeId, { reveal: state.followSource, preview: true });
        break;
      case "toggle": {
        const id = target.dataset.nodeId;
        if (state.collapsed.has(id)) {
          state.collapsed.delete(id);
        } else {
          state.collapsed.add(id);
        }
        updateOutline();
        break;
      }
      case "select-parent":
        if (selected && selected.parentId) {
          selectNode(selected.parentId, { reveal: state.followSource, preview: true });
        }
        break;
      case "reveal":
        if (selected) {
          vscode.postMessage({ type: "reveal", nodeId: selected.id });
        }
        break;
      case "move":
        if (requireConcrete(selected)) {
          postMutation({ kind: "moveNode", nodeId: selected.id, direction: target.dataset.direction });
        }
        break;
      case "duplicate":
        if (requireConcrete(selected)) {
          postMutation({ kind: "duplicateNode", nodeId: selected.id });
        }
        break;
      case "delete":
        if (requireConcrete(getSelected())) {
          deleteSelected();
        }
        break;
      case "save-component":
        if (selected) {
          vscode.postMessage({ type: "saveComponent", nodeId: selected.id });
        }
        break;
      case "insert-component":
        if (requireConcrete(selected)) {
          const where = state.insertPosition === "before" ? "之前" : "之后";
          toast(`将插入到「${selected.label}」${where}`, "info");
          postMutation({
            kind: "insertHtml",
            nodeId: selected.id,
            componentId: target.dataset.componentId,
            html: "",
            position: state.insertPosition
          });
        }
        break;
      case "show-target":
        if (selected) {
          selectNode(selected.id, { reveal: state.followSource, preview: true });
        }
        break;
      case "open-browser":
        vscode.postMessage({ type: "openExternal" });
        break;
      case "delete-component":
        vscode.postMessage({ type: "deleteComponent", componentId: target.dataset.componentId });
        break;
      case "insert-pos":
        state.insertPosition = target.dataset.position;
        updateLibrary();
        break;
      case "viewport":
        state.viewport = target.dataset.viewport;
        updateTopbar();
        layoutCanvas();
        scheduleOverlay();
        break;
      case "zoom-in":
        setZoom(state.zoom + 0.1, "manual");
        break;
      case "zoom-out":
        setZoom(state.zoom - 0.1, "manual");
        break;
      case "zoom-reset":
        setZoom(1, "manual");
        break;
      case "zoom-fit":
        state.zoomMode = "fit";
        setZoom(fitZoomValue(), "fit");
        break;
      case "tab":
        state.rightTab = target.dataset.tab;
        syncTabs();
        break;
      case "toggle-panel": {
        const side = target.dataset.side;
        if (side === "left") {
          state.showLeft = !state.showLeft;
        } else {
          state.showRight = !state.showRight;
        }
        syncPanels();
        layoutCanvas();
        scheduleOverlay();
        break;
      }
      case "fold-all": {
        if (state.collapsed.size) {
          state.collapsed.clear();
        } else if (state.ir) {
          for (const node of state.ir.nodes) {
            if (node.kind !== "root" && node.children.length) {
              state.collapsed.add(node.id);
            }
          }
        }
        updateOutline();
        break;
      }
    }
  });

  function syncPanels() {
    el.main.classList.toggle("is-left-hidden", !state.showLeft);
    el.main.classList.toggle("is-right-hidden", !state.showRight);
    byId("rwToggleLeft").classList.toggle("is-on", state.showLeft);
    byId("rwToggleRight").classList.toggle("is-on", state.showRight);
  }

  function syncTabs() {
    for (const tab of document.querySelectorAll(".rw-tab")) {
      tab.classList.toggle("is-active", tab.dataset.tab === state.rightTab);
    }
    el.inspect.hidden = state.rightTab !== "inspect";
    el.library.hidden = state.rightTab !== "library";
  }

  function setZoom(value, mode) {
    state.zoomMode = mode || "manual";
    state.zoom = clampZoom(value);
    el.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    updateTopbar();
    layoutCanvas();
    scheduleOverlay();
  }

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "rwFollow") {
      state.followSource = target.checked;
      if (state.followSource && state.selectedId) {
        vscode.postMessage({ type: "select", nodeId: state.selectedId, reveal: true });
      }
      return;
    }
    if (target.id === "rwSync") {
      state.syncRepeat = target.checked;
      const sync = target.closest(".rw-sync");
      if (sync) {
        sync.classList.toggle("is-on", target.checked);
      }
      return;
    }
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const node = nodeById.get(target.dataset.nodeId || "");
    if (!node) {
      return;
    }
    const sync = state.syncRepeat && node.kind === "repeat-item";
    if (target.dataset.action === "set-text") {
      postMutation({ kind: "setText", nodeId: node.id, slotId: target.dataset.slotId, value: target.value, sync });
    } else if (target.dataset.action === "set-prop") {
      postMutation({ kind: "setProp", nodeId: node.id, propId: target.dataset.propId, value: target.value, sync });
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "rwSearch") {
      state.outlineQuery = event.target.value;
      updateOutline();
    }
  });

  document.addEventListener("keydown", handleKeydown);

  function handleKeydown(event) {
    const active = event.target;
    const inField = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
    if (inField) {
      return;
    }
    const selected = getSelected();
    if (!selected) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;

    if (event.key === "Escape") {
      if (selected.parentId) {
        event.preventDefault();
        selectNode(selected.parentId, { reveal: state.followSource, preview: true });
      }
    } else if (event.key === "Enter") {
      if (selected.children.length) {
        event.preventDefault();
        selectNode(selected.children[0].id, { reveal: state.followSource, preview: true });
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (event.altKey) {
        if (selected.kind !== "root") {
          postMutation({ kind: "moveNode", nodeId: selected.id, direction: event.key === "ArrowUp" ? "up" : "down" });
        }
        return;
      }
      const parent = selected.parentId ? nodeById.get(selected.parentId) : undefined;
      if (!parent) {
        return;
      }
      const index = parent.children.findIndex((child) => child.id === selected.id);
      const next = event.key === "ArrowUp" ? parent.children[index - 1] : parent.children[index + 1];
      if (next) {
        selectNode(next.id, { reveal: state.followSource, preview: true });
      }
    } else if (meta && (event.key === "d" || event.key === "D")) {
      event.preventDefault();
      if (selected.kind !== "root") {
        postMutation({ kind: "duplicateNode", nodeId: selected.id });
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    }
  }

  // ------------------------------------------------------------ outline DnD -

  el.outline.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".rw-row");
    if (!row || row.classList.contains("is-root")) {
      event.preventDefault();
      return;
    }
    state.dragNodeId = row.dataset.nodeId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.nodeId);
    row.classList.add("is-dragging");
  });

  el.outline.addEventListener("dragend", () => {
    state.dragNodeId = undefined;
    clearDropMarkers();
    for (const row of el.outline.querySelectorAll(".is-dragging")) {
      row.classList.remove("is-dragging");
    }
  });

  el.outline.addEventListener("dragover", (event) => {
    const row = event.target.closest(".rw-row");
    clearDropMarkers();
    if (!row || !state.dragNodeId) {
      return;
    }
    const dragNode = nodeById.get(state.dragNodeId);
    const targetNode = nodeById.get(row.dataset.nodeId);
    if (!dragNode || !targetNode || dragNode.id === targetNode.id || dragNode.parentId !== targetNode.parentId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    row.classList.add(before ? "drop-before" : "drop-after");
  });

  el.outline.addEventListener("drop", (event) => {
    const row = event.target.closest(".rw-row");
    clearDropMarkers();
    if (!row || !state.dragNodeId) {
      return;
    }
    const dragNode = nodeById.get(state.dragNodeId);
    const targetNode = nodeById.get(row.dataset.nodeId);
    state.dragNodeId = undefined;
    if (!dragNode || !targetNode || dragNode.id === targetNode.id || dragNode.parentId !== targetNode.parentId) {
      return;
    }
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    postMutation({
      kind: "reorderNode",
      nodeId: dragNode.id,
      targetId: targetNode.id,
      position: before ? "before" : "after"
    });
  });

  function clearDropMarkers() {
    for (const row of el.outline.querySelectorAll(".drop-before, .drop-after")) {
      row.classList.remove("drop-before", "drop-after");
    }
  }

  window.addEventListener("resize", () => {
    layoutCanvas();
    scheduleOverlay();
  });

  // --------------------------------------------------------------- toasts ---

  function toast(message, tone) {
    const item = document.createElement("div");
    item.className = `rw-toast rw-toast-${tone}`;
    item.textContent = message;
    el.toasts.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 250);
    }, 3200);
    while (el.toasts.children.length > 4) {
      el.toasts.firstChild.remove();
    }
  }

  // ---------------------------------------------------------------- utils ---

  function toHexColor(value) {
    if (!value) {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split("").map((char) => char + char).join("");
      }
      return `#${hex.slice(0, 6)}`;
    }
    const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgbMatch) {
      const toHex = (part) => Math.min(255, parseInt(part, 10)).toString(16).padStart(2, "0");
      return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
    }
    const named = { white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff", green: "#008000", gray: "#808080", grey: "#808080", transparent: null };
    if (trimmed in named) {
      return named[trimmed];
    }
    return null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function compactText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
})();
