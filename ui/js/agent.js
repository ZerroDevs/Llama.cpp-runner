/**
 * Llama Server Control - Autonomous Coding Agent Controller
 * Manages project workspace folders, tool calling, and live execution cards
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

export function initAgent() {
  // 1. Workspace selection buttons
  document.getElementById('btn-select-workspace')?.addEventListener('click', async () => {
    await selectWorkspaceFolder();
  });

  document.getElementById('btn-clear-workspace')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await clearWorkspaceFolder();
  });

  document.getElementById('btn-agent-refresh-workspace')?.addEventListener('click', async () => {
    await refreshWorkspaceFolder();
  });

  // 2. Agent Mode Toggle Pill
  document.getElementById('btn-toggle-agent-mode')?.addEventListener('click', () => {
    toggleAgentMode();
  });

  // 3. Restore persisted agent mode
  const savedAgentMode = localStorage.getItem('llama_agent_mode') === 'true';
  setAgentModeState(savedAgentMode, false);

  // 4. Probe initial workspace state
  refreshWorkspaceFolder();
}

export async function selectWorkspaceFolder() {
  try {
    const res = await api.invoke('agent_select_workspace');
    if (res && res.status === 'success') {
      state.activeWorkspace = res;
      updateWorkspaceUI(res);
      showToast('Workspace Opened', `Connected to project: ${res.folder_name}`, 'success', 2500);

      // Auto-enable Agent Mode if not already active
      if (!state.isAgentMode) {
        setAgentModeState(true, true);
      }
    } else if (res && res.status === 'error') {
      showToast('Workspace Error', res.message || 'Failed to open directory.', 'error');
    }
  } catch (err) {
    showToast('Folder Selection Failed', err.message, 'error');
  }
}

export async function clearWorkspaceFolder() {
  try {
    await api.invoke('agent_clear_workspace');
    state.activeWorkspace = null;
    updateWorkspaceUI(null);
    showToast('Workspace Disconnected', 'Project folder unlinked.', 'info', 1800);
  } catch {}
}

export async function refreshWorkspaceFolder() {
  try {
    const res = await api.invoke('agent_get_workspace');
    if (res && res.has_workspace) {
      state.activeWorkspace = res;
      updateWorkspaceUI(res);
    } else {
      state.activeWorkspace = null;
      updateWorkspaceUI(null);
    }
  } catch {}
}

export function updateWorkspaceUI(ws) {
  const labelFolder = document.getElementById('label-workspace-folder');
  const btnClear = document.getElementById('btn-clear-workspace');
  const banner = document.getElementById('agent-workspace-banner');
  const bannerName = document.getElementById('agent-banner-name');
  const bannerPath = document.getElementById('agent-banner-path');
  const bannerType = document.getElementById('agent-banner-type');
  const bannerFiles = document.getElementById('agent-banner-files');

  if (ws && (ws.has_workspace !== false)) {
    const folderName = ws.folder_name || (ws.workspace_path ? ws.workspace_path.split(/[\\/]/).pop() : 'Project');
    const fileCount = ws.file_count ?? (ws.files ? ws.files.length : 0);
    const pType = (ws.project_types && ws.project_types.length > 0) ? ws.project_types[0] : 'Workspace';

    if (labelFolder) labelFolder.textContent = folderName;
    if (btnClear) btnClear.classList.remove('hidden');

    if (banner) {
      banner.classList.remove('hidden');
      if (bannerName) bannerName.textContent = folderName;
      if (bannerPath) bannerPath.textContent = ws.workspace_path || '';
      if (bannerType) bannerType.textContent = pType;
      if (bannerFiles) bannerFiles.textContent = `${fileCount} files`;
    }
  } else {
    if (labelFolder) labelFolder.textContent = 'No Project';
    if (btnClear) btnClear.classList.add('hidden');
    if (banner) banner.classList.add('hidden');
  }

  if (window.lucide) window.lucide.createIcons();
}

export function toggleAgentMode() {
  setAgentModeState(!state.isAgentMode, true);
}

export function setAgentModeState(enabled, showFeedback = true) {
  state.isAgentMode = enabled;
  localStorage.setItem('llama_agent_mode', enabled ? 'true' : 'false');

  const btn = document.getElementById('btn-toggle-agent-mode');
  const text = document.getElementById('text-agent-mode');
  const icon = document.getElementById('icon-agent-mode');

  if (enabled) {
    btn?.classList.add('btn-agent-active');
    if (text) text.textContent = 'Agent: ON';
    if (icon) icon.className = 'w-3.5 h-3.5 text-cyan-400';
    if (showFeedback) {
      if (!state.activeWorkspace) {
        showToast('Agent Mode Enabled', 'Click "No Project" above to select your target project folder.', 'warning', 3500);
      } else {
        showToast('Agent Mode Active', `Ready to create, edit, and run in ${state.activeWorkspace.folder_name || 'project'}.`, 'success', 2500);
      }
    }
  } else {
    btn?.classList.remove('btn-agent-active');
    if (text) text.textContent = 'Agent: OFF';
    if (icon) icon.className = 'w-3.5 h-3.5 text-[var(--text-muted)]';
    if (showFeedback) {
      showToast('Agent Mode Disabled', 'Standard chat mode active.', 'info', 1500);
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Returns system instructions instructing the model to act as an autonomous coding agent
 */
