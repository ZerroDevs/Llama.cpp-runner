/**
 * Llama Server Control - Central Application State
 */

export const state = {
  config: {},
  models: [],
  serverRunning: false,
  swarmRunning: false,
  activeTab: 'tab-dashboard',
  selectedPreset: 'general',
  chatMessages: [],
  chatSessions: [],
  activeSessionId: null,
  chatSidebarOpen: true,
  attachedImages: [],
  attachedDocuments: [],
  isStreaming: false,
  enableReasoning: true,
  isAgentMode: false,
  activeWorkspace: null,
  isAgentRunning: false,
  abortController: null,
  galleryImages: [],
  gallerySelected: new Set(),
  gallerySelectMode: false,
  logs: [],
  logFilter: '',
  logSourceFilter: 'all',
  logAutoScroll: true,
  currentTps: 0,
  tokenCount: 0,
  telemetryTimer: null,
  isWindowVisible: true
};
