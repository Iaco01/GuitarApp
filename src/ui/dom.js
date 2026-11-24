// Tiny DOM helper for the UI modules.

export function domEl(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('--')) node.style.setProperty(k, v);
        else node.style[k] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  domAppend(node, children);
  return node;
}

export function domAppend(node, children) {
  for (const child of children) {
    if (Array.isArray(child)) domAppend(node, child);
    else if (child === null || child === undefined || child === false) continue;
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function domClear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
