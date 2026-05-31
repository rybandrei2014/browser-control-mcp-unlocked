// firefox-extension/content-script.js
let port = null;

function connect() {
  port = browser.runtime.connect({ name: "content-script" });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_ACTION") {
    handleAction(message.action).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async response
  }
});

async function handleAction(action) {
  switch (action.type) {
    case "CLICK":
      return clickElement(action.selector, action.text);
    case "TYPE":
      return typeIntoElement(action.selector, action.text);
    case "SCROLL":
      window.scrollBy(action.x || 0, action.y || 0);
      return { success: true };
   case "EXECUTE_SCRIPT":
      return eval(action.code);
    case "SET_FILE_INPUT":
      return setFileInput(action.selector, action.filename, action.content, action.mimeType);
    case "PRESS_KEY":
      return pressKey(action.key);
    default:
      throw new Error("Unknown action type");
  }
}

function clickElement(selector, text) {
  let element;
  if (text) {
    element = findElementByText(text);
  } else {
    element = document.querySelector(selector);
  }

  if (element) {
    element.click();
    return { success: true, clicked: element.outerHTML.substring(0, 200) };
  }
  throw new Error("Element not found");
}

function findElementByText(text) {
  const query = text.toLowerCase();

  function isClickable(el) {
    const tag = el.tagName.toLowerCase();
    return (
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('tabindex') !== null
    );
  }

  function isVisible(el) {
    if (el.hidden || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getOwnText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  function matchScore(el) {
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const ownText = getOwnText(el).toLowerCase();
    const allText = (el.textContent || '').trim().toLowerCase();

    if (allText.indexOf(query) === -1) return 0;

    let score = 0;

    if (ariaLabel === query) score += 100;
    else if (ariaLabel.includes(query)) score += 50;

    if (title === query) score += 80;
    else if (title.includes(query)) score += 40;

    if (ownText === query) score += 60;
    else if (ownText.includes(query)) score += 30;

    if (isClickable(el)) score += 5;

    return score;
  }

  const elements = [...document.querySelectorAll('*')];
  const scored = elements
    .map(el => ({ el, score: matchScore(el) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { el } of scored) {
    if (isVisible(el) && isClickable(el)) return el;
  }

  for (const { el } of scored) {
    if (isVisible(el)) return el;
  }

  for (const { el } of scored) {
    if (isClickable(el)) return el;
  }

  return scored.length > 0 ? scored[0].el : null;
}

function typeIntoElement(selector, text) {
  const element = document.querySelector(selector);
  if (element) {
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }
  throw new Error("Input element not found");
}

function setFileInput(selector, filename, content, mimeType) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error("File input element not found");
  }
  if (element.type !== "file") {
    throw new Error("Element is not a file input");
  }

  let fileData;
  if (element.dataset._wasBase64 === "true" || content.includes("/") || content.includes("+")) {
    const binaryString = atob(content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    fileData = bytes;
  } else {
    fileData = content;
  }

  const file = new File([fileData], filename, { type: mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  element.files = dataTransfer.files;
  element.dispatchEvent(new Event("change", { bubbles: true }));

  return { success: true, filename: filename };
}

function pressKey(key) {
  const keydown = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(keydown);

  const keyup = new KeyboardEvent('keyup', {
    key,
    code: key,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(keyup);

  return { success: true, key };
}