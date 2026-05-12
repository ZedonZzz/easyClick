// ==UserScript==
// @name         多快捷键点击
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  支持多个 XPath 点击任务、分组快捷粘贴、多个执行 JS 任务，可视化配置快捷键
// @author       助手
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const LOG_PREFIX = '[TM多快捷键]';
    const STORAGE_KEY = '__tm_multi_shortcut_config_v4__';

    const defaultConfig = {
        clickTasks: [
            {
                id: createId(),
                name: '点击目标按钮',
                enabled: true,
                shortcut: 'F4',
                xpaths: `//*[@id="conbination-wrap"]/div/div/div/div/div/div/div[5]/div/div[1]/div/div[2]/a`,
                delay: 80
            }
        ],
        pasteShortcut: 'Ctrl+Shift+V',
        pasteCurrentGroupId: 'default_paste_group',
        pasteGroups: [
            {
                id: 'default_paste_group',
                name: '默认分组',
                items: [
                    {
                        id: createId(),
                        name: '快速粘贴文本',
                        enabled: true,
                        text: '这里填写要快速复制粘贴的内容'
                    }
                ]
            }
        ],
        jsTasks: [
            {
                id: createId(),
                name: '执行自定义 JS',
                enabled: true,
                shortcut: 'F8',
                code: `console.log('自定义 JS 已执行', location.href);`
            }
        ]
    };

    let config = loadConfig();
    let panelVisible = false;
    let uiMounted = false;
    let toastTimer = null;
    let lastMousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let pasteMenuVisible = false;
    let pasteTargetElement = null;

    console.warn(`${LOG_PREFIX} 脚本入口已执行`, new Date().toLocaleString(), location.href);

    document.addEventListener(
        'mousemove',
        (e) => {
            lastMousePosition = { x: e.clientX, y: e.clientY };
        },
        true
    );

    document.addEventListener(
        'mousedown',
        (e) => {
            if (isInsidePasteMenu(e.target)) {
                e.preventDefault();
                return;
            }

            if (pasteMenuVisible) {
                closePasteMenu();
            }
        },
        true
    );

    document.addEventListener(
        'keydown',
        async (e) => {
            if (e.repeat) return;

            if (e.key === 'Escape' && pasteMenuVisible) {
                closePasteMenu();
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const target = e.target;

            if (isInsidePanel(target)) return;

            const shortcut = normalizeShortcut(e);
            if (!shortcut) return;

            const matchedClickTasks = config.clickTasks.filter((task) => {
                return task.enabled && isShortcutEqual(shortcut, task.shortcut);
            });

            const matchedPasteShortcut = isShortcutEqual(shortcut, config.pasteShortcut);

            const matchedJsTasks = config.jsTasks.filter((task) => {
                return task.enabled && isShortcutEqual(shortcut, task.shortcut);
            });

            if (!matchedClickTasks.length && !matchedPasteShortcut && !matchedJsTasks.length) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            console.log(`${LOG_PREFIX} 命中快捷键：`, shortcut);

            for (const task of matchedClickTasks) {
                await runClickTask(task);
            }

            if (matchedPasteShortcut) {
                showPasteMenuAtMouse();
            }

            for (const task of matchedJsTasks) {
                await runJsTask(task);
            }
        },
        true
    );

    function loadConfig() {
        try {
            const saved = GM_getValue(STORAGE_KEY, null);
            if (!saved) return structuredCloneSafe(defaultConfig);

            const parsed = JSON.parse(saved);
            return migrateConfig(parsed);
        } catch (err) {
            console.warn(`${LOG_PREFIX} 配置读取失败，使用默认配置`, err);
            return structuredCloneSafe(defaultConfig);
        }
    }

    function migrateConfig(savedConfig) {
        savedConfig = savedConfig && typeof savedConfig === 'object' ? savedConfig : {};

        const nextConfig = {
            clickTasks: Array.isArray(savedConfig.clickTasks) ? savedConfig.clickTasks : structuredCloneSafe(defaultConfig.clickTasks),
            pasteShortcut: String(savedConfig.pasteShortcut || '').trim() || defaultConfig.pasteShortcut,
            pasteCurrentGroupId: savedConfig.pasteCurrentGroupId || defaultConfig.pasteCurrentGroupId,
            pasteGroups: Array.isArray(savedConfig.pasteGroups) ? savedConfig.pasteGroups : [],
            jsTasks: Array.isArray(savedConfig.jsTasks) ? savedConfig.jsTasks : structuredCloneSafe(defaultConfig.jsTasks)
        };

        if (!nextConfig.pasteGroups.length && Array.isArray(savedConfig.pasteTasks)) {
            const firstShortcutTask = savedConfig.pasteTasks.find((task) => String(task.shortcut || '').trim());
            nextConfig.pasteShortcut = firstShortcutTask ? firstShortcutTask.shortcut : defaultConfig.pasteShortcut;
            nextConfig.pasteCurrentGroupId = defaultConfig.pasteCurrentGroupId;
            nextConfig.pasteGroups = [
                {
                    id: defaultConfig.pasteCurrentGroupId,
                    name: '默认分组',
                    items: savedConfig.pasteTasks.map((task, index) => ({
                        id: task.id || createId(),
                        name: task.name || `粘贴文本 ${index + 1}`,
                        enabled: task.enabled !== false,
                        text: task.text || ''
                    }))
                }
            ];
        }

        if (!nextConfig.pasteGroups.length) {
            nextConfig.pasteGroups = structuredCloneSafe(defaultConfig.pasteGroups);
        }

        nextConfig.pasteGroups = nextConfig.pasteGroups.map((group, groupIndex) => ({
            id: group.id || createId(),
            name: group.name || `分组 ${groupIndex + 1}`,
            items: Array.isArray(group.items)
                ? group.items.map((item, itemIndex) => ({
                    id: item.id || createId(),
                    name: item.name || `粘贴文本 ${itemIndex + 1}`,
                    enabled: item.enabled !== false,
                    text: item.text || ''
                }))
                : []
        }));

        if (!nextConfig.pasteGroups.some((group) => group.id === nextConfig.pasteCurrentGroupId)) {
            nextConfig.pasteCurrentGroupId = nextConfig.pasteGroups[0].id;
        }

        return nextConfig;
    }

    function saveConfig() {
        GM_setValue(STORAGE_KEY, JSON.stringify(config));
        console.log(`${LOG_PREFIX} 配置已保存：`, config);
    }

    function exportConfig() {
        collectConfigFromPanel();
        saveConfig();

        const payload = {
            name: 'tm-multi-shortcut-config',
            version: '4.1',
            exportedAt: new Date().toISOString(),
            config
        };

        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const dateText = new Date().toISOString().slice(0, 10);
        const link = document.createElement('a');

        link.href = url;
        link.download = `tm-multi-shortcut-config-${dateText}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('配置已导出');
    }

    function importConfigFromFile(file) {
        if (!file) return;

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const payload = JSON.parse(String(reader.result || '{}'));
                const importedConfig = payload && payload.config ? payload.config : payload;
                const nextConfig = migrateConfig(importedConfig);
                const ok = confirm('导入配置会覆盖当前全部配置，确定继续吗？');

                if (!ok) return;

                config = nextConfig;
                saveConfig();
                renderPanel();
                closePasteMenu();
                toast('配置已导入');
            } catch (err) {
                console.error(`${LOG_PREFIX} 配置导入失败：`, err);
                toast(`配置导入失败：${err.message}`);
            }
        };

        reader.onerror = () => {
            toast('配置文件读取失败');
        };

        reader.readAsText(file, 'utf-8');
    }

    function structuredCloneSafe(obj) {
        try {
            return structuredClone(obj);
        } catch (_) {
            return JSON.parse(JSON.stringify(obj));
        }
    }

    function createId() {
        return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function normalizeShortcut(e) {
        const keys = [];

        if (e.ctrlKey) keys.push('Ctrl');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
        if (e.metaKey) keys.push('Meta');

        let key = e.key;

        if (key === ' ') key = 'Space';
        if (key === 'Escape') key = 'Esc';

        if (
            key &&
            key !== 'Control' &&
            key !== 'Shift' &&
            key !== 'Alt' &&
            key !== 'Meta'
        ) {
            if (key.length === 1) key = key.toUpperCase();
            if (/^F\d+$/i.test(key)) key = key.toUpperCase();

            keys.push(key);
        }

        const result = keys.join('+');

        if (['Ctrl', 'Shift', 'Alt', 'Meta'].includes(result)) {
            return '';
        }

        return result;
    }

    function isShortcutEqual(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    function getElementByXPath(xpath) {
        try {
            return document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
        } catch (err) {
            console.warn(`${LOG_PREFIX} XPath 解析失败：`, xpath, err);
            return null;
        }
    }

    function getXPathLines(text) {
        return String(text || '')
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function runClickTask(task) {
        const xpaths = getXPathLines(task.xpaths);
        const delayMs = Number(task.delay || 0);

        if (!xpaths.length) {
            toast(`点击任务「${task.name}」没有 XPath`);
            return;
        }

        console.log(`${LOG_PREFIX} 执行点击任务：`, task.name, xpaths);

        let successCount = 0;

        for (const xpath of xpaths) {
            const el = getElementByXPath(xpath);

            if (!el) {
                console.warn(`${LOG_PREFIX} 未找到元素：`, xpath);
                continue;
            }

            try {
                el.click();
                successCount++;
                console.log(`${LOG_PREFIX} 已点击元素：`, el);

                if (delayMs > 0) {
                    await delay(delayMs);
                }
            } catch (err) {
                console.error(`${LOG_PREFIX} 点击失败：`, xpath, err);
            }
        }

        if (successCount > 0) {
            toast(`已执行点击任务：${task.name}，成功 ${successCount} 个`);
        } else {
            toast(`点击任务「${task.name}」未找到元素`);
        }
    }

    async function runPasteTask(task, targetElement = document.activeElement) {
        const text = String(task.text || '');

        if (!text) {
            toast(`粘贴任务「${task.name}」内容为空`);
            return;
        }

        console.log(`${LOG_PREFIX} 执行复制粘贴任务：`, task.name);

        await copyToClipboard(text);

        const active = targetElement || document.activeElement;
        const pasted = insertTextToActiveElement(active, text);

        if (pasted) {
            toast(`已粘贴：${task.name}`);
        } else {
            toast(`已复制，但当前焦点不可粘贴`);
            console.warn(`${LOG_PREFIX} 当前焦点不可粘贴：`, active);
        }
    }

    function getCurrentPasteGroup() {
        if (!Array.isArray(config.pasteGroups) || !config.pasteGroups.length) {
            config.pasteGroups = structuredCloneSafe(defaultConfig.pasteGroups);
            config.pasteCurrentGroupId = config.pasteGroups[0].id;
        }

        let group = config.pasteGroups.find((item) => item.id === config.pasteCurrentGroupId);

        if (!group) {
            group = config.pasteGroups[0];
            config.pasteCurrentGroupId = group.id;
        }

        if (!Array.isArray(group.items)) {
            group.items = [];
        }

        return group;
    }

    function getCurrentPasteItems() {
        const group = getCurrentPasteGroup();
        return (group.items || []).filter((item) => item.enabled !== false && String(item.text || '').length > 0);
    }

    function showPasteMenuAtMouse() {
        const items = getCurrentPasteItems();

        if (!items.length) {
            toast('当前粘贴分组没有可用文本');
            closePasteMenu();
            return;
        }

        pasteTargetElement = document.activeElement;

        const menu = document.querySelector('#tm-paste-select-menu');
        const group = getCurrentPasteGroup();

        if (!menu) return;

        menu.innerHTML = `
          <div class="tm-paste-menu-head">
            <span>${escapeHTML(group.name)}</span>
            <span>${items.length} 条</span>
          </div>
          <div class="tm-paste-menu-list">
            ${items.map(renderPasteMenuItem).join('')}
          </div>
        `;

        menu.style.display = 'block';
        menu.classList.add('show');
        pasteMenuVisible = true;

        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const margin = 10;
            const x = Math.min(Math.max(lastMousePosition.x, margin), window.innerWidth - rect.width - margin);
            const y = Math.min(Math.max(lastMousePosition.y, margin), window.innerHeight - rect.height - margin);

            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        });
    }

    function renderPasteMenuItem(item) {
        const preview = String(item.text || '').replace(/\s+/g, ' ').slice(0, 80);

        return `
          <button class="tm-paste-menu-item" type="button" data-action="select-paste" data-id="${escapeHTML(item.id)}">
            <span class="tm-paste-menu-name">${escapeHTML(item.name)}</span>
            <span class="tm-paste-menu-preview">${escapeHTML(preview)}</span>
          </button>
        `;
    }

    function closePasteMenu() {
        const menu = document.querySelector('#tm-paste-select-menu');
        if (menu) {
            menu.classList.remove('show');
            menu.style.display = 'none';
        }

        pasteMenuVisible = false;
        pasteTargetElement = null;
    }

    async function runJsTask(task) {
        const code = String(task.code || '').trim();

        if (!code) {
            toast(`JS任务「${task.name}」代码为空`);
            return;
        }

        console.log(`${LOG_PREFIX} 执行 JS 任务：`, task.name);

        try {
            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

            const fn = new AsyncFunction(
                'task',
                'config',
                'toast',
                'delay',
                'LOG_PREFIX',
                `
          "use strict";
          ${code}
        `
            );

            await fn(task, config, toast, delay, LOG_PREFIX);

            toast(`已执行 JS：${task.name}`);
        } catch (err) {
            console.error(`${LOG_PREFIX} JS 执行失败：`, task.name, err);
            toast(`JS执行失败：${err.message}`);
        }
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn(`${LOG_PREFIX} Clipboard API 失败，尝试降级复制`, err);

            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            textarea.style.opacity = '0';

            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            let ok = false;

            try {
                ok = document.execCommand('copy');
            } catch (_) { }

            textarea.remove();

            return ok;
        }
    }

    function insertTextToActiveElement(el, text) {
        if (!el) return false;

        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        if (tag === 'input' || tag === 'textarea') {
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;

            const before = el.value.slice(0, start);
            const after = el.value.slice(end);

            el.value = before + text + after;

            const nextPos = start + text.length;
            el.selectionStart = nextPos;
            el.selectionEnd = nextPos;

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            return true;
        }

        if (el.isContentEditable) {
            el.focus();

            const selection = window.getSelection();

            if (!selection || selection.rangeCount === 0) {
                el.textContent += text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }

            const range = selection.getRangeAt(0);
            range.deleteContents();

            const textNode = document.createTextNode(text);
            range.insertNode(textNode);

            range.setStartAfter(textNode);
            range.setEndAfter(textNode);

            selection.removeAllRanges();
            selection.addRange(range);

            el.dispatchEvent(new Event('input', { bubbles: true }));

            return true;
        }

        return false;
    }

    function isInsidePanel(target) {
        if (!target || !target.closest) return false;
        return Boolean(target.closest('#tm-multi-shortcut-root'));
    }

    function isInsidePasteMenu(target) {
        if (!target || !target.closest) return false;
        return Boolean(target.closest('#tm-paste-select-menu'));
    }

    function boot() {
        if (uiMounted) return;

        if (document.body) {
            mountUI();
            return;
        }

        const timer = setInterval(() => {
            if (document.body) {
                clearInterval(timer);
                mountUI();
            }
        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
        setTimeout(boot, 1000);
    } else {
        boot();
    }

    function mountUI() {
        if (uiMounted) return;
        uiMounted = true;

        const style = document.createElement('style');
        style.textContent = `
      #tm-multi-shortcut-root,
      #tm-multi-shortcut-root * {
        box-sizing: border-box !important;
      }

      #tm-multi-shortcut-btn {
        position: fixed !important;
        right: 20px !important;
        top: 45% !important;
        z-index: 2147483647 !important;
        width: 54px !important;
        height: 54px !important;
        border-radius: 50% !important;
        border: none !important;
        background: linear-gradient(135deg, #111827, #2563eb) !important;
        color: #fff !important;
        font-size: 15px !important;
        font-weight: 800 !important;
        cursor: pointer !important;
        box-shadow: 0 12px 32px rgba(0,0,0,.3) !important;
        font-family: Arial, "Microsoft YaHei", sans-serif !important;
      }

      #tm-multi-shortcut-btn:hover {
        transform: scale(1.08) !important;
      }

      #tm-multi-shortcut-panel {
        position: fixed !important;
        right: 86px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        z-index: 2147483647 !important;
        width: 560px !important;
        max-height: 82vh !important;
        overflow: auto !important;
        display: none !important;
        border-radius: 18px !important;
        background: rgba(255,255,255,.98) !important;
        color: #111827 !important;
        box-shadow: 0 18px 60px rgba(0,0,0,.3) !important;
        border: 1px solid rgba(0,0,0,.08) !important;
        padding: 16px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif !important;
      }

      #tm-multi-shortcut-panel.show {
        display: block !important;
      }

      .tm-ms-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        margin-bottom: 12px !important;
      }

      .tm-ms-title {
        font-size: 18px !important;
        font-weight: 800 !important;
      }

      .tm-ms-subtitle {
        font-size: 12px !important;
        color: #6b7280 !important;
        margin-top: 4px !important;
      }

      .tm-ms-section {
        border: 1px solid #e5e7eb !important;
        border-radius: 14px !important;
        padding: 12px !important;
        margin-top: 12px !important;
        background: #f9fafb !important;
      }

      .tm-ms-section-title {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        font-size: 15px !important;
        font-weight: 800 !important;
        margin-bottom: 10px !important;
      }

      .tm-ms-task {
        border: 1px solid #e5e7eb !important;
        border-radius: 12px !important;
        padding: 12px !important;
        margin-bottom: 10px !important;
        background: #fff !important;
      }

      .tm-ms-task:last-child {
        margin-bottom: 0 !important;
      }

      .tm-ms-grid {
        display: grid !important;
        grid-template-columns: 1fr 160px !important;
        gap: 10px !important;
      }

      .tm-ms-field {
        margin-bottom: 10px !important;
      }

      .tm-ms-field label {
        display: block !important;
        font-size: 12px !important;
        color: #374151 !important;
        margin-bottom: 5px !important;
      }

      .tm-ms-field input,
      .tm-ms-field select,
      .tm-ms-field textarea {
        width: 100% !important;
        border: 1px solid #d1d5db !important;
        border-radius: 10px !important;
        padding: 8px 10px !important;
        font-size: 13px !important;
        color: #111827 !important;
        background: #fff !important;
        outline: none !important;
        font-family: inherit !important;
      }

      .tm-ms-field textarea {
        min-height: 70px !important;
        resize: vertical !important;
        line-height: 1.5 !important;
      }

      .tm-ms-code {
        min-height: 140px !important;
        font-family: Consolas, Monaco, "Courier New", monospace !important;
        line-height: 1.6 !important;
      }

      .tm-ms-field input:focus,
      .tm-ms-field select:focus,
      .tm-ms-field textarea:focus {
        border-color: #2563eb !important;
        box-shadow: 0 0 0 3px rgba(37,99,235,.12) !important;
      }

      .tm-ms-shortcut {
        cursor: pointer !important;
        background: #f3f4f6 !important;
        font-weight: 700 !important;
      }

      .tm-ms-row {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
      }

      .tm-ms-paste-toolbar {
        display: grid !important;
        grid-template-columns: 1fr 170px !important;
        gap: 10px !important;
        align-items: end !important;
      }

      .tm-ms-check {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        font-size: 12px !important;
        color: #374151 !important;
      }

      .tm-ms-check input {
        width: auto !important;
      }

      .tm-ms-btn {
        border: none !important;
        border-radius: 10px !important;
        padding: 8px 10px !important;
        font-size: 12px !important;
        cursor: pointer !important;
        background: #e5e7eb !important;
        color: #111827 !important;
        font-family: inherit !important;
      }

      .tm-ms-btn:hover {
        opacity: .9 !important;
        transform: translateY(-1px) !important;
      }

      .tm-ms-btn-primary {
        background: #111827 !important;
        color: #fff !important;
      }

      .tm-ms-btn-blue {
        background: #2563eb !important;
        color: #fff !important;
      }

      .tm-ms-btn-red {
        background: #fee2e2 !important;
        color: #b91c1c !important;
      }

      .tm-ms-footer {
        display: flex !important;
        gap: 8px !important;
        margin-top: 14px !important;
      }

      .tm-ms-footer .tm-ms-btn {
        flex: 1 !important;
        padding: 10px 12px !important;
        font-size: 13px !important;
      }

      #tm-multi-shortcut-toast {
        position: fixed !important;
        right: 20px !important;
        bottom: 30px !important;
        z-index: 2147483647 !important;
        background: rgba(17,24,39,.94) !important;
        color: white !important;
        padding: 10px 14px !important;
        border-radius: 999px !important;
        font-size: 13px !important;
        box-shadow: 0 10px 30px rgba(0,0,0,.25) !important;
        opacity: 0 !important;
        transform: translateY(12px) !important;
        pointer-events: none !important;
        transition: all .25s ease !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif !important;
      }

      #tm-multi-shortcut-toast.show {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }

      #tm-paste-select-menu {
        position: fixed !important;
        z-index: 2147483647 !important;
        display: none !important;
        width: 280px !important;
        max-height: 360px !important;
        overflow: hidden !important;
        border: 1px solid rgba(17,24,39,.12) !important;
        border-radius: 14px !important;
        background: rgba(255,255,255,.98) !important;
        color: #111827 !important;
        box-shadow: 0 18px 60px rgba(0,0,0,.28) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif !important;
      }

      #tm-paste-select-menu.show {
        display: block !important;
      }

      .tm-paste-menu-head {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        padding: 10px 12px !important;
        border-bottom: 1px solid #e5e7eb !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        color: #374151 !important;
      }

      .tm-paste-menu-list {
        max-height: 310px !important;
        overflow: auto !important;
        padding: 6px !important;
      }

      .tm-paste-menu-item {
        display: block !important;
        width: 100% !important;
        border: none !important;
        border-radius: 10px !important;
        padding: 9px 10px !important;
        background: transparent !important;
        color: #111827 !important;
        text-align: left !important;
        cursor: pointer !important;
        font-family: inherit !important;
      }

      .tm-paste-menu-item:hover {
        background: #eff6ff !important;
      }

      .tm-paste-menu-name {
        display: block !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        line-height: 1.35 !important;
      }

      .tm-paste-menu-preview {
        display: block !important;
        margin-top: 3px !important;
        font-size: 12px !important;
        color: #6b7280 !important;
        line-height: 1.35 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
    `;

        const root = document.createElement('div');
        root.id = 'tm-multi-shortcut-root';

        root.innerHTML = `
      <button id="tm-multi-shortcut-btn" title="快捷键配置">TM</button>

      <div id="tm-paste-select-menu"></div>

      <div id="tm-multi-shortcut-panel">
        <div class="tm-ms-header">
          <div>
            <div class="tm-ms-title">快捷键任务配置</div>
            <div class="tm-ms-subtitle">支持点击、分组快捷粘贴、执行 JS</div>
          </div>
          <button class="tm-ms-btn" data-action="close">关闭</button>
        </div>

        <div class="tm-ms-section">
          <div class="tm-ms-section-title">
            <span>点击任务</span>
            <button class="tm-ms-btn tm-ms-btn-blue" data-action="add-click">新增点击任务</button>
          </div>
          <div id="tm-click-task-list"></div>
        </div>

        <div class="tm-ms-section">
          <div class="tm-ms-section-title">
            <span>快捷粘贴</span>
            <button class="tm-ms-btn tm-ms-btn-blue" data-action="add-paste">新增文本</button>
          </div>
          <div id="tm-paste-group-controls"></div>
          <div id="tm-paste-task-list"></div>
        </div>

        <div class="tm-ms-section">
          <div class="tm-ms-section-title">
            <span>执行 JS 任务</span>
            <button class="tm-ms-btn tm-ms-btn-blue" data-action="add-js">新增 JS 任务</button>
          </div>
          <div id="tm-js-task-list"></div>
        </div>

        <div class="tm-ms-footer">
          <button class="tm-ms-btn tm-ms-btn-primary" data-action="save">保存全部配置</button>
          <button class="tm-ms-btn" data-action="export-config">导出配置</button>
          <button class="tm-ms-btn" data-action="import-config">导入配置</button>
          <button class="tm-ms-btn" data-action="reset">恢复默认</button>
        </div>
      </div>

      <input id="tm-config-import-input" type="file" accept="application/json,.json" style="display:none !important;" />
    `;

        const toastEl = document.createElement('div');
        toastEl.id = 'tm-multi-shortcut-toast';

        document.documentElement.appendChild(style);
        document.body.appendChild(root);
        document.body.appendChild(toastEl);

        bindUI(root);
        renderPanel();

        toast('多快捷键脚本已运行');
        console.log(`${LOG_PREFIX} UI 已挂载`);
    }

    function bindUI(root) {
        const btn = root.querySelector('#tm-multi-shortcut-btn');
        const panel = root.querySelector('#tm-multi-shortcut-panel');

        btn.addEventListener('click', () => {
            panelVisible = !panelVisible;
            panel.classList.toggle('show', panelVisible);

            if (panelVisible) {
                renderPanel();
            }
        });

        root.addEventListener('click', async (e) => {
            const actionTarget = e.target.closest('[data-action]');
            const action = actionTarget ? actionTarget.dataset.action : '';
            const id = actionTarget ? actionTarget.dataset.id : '';

            if (!action) return;

            if (action === 'select-paste') {
                const task = getCurrentPasteItems().find((item) => item.id === id);
                const targetElement = pasteTargetElement;
                closePasteMenu();

                if (task) {
                    await runPasteTask(task, targetElement);
                }

                return;
            }

            if (action === 'close') {
                panelVisible = false;
                panel.classList.remove('show');
                return;
            }

            if (action === 'add-click') {
                collectConfigFromPanel();

                config.clickTasks.push({
                    id: createId(),
                    name: `点击任务 ${config.clickTasks.length + 1}`,
                    enabled: true,
                    shortcut: '',
                    xpaths: '',
                    delay: 80
                });

                saveConfig();
                renderPanel();
                return;
            }

            if (action === 'add-paste') {
                collectConfigFromPanel();
                const group = getCurrentPasteGroup();

                group.items.push({
                    id: createId(),
                    name: `粘贴文本 ${group.items.length + 1}`,
                    enabled: true,
                    text: ''
                });

                saveConfig();
                renderPanel();
                return;
            }

            if (action === 'add-paste-group') {
                collectConfigFromPanel();

                const group = {
                    id: createId(),
                    name: `分组 ${config.pasteGroups.length + 1}`,
                    items: []
                };

                config.pasteGroups.push(group);
                config.pasteCurrentGroupId = group.id;

                saveConfig();
                renderPanel();
                toast('已新增粘贴分组');
                return;
            }

            if (action === 'delete-paste-group') {
                collectConfigFromPanel();

                if (config.pasteGroups.length <= 1) {
                    toast('至少保留一个粘贴分组');
                    return;
                }

                const group = getCurrentPasteGroup();
                const ok = confirm(`确定删除粘贴分组「${group.name}」吗？`);
                if (!ok) return;

                config.pasteGroups = config.pasteGroups.filter((item) => item.id !== group.id);
                config.pasteCurrentGroupId = config.pasteGroups[0].id;

                saveConfig();
                renderPanel();
                toast('已删除粘贴分组');
                return;
            }

            if (action === 'add-js') {
                collectConfigFromPanel();

                config.jsTasks.push({
                    id: createId(),
                    name: `JS任务 ${config.jsTasks.length + 1}`,
                    enabled: true,
                    shortcut: '',
                    code: `console.log('JS任务执行', location.href);`
                });

                saveConfig();
                renderPanel();
                return;
            }

            if (action === 'delete-click') {
                collectConfigFromPanel();
                config.clickTasks = config.clickTasks.filter((task) => task.id !== id);
                saveConfig();
                renderPanel();
                toast('已删除点击任务');
                return;
            }

            if (action === 'delete-paste') {
                collectConfigFromPanel();
                const group = getCurrentPasteGroup();
                group.items = group.items.filter((task) => task.id !== id);
                saveConfig();
                renderPanel();
                toast('已删除粘贴任务');
                return;
            }

            if (action === 'delete-js') {
                collectConfigFromPanel();
                config.jsTasks = config.jsTasks.filter((task) => task.id !== id);
                saveConfig();
                renderPanel();
                toast('已删除 JS 任务');
                return;
            }

            if (action === 'test-click') {
                collectConfigFromPanel();
                saveConfig();

                const task = config.clickTasks.find((item) => item.id === id);
                if (task) {
                    await runClickTask(task);
                }

                return;
            }

            if (action === 'test-paste') {
                collectConfigFromPanel();
                saveConfig();

                const task = getCurrentPasteGroup().items.find((item) => item.id === id);
                if (task) {
                    await runPasteTask(task);
                }

                return;
            }

            if (action === 'test-js') {
                collectConfigFromPanel();
                saveConfig();

                const task = config.jsTasks.find((item) => item.id === id);
                if (task) {
                    await runJsTask(task);
                }

                return;
            }

            if (action === 'save') {
                collectConfigFromPanel();
                saveConfig();
                toast('配置已保存');
                return;
            }

            if (action === 'export-config') {
                exportConfig();
                return;
            }

            if (action === 'import-config') {
                const input = root.querySelector('#tm-config-import-input');
                if (input) {
                    input.value = '';
                    input.click();
                }
                return;
            }

            if (action === 'reset') {
                const ok = confirm('确定恢复默认配置吗？当前所有任务会被覆盖。');
                if (!ok) return;

                config = structuredCloneSafe(defaultConfig);
                saveConfig();
                renderPanel();
                toast('已恢复默认');
            }
        });

        root.addEventListener('change', (e) => {
            const field = e.target.dataset.field;

            if (e.target.id === 'tm-config-import-input') {
                importConfigFromFile(e.target.files && e.target.files[0]);
                e.target.value = '';
                return;
            }

            if (field !== 'paste-current-group') return;

            collectConfigFromPanel();
            config.pasteCurrentGroupId = e.target.value;
            saveConfig();
            renderPanel();
        });
    }

    function renderPanel() {
        const clickList = document.querySelector('#tm-click-task-list');
        const pasteGroupControls = document.querySelector('#tm-paste-group-controls');
        const pasteList = document.querySelector('#tm-paste-task-list');
        const jsList = document.querySelector('#tm-js-task-list');

        if (!clickList || !pasteGroupControls || !pasteList || !jsList) return;

        clickList.innerHTML = config.clickTasks.map(renderClickTask).join('');
        pasteGroupControls.innerHTML = renderPasteGroupControls();
        pasteList.innerHTML = getCurrentPasteGroup().items.map(renderPasteTask).join('');
        jsList.innerHTML = config.jsTasks.map(renderJsTask).join('');

        bindShortcutRecorders();
    }

    function renderClickTask(task) {
        return `
      <div class="tm-ms-task" data-click-task-id="${escapeHTML(task.id)}">
        <div class="tm-ms-grid">
          <div class="tm-ms-field">
            <label>任务名称</label>
            <input data-field="click-name" data-id="${escapeHTML(task.id)}" value="${escapeHTML(task.name)}" />
          </div>

          <div class="tm-ms-field">
            <label>快捷键</label>
            <input
              class="tm-ms-shortcut"
              readonly
              placeholder="点击后按快捷键"
              data-shortcut-type="click"
              data-id="${escapeHTML(task.id)}"
              value="${escapeHTML(task.shortcut)}"
            />
          </div>
        </div>

        <div class="tm-ms-field">
          <label>XPath 列表，一行一个。一个任务里可以写多个 XPath，会依次点击。</label>
          <textarea data-field="click-xpaths" data-id="${escapeHTML(task.id)}">${escapeHTML(task.xpaths)}</textarea>
        </div>

        <div class="tm-ms-row">
          <label class="tm-ms-check">
            <input type="checkbox" data-field="click-enabled" data-id="${escapeHTML(task.id)}" ${task.enabled ? 'checked' : ''} />
            启用
          </label>

          <label class="tm-ms-check">
            点击间隔
            <input
              style="width:70px !important;padding:5px 7px !important;"
              type="number"
              min="0"
              data-field="click-delay"
              data-id="${escapeHTML(task.id)}"
              value="${Number(task.delay || 0)}"
            />
            ms
          </label>

          <button class="tm-ms-btn" data-action="test-click" data-id="${escapeHTML(task.id)}">测试点击</button>
          <button class="tm-ms-btn tm-ms-btn-red" data-action="delete-click" data-id="${escapeHTML(task.id)}">删除</button>
        </div>
      </div>
    `;
    }

    function renderPasteGroupControls() {
        const group = getCurrentPasteGroup();
        const groupOptions = config.pasteGroups.map((item) => {
            const selected = item.id === config.pasteCurrentGroupId ? 'selected' : '';
            return `<option value="${escapeHTML(item.id)}" ${selected}>${escapeHTML(item.name)}</option>`;
        }).join('');

        return `
      <div class="tm-ms-task">
        <div class="tm-ms-paste-toolbar">
          <div class="tm-ms-field">
            <label>当前使用分组</label>
            <select data-field="paste-current-group">${groupOptions}</select>
          </div>

          <div class="tm-ms-field">
            <label>统一快捷键</label>
            <input
              class="tm-ms-shortcut"
              readonly
              placeholder="点击后按快捷键"
              data-shortcut-type="paste"
              value="${escapeHTML(config.pasteShortcut)}"
            />
          </div>
        </div>

        <div class="tm-ms-grid">
          <div class="tm-ms-field">
            <label>分组名称</label>
            <input data-field="paste-group-name" data-id="${escapeHTML(group.id)}" value="${escapeHTML(group.name)}" />
          </div>

          <div class="tm-ms-field">
            <label>分组操作</label>
            <div class="tm-ms-row">
              <button class="tm-ms-btn" data-action="add-paste-group">新增分组</button>
              <button class="tm-ms-btn tm-ms-btn-red" data-action="delete-paste-group">删除分组</button>
            </div>
          </div>
        </div>
      </div>
    `;
    }

    function renderPasteTask(task) {
        return `
      <div class="tm-ms-task" data-paste-task-id="${escapeHTML(task.id)}">
        <div class="tm-ms-field">
          <label>文本名称</label>
          <input data-field="paste-name" data-id="${escapeHTML(task.id)}" value="${escapeHTML(task.name)}" />
        </div>

        <div class="tm-ms-field">
          <label>要复制并粘贴的内容</label>
          <textarea data-field="paste-text" data-id="${escapeHTML(task.id)}">${escapeHTML(task.text)}</textarea>
        </div>

        <div class="tm-ms-row">
          <label class="tm-ms-check">
            <input type="checkbox" data-field="paste-enabled" data-id="${escapeHTML(task.id)}" ${task.enabled ? 'checked' : ''} />
            启用
          </label>

          <button class="tm-ms-btn" data-action="test-paste" data-id="${escapeHTML(task.id)}">测试粘贴</button>
          <button class="tm-ms-btn tm-ms-btn-red" data-action="delete-paste" data-id="${escapeHTML(task.id)}">删除</button>
        </div>
      </div>
    `;
    }

    function renderJsTask(task) {
        return `
      <div class="tm-ms-task" data-js-task-id="${escapeHTML(task.id)}">
        <div class="tm-ms-grid">
          <div class="tm-ms-field">
            <label>任务名称</label>
            <input data-field="js-name" data-id="${escapeHTML(task.id)}" value="${escapeHTML(task.name)}" />
          </div>

          <div class="tm-ms-field">
            <label>快捷键</label>
            <input
              class="tm-ms-shortcut"
              readonly
              placeholder="点击后按快捷键"
              data-shortcut-type="js"
              data-id="${escapeHTML(task.id)}"
              value="${escapeHTML(task.shortcut)}"
            />
          </div>
        </div>

        <div class="tm-ms-field">
          <label>要执行的 JavaScript 代码，支持 await delay(500)、toast('提示')</label>
          <textarea
            class="tm-ms-code"
            data-field="js-code"
            data-id="${escapeHTML(task.id)}">${escapeHTML(task.code)}</textarea>
        </div>

        <div class="tm-ms-row">
          <label class="tm-ms-check">
            <input type="checkbox" data-field="js-enabled" data-id="${escapeHTML(task.id)}" ${task.enabled ? 'checked' : ''} />
            启用
          </label>

          <button class="tm-ms-btn" data-action="test-js" data-id="${escapeHTML(task.id)}">测试执行</button>
          <button class="tm-ms-btn tm-ms-btn-red" data-action="delete-js" data-id="${escapeHTML(task.id)}">删除</button>
        </div>
      </div>
    `;
    }

    function bindShortcutRecorders() {
        const inputs = document.querySelectorAll('#tm-multi-shortcut-panel [data-shortcut-type]');

        inputs.forEach((input) => {
            input.addEventListener('keydown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const shortcut = normalizeShortcut(e);
                if (!shortcut) return;

                input.value = shortcut;

                const id = input.dataset.id;
                const type = input.dataset.shortcutType;

                if (type === 'click') {
                    const task = config.clickTasks.find((item) => item.id === id);
                    if (task) task.shortcut = shortcut;
                }

                if (type === 'paste') {
                    config.pasteShortcut = shortcut;
                }

                if (type === 'js') {
                    const task = config.jsTasks.find((item) => item.id === id);
                    if (task) task.shortcut = shortcut;
                }

                collectConfigFromPanel();
                saveConfig();

                toast(`快捷键已设置：${shortcut}`);
            });

            input.addEventListener('focus', () => {
                input.placeholder = '请直接按快捷键';
            });
        });
    }

    function collectConfigFromPanel() {
        const panel = document.querySelector('#tm-multi-shortcut-panel');
        if (!panel) return;

        config.clickTasks = config.clickTasks.map((task) => {
            const nameInput = panel.querySelector(`[data-field="click-name"][data-id="${cssEscape(task.id)}"]`);
            const shortcutInput = panel.querySelector(`[data-shortcut-type="click"][data-id="${cssEscape(task.id)}"]`);
            const xpathsInput = panel.querySelector(`[data-field="click-xpaths"][data-id="${cssEscape(task.id)}"]`);
            const enabledInput = panel.querySelector(`[data-field="click-enabled"][data-id="${cssEscape(task.id)}"]`);
            const delayInput = panel.querySelector(`[data-field="click-delay"][data-id="${cssEscape(task.id)}"]`);

            return {
                ...task,
                name: nameInput ? nameInput.value.trim() || '未命名点击任务' : task.name,
                shortcut: shortcutInput ? shortcutInput.value.trim() : task.shortcut,
                xpaths: xpathsInput ? xpathsInput.value : task.xpaths,
                enabled: enabledInput ? enabledInput.checked : task.enabled,
                delay: delayInput ? Math.max(0, Number(delayInput.value || 0)) : Number(task.delay || 0)
            };
        });

        const pasteShortcutInput = panel.querySelector('[data-shortcut-type="paste"]');
        const pasteGroupSelect = panel.querySelector('[data-field="paste-current-group"]');

        config.pasteShortcut = pasteShortcutInput ? pasteShortcutInput.value.trim() : config.pasteShortcut;
        config.pasteCurrentGroupId = pasteGroupSelect ? pasteGroupSelect.value : config.pasteCurrentGroupId;

        config.pasteGroups = config.pasteGroups.map((group) => {
            const groupNameInput = panel.querySelector(`[data-field="paste-group-name"][data-id="${cssEscape(group.id)}"]`);

            return {
                ...group,
                name: groupNameInput ? groupNameInput.value.trim() || '未命名分组' : group.name,
                items: (group.items || []).map((task) => {
                    const nameInput = panel.querySelector(`[data-field="paste-name"][data-id="${cssEscape(task.id)}"]`);
                    const textInput = panel.querySelector(`[data-field="paste-text"][data-id="${cssEscape(task.id)}"]`);
                    const enabledInput = panel.querySelector(`[data-field="paste-enabled"][data-id="${cssEscape(task.id)}"]`);

                    return {
                        ...task,
                        name: nameInput ? nameInput.value.trim() || '未命名粘贴文本' : task.name,
                        text: textInput ? textInput.value : task.text,
                        enabled: enabledInput ? enabledInput.checked : task.enabled
                    };
                })
            };
        });

        config.jsTasks = config.jsTasks.map((task) => {
            const nameInput = panel.querySelector(`[data-field="js-name"][data-id="${cssEscape(task.id)}"]`);
            const shortcutInput = panel.querySelector(`[data-shortcut-type="js"][data-id="${cssEscape(task.id)}"]`);
            const codeInput = panel.querySelector(`[data-field="js-code"][data-id="${cssEscape(task.id)}"]`);
            const enabledInput = panel.querySelector(`[data-field="js-enabled"][data-id="${cssEscape(task.id)}"]`);

            return {
                ...task,
                name: nameInput ? nameInput.value.trim() || '未命名 JS 任务' : task.name,
                shortcut: shortcutInput ? shortcutInput.value.trim() : task.shortcut,
                code: codeInput ? codeInput.value : task.code,
                enabled: enabledInput ? enabledInput.checked : task.enabled
            };
        });
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }

        return String(value).replace(/"/g, '\\"');
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function toast(msg) {
        const el = document.querySelector('#tm-multi-shortcut-toast');
        if (!el) return;

        el.textContent = msg;
        el.classList.add('show');

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            el.classList.remove('show');
        }, 1800);
    }
})();