export function getAgentSystemInstructions() {
  const ws = state.activeWorkspace;
  const wsPath = ws?.workspace_path || 'Current Workspace';
  const folderName = ws?.folder_name || 'Project';
  const fileListStr = (ws?.files && ws.files.length > 0)
    ? ws.files.slice(0, 80).join('\n')
    : '(Empty directory or no files discovered yet)';

  return `You are an expert autonomous coding agent with full capability to inspect, create, edit, and maintain files and execute terminal commands in the user's workspace.

WORKSPACE ENVIRONMENT:
- Project Folder: "${folderName}" (${wsPath})
- Existing Files:
${fileListStr}

TOOL CALLING PROTOCOL:
Always wrap each tool call inside <tool_call> ... </tool_call> tags.
Never output raw markdown blocks or unescaped JSON without <tool_call> tags.
You can output multiple <tool_call> blocks in one response to execute multiple actions in sequence.

AVAILABLE TOOLS:

1. write_file (STRONGLY RECOMMENDED FOR CREATING OR UPDATING FILES):
   Create a new file or completely replace/update an existing file with new content.
   IMPORTANT: When asked to edit, add features, add buttons, update styles, or change a file, ALWAYS use write_file with the complete updated code. This guarantees 100% success, handles large files effortlessly, and never fails due to whitespace mismatches.
   Syntax:
   <tool_call>
   {"name": "write_file", "arguments": {"path": "relative/filename.ext", "content": "complete file content"}}
   </tool_call>

2. read_file: Read an existing file to inspect its content before making changes.
   Syntax:
   <tool_call>
   {"name": "read_file", "arguments": {"path": "relative/filename.ext"}}
   </tool_call>

3. edit_file: Surgically replace a specific unique chunk in an existing file.
   Use ONLY for small 1-3 line edits where the search chunk is completely unique. If adding new HTML sections, CSS classes, or buttons, use write_file instead.
   Syntax:
   <tool_call>
   {"name": "edit_file", "arguments": {"path": "relative/filename.ext", "search": "unique anchor string", "replace": "replacement string"}}
   </tool_call>

4. run_command: Run a terminal command (PowerShell or CMD) in the project workspace (e.g. dir, npm install, git status, python script).
   Syntax:
   <tool_call>
   {"name": "run_command", "arguments": {"command": "dir", "shell": "powershell"}}
   </tool_call>

5. list_directory: List subfolder contents and directory structure.
   Syntax:
   <tool_call>
   {"name": "list_directory", "arguments": {"path": ""}}
   </tool_call>

6. create_directory: Create a subfolder.
   Syntax:
   <tool_call>
   {"name": "create_directory", "arguments": {"path": "subfolder"}}
   </tool_call>

7. delete_file: Delete a file or directory.
   Syntax:
   <tool_call>
   {"name": "delete_file", "arguments": {"path": "relative/filename.ext"}}
   </tool_call>

EXECUTION RULES:
- When the user asks to edit, add, or create something, plan concisely and immediately execute the tool calls.
- When editing or adding features to code, output write_file with the updated code.
- Always wrap every tool call inside <tool_call> and </tool_call>.`;
}

