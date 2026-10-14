import { validateEndpoint } from './commands.js';
document.getElementById('connect').addEventListener('click', () => {
  try {
    const ws = validateEndpoint(document.getElementById('endpoint').value), token = document.getElementById('token').value.trim();
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Copy the 32-character token from Android');
    location.assign(`index.html?control=1#${new URLSearchParams({ ws, token })}`);
  } catch (error) { document.getElementById('error').textContent = error.message; }
});
document.getElementById('endpoint').focus();
