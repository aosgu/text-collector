/**
 * arena-exporter.js — Arena 对话导出内容脚本（v1.1.0 自 arena-md-exporter 合并）
 *
 * 仅注入 arena.ai / lmarena.ai 的对话页（/c/ 路径，见 manifest content_scripts）。
 * 由 SW 的右键菜单项「Arena 对话导出」经 chrome.tabs.sendMessage 触发导出；
 * 若本脚本未随页面加载（SPA 从首页进入对话页），SW 会先经 chrome.scripting
 * 补注入本文件再发消息，window 标志位防重复注册。
 *
 * 页面结构（2026-08 实测 arena.ai Battle Mode）：
 *   main > div(-mb-4 flex-1) > ol.flex-col-reverse   ← 消息列表，DOM 顺序为最新在前
 *     ├─ div.w-full                                   ← 一轮模型回答组（carousel）
 *     │   └─ div[@container/carousel] > 幻灯片×N
 *     │       ├─ 卡片：粘性模型名头 / div.no-scrollbar(来源框 + div.prose 正文)
 *     │       └─ h2.hidden "Message from <模型名>"
 *     └─ div.mx-auto                                  ← 用户消息（内含 p）
 */
(() => {
  if (window.__arenaMdExporterLoaded) return;
  window.__arenaMdExporterLoaded = true;

  const hasClass = (el, frag) => (el.getAttribute("class") || "").includes(frag);
  // 嵌套列表每层的缩进；4 空格对无序/有序父级都安全（2 空格在有序父级下会脱离列表）
  const indentOf = (depth) => "    ".repeat(depth);
  // 内容中最长反引号串的长度，决定代码围栏/行内代码分隔符所需的长度
  const longestBackticks = (s) => (s.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
  const escBracket = (s) => s.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  // 链接地址中的空白与括号需转义，否则会截断 Markdown 链接
  const escHref = (href) =>
    href.trim().replace(/\\/g, "%5C").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

  // ---------- 行内节点 → Markdown ----------
  function inlineMd(el) {
    let out = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") {
        const inner = inlineMd(node).trim();
        if (inner) out += `**${inner}**`;
      } else if (tag === "em" || tag === "i") {
        const inner = inlineMd(node).trim();
        if (inner) out += `*${inner}*`;
      } else if (tag === "code") {
        const t = node.textContent;
        if (t) {
          const d = "`".repeat(longestBackticks(t) + 1);
          out += `${d} ${t} ${d}`;
        }
      } else if (tag === "a") {
        const href = escHref(node.href || node.getAttribute("href") || "");
        if (!href) {
          out += inlineMd(node); // 无 href 的 a 只保留文字
        } else {
          const txt = escBracket(inlineMd(node).trim()) || href;
          out += `[${txt}](${href})`;
        }
      } else if (tag === "br") {
        out += "\n";
      } else if (tag === "img") {
        const src = escHref(node.src || node.getAttribute("src") || "");
        const alt = escBracket((node.getAttribute("alt") || "").replace(/\s+/g, " "));
        if (src) out += `![${alt}](${src})`;
      } else if (tag === "sup") {
        const t = node.textContent.trim();
        if (t) out += `[${t}]`;
      } else if (tag === "button") {
        // 引用角标渲染为纯数字按钮
        const t = node.textContent.trim();
        if (/^\d{1,2}$/.test(t)) out += `[${t}]`;
      } else {
        out += inlineMd(node);
      }
    }
    return out;
  }

  // ---------- 块级节点 → Markdown ----------
  // 单个块级元素的转换；blockMd 与列表内嵌套块共用
  function emitBlock(node, out, depth) {
    const tag = node.tagName.toLowerCase();
    if (tag === "p") {
      const txt = inlineMd(node).trim();
      if (txt) out.push(txt + "\n\n");
    } else if (/^h[1-6]$/.test(tag)) {
      const txt = inlineMd(node).trim();
      // +2 级避开文档骨架（# 标题 / ## 轮次 / ### 卡片），下限 4 级防止与卡片标题同级
      const lvl = Math.min(Math.max(Number(tag[1]) + 2, 4), 6);
      if (txt) out.push("#".repeat(lvl) + " " + txt + "\n\n");
    } else if (tag === "pre") {
      const codeEl = node.querySelector("code");
      const lang = ((codeEl && codeEl.className.match(/language-([\w+#.-]+)/)) || [])[1] || "";
      const text = node.textContent.replace(/\s+$/, "");
      // 内容含 ``` 时加长围栏，避免代码块被截断
      const fence = "`".repeat(Math.max(3, longestBackticks(text) + 1));
      out.push(fence + lang + "\n" + text + "\n" + fence + "\n\n");
    } else if (tag === "ul" || tag === "ol") {
      listMd(node, out, depth);
    } else if (tag === "blockquote") {
      const inner = blockMd(node).join("").trim();
      for (const line of inner.split("\n")) out.push((line ? "> " : ">") + line + "\n");
      out.push("\n");
    } else if (tag === "table") {
      const rows = Array.from(node.querySelectorAll("tr"));
      rows.forEach((tr, ri) => {
        const cells = Array.from(tr.querySelectorAll("td,th")).map((c) =>
          c.textContent.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")
        );
        out.push("| " + cells.join(" | ") + " |\n");
        if (ri === 0) out.push("|" + "---|".repeat(cells.length) + "\n");
      });
      out.push("\n");
    } else if (tag === "hr") {
      // 与上一行之间确保有空行，避免 --- 把前文变成 setext 标题
      const last = out[out.length - 1];
      if (last !== undefined && !/\n\n$/.test(last)) out.push("\n");
      out.push("---\n\n");
    } else if (tag === "div") {
      // 含块级子元素则递归，否则按行内文本处理
      const hasBlocks = node.querySelector(
        ":scope > pre, :scope > ul, :scope > ol, :scope > p, :scope > table, :scope > blockquote, " +
          ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > hr"
      );
      if (hasBlocks || node.querySelector("pre, table")) {
        blockMd(node, out, depth);
      } else {
        const txt = inlineMd(node).trim();
        if (txt) out.push(txt + "\n\n");
      }
    } else {
      const txt = inlineMd(node).trim();
      if (txt) out.push(txt + "\n\n");
    }
  }

  // 列表：支持嵌套列表，以及 li 内的块级内容（段落/代码块等缩进为续行）
  function listMd(listEl, out, depth) {
    const ordered = listEl.tagName.toLowerCase() === "ol";
    let idx = ordered ? parseInt(listEl.getAttribute("start"), 10) || 1 : 0;
    const lis = Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === "li");
    for (const li of lis) {
      const nested = [];
      let inline = "";
      for (const child of Array.from(li.childNodes)) {
        const t = child.nodeType === Node.ELEMENT_NODE ? child.tagName.toLowerCase() : "";
        if (/^(ul|ol|p|pre|blockquote|table|div|h[1-6])$/.test(t)) nested.push(child);
        else if (child.nodeType === Node.TEXT_NODE) inline += child.nodeValue;
        else inline += inlineMd(child);
      }
      // 宽松列表（<li><p>正文</p>…）：首个 p 作为条目正文
      if (!inline.trim() && nested.length && nested[0].tagName.toLowerCase() === "p") {
        inline = inlineMd(nested.shift());
      }
      const marker = ordered ? `${idx++}. ` : "- ";
      const text = inline.replace(/\n{2,}/g, "\n").trim();
      out.push(indentOf(depth) + marker + text + "\n");
      for (const b of nested) {
        const t = b.tagName.toLowerCase();
        if (t === "ul" || t === "ol") {
          listMd(b, out, depth + 1);
        } else {
          const sub = [];
          emitBlock(b, sub, depth + 1);
          for (const line of sub.join("").replace(/\n+$/, "").split("\n")) {
            out.push((line ? indentOf(depth + 1) : "") + line + "\n");
          }
          out.push("\n");
        }
      }
    }
    out.push("\n");
  }

  function blockMd(el, out = [], depth = 0) {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const s = node.nodeValue.trim();
        if (s) out.push(s + "\n");
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      emitBlock(node, out, depth);
    }
    return out;
  }

  // 保留 <br> 换行的文本提取（用于用户消息）
  function textWithBreaks(el) {
    let out = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName.toLowerCase() === "br") out += "\n";
        else out += textWithBreaks(node);
      }
    }
    return out;
  }

  // 去掉引用序号前缀。实测站点把序号直接粘在标题开头（"1Genetic..."、"12 遗传..."），
  // 也有 "1. "、"(3) " 等带分隔符的形态。序号在卡片内按 1、2、3…递增且已知，
  // 因此只剥与实际序号完全匹配的前缀（序号后不能紧跟数字），避免误伤"2024 年指南"这类标题。
  function cleanTitle(title, href, ordinal) {
    let t = title.replace(/\s+/g, " ").trim();
    if (ordinal) {
      // 注意用字符串拼接而非模板字面量：tests/helpers/load-source.js 的括号
      // 匹配器不支持嵌套块内的 ${} 插值，会误判函数体边界
      t = t.replace(new RegExp("^\\(?(" + ordinal + ")\\)?(?!\\d)[.、:\\]]?\\s*"), "");
    }
    t = t.replace(/\s*https?:\/\/\S+\s*$/, ""); // 去掉尾部 URL 文本
    return t.trim() || href;
  }

  // ---------- 单张模型卡片 ----------
  function extractCard(slide) {
    let model = "?";
    for (const h2 of Array.from(slide.querySelectorAll("h2"))) {
      const t = h2.textContent.replace(/\s+/g, " ").trim();
      if (t.startsWith("Message from ")) {
        model = t.slice("Message from ".length).trim();
        break;
      }
    }
    if (model === "?") {
      const pill = slide.querySelector('span[class*="truncate"]');
      if (pill) model = pill.textContent.trim();
    }

    const sources = [];
    let body = "";
    const content = slide.querySelector('div[class*="no-scrollbar"]');
    if (content) {
      const gap = content.querySelector('div[class*="gap-3"]');
      if (gap) {
        for (const b of Array.from(gap.children)) {
          if (hasClass(b, "border-border-faint")) {
            for (const a of Array.from(b.querySelectorAll("a"))) {
              const title = a.textContent.replace(/\s+/g, " ").trim();
              const href = a.href || a.getAttribute("href") || "";
              if (title && href) sources.push({ title: cleanTitle(title, href, sources.length + 1), href });
            }
          } else if (hasClass(b, "prose")) {
            body = blockMd(b).join("").trim();
          }
        }
      }
    }
    return { model, sources, body };
  }

  // ---------- 整个对话（按时间正序）----------
  function extractConversation() {
    const ol =
      document.querySelector('main ol[class*="flex-col-reverse"]') ||
      document.querySelector('ol[class*="flex-col-reverse"]');
    if (!ol) return null;

    const turns = [];
    let pendingUser = null;
    // flex-col-reverse：DOM 顺序为最新在前，反转得到时间正序
    for (const item of Array.from(ol.children).reverse()) {
      const cls = item.getAttribute("class") || "";
      if (cls.includes("mx-auto")) {
        // 用户气泡可能含多个段落，逐段拼接（当前站点单 p + br，多 p 时不丢内容）
        const ps = item.querySelectorAll("p");
        const text = ps.length
          ? Array.from(ps).map((p) => textWithBreaks(p)).join("\n\n")
          : textWithBreaks(item);
        pendingUser = text.replace(/\n{3,}/g, "\n\n").trim();
      } else if (cls.includes("w-full") && !cls.includes("mx-auto")) {
        const carousel = item.querySelector('div[class*="@container/carousel"]');
        const cards = carousel ? Array.from(carousel.children).map(extractCard) : [];
        turns.push({ user: pendingUser || "", cards });
        pendingUser = null;
      }
    }
    return turns;
  }

  // ---------- 组装 Markdown ----------
  function buildMarkdown(turns) {
    const models = [...new Set(turns.flatMap((t) => t.cards.map((c) => c.model)))].sort();
    const nAnswers = turns.reduce((s, t) => s + t.cards.length, 0);
    const firstUser = (turns[0] && turns[0].user) || "";
    const titleTopic = firstUser.replace(/\s+/g, " ").slice(0, 40) || "对话";
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;

    const lines = [];
    lines.push(`# Arena 对话导出：${titleTopic}`, "");
    lines.push(`> **来源**: ${location.href}  `);
    lines.push(`> **模式**: Battle Mode（每轮双模型对比）  `);
    lines.push(`> **导出时间**: ${dateStr} ${timeStr}  `);
    lines.push(`> **参与模型**: ${models.join(", ")}  `);
    lines.push(`> **规模**: ${turns.length} 轮 · ${nAnswers} 条回答`, "");
    lines.push("---", "");

    let totalSources = 0;
    turns.forEach((round, i) => {
      lines.push(`## 第 ${i + 1} 轮`, "");
      lines.push("### 🧑 用户", "");
      lines.push(round.user || "（未识别到用户消息）", "");
      round.cards.forEach((card, j) => {
        const side = round.cards.length === 2 ? (j === 0 ? "（左）" : "（右）") : "";
        lines.push(`### 🤖 ${card.model}${side}`, "");
        if (card.sources.length) {
          totalSources += card.sources.length;
          lines.push("**引用来源：**", "");
          card.sources.forEach((s, k) => lines.push(`${k + 1}. [${escBracket(s.title)}](${escHref(s.href)})`));
          lines.push("");
        }
        lines.push("**回答：**", "");
        lines.push(card.body || "（未提取到正文）", "");
      });
      lines.push("---", "");
    });

    lines.push(`*共 ${turns.length} 轮对话，${nAnswers} 条模型回答，${totalSources} 条引用来源。由 Arena 对话导出器生成。*`, "");

    const slugBase = titleTopic.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "chat";
    const filename = `arena-${dateStr.replace(/-/g, "")}-${timeStr}-${slugBase}.md`;
    return { markdown: lines.join("\n"), filename };
  }

  // ---------- 下载与提示 ----------

  function download(markdown, filename) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * 导出反馈：优先复用 content.js 的全局 showToast（同一隔离世界，
   * 与采集 toast 视觉一致）；content.js 未加载（扩展重载后的旧页面等）
   * 时退回右下角简易 toast。
   */
  function notify(message, ok = true) {
    if (typeof showToast === "function") {
      showToast(message, ok ? "success" : "danger");
      return;
    }
    const div = document.createElement("div");
    div.textContent = message;
    Object.assign(div.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "2147483647",
      padding: "10px 16px",
      borderRadius: "8px",
      background: ok ? "#1a1a2e" : "#7f1d1d",
      color: "#fff",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 12px rgba(0,0,0,.3)",
      transition: "opacity .3s",
    });
    document.body.appendChild(div);
    setTimeout(() => {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 400);
    }, 2600);
  }

  function exportNow() {
    const turns = extractConversation();
    if (!turns || turns.length === 0) {
      notify("未找到对话内容：请打开 arena.ai 的对话页（/c/...）再点击导出", false);
      return;
    }
    const { markdown, filename } = buildMarkdown(turns);
    download(markdown, filename);
    const n = turns.reduce((s, t) => s + t.cards.length, 0);
    notify(`已导出 ${turns.length} 轮 / ${n} 条回答 → ${filename}`);
  }

  // 调试钩子（页面控制台可调用，便于站点改版时排查）
  window.__arenaExport = { extractConversation, buildMarkdown, exportNow };

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === "EXPORT_ARENA_MD") {
        exportNow();
        sendResponse({ ok: true });
      }
    });
  }
})();
