import type { ServerMessageRequest } from "@browser-control-mcp/common";
import { WebsocketClient } from "./client";
import { isCommandAllowed, isDomainInDenyList, COMMAND_TO_TOOL_ID, addAuditLogEntry } from "./extension-config";

export class MessageHandler {
  private client: WebsocketClient;

  constructor(client: WebsocketClient) {
    this.client = client;
  }

  public async handleDecodedMessage(req: ServerMessageRequest): Promise<void> {
    const isAllowed = await isCommandAllowed(req.cmd);
    if (!isAllowed) {
      throw new Error(`Command '${req.cmd}' is disabled in extension settings`);
    }

    this.addAuditLogForReq(req).catch((error) => {
      console.error("Failed to add audit log entry:", error);
    });

    switch (req.cmd) {
      case "open-tab":
        await this.openUrl(req.correlationId, req.url);
        break;
      case "close-tabs":
        await this.closeTabs(req.correlationId, req.tabIds);
        break;
      case "get-tab-list":
        await this.sendTabs(req.correlationId);
        break;
      case "get-browser-recent-history":
        await this.sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        await this.sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        await this.reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        await this.findAndHighlightText(
          req.correlationId,
          req.tabId,
          req.queryPhrase
        );
        break;
      case "group-tabs":
        await this.groupTabs(
          req.correlationId,
          req.tabIds,
          req.isCollapsed,
          req.groupColor as browser.tabGroups.Color,
          req.groupTitle
        );
        break;
      case "click":
        await this.clickElement(
          req.correlationId,
          req.selector,
          req.text,
          req.tabId
        );
        break;

      case "type":
        await this.typeText(
          req.correlationId,
          req.selector,
          req.text,
          req.tabId
        );
        break;

      case "scroll":
        await this.scrollPage(
          req.correlationId,
          req.x,
          req.y,
          req.tabId
        );
        break;

      case "set-file-input":
        await this.setFileInput(
          req.correlationId,
          req.selector,
          req.filename,
          req.content,
          req.mimeType,
          req.tabId
        );
        break;
      case "press-key":
        await this.pressKey(
          req.correlationId,
          req.key,
          req.tabId
        );
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  private async addAuditLogForReq(req: ServerMessageRequest) {
    // Get the URL in context (either from param or from the tab)
    let contextUrl: string | undefined;
    if ("url" in req && req.url) {
      contextUrl = req.url;
    }
    if ("tabId" in req && req.tabId !== undefined) {
      try {
        const tab = await browser.tabs.get(req.tabId);
        contextUrl = tab.url;
      } catch (error) {
        console.error("Failed to get tab URL for audit log:", error);
      }
    }

    const toolId = COMMAND_TO_TOOL_ID[req.cmd];
    const auditEntry = {
      toolId,
      command: req.cmd,
      timestamp: Date.now(),
      url: contextUrl
    };
    
    await addAuditLogEntry(auditEntry);
  }

  private async openUrl(correlationId: string, url: string): Promise<void> {
    if (!url.startsWith("https://")) {
      console.error("Invalid URL:", url);
      throw new Error("Invalid URL");
    }

    if (await isDomainInDenyList(url)) {
      throw new Error("Domain in user defined deny list");
    }

    const tab = await browser.tabs.create({
      url,
    });

    await this.client.sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
    });
  }

  private async closeTabs(
    correlationId: string,
    tabIds: number[]
  ): Promise<void> {
    await browser.tabs.remove(tabIds);
    await this.client.sendResourceToServer({
      resource: "tabs-closed",
      correlationId,
    });
  }

  private async sendTabs(correlationId: string): Promise<void> {
    const tabs = await browser.tabs.query({});
    await this.client.sendResourceToServer({
      resource: "tabs",
      correlationId,
      tabs,
    });
  }

  private async sendRecentHistory(
    correlationId: string,
    searchQuery: string | null = null
  ): Promise<void> {
    const historyItems = await browser.history.search({
      text: searchQuery ?? "", // Search for all URLs (empty string matches everything)
      maxResults: 200, // Limit to 200 results
      startTime: 0, // Search from the beginning of time
    });
    const filteredHistoryItems = historyItems.filter((item) => {
      return !!item.url;
    });
    await this.client.sendResourceToServer({
      resource: "history",
      correlationId,
      historyItems: filteredHistoryItems,
    });
  }