/**
 * Robust JSON parser that handles unescaped newlines and control characters in code strings
 */
export function safeParseJson(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 1. Sanitize unescaped control characters inside JSON string literals
  try {
    let inString = false;
    let escaped = false;
    let out = '';
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"' && !escaped) {
        inString = !inString;
        out += ch;
      } else if (ch === '\\' && inString) {
        escaped = !escaped;
        out += ch;
      } else {
        if (inString) {
          if (ch === '\n') {
            out += '\\n';
          } else if (ch === '\r') {
            out += '\\r';
          } else if (ch === '\t') {
            out += '\\t';
          } else if (ch.charCodeAt(0) < 32) {
            // drop non-printable control characters
          } else {
            out += ch;
          }
        } else {
          out += ch;
        }
        escaped = false;
      }
    }
    return JSON.parse(out);
  } catch {}

  // 2. Aggressive regex-based fallback for write_file / edit_file
  try {
    const nameMatch = /"(?:name|tool)"\s*:\s*"([^"]+)"/i.exec(trimmed);
    const pathMatch = /"path"\s*:\s*"([^"]+)"/i.exec(trimmed);
    if (nameMatch && pathMatch) {
      const toolName = nameMatch[1].toLowerCase();
      const filePath = pathMatch[1];

      if (toolName === 'write_file') {
        const contentMatch = /"content"\s*:\s*"([\s\S]*)"\s*\}?\s*$/i.exec(trimmed);
        if (contentMatch) {
          return {
            name: 'write_file',
            arguments: { path: filePath, content: unescapeJsonString(contentMatch[1]) }
          };
        }
      } else if (toolName === 'read_file' || toolName === 'delete_file' || toolName === 'create_directory' || toolName === 'list_directory') {
        return {
          name: toolName,
          arguments: { path: filePath }
        };
      }
    }
  } catch {}

  return null;
}

function unescapeJsonString(str) {
  if (!str) return '';
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Extracts raw JSON tool calls from text even if model forgot <tool_call> tags
 */
export function extractRawToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const toolNames = ['write_file', 'edit_file', 'read_file', 'run_command', 'create_directory', 'delete_file', 'list_directory'];

  let i = 0;
  while (i < text.length) {
    const nextBrace = text.indexOf('{', i);
    if (nextBrace === -1) break;

    const snippet = text.slice(nextBrace, nextBrace + 120);
    const hasToolKeyword = /"(?:name|tool)"\s*:\s*"(?:write_file|edit_file|read_file|run_command|create_directory|delete_file|list_directory)"/i.test(snippet);

    if (!hasToolKeyword) {
      i = nextBrace + 1;
      continue;
    }

    // Balance braces to find the complete JSON object
    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = -1;

    for (let j = nextBrace; j < text.length; j++) {
      const ch = text[j];
      if (ch === '"' && !escaped) {
        inString = !inString;
      } else if (ch === '\\' && inString) {
        escaped = !escaped;
        continue;
      } else if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIndex = j;
            break;
          }
        }
      }
      escaped = false;
    }

    if (endIndex !== -1) {
      const candidateStr = text.slice(nextBrace, endIndex + 1);
      const parsed = safeParseJson(candidateStr);
      if (parsed) {
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        if (name && toolNames.includes(name.toLowerCase())) {
          calls.push({
            name: name.toLowerCase(),
            arguments: args,
            rawMatch: candidateStr,
            startIndex: nextBrace,
            endIndex: endIndex
          });
        }
      }
      i = endIndex + 1;
    } else {
      i = nextBrace + 1;
    }
  }

  return calls;
}

