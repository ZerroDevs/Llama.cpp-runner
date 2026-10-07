/**
 * Llama Server Control - Autonomous Coding Agent Controller
 * Manages chat-scoped project workspace folders, tool calling, and live execution cards
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

let onSessionUpdatedCallback = null;

export function registerAgentSessionCallback(callback) {
  onSessionUpdatedCallback = callback;
}

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

  // 3. Workspace File Explorer Drawer
  initWorkspaceExplorer();
}

/**
 * Synchronizes Agent Mode and linked project workspace for the currently active chat session
 */
export function syncAgentModeForActiveSession(session) {
  if (!session) {
    setAgentModeState(false, false);
    state.activeWorkspace = null;
    updateWorkspaceUI(null);
    api.invoke('agent_clear_workspace').catch(() => {});
    return;
  }

  const isAgent = session.isAgentMode === true;
  setAgentModeState(isAgent, false);

  if (isAgent && session.agentWorkspace && session.agentWorkspace.workspace_path) {
    state.activeWorkspace = session.agentWorkspace;
    updateWorkspaceUI(session.agentWorkspace);
    api.invoke('agent_set_workspace', { path: session.agentWorkspace.workspace_path }).catch(() => {});
  } else {
    state.activeWorkspace = null;
    updateWorkspaceUI(null);
    api.invoke('agent_clear_workspace').catch(() => {});
  }
}

export async function selectWorkspaceFolder() {
  try {
    const res = await api.invoke('agent_select_workspace');
    if (res && res.status === 'success') {
      state.activeWorkspace = res;
      updateWorkspaceUI(res);
      showToast('Workspace Opened', `Connected to project: ${res.folder_name}`, 'success', 2500);

      // Save folder to current active chat session and activate agent mode for this chat
      const currentSession = state.chatSessions?.find(s => s.id === state.activeSessionId);
      if (currentSession) {
        currentSession.agentWorkspace = res;
        currentSession.isAgentMode = true;
      }

      setAgentModeState(true, true);

      if (onSessionUpdatedCallback) {
        onSessionUpdatedCallback();
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

    const currentSession = state.chatSessions?.find(s => s.id === state.activeSessionId);
    if (currentSession) {
      currentSession.agentWorkspace = null;
    }

    if (onSessionUpdatedCallback) {
      onSessionUpdatedCallback();
    }
    showToast('Workspace Disconnected', 'Project folder unlinked from this chat.', 'info', 1800);
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
  const explorerTitle = document.getElementById('explorer-project-title');

  if (ws && (ws.has_workspace !== false)) {
    const folderName = ws.folder_name || (ws.workspace_path ? ws.workspace_path.split(/[\\/]/).pop() : 'Project');
    const fileCount = ws.file_count ?? (ws.files ? ws.files.length : 0);
    const pType = (ws.project_types && ws.project_types.length > 0) ? ws.project_types[0] : 'Workspace';

    if (labelFolder) labelFolder.textContent = folderName;
    if (btnClear) btnClear.classList.remove('hidden');
    if (explorerTitle) explorerTitle.textContent = folderName;

    if (banner) {
      banner.classList.remove('hidden');
      if (bannerName) bannerName.textContent = folderName;
      if (bannerPath) bannerPath.textContent = ws.workspace_path || '';
      if (bannerType) bannerType.textContent = pType;
      if (bannerFiles) bannerFiles.textContent = `${fileCount} files`;
    }

    const workspacePanel = document.getElementById('sidebar-panel-workspace');
    if (workspacePanel && !workspacePanel.classList.contains('hidden')) {
      loadWorkspaceFileTree();
    }
  } else {
    if (labelFolder) labelFolder.textContent = 'No Project';
    if (btnClear) btnClear.classList.add('hidden');
    if (explorerTitle) explorerTitle.textContent = 'No Workspace';
    if (banner) banner.classList.add('hidden');

    const treeContainer = document.getElementById('workspace-file-tree');
    if (treeContainer) {
      renderEmptyWorkspaceTree(treeContainer);
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

export function toggleAgentMode() {
  const currentSession = state.chatSessions?.find(s => s.id === state.activeSessionId);
  const targetState = !state.isAgentMode;

  if (currentSession) {
    currentSession.isAgentMode = targetState;
  }

  setAgentModeState(targetState, true);

  if (targetState) {
    if (currentSession?.agentWorkspace?.workspace_path) {
      state.activeWorkspace = currentSession.agentWorkspace;
      updateWorkspaceUI(currentSession.agentWorkspace);
      api.invoke('agent_set_workspace', { path: currentSession.agentWorkspace.workspace_path }).catch(() => {});
    }
  } else {
    api.invoke('agent_clear_workspace').catch(() => {});
    updateWorkspaceUI(null);
  }

  if (onSessionUpdatedCallback) {
    onSessionUpdatedCallback();
  }
}

export function setAgentModeState(enabled, showFeedback = true) {
  state.isAgentMode = enabled;

  const btn = document.getElementById('btn-toggle-agent-mode');
  const text = document.getElementById('text-agent-mode');
  const icon = document.getElementById('icon-agent-mode');

  if (enabled) {
    btn?.classList.add('btn-agent-active');
    if (text) text.textContent = 'Agent: ON';
    if (icon) icon.setAttribute('class', 'w-3.5 h-3.5 text-cyan-400');
    if (showFeedback) {
      if (!state.activeWorkspace) {
        showToast('Agent Mode Enabled', 'Click "No Project" above to select your target project folder for this chat.', 'warning', 3500);
      } else {
        showToast('Agent Mode Active', `Ready to create, edit, and run in ${state.activeWorkspace.folder_name || 'project'}.`, 'success', 2500);
      }
    }
  } else {
    btn?.classList.remove('btn-agent-active');
    if (text) text.textContent = 'Agent: OFF';
    if (icon) icon.setAttribute('class', 'w-3.5 h-3.5 text-[var(--text-muted)]');
    if (showFeedback) {
      showToast('Agent Mode Disabled', 'Standard chat mode active for this conversation.', 'info', 1500);
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

8. fetch_web: Fetch online documentation, npm READMEs, or API specifications from external URLs.
   Syntax:
   <tool_call>
   {"name": "fetch_web", "arguments": {"url": "https://raw.githubusercontent.com/.../README.md"}}
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
    let escape = false;
    let out = '';
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escape) {
          out += ch;
          escape = false;
        } else if (ch === '\\') {
          out += ch;
          escape = true;
        } else if (ch === '"') {
          inString = false;
          out += ch;
        } else if (ch === '\n') {
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
        if (ch === '"') {
          inString = true;
        }
        out += ch;
      }
    }
    return JSON.parse(out);
  } catch {}

  // 2. Aggressive regex-based fallback for write_file / edit_file / fetch_web
  try {
    const nameMatch = /"(?:name|tool)"\s*:\s*"([^"]+)"/i.exec(trimmed);
    const pathMatch = /"path"\s*:\s*"([^"]+)"/i.exec(trimmed);
    const urlMatch = /"url"\s*:\s*"([^"]+)"/i.exec(trimmed);
    if (nameMatch) {
      const toolName = nameMatch[1].toLowerCase();
      if (toolName === 'fetch_web' && urlMatch) {
        return {
          name: 'fetch_web',
          arguments: { url: urlMatch[1] }
        };
      }
      if (pathMatch) {
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
 * Extracts a balanced JSON object from string starting at startIndex
 */
export function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let j = startIndex; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return { endIndex: j, jsonStr: text.slice(startIndex, j + 1) };
        }
      }
    }
  }
  return null;
}