  private async sendTabsContent(
    correlationId: string,
    tabId: number,
    offset?: number
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

    const MAX_CONTENT_LENGTH = 50_000;
    const results = await browser.tabs.executeScript(tabId, {
      code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && link.url.startsWith('https://') && !link.url.includes('#'));
        }

        function getTextContent() {
          let isTruncated = false;
          let text = document.body.innerText.substring(${Number(offset) || 0});
          if (text.length > ${MAX_CONTENT_LENGTH}) {
            text = text.substring(0, ${MAX_CONTENT_LENGTH});
            isTruncated = true;
          }
          return {
            text, isTruncated
          }
        }

        function getAriaLabels() {
          const elements = document.querySelectorAll('[aria-label]');
          const labels = [];
          for (const el of elements) {
            const tag = el.tagName.toLowerCase();
            if (tag === 'button' || tag === 'a' || tag === 'input' || el.getAttribute('role') === 'button') {
              labels.push('[' + tag + '] aria-label="' + el.getAttribute('aria-label') + '"');
            }
          }
          return labels.join('\\n');
        }

        const textContent = getTextContent();

        return {
          links: getLinks(),
          fullText: textContent.text,
          isTruncated: textContent.isTruncated,
          totalLength: document.body.innerText.length,
          ariaLabels: getAriaLabels()
        };
      })();
    `,
    });
    const { isTruncated, fullText, links, totalLength, ariaLabels } = results[0];
    await this.client.sendResourceToServer({
      resource: "tab-content",
      tabId,
      correlationId,
      isTruncated,
      fullText,
      links,
      totalLength,
      ariaLabels,
    });
  }

  private async reorderTabs(
    correlationId: string,
    tabOrder: number[]
  ): Promise<void> {
    // Reorder the tabs sequentially
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      const tabId = tabOrder[newIndex];
      await browser.tabs.move(tabId, { index: newIndex });
    }
    await this.client.sendResourceToServer({
      resource: "tabs-reordered",
      correlationId,
      tabOrder,
    });
  }

  private async findAndHighlightText(
    correlationId: string,
    tabId: number,
    queryPhrase: string
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);

    if (tab.url && (await isDomainInDenyList(tab.url))) {
      throw new Error(`Domain in tab URL is in the deny list`);
    }

   const findResults = await browser.find.find(queryPhrase, {
      tabId,
      caseSensitive: true,
    });

    // If there are results, highlight them
    if (findResults.count > 0) {
      // But first, activate the tab. In firefox, this would also enable
      // auto-scrolling to the highlighted result.
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({
        tabId,
      });
    }

    await this.client.sendResourceToServer({
      resource: "find-highlight-result",
      correlationId,
      noOfResults: findResults.count,
    });
  }

  private async groupTabs(
    correlationId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: browser.tabGroups.Color,
    groupTitle: string
  ): Promise<void> {
    const groupId = await browser.tabs.group({
      tabIds,
    });

    let tabGroup = await browser.tabGroups.update(groupId, {
      collapsed: isCollapsed,
      color: groupColor,
      title: groupTitle,
    });

    await this.client.sendResourceToServer({
      resource: "new-tab-group",
      correlationId,
      groupId: tabGroup.id,
    });
  }

  private async executePageAction(
    correlationId: string,
    tabId: number | undefined,
    action: any
  ): Promise<void> {
    if (!tabId) {
      tabId = (await browser.tabs.query({ active: true, currentWindow: true }))[0].id!;
    }

    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "EXECUTE_ACTION",
        action: action
      });

      await this.client.sendSuccess(correlationId, response);
    } catch (error) {
      await this.client.sendErrorToServer(correlationId, `Page action failed: ${error}`);
    }
  }

  // Click on element
  private async clickElement(correlationId: string, selector?: string, text?: string, tabId?: number) {
    await this.executePageAction(correlationId, tabId, {
      type: "CLICK",
      selector,
      text
    });
  }

  // Type into input field
  private async typeText(correlationId: string, selector: string, text: string, tabId?: number) {
    await this.executePageAction(correlationId, tabId, {
      type: "TYPE",
      selector,
      text
    });
  }

  // Scroll the page
  private async scrollPage(correlationId: string, x: number = 0, y: number = 300, tabId?: number) {
    await this.executePageAction(correlationId, tabId, {
      type: "SCROLL",
      x,
      y
    });
  }

  private async setFileInput(
    correlationId: string,
    selector: string,
    filename: string,
    content: string,
    mimeType?: string,
    tabId?: number
  ) {
    await this.executePageAction(correlationId, tabId, {
      type: "SET_FILE_INPUT",
      selector,
      filename,
      content,
      mimeType: mimeType || "application/octet-stream"
    });
  }

private async pressKey(
    correlationId: string,
    key: string,
    tabId?: number
  ) {
    if (!tabId) {
      tabId = (await browser.tabs.query({ active: true, currentWindow: true }))[0].id!;
    }

   await browser.tabs.executeScript(tabId, {
      code: `
        (function() {
          const keydown = new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true });
          const keyup = new KeyboardEvent('keyup', { key: '${key}', bubbles: true, cancelable: true });
          document.dispatchEvent(keydown);
          document.dispatchEvent(keyup);
        })();
      `,
    });

   await this.client.sendSuccess(correlationId, { success: true, key });
  }
}
