(() => {
  if (globalThis.__localAuthenticator) return;
  globalThis.__localAuthenticator = true;
  let busy = false, timer;
  const filled = new WeakSet();
  const visible = input => !input.disabled && !input.readOnly && input.type !== 'hidden' && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden';
  const usernameInputs = () => [...document.querySelectorAll('input')].filter(input => /^(email|text|search|tel)$/.test(input.type) && (/username|email/i.test(`${input.autocomplete} ${input.name} ${input.id}`) || input.type === 'email'));
  function usernames() {
    const inputs = usernameInputs().map(x => x.value.trim()).filter(Boolean);
    if (inputs.length) return inputs;
    return [...document.querySelectorAll('[data-username], [data-email], [class*="email"], [id*="email"]')].map(x => x.getAttribute('data-username') || x.getAttribute('data-email') || x.textContent?.trim()).filter(x => x && x.length < 200 && !/\s/.test(x));
  }
  function remember() {
    const username = usernameInputs().find(x => x.value.trim())?.value.trim();
    if (username) void chrome.runtime.sendMessage({ type: 'REMEMBER_USER', username }).catch(() => {});
  }
  function fields() {
    const inputs = [...document.querySelectorAll('input')].filter(x => visible(x) && ['text', 'tel', 'number', 'password'].includes(x.type));
    const otp = inputs.filter(x => x.autocomplete === 'one-time-code' || (!/password|username|email|phone|search/i.test(`${x.name} ${x.id}`) && /(?:otp|totp|mfa|2fa|verification.?code|auth.?code|security.?code|验证码|动态码)/i.test(`${x.name} ${x.id} ${x.placeholder} ${x.getAttribute('aria-label')} ${[...(x.labels ?? [])].map(y => y.textContent).join(' ')}`)));
    const single = otp.find(x => x.maxLength !== 1);
    if (single) return [single];
    // Group split fields within their immediate container; do not combine forms.
    for (const first of inputs.filter(x => x.maxLength === 1)) {
      const group = inputs.filter(x => x.maxLength === 1 && x.parentElement === first.parentElement);
      if ([6, 8].includes(group.length) && (group.some(x => otp.includes(x)) || group.every(x => x.inputMode === 'numeric'))) return group;
    }
    return [];
  }
  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    filled.add(input);
  }
  async function scan() {
    if (busy || document.visibilityState === 'hidden') return;
    const targets = fields();
    if (!targets.length || targets.some(x => x.value || filled.has(x))) return;
    busy = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CODE', usernames: usernames() });
      const code = response?.ok && response.data?.code;
      if (!code || targets.some(x => !x.isConnected || x.value)) return;
      if (targets.length === 1) {
        if (targets[0].maxLength > 0 && targets[0].maxLength < code.length) return;
        setValue(targets[0], code);
      } else if (targets.length === code.length) targets.forEach((input, i) => setValue(input, code[i]));
    } catch { /* Extension reload or removed permission; leave the form untouched. */ }
    finally { busy = false; }
  }
  document.addEventListener('input', remember, true);
  document.addEventListener('change', remember, true);
  document.addEventListener('submit', remember, true);
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 180); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'class', 'style', 'hidden'] });
  setInterval(scan, 1500);
  remember(); void scan();
})();