/**
 * Parses <tool_call> tags, markdown code-blocks, and raw JSON variants from the response
 */
export function parseToolCalls(text) {
  if (!text) return [];
  const calls = [];

  // 1. Match <tool_call>...</tool_call>
  const tagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const rawJson = match[1].trim();
    const parsed = safeParseJson(rawJson);
    if (parsed && (parsed.name || parsed.tool)) {
      const name = (parsed.name || parsed.tool).toLowerCase();
      const args = parsed.arguments || parsed.parameters || parsed.args || {};
      calls.push({ name, arguments: args });
    }
  }

  // 2. Match markdown fenced ```tool_call or ```json blocks
  if (calls.length === 0) {
    const codeRegex = /```(?:tool_call|json)\s*\n([\s\S]*?)\n```/gi;
    while ((match = codeRegex.exec(text)) !== null) {
      const parsed = safeParseJson(match[1].trim());
      if (parsed && (parsed.name || parsed.tool)) {
        const name = (parsed.name || parsed.tool).toLowerCase();
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        calls.push({ name, arguments: args });
      }
    }
  }

  // 3. Match raw JSON object calls directly in text
  if (calls.length === 0) {
    const rawCalls = extractRawToolCalls(text);
    for (const rc of rawCalls) {
      calls.push({ name: rc.name, arguments: rc.arguments });
    }
  }

  return calls;
}

/**
 * Executes a tool via NativeBridge IPC
 */
