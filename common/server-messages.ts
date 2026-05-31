export interface ServerMessageBase {
  cmd: string;
}

export interface OpenTabServerMessage extends ServerMessageBase {
  cmd: "open-tab";
  url: string;
}

export interface CloseTabsServerMessage extends ServerMessageBase {
  cmd: "close-tabs";
  tabIds: number[];
}

export interface GetTabListServerMessage extends ServerMessageBase {
  cmd: "get-tab-list";
}

export interface GetBrowserRecentHistoryServerMessage extends ServerMessageBase {
  cmd: "get-browser-recent-history";
  searchQuery?: string;
}

export interface GetTabContentServerMessage extends ServerMessageBase {
  cmd: "get-tab-content";
  tabId: number;
  offset?: number;
}

export interface ReorderTabsServerMessage extends ServerMessageBase {
  cmd: "reorder-tabs";
  tabOrder: number[];
}

export interface FindHighlightServerMessage extends ServerMessageBase {
  cmd: "find-highlight";
  tabId: number;
  queryPhrase: string;
}

export interface GroupTabsServerMessage extends ServerMessageBase {
  cmd: "group-tabs";
  tabIds: number[];
  isCollapsed: boolean;
  groupColor: string;
  groupTitle: string;
}

export interface ClickElementServerMessage extends ServerMessageBase {
  cmd: "click";
  selector?: string;        // CSS selector
  text?: string;            // Click by visible text (alternative to selector)
  tabId?: number;
}

export interface TypeTextServerMessage extends ServerMessageBase {
  cmd: "type";
  selector: string;         // CSS selector for input/textarea
  text: string;
  tabId?: number;
}

export interface ScrollPageServerMessage extends ServerMessageBase {
  cmd: "scroll";
  x?: number;
  y?: number;
  tabId?: number;
}

export interface SetFileInputServerMessage extends ServerMessageBase {
  cmd: "set-file-input";
  selector: string;
  filename: string;
  content: string;
  mimeType?: string;
  tabId?: number;
}

export interface PressKeyServerMessage extends ServerMessageBase {
  cmd: "press-key";
  key: string;
  tabId?: number;
}

// ================================================================

export type ServerMessage =
  | OpenTabServerMessage
  | CloseTabsServerMessage
  | GetTabListServerMessage
  | GetBrowserRecentHistoryServerMessage
  | GetTabContentServerMessage
  | ReorderTabsServerMessage
  | FindHighlightServerMessage
  | GroupTabsServerMessage
  | ClickElementServerMessage      // ← New
  | TypeTextServerMessage          // ← New
  | ScrollPageServerMessage        // ← New
  | SetFileInputServerMessage      // ← New
  | PressKeyServerMessage;         // ← New

export type ServerMessageRequest = ServerMessage & { correlationId: string };
