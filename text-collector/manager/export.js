/**
 * export.js — 管理页导出
 *
 * 从原 manager.js 拆分而来：
 *   handleExport L513-535 / downloadBlob L537-546。
 *
 * 状态约定：本文件不持有也不修改 manager.js 的任何全局状态，
 * 仅通过 getCurrentTab() 读取当前页签以决定导出范围。
 */

// ── 导出为 TXT（UTF-8 BOM）或 JSON ──
async function handleExport(format) {
  try {
    const filter = typeof getCurrentTab === 'function' ? getCurrentTab() : 'all';
    const records = await getAllSnippets(filter);
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = filter === 'saved' ? '_saved_' : '_';

    if (format === 'txt') {
      const texts = records.map(r => r.text);
      const content = texts.join('\n\n');
      const bom = '\uFEFF';
      const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `snippets${suffix}${dateStr}.txt`);
    } else if (format === 'json') {
      const data = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        count: records.length,
        snippets: records,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `snippets${suffix}${dateStr}.json`);
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
