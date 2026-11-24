// Small modal with several choices. Resolves with the `value` of the pressed button (or `cancel`).

import { domEl } from './dom.js';

// `details` (optional) is a list of short lines shown under the message.
export function choiceDialog({ title, message, details = null, buttons, cancel = null }) {
  return new Promise((resolve) => {
    const done = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(cancel);
    };
    const overlay = domEl('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      domEl('div', { class: 'sheet-card dlg' },
        domEl('h2', { class: 'dlg-title' }, title),
        message ? domEl('p', { class: 'dlg-msg' }, message) : null,
        details && details.length ? domEl('ul', { class: 'dlg-details' }, details.map((d) => domEl('li', null, d))) : null,
        domEl('div', { class: 'dlg-btns' }, buttons.map((b) => domEl('button', {
          type: 'button',
          class: 'btn' + (b.primary ? ' primary' : ''),
          'data-value': String(b.value),
          onclick: () => done(b.value),
        }, b.label)))));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.querySelector('button').focus();
  });
}
