// Semantic editor controls with bounded, value-free failure diagnostics.
import assert from 'node:assert/strict';
export async function editorControl(editor, role, name, { enabled = true, option, onFailure = () => {} } = {}) {
  const locator = editor.getByRole(role, { name, exact: typeof name === 'string' });
  const count = await locator.count();
  const expectedTag = { combobox: 'SELECT', textbox: 'TEXTAREA', spinbutton: 'INPUT', checkbox: 'INPUT', button: 'BUTTON' }[role];
  const detail = count === 1 ? await locator.evaluate(e => ({ tag: e.tagName, type: e.getAttribute('type'), visible: Boolean(e.getClientRects().length), disabled: e.matches(':disabled'), options: e.tagName === 'SELECT' ? Array.from(e.options, o => o.value) : undefined })) : null;
  if (count !== 1 || !detail.visible || detail.tag !== expectedTag || (role === 'spinbutton' && detail.type !== 'number') || (role === 'checkbox' && detail.type !== 'checkbox') || detail.disabled === enabled || (option !== undefined && !detail.options?.includes(option))) {
    const controls = await editor.locator('select, textarea, input, button').evaluateAll(nodes => nodes.map(e => {
      const label = e.labels?.[0]?.cloneNode(true); label?.querySelectorAll('input, textarea, select').forEach(n => n.remove());
      return { tag: e.tagName, type: e.getAttribute('type'), label: e.getAttribute('aria-label') || label?.textContent?.trim() || (e.tagName === 'BUTTON' ? e.textContent?.trim() : ''), visible: Boolean(e.getClientRects().length), disabled: e.matches(':disabled'), options: e.tagName === 'SELECT' ? Array.from(e.options, o => o.value) : undefined };
    }).filter(e => e.tag === 'SELECT' || e.tag === 'TEXTAREA' || e.type === 'number' || e.type === 'checkbox').slice(0, 24));
    onFailure({ expectedRole: role, expectedName: String(name), count, detail, controls });
    throw new Error(`EDITOR_CONTROL_MISMATCH role=${role} name=${name} count=${count}`);
  }
  return locator;
}
export async function selectEditorOption(editor, name, value, onFailure) {
  const control = await editorControl(editor, 'combobox', name, { option: value, onFailure });
  await control.selectOption(value);
  assert.equal(await control.inputValue(), value, `EDITOR_OPTION_NOT_APPLIED ${name}`);
}