/**
 * Extracts raw JSON tool calls from text even if model forgot <tool_call> tags
 */
export function extractRawToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const toolNames = ['write_file', 'edit_file', 'read_file', 'run_command', 'create_directory', 'delete_file', 'list_directory', 'fetch_web'];

  let i = 0;
  while (i < text.length) {
    const nextBrace = text.indexOf('{', i);
    if (nextBrace === -1) break;

    const snippet = text.slice(nextBrace, nextBrace + 120);
    const hasToolKeyword = /"(?:name|tool)"\s*:\s*"(?:write_file|edit_file|read_file|run_command|create_directory|delete_file|list_directory|fetch_web)"/i.test(snippet);

    if (!hasToolKeyword) {
      i = nextBrace + 1;
      continue;
    }

    const balanced = extractBalancedJson(text, nextBrace);
    if (balanced) {
      const parsed = safeParseJson(balanced.jsonStr);
      if (parsed) {
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.parameters || parsed.args || {};
        if (name && toolNames.includes(name.toLowerCase())) {
          calls.push({
            name: name.toLowerCase(),
            arguments: args,
            rawMatch: balanced.jsonStr,
            startIndex: nextBrace,
            endIndex: balanced.endIndex
          });
        }
      }
      i = balanced.endIndex + 1;
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
 * Resolves appropriate Lucide icon name for each tool action
 */
export function getToolIconName(toolName) {
  const norm = String(toolName || '').toLowerCase();
  switch (norm) {
    case 'write_file':
      return 'file-plus-2';
    case 'edit_file':
      return 'file-edit';
    case 'read_file':
      return 'file-search';
    case 'run_command':
      return 'terminal';
    case 'create_directory':
      return 'folder-plus';
    case 'delete_file':
      return 'trash-2';
    case 'list_directory':
      return 'folder-tree';
    case 'fetch_web':
      return 'globe';
    default:
      return 'wrench';
  }
}

/**
 * Builds HTML for a lightweight pending tool call card while streaming parameters
 */
export function buildPendingToolCardHtml(toolName = 'workspace_action') {
  const iconName = getToolIconName(toolName);
  return `<details class="group-agent-action mb-2.5 bg-[var(--bg-elevated)] border border-cyan-500/25 rounded-xl p-3 is-action-pending" open><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-cyan-400 list-none"><div class="flex items-center gap-2 min-w-0 flex-1 mr-2"><span class="agent-action-icon flex items-center justify-center w-5 h-5 rounded-md bg-cyan-500/15 text-cyan-400 shrink-0"><i data-lucide="${iconName}" class="w-3.5 h-3.5"></i></span><span class="agent-action-name font-mono text-cyan-300 font-semibold shrink-0">${escapeHtml(toolName)}</span></div><div class="flex items-center gap-2 shrink-0"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"><i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i><span>Preparing</span></span></div></summary><div class="agent-action-body text-xs text-[var(--text-muted)] mt-2 pt-2 border-t border-[var(--border)] font-mono flex items-center gap-2 py-1"><i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-cyan-400"></i><span>Preparing tool call parameters...</span></div></details>`;
}

/**
 * Builds HTML for interactive tool execution accordion box (styled like thinking/reasoning)
 */
export function buildToolCardHtml(toolName, args, result) {
  const isPending = !result;
  const isSuccess = result && result.status === 'success';
  const targetPath = args?.path || args?.command || args?.url || result?.path || result?.url || '';
  const iconName = getToolIconName(toolName);

  // Status Badge
  let statusBadge = '';
  if (isPending) {
    statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"><i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i><span>Running</span></span>`;
  } else if (isSuccess) {
    statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><i data-lucide="check" class="w-3 h-3"></i><span>Success</span></span>`;
  } else {
    statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30"><i data-lucide="alert-triangle" class="w-3 h-3"></i><span>Error</span></span>`;
  }

  // Metrics Badge in summary header
  let metricsBadge = '';
  if (result) {
    if (toolName === 'write_file') {
      const lines = result.lines ?? 0;
      const sizeKb = result.size_kb ?? (result.size_bytes ? (result.size_bytes / 1024).toFixed(1) : 0);
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${lines} lines • ${sizeKb} KB</span>`;
    } else if (toolName === 'edit_file') {
      const delta = result.lines_delta ?? 0;
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${delta >= 0 ? '+' : ''}${delta} lines</span>`;
    } else if (toolName === 'read_file') {
      const lines = result.lines ?? 0;
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${lines} lines</span>`;
    } else if (toolName === 'run_command') {
      const exitCode = result.exit_code ?? 0;
      const durMs = result.duration_ms ?? 0;
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">exit: ${exitCode} • ${durMs}ms</span>`;
    } else if (toolName === 'list_directory') {
      const count = result.entries ? result.entries.length : 0;
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${count} items</span>`;
    } else if (toolName === 'fetch_web') {
      const chars = result.chars ?? (result.content ? result.content.length : 0);
      const statusHttp = result.http_status ?? 200;
      metricsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">HTTP ${statusHttp} • ${chars} chars</span>`;
    }
  }

  // Collapsible Body HTML
  let bodyHtml = '';
  if (isPending) {
    bodyHtml = `<div class="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1"><i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-cyan-400"></i><span>Executing in workspace project folder...</span></div>`;
  } else if (!isSuccess) {
    bodyHtml = `<div class="p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4 shrink-0 text-rose-400"></i><span>${escapeHtml(result?.message || 'Tool execution encountered an error.')}</span></div>`;
  } else if (toolName === 'write_file') {
    const content = args?.content;
    bodyHtml = `<div class="space-y-1.5"><div class="text-[11px] text-[var(--text-muted)] flex items-center justify-between"><span>Target: <span class="text-cyan-300 font-mono">${escapeHtml(targetPath)}</span></span><span class="font-mono text-[10px] text-zinc-400">${result.lines || 0} lines written (${result.size_kb || 0} KB)</span></div>${content ? `<pre class="bg-black/50 border border-white/5 rounded-lg p-2.5 text-[11px] text-zinc-300 font-mono overflow-x-auto max-h-56 whitespace-pre leading-relaxed select-text"><code>${escapeHtml(content)}</code></pre>` : '<div class="text-xs text-emerald-400">File created and written successfully.</div>'}</div>`;
  } else if (toolName === 'edit_file') {
    bodyHtml = `<div class="space-y-2"><div class="text-[11px] text-[var(--text-muted)]">Target: <span class="text-cyan-300 font-mono">${escapeHtml(targetPath)}</span></div>${args?.search ? `<div><div class="text-[10px] uppercase tracking-wider text-rose-400/90 font-semibold mb-1">Replaced Chunk:</div><pre class="bg-rose-950/20 border border-rose-500/20 rounded-lg p-2 text-[11px] text-rose-200 font-mono whitespace-pre overflow-x-auto max-h-36"><code>${escapeHtml(args.search)}</code></pre></div>` : ''}${args?.replace ? `<div><div class="text-[10px] uppercase tracking-wider text-emerald-400/90 font-semibold mb-1">New Content:</div><pre class="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-2 text-[11px] text-emerald-200 font-mono whitespace-pre overflow-x-auto max-h-36"><code>${escapeHtml(args.replace)}</code></pre></div>` : ''}</div>`;
  } else if (toolName === 'run_command') {
    const cmdText = args?.command || '';
    const stdout = result?.stdout || '';
    const stderr = result?.stderr || '';
    const exitCode = result?.exit_code ?? 0;
    const durMs = result?.duration_ms || 0;

    bodyHtml = `<div class="space-y-1.5 font-mono text-[11px]"><div class="bg-black/60 border border-white/10 rounded-lg p-2.5"><div class="text-cyan-400 select-all">$ ${escapeHtml(cmdText)}</div>${stdout ? `<pre class="mt-2 text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-white/5 pt-2">${escapeHtml(stdout)}</pre>` : ''}${stderr ? `<pre class="mt-2 text-rose-400 whitespace-pre-wrap max-h-36 overflow-y-auto border-t border-rose-500/20 pt-2">${escapeHtml(stderr)}</pre>` : ''}<div class="mt-2 pt-1 border-t border-white/5 text-[10px] text-[var(--text-muted)] flex items-center justify-between"><span>Exit Code: <span class="${exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}">${exitCode}</span></span><span>Duration: ${durMs} ms</span></div></div></div>`;
  } else if (toolName === 'read_file') {
    bodyHtml = `<div class="space-y-1.5"><div class="text-[11px] text-[var(--text-muted)] flex items-center justify-between"><span>Read from: <span class="text-cyan-300 font-mono">${escapeHtml(targetPath)}</span></span><span class="font-mono text-[10px]">${result.lines || 0} lines</span></div>${result.content ? `<pre class="bg-black/50 border border-white/5 rounded-lg p-2.5 text-[11px] text-zinc-300 font-mono overflow-x-auto max-h-56 whitespace-pre leading-relaxed select-text"><code>${escapeHtml(result.content)}</code></pre>` : ''}</div>`;
  } else if (toolName === 'create_directory') {
    bodyHtml = `<div class="text-xs text-emerald-400">Created directory: <span class="font-mono">${escapeHtml(targetPath)}</span></div>`;
  } else if (toolName === 'delete_file') {
    bodyHtml = `<div class="text-xs text-emerald-400">Removed item: <span class="font-mono">${escapeHtml(targetPath)}</span></div>`;
  } else if (toolName === 'list_directory') {
    const entries = result?.entries || [];
    bodyHtml = `<div class="space-y-1 font-mono text-[11px]"><div class="text-[var(--text-muted)] mb-1">Directory contents (${entries.length} items):</div><div class="bg-black/50 border border-white/5 rounded-lg p-2 max-h-48 overflow-y-auto space-y-0.5">${entries.map(e => `<div class="flex items-center gap-2 ${e.is_directory ? 'text-cyan-300' : 'text-zinc-300'}"><i data-lucide="${e.is_directory ? 'folder' : 'file'}" class="w-3 h-3 shrink-0"></i><span>${escapeHtml(e.name)}</span></div>`).join('')}</div></div>`;
  } else if (toolName === 'fetch_web') {
    const url = args?.url || result?.url || '';
    const title = result?.title || '';
    const chars = result?.chars || (result?.content ? result.content.length : 0);
    bodyHtml = `<div class="space-y-1.5"><div class="text-[11px] text-[var(--text-muted)] flex items-center justify-between"><span>Source: <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-cyan-300 font-mono hover:underline break-all">${escapeHtml(url)}</a></span><span class="font-mono text-[10px] text-zinc-400 shrink-0 ml-2">${chars} chars</span></div>${title ? `<div class="text-[11px] text-zinc-300 font-semibold">${escapeHtml(title)}</div>` : ''}${result?.content ? `<pre class="bg-black/50 border border-white/5 rounded-lg p-2.5 text-[11px] text-zinc-300 font-mono overflow-x-auto max-h-56 whitespace-pre leading-relaxed select-text"><code>${escapeHtml(result.content)}</code></pre>` : '<div class="text-xs text-emerald-400">Content retrieved successfully.</div>'}</div>`;
  }

  return `<details class="group-agent-action mb-2.5 bg-[var(--bg-elevated)] border border-cyan-500/25 hover:border-cyan-500/40 rounded-xl p-3 transition-colors"${isPending ? ' open' : ''}><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors list-none"><div class="flex items-center gap-2 min-w-0 flex-1 mr-2"><span class="agent-action-icon flex items-center justify-center w-5 h-5 rounded-md bg-cyan-500/15 text-cyan-400 shrink-0"><i data-lucide="${iconName}" class="w-3.5 h-3.5"></i></span><span class="agent-action-name font-mono text-cyan-300 font-semibold shrink-0">${escapeHtml(toolName)}</span>${targetPath ? `<span class="agent-action-target font-mono text-[var(--text-secondary)] truncate max-w-[260px]" title="${escapeHtml(targetPath)}">${escapeHtml(targetPath)}</span>` : ''}${metricsBadge}</div><div class="flex items-center gap-2 shrink-0">${statusBadge}<svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></div></summary><div class="agent-action-body text-xs text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border)] leading-relaxed select-text font-mono">${bodyHtml}</div></details>`;
}

/**
 * Builds HTML for standalone action results (e.g. {"action":"created_or_updated",...})
 */
export function buildActionResultCardHtml(actionResult) {
  if (!actionResult) return '';

  const action = actionResult.action || 'action';
  const targetPath = actionResult.path || actionResult.target || actionResult.url || '';
  const isSuccess = actionResult.status === 'success';

  let toolName = 'workspace_action';
  let iconName = 'wrench';

  if (action === 'created_or_updated') {
    toolName = 'write_file';
    iconName = 'file-plus-2';
  } else if (action === 'surgical_edit') {
    toolName = 'edit_file';
    iconName = 'file-edit';
  } else if (action === 'read') {
    toolName = 'read_file';
    iconName = 'file-search';
  } else if (action === 'executed') {
    toolName = 'run_command';
    iconName = 'terminal';
  } else if (action === 'deleted') {
    toolName = 'delete_file';
    iconName = 'trash-2';
  } else if (action === 'fetched_web') {
    toolName = 'fetch_web';
    iconName = 'globe';
  }

  const lines = actionResult.lines ?? 0;
  const sizeKb = actionResult.size_kb ?? (actionResult.size_bytes ? (actionResult.size_bytes / 1024).toFixed(1) : 0);
  const metricsBadge = lines > 0
    ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">${lines} lines • ${sizeKb} KB</span>`
    : '';

  const statusBadge = isSuccess
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><i data-lucide="check" class="w-3 h-3"></i><span>Success</span></span>`
    : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30"><i data-lucide="alert-triangle" class="w-3 h-3"></i><span>Error</span></span>`;

  return `<details class="group-agent-action mb-2.5 bg-[var(--bg-elevated)] border border-cyan-500/25 hover:border-cyan-500/40 rounded-xl p-3 transition-colors"><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors list-none"><div class="flex items-center gap-2 min-w-0 flex-1 mr-2"><span class="agent-action-icon flex items-center justify-center w-5 h-5 rounded-md bg-cyan-500/15 text-cyan-400 shrink-0"><i data-lucide="${iconName}" class="w-3.5 h-3.5"></i></span><span class="agent-action-name font-mono text-cyan-300 font-semibold shrink-0">${escapeHtml(toolName)}</span>${targetPath ? `<span class="agent-action-target font-mono text-[var(--text-secondary)] truncate max-w-[260px]" title="${escapeHtml(targetPath)}">${escapeHtml(targetPath)}</span>` : ''}${metricsBadge}</div><div class="flex items-center gap-2 shrink-0">${statusBadge}<svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></div></summary><div class="agent-action-body text-xs text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border)] leading-relaxed select-text font-mono"><div class="flex items-center justify-between"><span>Action: <span class="text-cyan-300 font-mono">${escapeHtml(action)}</span></span><span class="text-emerald-400">${isSuccess ? 'Completed successfully' : 'Failed'}</span></div>${targetPath ? `<div class="text-[11px] text-[var(--text-muted)] mt-1">Path: <span class="text-zinc-300 font-mono">${escapeHtml(targetPath)}</span></div>` : ''}</div></details>`;
}

/**
 * Transforms all tool calls, results, and action result objects into interactive accordion boxes.
 * Completely eliminates any unstyled raw JSON text from leaking into the user chat bubble.
 */
export function renderToolCardsInText(text) {
  if (!text) return '';

  let out = text;

  // 1. First parse <tool_call> tags (and trailing <tool_result>)
  out = out.replace(/<tool_call>([\s\S]*?)<\/tool_call>(?:\s*<tool_result>([\s\S]*?)<\/tool_result>)?/gi, (match, callJson, resultJson) => {
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

  // 2. Active unclosed <tool_call> while model is actively streaming parameters
  if (out.includes('<tool_call>') && !out.includes('</tool_call>')) {
    out = out.replace(/<tool_call>([\s\S]*)$/i, (match, partial) => {
      const nameMatch = partial.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/i);
      const toolName = nameMatch ? nameMatch[1].toLowerCase() : 'workspace_action';
      return `\n\n${buildPendingToolCardHtml(toolName)}\n\n`;
    });
  }

  // 3. Active unclosed <tool_result> while tool is executing
  if (out.includes('<tool_result>') && !out.includes('</tool_result>')) {
    out = out.replace(/<tool_result>([\s\S]*)$/i, '');
  }

  // 4. Extract and transform any remaining raw JSON tool calls and raw action results
  let i = 0;
  while (i < out.length) {
    const nextBrace = out.indexOf('{', i);
    if (nextBrace === -1) break;

    const balanced = extractBalancedJson(out, nextBrace);
    if (!balanced) {
      i = nextBrace + 1;
      continue;
    }

    const jsonStr = balanced.jsonStr;
    const isToolCall = /"(?:name|tool)"\s*:\s*"(?:write_file|edit_file|read_file|run_command|create_directory|delete_file|list_directory|fetch_web)"/i.test(jsonStr);
    const isActionResult = /"(?:action|status)"\s*:\s*"(?:created_or_updated|surgical_edit|fetched_web|success|error)"/i.test(jsonStr) &&
      (jsonStr.includes('"lines"') || jsonStr.includes('"path"') || jsonStr.includes('"action"') || jsonStr.includes('"size_bytes"') || jsonStr.includes('"chars"') || jsonStr.includes('"url"'));

    if (isToolCall) {
      const parsedCall = safeParseJson(jsonStr);
      if (parsedCall && (parsedCall.name || parsedCall.tool)) {
        const toolName = (parsedCall.name || parsedCall.tool).toLowerCase();
        const toolArgs = parsedCall.arguments || parsedCall.parameters || parsedCall.args || {};

        // Check if immediately followed by an action result JSON or <tool_result>
        let afterIdx = balanced.endIndex + 1;
        while (afterIdx < out.length && /\s/.test(out[afterIdx])) afterIdx++;

        let resJsonObj = null;
        let totalEndIndex = balanced.endIndex;

        if (out.slice(afterIdx, afterIdx + 13).toLowerCase() === '<tool_result>') {
          const closeTag = out.indexOf('</tool_result>', afterIdx);
          if (closeTag !== -1) {
            const rawRes = out.slice(afterIdx + 13, closeTag).trim();
            resJsonObj = safeParseJson(rawRes);
            totalEndIndex = closeTag + 14 - 1;
          }
        } else if (out[afterIdx] === '{') {
          const nextBalanced = extractBalancedJson(out, afterIdx);
          if (nextBalanced && /"(?:action|status)"/i.test(nextBalanced.jsonStr)) {
            resJsonObj = safeParseJson(nextBalanced.jsonStr);
            totalEndIndex = nextBalanced.endIndex;
          }
        }

        const replacement = `\n\n${buildToolCardHtml(toolName, toolArgs, resJsonObj)}\n\n`;
        out = out.slice(0, nextBrace) + replacement + out.slice(totalEndIndex + 1);
        i = nextBrace + replacement.length;
        continue;
      }
    } else if (isActionResult) {
      const parsedRes = safeParseJson(jsonStr);
      if (parsedRes && (parsedRes.action || parsedRes.status)) {
        const replacement = `\n\n${buildActionResultCardHtml(parsedRes)}\n\n`;
        out = out.slice(0, nextBrace) + replacement + out.slice(balanced.endIndex + 1);
        i = nextBrace + replacement.length;
        continue;
      }
    }

    i = nextBrace + 1;
  }

  // 5. Clean up any leftover stray <tool_result> tags
  out = out.replace(/<tool_result>([\s\S]*?)<\/tool_result>/gi, (match, resContent) => {
    const parsed = safeParseJson(resContent.trim());
    if (parsed) return `\n\n${buildActionResultCardHtml(parsed)}\n\n`;
    return '';
  });

  return out;
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

// ==========================================
// WORKSPACE FILE EXPLORER DRAWER CONTROLLER
// ==========================================

let cachedTreeData = null;
let activePreviewFilePath = '';
let activeSidebarTab = 'chats';
const expandedFolderPaths = new Set(['']);

export function getActiveSidebarTab() {
  return activeSidebarTab;
}

export function initWorkspaceExplorer() {
  // 1. Drawer Tab Switching
  document.getElementById('btn-sidebar-tab-chats')?.addEventListener('click', () => {
    switchSidebarTab('chats');
  });

  document.getElementById('btn-sidebar-tab-workspace')?.addEventListener('click', () => {
    switchSidebarTab('workspace');
  });

  // 2. Explorer Top Toolbar Actions
  document.getElementById('btn-explorer-refresh')?.addEventListener('click', async () => {
    await loadWorkspaceFileTree(document.getElementById('explorer-filter-input')?.value || '');
    showToast('Files Refreshed', 'Workspace tree synchronized.', 'info', 1500);
  });

  document.getElementById('btn-explorer-vscode')?.addEventListener('click', async () => {
    if (!state.activeWorkspace?.workspace_path) {
      showToast('No Workspace', 'Select a project folder first.', 'warning');
      return;
    }
    await api.invoke('agent_open_file_external', { path: '', target: 'vscode' });
    showToast('VS Code Launched', 'Opening workspace directory.', 'info', 1800);
  });

  document.getElementById('btn-explorer-reveal')?.addEventListener('click', async () => {
    if (!state.activeWorkspace?.workspace_path) {
      showToast('No Workspace', 'Select a project folder first.', 'warning');
      return;
    }
    await api.invoke('agent_open_file_external', { path: '', target: 'explorer' });
  });

  document.getElementById('btn-explorer-pick-folder')?.addEventListener('click', async () => {
    await selectWorkspaceFolder();
  });

  // 3. Search / Filter File Tree
  const filterInput = document.getElementById('explorer-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase();
      if (cachedTreeData) {
        renderWorkspaceFileTree(cachedTreeData, q);
      }
    });
  }

  // 4. File Tree Container Event Delegation
  const treeContainer = document.getElementById('workspace-file-tree');
  if (treeContainer) {
    treeContainer.addEventListener('click', async (e) => {
      // a. Open in VS Code button
      const btnVsCode = e.target.closest('.btn-node-open-vscode');
      if (btnVsCode) {
        e.stopPropagation();
        const fPath = btnVsCode.getAttribute('data-file-path');
        if (fPath) {
          await api.invoke('agent_open_file_external', { path: fPath, target: 'vscode' });
          showToast('Opened in VS Code', fPath, 'info', 1500);
        }
        return;
      }

      // b. Reveal in Explorer button
      const btnExp = e.target.closest('.btn-node-reveal-explorer');
      if (btnExp) {
        e.stopPropagation();
        const fPath = btnExp.getAttribute('data-file-path');
        if (fPath) {
          await api.invoke('agent_open_file_external', { path: fPath, target: 'explorer' });
        }
        return;
      }

      // c. Folder row toggle (expand/collapse)
      const folderRow = e.target.closest('.tree-folder-row');
      if (folderRow) {
        const folderEl = folderRow.closest('.tree-folder');
        const folderPath = folderEl?.getAttribute('data-folder-path') || '';
        const childrenEl = folderEl?.querySelector(':scope > .tree-folder-children');

        if (folderEl && childrenEl) {
          const isCurrentlyOpen = folderEl.classList.contains('open');
          if (isCurrentlyOpen) {
            folderEl.classList.remove('open');
            childrenEl.classList.add('hidden');
            expandedFolderPaths.delete(folderPath);
          } else {
            folderEl.classList.add('open');
            childrenEl.classList.remove('hidden');
            expandedFolderPaths.add(folderPath);
          }
          if (window.lucide) window.lucide.createIcons({ root: folderRow });
        }
        return;
      }

      // d. File node click -> Open Preview Modal
      const fileNode = e.target.closest('.workspace-tree-node');
      if (fileNode) {
        const fPath = fileNode.getAttribute('data-file-path');
        const fName = fileNode.getAttribute('data-file-name');
        const fSize = fileNode.getAttribute('data-file-size');
        if (fPath) {
          await openFilePreviewModal(fPath, fName, fSize);
        }
      }
    });
  }

  // 5. File Preview Modal Setup
  const modalPreview = document.getElementById('modal-file-preview');
  if (modalPreview) {
    modalPreview.addEventListener('click', (e) => {
      if (e.target === modalPreview) closeFilePreviewModal();
    });

    document.getElementById('btn-preview-close')?.addEventListener('click', () => {
      closeFilePreviewModal();
    });

    document.getElementById('btn-preview-open-vscode')?.addEventListener('click', async () => {
      if (activePreviewFilePath) {
        await api.invoke('agent_open_file_external', { path: activePreviewFilePath, target: 'vscode' });
        showToast('Opened in VS Code', activePreviewFilePath, 'info', 1500);
      }
    });

    document.getElementById('btn-preview-open-notepad')?.addEventListener('click', async () => {
      if (activePreviewFilePath) {
        await api.invoke('agent_open_file_external', { path: activePreviewFilePath, target: 'notepad' });
      }
    });

    document.getElementById('btn-preview-open-explorer')?.addEventListener('click', async () => {
      if (activePreviewFilePath) {
        await api.invoke('agent_open_file_external', { path: activePreviewFilePath, target: 'explorer' });
      }
    });

    document.getElementById('btn-preview-insert-chat')?.addEventListener('click', () => {
      insertPreviewCodeToChat();
    });
  }
}

export function switchSidebarTab(tabName) {
  activeSidebarTab = tabName;
  const btnChats = document.getElementById('btn-sidebar-tab-chats');
  const btnFiles = document.getElementById('btn-sidebar-tab-workspace');
  const panelChats = document.getElementById('sidebar-panel-chats');
  const panelFiles = document.getElementById('sidebar-panel-workspace');

  if (tabName === 'chats') {
    if (btnChats) {
      btnChats.className = 'sidebar-tab-btn active flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold bg-[var(--brand)] text-black transition-all cursor-pointer shadow-xs';
    }
    if (btnFiles) {
      btnFiles.className = 'sidebar-tab-btn flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:text-cyan-400 transition-all cursor-pointer bg-transparent';
    }
    panelChats?.classList.remove('hidden');
    panelFiles?.classList.add('hidden');
  } else {
    if (btnFiles) {
      btnFiles.className = 'sidebar-tab-btn active flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold bg-cyan-500 text-black transition-all cursor-pointer shadow-xs';
    }
    if (btnChats) {
      btnChats.className = 'sidebar-tab-btn flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer bg-transparent';
    }
    panelFiles?.classList.remove('hidden');
    panelChats?.classList.add('hidden');
    loadWorkspaceFileTree();
  }

  updateSidebarToggleButtonsState(true, tabName);
  if (window.lucide) window.lucide.createIcons();
}

export function updateSidebarToggleButtonsState(isOpen, currentTab) {
  const btnChats = document.getElementById('btn-toggle-chat-sidebar');
  const btnFiles = document.getElementById('btn-toggle-workspace-sidebar');

  if (!isOpen) {
    if (btnChats) {
      btnChats.classList.remove('text-[var(--brand)]');
      btnChats.classList.add('text-[var(--text-secondary)]');
      const icon = btnChats.querySelector('i, svg');
      if (icon) {
        icon.classList.remove('text-[var(--brand)]');
        icon.classList.add('text-[var(--text-secondary)]');
      }
    }
    if (btnFiles) {
      btnFiles.classList.remove('text-cyan-400');
      btnFiles.classList.add('text-[var(--text-secondary)]');
      const icon = btnFiles.querySelector('i, svg');
      if (icon) {
        icon.classList.remove('text-cyan-400');
        icon.classList.add('text-[var(--text-secondary)]');
      }
    }
    return;
  }

  if (currentTab === 'chats') {
    if (btnChats) {
      btnChats.classList.add('text-[var(--brand)]');
      btnChats.classList.remove('text-[var(--text-secondary)]');
      const icon = btnChats.querySelector('i, svg');
      if (icon) {
        icon.classList.add('text-[var(--brand)]');
        icon.classList.remove('text-[var(--text-secondary)]');
      }
    }
    if (btnFiles) {
      btnFiles.classList.remove('text-cyan-400');
      btnFiles.classList.add('text-[var(--text-secondary)]');
      const icon = btnFiles.querySelector('i, svg');
      if (icon) {
        icon.classList.remove('text-cyan-400');
        icon.classList.add('text-[var(--text-secondary)]');
      }
    }
  } else {
    if (btnChats) {
      btnChats.classList.remove('text-[var(--brand)]');
      btnChats.classList.add('text-[var(--text-secondary)]');
      const icon = btnChats.querySelector('i, svg');
      if (icon) {
        icon.classList.remove('text-[var(--brand)]');
        icon.classList.add('text-[var(--text-secondary)]');
      }
    }
    if (btnFiles) {
      btnFiles.classList.add('text-cyan-400');
      btnFiles.classList.remove('text-[var(--text-secondary)]');
      const icon = btnFiles.querySelector('i, svg');
      if (icon) {
        icon.classList.add('text-cyan-400');
        icon.classList.remove('text-[var(--text-secondary)]');
      }
    }
  }
}

export async function loadWorkspaceFileTree(filterQuery = '') {
  const treeContainer = document.getElementById('workspace-file-tree');
  if (!treeContainer) return;

  if (!state.activeWorkspace || (state.activeWorkspace.has_workspace === false)) {
    renderEmptyWorkspaceTree(treeContainer);
    return;
  }

  const explorerTitle = document.getElementById('explorer-project-title');
  if (explorerTitle) {
    explorerTitle.textContent = state.activeWorkspace.folder_name || 'Project';
  }

  try {
    const res = await api.invoke('agent_get_file_tree');
    if (res && res.status === 'success' && res.tree) {
      cachedTreeData = res.tree;
      renderWorkspaceFileTree(res.tree, filterQuery);

      const stats = countTreeStats(res.tree);
      const statsEl = document.getElementById('explorer-stats-files');
      if (statsEl) {
        statsEl.textContent = `${stats.files} files, ${stats.dirs} dirs`;
      }
    } else {
      treeContainer.innerHTML = `<div class="p-3 text-xs text-rose-400">Failed to load directory tree: ${escapeHtml(res?.message || 'Unknown error')}</div>`;
    }
  } catch (err) {
    treeContainer.innerHTML = `<div class="p-3 text-xs text-rose-400">Tree Error: ${escapeHtml(err.message)}</div>`;
  }
}

function countTreeStats(node) {
  let files = 0;
  let dirs = 0;
  if (!node) return { files, dirs };

  if (node.files && Array.isArray(node.files)) {
    files += node.files.length;
  }
  if (node.directories && Array.isArray(node.directories)) {
    dirs += node.directories.length;
    for (const d of node.directories) {
      const sub = countTreeStats(d);
      files += sub.files;
      dirs += sub.dirs;
    }
  }
  return { files, dirs };
}

export function renderEmptyWorkspaceTree(container) {
  container.innerHTML = `
    <div class="p-4 text-center text-xs text-[var(--text-muted)] space-y-3 mt-4 select-none">
      <div class="w-10 h-10 mx-auto rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
        <i data-lucide="folder-code" class="w-5 h-5"></i>
      </div>
      <div>
        <div class="font-semibold text-[var(--text-primary)]">No Project Connected</div>
        <p class="text-[11px] text-[var(--text-muted)] mt-1">Select a folder to view files and enable autonomous code editing.</p>
      </div>
      <button id="btn-empty-select-folder" type="button" class="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs">
        <i data-lucide="folder-open" class="w-3.5 h-3.5"></i>
        <span>Open Project Folder</span>
      </button>
    </div>
  `;

  document.getElementById('btn-empty-select-folder')?.addEventListener('click', async () => {
    await selectWorkspaceFolder();
  });

  const statsEl = document.getElementById('explorer-stats-files');
  if (statsEl) statsEl.textContent = '0 files';

  if (window.lucide) window.lucide.createIcons({ root: container });
}

export function renderWorkspaceFileTree(tree, filterQuery = '') {
  const container = document.getElementById('workspace-file-tree');
  if (!container || !tree) return;

  const q = (filterQuery || '').toLowerCase();
  const effectiveExpanded = new Set(expandedFolderPaths);

  if (q) {
    autoExpandMatchingAncestors(tree, q, effectiveExpanded);
  }

  const html = renderDirectoryChildrenHtml(tree, q, effectiveExpanded, true);
  if (!html.trim()) {
    container.innerHTML = `<div class="p-4 text-center text-xs text-[var(--text-muted)] font-mono">No matching files found.</div>`;
    return;
  }

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons({ root: container });
}

function autoExpandMatchingAncestors(dirNode, query, expandSet) {
  let hasMatch = false;
  if (dirNode.files) {
    for (const f of dirNode.files) {
      if (f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query)) {
        hasMatch = true;
      }
    }
  }
  if (dirNode.directories) {
    for (const d of dirNode.directories) {
      if (autoExpandMatchingAncestors(d, query, expandSet)) {
        hasMatch = true;
      }
    }
  }
  if (hasMatch && dirNode.path !== undefined) {
    expandSet.add(dirNode.path);
  }
  return hasMatch;
}

function renderDirectoryChildrenHtml(dirNode, query, expandSet, isRoot = false) {
  let out = '';

  // Render Subdirectories
  if (dirNode.directories && Array.isArray(dirNode.directories)) {
    for (const sub of dirNode.directories) {
      const subDirHtml = renderDirectoryChildrenHtml(sub, query, expandSet, false);
      const nameMatches = sub.name.toLowerCase().includes(query);
      if (query && !nameMatches && !subDirHtml.trim()) {
        continue;
      }

      const isOpen = expandSet.has(sub.path);
      const totalItems = (sub.directories ? sub.directories.length : 0) + (sub.files ? sub.files.length : 0);

      out += `
        <div class="tree-folder ${isOpen ? 'open' : ''}" data-folder-path="${escapeHtml(sub.path)}">
          <div class="tree-folder-row flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-white/5 cursor-pointer text-xs select-none group">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <i data-lucide="chevron-right" class="w-3 h-3 text-zinc-500 tree-chevron shrink-0"></i>
              <i data-lucide="${isOpen ? 'folder-open' : 'folder'}" class="w-3.5 h-3.5 text-cyan-400/90 shrink-0"></i>
              <span class="truncate font-medium text-zinc-200">${escapeHtml(sub.name)}</span>
            </div>
            <span class="text-[10px] text-zinc-500 font-mono shrink-0">${totalItems}</span>
          </div>
          <div class="tree-folder-children ${isOpen ? '' : 'hidden'} pl-2 ml-1.5 border-l border-white/5 space-y-0.5 mt-0.5">
            ${subDirHtml}
          </div>
        </div>
      `;
    }
  }

  // Render Files in this directory
  if (dirNode.files && Array.isArray(dirNode.files)) {
    for (const file of dirNode.files) {
      if (query && !file.name.toLowerCase().includes(query) && !file.path.toLowerCase().includes(query)) {
        continue;
      }

      const iconMeta = getFileIconMeta(file.extension);
      out += `
        <div class="workspace-tree-node flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-white/5 cursor-pointer text-xs select-none group" data-file-path="${escapeHtml(file.path)}" data-file-name="${escapeHtml(file.name)}" data-file-size="${file.size_kb}">
          <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
            <i data-lucide="${iconMeta.icon}" class="w-3.5 h-3.5 ${iconMeta.color} shrink-0"></i>
            <span class="truncate text-zinc-300 group-hover:text-cyan-300 transition-colors">${escapeHtml(file.name)}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-[10px] text-zinc-500 font-mono group-hover:hidden">${file.size_kb}KB</span>
            <div class="tree-node-actions flex items-center gap-0.5">
              <button type="button" class="btn-node-open-vscode p-1 rounded hover:bg-cyan-500/20 text-zinc-400 hover:text-cyan-300 transition-colors" title="Open in VS Code" data-file-path="${escapeHtml(file.path)}">
                <i data-lucide="code" class="w-3 h-3"></i>
              </button>
              <button type="button" class="btn-node-reveal-explorer p-1 rounded hover:bg-indigo-500/20 text-zinc-400 hover:text-indigo-300 transition-colors" title="Reveal in Windows Explorer" data-file-path="${escapeHtml(file.path)}">
                <i data-lucide="folder-open" class="w-3 h-3"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }
  }

  return out;
}

export function getFileIconMeta(ext = '') {
  const norm = (ext || '').toLowerCase();
  switch (norm) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return { icon: 'file-code', color: 'text-amber-400' };
    case 'html':
    case 'htm':
      return { icon: 'file-code', color: 'text-orange-400' };
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { icon: 'palette', color: 'text-cyan-400' };
    case 'json':
      return { icon: 'file-json', color: 'text-yellow-300' };
    case 'cs':
      return { icon: 'file-code', color: 'text-violet-400' };
    case 'py':
      return { icon: 'file-code', color: 'text-emerald-400' };
    case 'md':
    case 'txt':
    case 'log':
      return { icon: 'file-text', color: 'text-zinc-400' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return { icon: 'image', color: 'text-pink-400' };
    case 'sh':
    case 'bash':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return { icon: 'terminal', color: 'text-emerald-300' };
    default:
      return { icon: 'file', color: 'text-zinc-400' };
  }
}

export async function openFilePreviewModal(relPath, fileName, sizeKb) {
  if (!relPath) return;
  activePreviewFilePath = relPath;

  const modal = document.getElementById('modal-file-preview');
  const nameEl = document.getElementById('preview-file-name');
  const pathEl = document.getElementById('preview-file-path');
  const metaEl = document.getElementById('preview-file-meta');
  const codeEl = document.getElementById('preview-file-code');
  const iconEl = document.getElementById('preview-file-icon');

  const baseName = fileName || relPath.split(/[\\/]/).pop();
  const ext = baseName.includes('.') ? baseName.split('.').pop().toLowerCase() : '';

  if (nameEl) nameEl.textContent = baseName;
  if (pathEl) pathEl.textContent = relPath;
  if (metaEl) metaEl.textContent = 'Loading file...';
  if (codeEl) {
    codeEl.textContent = 'Loading content...';
    codeEl.className = 'text-zinc-300 whitespace-pre leading-relaxed';
  }

  if (iconEl) {
    const meta = getFileIconMeta(ext);
    iconEl.setAttribute('data-lucide', meta.icon);
    iconEl.setAttribute('class', `w-4 h-4 ${meta.color}`);
  }

  modal?.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons({ root: modal });

  try {
    const res = await executeAgentTool('read_file', { path: relPath });
    if (res && res.status === 'success') {
      const content = res.content || '';
      const lines = res.lines ?? content.split('\n').length;
      const kb = sizeKb || (res.size_bytes ? (res.size_bytes / 1024).toFixed(1) : '0.0');

      if (metaEl) metaEl.textContent = `${lines} lines • ${kb} KB`;
      if (codeEl) {
        codeEl.textContent = content || '(Empty file)';
        if (ext) codeEl.classList.add(`language-${ext}`);
        if (window.hljs && typeof window.hljs.highlightElement === 'function') {
          try { window.hljs.highlightElement(codeEl); } catch {}
        }
      }
    } else {
      if (metaEl) metaEl.textContent = 'Error';
      if (codeEl) codeEl.textContent = `Failed to read file: ${res?.message || 'Unknown error'}`;
    }
  } catch (err) {
    if (metaEl) metaEl.textContent = 'Error';
    if (codeEl) codeEl.textContent = `Read error: ${err.message}`;
  }
}

export function closeFilePreviewModal() {
  const modal = document.getElementById('modal-file-preview');
  modal?.classList.add('hidden');
  activePreviewFilePath = '';
}

export function insertPreviewCodeToChat() {
  const codeEl = document.getElementById('preview-file-code');
  const chatInput = document.getElementById('chat-user-input');

  if (!codeEl || !chatInput || !activePreviewFilePath) return;

  const content = codeEl.textContent || '';
  const ext = activePreviewFilePath.includes('.') ? activePreviewFilePath.split('.').pop() : '';
  const snippet = `\`\`\`${ext}\n// ${activePreviewFilePath}\n${content}\n\`\`\``;

  if (chatInput.value.trim().length > 0) {
    chatInput.value = `${chatInput.value.trim()}\n\n${snippet}\n`;
  } else {
    chatInput.value = `${snippet}\n`;
  }

  closeFilePreviewModal();
  chatInput.focus();
  showToast('Code Inserted', `Added ${activePreviewFilePath} into chat composer.`, 'success', 2000);
}