export async function executeAgentTool(toolName, toolArgs) {
  try {
    return await api.invoke('agent_execute_tool', {
      tool: toolName,
      args: toolArgs || {}
    });
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Builds HTML for interactive tool execution cards
 */
export function buildToolCardHtml(toolName, args, result) {
  const isPending = !result;
  const isSuccess = result && result.status === 'success';
  const targetPath = args?.path || args?.command || '';

  let detailHtml = '';
  if (isPending) {
    detailHtml = `
      <div class="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-1">
        <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-cyan-400"></i>
        <span>Executing in workspace...</span>
      </div>
    `;
  } else if (toolName === 'write_file') {
    if (isSuccess) {
      detailHtml = `
        <div class="flex items-center gap-3 text-xs mt-1">
          <span class="agent-stat-pill success">
            <i data-lucide="file-check" class="w-3.5 h-3.5"></i>
            <span>${result.lines || 0} lines written</span>
          </span>
          <span class="agent-stat-pill font-mono">${result.size_kb || 0} KB</span>
        </div>
      `;
    }
  } else if (toolName === 'edit_file') {
    if (isSuccess) {
      detailHtml = `
        <div class="flex items-center gap-3 text-xs mt-1">
          <span class="agent-stat-pill success">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>Surgically replaced chunk (${result.lines_delta || 0} lines delta)</span>
          </span>
        </div>
      `;
    }
  } else if (toolName === 'read_file') {
    if (isSuccess) {
      detailHtml = `
        <div class="flex items-center gap-3 text-xs mt-1">
          <span class="agent-stat-pill">
            <i data-lucide="eye" class="w-3.5 h-3.5 text-cyan-400"></i>
            <span>${result.lines || 0} lines read (${Math.round((result.size_bytes || 0) / 1024)} KB)</span>
          </span>
        </div>
      `;
    }
  } else if (toolName === 'run_command') {
    const cmdText = args?.command || '';
    const stdout = result?.stdout || '';
    const stderr = result?.stderr || '';
    const exitCode = result?.exit_code ?? 0;
    const durMs = result?.duration_ms || 0;

    detailHtml = `
      <div class="agent-tool-terminal">
        <div class="agent-tool-terminal-cmd">$ ${escapeHtml(cmdText)}</div>
        ${stdout ? `<pre class="text-zinc-300 font-mono text-[11px] whitespace-pre-wrap">${escapeHtml(stdout)}</pre>` : ''}
        ${stderr ? `<pre class="text-rose-400 font-mono text-[11px] whitespace-pre-wrap mt-1">${escapeHtml(stderr)}</pre>` : ''}
        <div class="mt-1 text-[10px] text-[var(--text-muted)] flex items-center justify-between border-t border-white/5 pt-1">
          <span>Exit: ${exitCode}</span>
          <span>${durMs} ms</span>
        </div>
      </div>
    `;
  } else if (toolName === 'create_directory') {
    detailHtml = `<div class="mt-1"><span class="agent-stat-pill success">Folder created</span></div>`;
  } else if (toolName === 'delete_file') {
    detailHtml = `<div class="mt-1"><span class="agent-stat-pill success">Item deleted</span></div>`;
  } else if (toolName === 'list_directory') {
    const count = result?.entries ? result.entries.length : 0;
    detailHtml = `<div class="mt-1"><span class="agent-stat-pill font-mono">${count} items listed</span></div>`;
  }

  if (!isPending && !isSuccess) {
    detailHtml += `
      <div class="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5 font-mono">
        <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-400 shrink-0"></i>
        <span>${escapeHtml(result?.message || 'Tool execution failed')}</span>
      </div>
    `;
  }

  const statusBadge = isPending
    ? `<span class="agent-stat-pill running"><i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> Running</span>`
    : `<span class="agent-stat-pill ${isSuccess ? 'success' : 'error'}">${isSuccess ? 'Success' : 'Error'}</span>`;

  return `
    <div class="agent-tool-card my-2">
      <div class="agent-tool-header">
        <div class="flex items-center gap-2 overflow-hidden">
          <span class="agent-tool-badge shrink-0">
            <i data-lucide="wrench" class="w-3 h-3"></i>
            <span>${escapeHtml(toolName)}</span>
          </span>
          <span class="agent-tool-path truncate" title="${escapeHtml(targetPath)}">${escapeHtml(targetPath)}</span>
        </div>
        ${statusBadge}
      </div>
      ${detailHtml}
    </div>
  `;
}

/**
 * Parses <tool_call> tags and raw JSON tool calls in text and transforms them into interactive UI tool cards
 */
export function renderToolCardsInText(text) {
  if (!text) return '';

  let normalized = text;

  // 1. Automatically wrap raw JSON tool calls in <tool_call> if model omitted them
  const rawCalls = extractRawToolCalls(normalized);
  for (const rc of rawCalls) {
    if (rc.rawMatch && !normalized.includes(`<tool_call>${rc.rawMatch}`)) {
      normalized = normalized.replace(rc.rawMatch, `<tool_call>${rc.rawMatch}</tool_call>`);
    }
  }

  // 2. Replace <tool_call> tags (and trailing <tool_result>) with interactive tool cards
  return normalized.replace(/<tool_call>([\s\S]*?)<\/tool_call>(?:\s*<tool_result>([\s\S]*?)<\/tool_result>)?/gi, (match, callJson, resultJson) => {
    const call = safeParseJson(callJson.trim());
    if (!call || (!call.name && !call.tool)) return match;

    const toolName = (call.name || call.tool).toLowerCase();
    const toolArgs = call.arguments || call.parameters || call.args || {};

    let result = null;
    if (resultJson) {
      result = safeParseJson(resultJson.trim());
    }

    return `\n\n${buildToolCardHtml(toolName, toolArgs, result)}\n\n`;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
