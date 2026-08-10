/**
 * import-export.js — 管理页导入 / 导出
 *
 * 从原 manager.js 拆分而来：
 *   handleExport L513-535 / downloadBlob L537-546 / handleImport L549-551，
 *   以及原 $fileInput change 监听器主体（L553-589）迁为 handleImportFileChange。
 *
 * 状态约定：ignoreAllOrderChanges / 列表刷新等全局状态保留在 manager.js，
 * 本文件通过 hooks（onBeforeImport / onAfterImport / onImported 回调）读写，
 * 不在文件间共享可变变量。文件输入框由 manager.js 绑定 change 事件；
 * 本文件通过 document.getElementById 自行触发点击与重置 value。
 */

// ── 导出为 TXT（UTF-8 BOM）或 JSON ──
async function handleExport(format) {
  try {
    const records = await getAllSnippets();
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'txt') {
      const texts = records.map(r => r.text);
      const content = texts.join('\n\n');
      const bom = '\uFEFF';
      const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `snippets_${dateStr}.txt`);
    } else if (format === 'json') {
      const data = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        count: records.length,
        snippets: records,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `snippets_${dateStr}.json`);
    } else {
      showToast('未知导出格式', { kind: 'danger' });
      return;
    }

    showToast(`已导出 ${records.length} 条`, { kind: 'success' });
  } catch (err) {
    console.error('[text-collector] export failed:', err);
    showToast('导出失败：存储读取异常', { kind: 'danger' });
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 导入 ──
function handleImport() {
  document.getElementById('file-input').click();
}

/**
 * 处理用户选择的导入文件（原 $fileInput change 监听器主体）。
 * @param {File|null} file
 * @param {object} [hooks]
 * @param {Function} [hooks.onBeforeImport] 校验通过、写入前回调（manager.js 置 ignoreAllOrderChanges=true）
 * @param {Function} [hooks.onAfterImport]  写入结束（finally）回调（manager.js 复位 ignoreAllOrderChanges=false）
 * @param {Function} [hooks.onImported]     导入成功后刷新列表的回调（manager.js 调 loadFirstPage）
 */
async function handleImportFileChange(file, hooks = {}) {
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.schemaVersion || !Array.isArray(data.snippets)) {
      showToast('文件格式不正确', { kind: 'danger' });
      return;
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      showToast(
        `文件版本 (v${data.schemaVersion}) 高于当前支持版本 (v${SCHEMA_VERSION})`,
        { kind: 'danger' }
      );
      return;
    }

    if (hooks.onBeforeImport) hooks.onBeforeImport();
    try {
      const result = await importSnippets(data.snippets);
      if (hooks.onImported) await hooks.onImported();
      showToast(
        `导入了 ${result.imported} 条，跳过 ${result.skipped} 条`,
        { kind: result.imported > 0 ? 'success' : 'info' }
      );
    } finally {
      if (hooks.onAfterImport) hooks.onAfterImport();
    }
  } catch (err) {
    showToast('导入失败：文件解析错误', { kind: 'danger' });
  } finally {
    document.getElementById('file-input').value = '';
  }
}
