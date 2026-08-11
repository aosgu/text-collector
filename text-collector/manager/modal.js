/**
 * modal.js — 管理页确认弹窗（Esc 取消 / Enter 触发焦点按钮 / 点遮罩关闭）
 *
 * 原 manager.js L406-L510 的 showConfirmModal 迁移而来。
 * 本文件完全自包含：不读写任何全局状态，DOM 全部在函数内创建。
 */

/**
 * 显示一个确认弹窗。
 * @param {string} title
 * @param {string} body
 * @param {Function} [onConfirm] 点击「确定」后的回调
 */
function showConfirmModal(title, body, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let lastFocused = null;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn);
    // 把焦点还给触发前的元素
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // 简易焦点陷阱：Shift+Tab 从取消按钮绕回确定，Tab 从确定绕回取消
      const focusables = modal.querySelectorAll('button');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // 尊重当前焦点：若焦点在某个按钮上，交给浏览器默认激活行为；
      // 仅在焦点在弹窗内非按钮元素（如 body 文本）时，才兜底触发「取消」。
      // 破坏性操作（清空）绝不应在 Enter 下默认触发确认。
      const active = document.activeElement;
      if (active && (active === cancelBtn || active === confirmBtn)) {
        return; // 让 click 事件自然派发
      }
      e.preventDefault();
      close();
    }
  };

  // 若 Tab 把焦点移出弹窗（焦点陷阱兜底），拉回取消按钮
  const onFocusIn = (e) => {
    if (!modal.contains(e.target)) {
      e.stopPropagation();
      cancelBtn.focus();
    }
  };

  const modal = document.createElement('div');
  modal.className = 'modal';

  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
  titleEl.textContent = title;
  modal.setAttribute('aria-labelledby', titleEl.id);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  bodyEl.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', close);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = '确定';
  confirmBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  modal.appendChild(titleEl);
  modal.appendChild(bodyEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // 点遮罩关闭（点 modal 内部不关闭）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // 记录打开弹窗前的焦点，关闭时恢复
  lastFocused = document.activeElement;
  // 破坏性操作默认焦点给「取消」，避免误按 Enter 直接执行不可撤销操作
  setTimeout(() => cancelBtn.focus(), 0);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
}

/**
 * 显示简易纯文字编辑弹窗（用于已保存笔记编辑）
 * @param {string} title 弹窗标题
 * @param {string} initialText 初始文本
 * @param {Function} onSave 点击「保存」或 Ctrl+Enter 后的回调
 */
function showEditModal(title, initialText, onSave) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let lastFocused = null;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  const modal = document.createElement('div');
  modal.className = 'modal';

  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
  titleEl.textContent = title;
  modal.setAttribute('aria-labelledby', titleEl.id);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';

  const textarea = document.createElement('textarea');
  textarea.className = 'modal-textarea';
  textarea.rows = 7;
  textarea.value = initialText || '';
  textarea.setAttribute('aria-label', '笔记文本');
  bodyEl.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', close);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const val = textarea.value;
    close();
    if (onSave) onSave(val);
  });

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === 'Tab') {
      const focusables = [textarea, cancelBtn, saveBtn];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onFocusIn = (e) => {
    if (!modal.contains(e.target)) {
      e.stopPropagation();
      textarea.focus();
    }
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(titleEl);
  modal.appendChild(bodyEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  lastFocused = document.activeElement;
  setTimeout(() => {
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }, 0);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
}
